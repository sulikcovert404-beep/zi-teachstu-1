import crypto from "crypto";
import { db } from "@/lib/db";
import { ApiError, Errors } from "@/server/core/errors";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { createSession } from "@/server/auth/session";
import type { AuthContext } from "@/server/auth/session";

// Round 16 — Telegram channel plumbing (spec §22/§23).
// initData validation per Telegram WebApp spec:
//   secret      = HMAC_SHA256(key="WebAppData", data=bot_token)
//   data_string = sorted "k=v" pairs (except hash) joined with \n
//   hash        = HMAC_SHA256(key=secret, data=data_string)
// The bot token NEVER leaves the server; the bot mini-service fetches it over
// localhost with a shared internal secret header.

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export function parseInitDataUser(initData: string): { user: TelegramUser; authDate: number } | null {
  try {
    const params = new URLSearchParams(initData);
    const rawUser = params.get("user");
    const authDate = Number(params.get("auth_date") ?? 0);
    if (!rawUser || !authDate) return null;
    const u = JSON.parse(rawUser) as {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    if (typeof u.id !== "number" || !u.first_name) return null;
    return {
      authDate,
      user: {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        photoUrl: u.photo_url,
      },
    };
  } catch {
    return null;
  }
}

export async function verifyInitData(initData: string): Promise<TelegramUser> {
  const settings = await getSettings();
  if (!settings.telegramBotToken) throw Errors.channelNotConfigured();

  const parsed = parseInitDataUser(initData);
  if (!parsed) throw Errors.validation("دادهٔ ورودی مینی‌اپ تلگرام نامعتبر است.");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw Errors.validation("امضای تلگرام یافت نشد.");

  // data-check-string: sorted key=value pairs excluding hash, joined by \n
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(settings.telegramBotToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Errors.unauthenticated(); // forged/expired initData — never trust client identity otherwise
  }

  // Freshness: reject initData older than 24h (replay window)
  if (Date.now() / 1000 - parsed.authDate > 24 * 3600) {
    throw Errors.unauthenticated();
  }
  return parsed.user;
}

// ── Bot API helpers (server→Telegram, outbound only) ──

async function telegramApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !json?.ok) {
    throw Errors.conflict(
      "TELEGRAM_API_ERROR",
      `اتصال به تلگرام ناموفق بود: ${json?.description ?? `HTTP ${res.status}`}`
    );
  }
  return json.result as T;
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
  can_join_groups?: boolean;
}

export async function getBotInfo(): Promise<BotInfo> {
  const settings = await getSettings();
  if (!settings.telegramBotToken) {
    throw Errors.channelNotConfigured("ابتدا توکن بات تلگرام را ذخیره کنید.");
  }
  return telegramApi<BotInfo>(settings.telegramBotToken, "getMe");
}

export async function pingGemini(): Promise<{ ok: true; model: string; reply: string }> {
  const { resolveAiProvider } = await import("./settings");
  const cfg = await resolveAiProvider();
  if (cfg.provider !== "gemini" || !cfg.apiKey) {
    throw Errors.validation("ابتدا کلید API جمینای را ذخیره و ارائه‌دهنده را روی جمینای تنظیم کنید.");
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "سلام را کوتاه جواب بده." }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  const json = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    // Round 25 — تشخیص محدودیت جغرافیایی: کلید معتبر است اما گوگل موقعیت IP
    // این سرور را نمی‌پذیرد؛ توضیح فارسی دقیق به‌جای پیام خام گوگل.
    if (/user location is not supported/i.test(msg)) {
      throw Errors.conflict(
        "GEMINI_GEO_BLOCKED",
        "کلید شما معتبر است اما گوگل اجازهٔ استفاده از موقعیت جغرافیایی این سرور را نمی‌دهد (محدودیت منطقه‌ای API). " +
          "این محدودیت سمت گوگل است و با تغییر کلید رفع نمی‌شود — پیشنهاد: ارائه‌دهندهٔ پیش‌فرض zai را فعال نگه دارید."
      );
    }
    throw Errors.conflict("GEMINI_TEST_FAILED", `آزمون اتصال جمینای ناموفق بود: ${msg.slice(0, 160)}`);
  }
  const reply = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!reply) throw Errors.conflict("GEMINI_TEST_FAILED", "جمینای پاسخی برنگرداند (متن خالی).");
  return { ok: true, model: cfg.model, reply: reply.slice(0, 200) };
}

// ── Round 25 — فهرست زندهٔ مدل‌های جمینای از خود API گوگل ──
// درخواست مدیر: «مدل‌های api جمینای با خود api دریافت کن تا انتخاب کنم» —
// چون فهرست ایستا (۲.۵ و…) قدیمی است. تأیید شد: gemini-2.5-flash/pro برای
// کاربران جدید بازنشسته شده‌اند (گوگل خودش gemini-3.6-flash و
// gemini-3.1-pro-preview را جایگزین معرفی می‌کند).
//
// دو مسیر دریافت:
//  ۱) ListModels رسمی (models.list) — در میزبانی‌های بدون محدودیت جغرافیایی.
//  ۲) آزمون مستقیم مدل‌ها (countTokens — رایگان و بدون تولید) — وقتی گوگل
//     ListModels را با «User location is not supported» می‌بندد. امضای پاسخ‌ها
//     قطعی است: ۴۰۰ محدودیت جغرافیایی یا ۴۲۹ سهمیه = مدل موجود است؛
//     ۴۰۴ «no longer available…use models/X» = بازنشسته (X = جایگزین)؛
//     ۴۰۴ «not found» = نامعتبر. جایگزین‌ها به‌صورت زنجیره‌ای دنبال می‌شوند.
export interface GeminiModelInfo {
  code: string; // بدون پیشوند «models/» — همان کدی که در generateContent استفاده می‌شود
  label: string; // برچسب فارسی/نمایشی
  deprecated: boolean; // گوگل مدل را منسوخ اعلام کرده
}

export interface GeminiModelsResult {
  models: GeminiModelInfo[];
  source: "list" | "probe"; // list = ListModels رسمی؛ probe = آزمون مستقیم (محدودیت جغرافیایی)
  geoRestricted: boolean; // true = گوگل دسترسی از موقعیت این سرور را می‌بندد
  noteFa?: string; // توضیح فارسی برای نمایش در رابط (فقط وقتی geoRestricted)
}

const GEO_BLOCK_SIG = /user location is not supported/i;
const RETIRED_HINT_RE = /no longer available[^\n]*?use (?:models\/)?([a-zA-Z0-9._-]+)/i;

// نام‌های کاندید آزمون — فهرست ایستای قبلی + نام‌های مستعار رسمی گوگل + نسل‌های جدید
const PROBE_SEEDS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-pro-latest",
  "gemini-3.6-flash",
  "gemini-3.6-pro",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash",
];

function persianModelLabel(code: string): string {
  // gemini-3.6-flash → «جمینای ۳.۶ فلش»؛ gemini-flash-latest → «جمینای فلش (همیشه جدیدترین)»
  const ver = code.match(/(\d+(?:\.\d+)?)/);
  const faVer = ver ? ver[1].replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : "";
  let suffix = "";
  if (/flash-lite/i.test(code)) suffix = "فلش لایت";
  else if (/flash/i.test(code)) suffix = "فلش";
  else if (/pro/i.test(code)) suffix = "پرو";
  if (/preview/i.test(code)) suffix += " (پیش‌نمایش)";
  if (/exp/i.test(code)) suffix += " (آزمایشی)";
  if (/latest/i.test(code)) suffix += " (همیشه جدیدترین)";
  if (!suffix && !faVer) return code;
  const parts = code.startsWith("gemini") ? ["جمینای", faVer, suffix] : [code, faVer, suffix];
  return parts.filter(Boolean).join(" ");
}

async function probeOneModel(
  apiKey: string,
  code: string
): Promise<{ status: "available" | "retired" | "missing"; hint?: string; geo?: boolean }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(code)}:countTokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "." }] }] }),
        signal: AbortSignal.timeout(12_000),
      }
    );
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = json?.error?.message ?? "";
    if (res.ok) return { status: "available" };
    if (GEO_BLOCK_SIG.test(msg)) return { status: "available", geo: true };
    if (res.status === 429) return { status: "available" }; // از بررسی مدل/کلید گذشته است
    const hint = RETIRED_HINT_RE.exec(msg)?.[1];
    if (hint) return { status: "retired", hint };
    if (res.status === 404) return { status: "missing" };
    return { status: "missing" };
  } catch {
    return { status: "missing" };
  }
}

export async function listGeminiModels(apiKey: string): Promise<GeminiModelsResult> {
  // ── مسیر ۱: ListModels رسمی ──
  try {
    const listed = await fetchGeminiModelsList(apiKey);
    return { models: listed, source: "list", geoRestricted: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // فقط «محدودیت جغرافیایی» به مسیر آزمون مستقیم می‌رود؛ خطای کلید و غیره مستقیم
    // به کاربر می‌رسد تا علت واقعی (کلید نامعتبر و…) پنهان نشود.
    if (!GEO_BLOCK_SIG.test(msg)) throw e;
  }

  // ── مسیر ۲: آزمون مستقیم (گوگل ListModels را برای این موقعیت بسته) ──
  const queue = [...PROBE_SEEDS];
  const seen = new Set(queue);
  const results: GeminiModelInfo[] = [];
  let geoHit = false;

  // آزمون با هم‌زمانی محدود (دسته‌های ۶تایی) — هر نام حداکثر یک‌بار؛
  // جایگزین‌های پیشنهادی گوگل («use models/X») در همین صف می‌پیوندند.
  while (queue.length) {
    const batch: string[] = [];
    while (batch.length < 6 && queue.length) batch.push(queue.shift()!);
    const batchResults = await Promise.all(batch.map((code) => probeOneModel(apiKey, code)));
    batch.forEach((code, i) => {
      const r = batchResults[i];
      if (r.geo) geoHit = true;
      if (r.status === "available") results.push({ code, label: persianModelLabel(code), deprecated: false });
      if (r.status === "retired" && r.hint && !seen.has(r.hint)) {
        seen.add(r.hint);
        queue.push(r.hint); // جایگزین پیشنهادی گوگل را هم آزمون کن
      }
    });
  }

  if (!results.length) {
    throw Errors.conflict(
      "GEMINI_MODELS_FAILED",
      "هیچ مدلی برای این کلید در دسترس نبود — کلید یا سهمیهٔ گوگل را بررسی کنید."
    );
  }

  // ترتیب: جمینای‌ها اول (نسل بالاتر اول) → سایر بردها؛ نام‌های خام آخر
  const generationOf = (code: string): number => {
    const m = code.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return -1;
    return Number(m[1]) * 100 + Number(m[2] ?? 0);
  };
  results.sort((a, b) => {
    const brandA = a.code.startsWith("gemini") ? 0 : 1;
    const brandB = b.code.startsWith("gemini") ? 0 : 1;
    if (brandA !== brandB) return brandA - brandB;
    const genDiff = generationOf(b.code) - generationOf(a.code);
    if (genDiff !== 0) return genDiff;
    if (/latest/i.test(b.code) !== /latest/i.test(a.code)) return /latest/i.test(b.code) ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  return {
    models: results,
    source: "probe",
    geoRestricted: geoHit, // دست‌کم یک مدلِ موجود با خطای محدودیت جغرافیایی پاسخ داد
    noteFa: geoHit
      ? "گوگل فهرست رسمی مدل‌ها (ListModels) را برای موقعیت جغرافیایی این سرور بسته است؛ فهرست بالا با «آزمون مستقیم» هر مدل ساخته شده و همهٔ آن‌ها برای کلید شما در دسترس‌اند. توجه: تولید محتوا با جمینای نیز ممکن است از همین محدودیت جغرافیایی متأثر شود — در صورت خطای مکرر، ارائه‌دهندهٔ پیش‌فرض zai را فعال نگه دارید."
      : "فهرست رسمی مدل‌ها برای موقعیت این سرور در دسترس نبود؛ این فهرست با «آزمون مستقیم» هر مدل ساخته شده است.",
  };
}

// ListModels رسمی — models.list با صفحه‌بندی؛ فقط مدل‌های generateContent
async function fetchGeminiModelsList(apiKey: string): Promise<GeminiModelInfo[]> {
  const models: GeminiModelInfo[] = [];
  let pageToken: string | undefined;

  // تا ۳ صفحه × ۱۰۰ — کل کاتالوگ عمومی گوگل معمولاً زیر ۱۰۰ مدل است.
  for (let page = 0; page < 3; page++) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      throw Errors.conflict("GEMINI_MODELS_FAILED", `دریافت فهرست مدل‌های جمینای ناموفق بود: ${msg.slice(0, 160)}`);
    }

    for (const m of json?.models ?? []) {
      const code = (m.name ?? "").replace(/^models\//, "");
      // فقط مدل‌های تولید محتوا (embedding/tts/… کنار گذاشته می‌شوند)
      if (!code || !(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      models.push({
        code,
        label: m.displayName || persianModelLabel(code),
        deprecated: /deprecated/i.test(m.description ?? ""),
      });
    }
    if (!json?.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  if (!models.length) {
    throw Errors.conflict("GEMINI_MODELS_FAILED", "گوگل هیچ مدل سازگاری برای این کلید برنگرداند.");
  }

  // ترتیب: جمینای‌ها اول (نسل بالاتر اول)؛ منسوخ‌ها آخرِ گروه
  const generationOf = (code: string): number => {
    const m = code.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return -1;
    return Number(m[1]) * 100 + Number(m[2] ?? 0);
  };
  models.sort((a, b) => {
    const brandA = a.code.startsWith("gemini") ? 0 : 1;
    const brandB = b.code.startsWith("gemini") ? 0 : 1;
    if (brandA !== brandB) return brandA - brandB;
    const genDiff = generationOf(b.code) - generationOf(a.code);
    if (genDiff !== 0) return genDiff;
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
    return a.code.localeCompare(b.code);
  });

  return models;
}

// One-click bot configuration: sets the Mini App as the bot's menu button,
// installs Persian commands, and writes a proper description + about text.
export async function autoConfigureBot(ctx: AuthContext) {
  const settings = await getSettings();
  if (!settings.telegramBotToken) throw Errors.channelNotConfigured("ابتدا توکن بات تلگرام را ذخیره کنید.");
  if (!settings.telegramMiniAppUrl) {
    throw Errors.validation("ابتدا «آدرس مینی‌اپ» (لینک HTTPS عمومی پلتفرم) را ذخیره کنید.");
  }

  const token = settings.telegramBotToken;
  const url = settings.telegramMiniAppUrl;

  const me = await telegramApi<BotInfo>(token, "getMe");

  await telegramApi(token, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "🎓 باز کردن پلتفرم", web_app: { url } },
  });

  await telegramApi(token, "setMyCommands", {
    commands: [
      { command: "start", description: "شروع و اتصال حساب" },
      { command: "books", description: "کتاب‌خانه هوشمند 📚" },
      { command: "quiz", description: "آزمون نمونه و کسب امتیاز ✍️" },
      { command: "points", description: "امتیازهای من ⭐" },
      { command: "app", description: "باز کردن مینی‌اپ 🎓" },
      { command: "help", description: "راهنما" },
    ],
  });

  await telegramApi(token, "setMyDescription", {
    description:
      "🎓 پلتفرم آموزش هوشمند ایران — دستیار هوشمند، خلاصه‌سازی، فلش‌کارت، پادکست و آزمون؛ همین حالا /start را بفرستید.",
  });
  await telegramApi(token, "setMyShortDescription", {
    short_description: "🎓 پلتفرم آموزش هوشمند ایران — در تلگرام، وب و مینی‌اپ.",
  });

  // cache the bot username for UI display
  await db.platformSetting.upsert({
    where: { key: "telegram.botUsername" },
    create: { key: "telegram.botUsername", value: JSON.stringify(me.username) },
    update: { value: JSON.stringify(me.username) },
  });

  await audit({
    actorId: ctx.userId,
    tenantId: null,
    action: "admin_action",
    targetType: "telegram_bot",
    metadata: { botUsername: me.username, menuButton: "web_app", commands: 6 },
  });

  return { botUsername: me.username, botName: me.first_name, miniAppUrl: url };
}

// ── Account linking (6-digit code, 10-minute TTL) ──

export async function createLinkCode(ctx: AuthContext) {
  // invalidate previous unconsumed codes for this user (one live code at a time)
  await db.telegramLinkCode.updateMany({
    where: { userId: ctx.userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.telegramLinkCode.create({ data: { userId: ctx.userId, code, expiresAt } });
  const settings = await getSettings();
  return {
    code,
    expiresInSec: 600,
    botUsername: settings.telegramBotUsername || null,
  };
}

export interface LinkResult {
  token: string;
  user: { id: string; role: string; fullName: string };
  telegramUser: TelegramUser;
}

async function linkTelegramToUser(
  userId: string,
  tUser: TelegramUser
): Promise<void> {
  const existing = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(tUser.id) } },
    include: { user: true },
  });
  if (existing) {
    if (existing.userId === userId) return; // already linked to this user — idempotent
    throw Errors.conflict(
      "TELEGRAM_ALREADY_LINKED",
      "این حساب تلگرام قبلاً به کاربر دیگری متصل شده است."
    );
  }
  await db.externalIdentity.create({
    data: {
      userId,
      provider: "telegram",
      externalUserId: String(tUser.id),
      metadata: JSON.stringify({
        username: tUser.username ?? null,
        firstName: tUser.firstName,
        lastName: tUser.lastName ?? null,
      }),
    },
  });
  await audit({
    actorId: userId,
    action: "login",
    metadata: { channel: "telegram", linked: true },
  });
}

// Redeem a 6-digit code sent by the user to the bot (called by the bot service
// over localhost with the shared internal secret).
export async function redeemLinkCode(
  code: string,
  tUser: TelegramUser
): Promise<LinkResult> {
  if (!/^\d{6}$/.test(code)) throw Errors.validation("کد اتصال باید ۶ رقم باشد.");

  const row = await db.telegramLinkCode.findUnique({ where: { code } });
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    throw Errors.validation("کد اتصال نامعتبر یا منقضی شده است.");
  }

  await linkTelegramToUser(row.userId, tUser);
  await db.telegramLinkCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

  const user = await db.user.findUnique({ where: { id: row.userId } });
  if (!user || user.status !== "ACTIVE") throw Errors.forbidden("حساب کاربری فعال نیست.");

  const { token } = await createSession(user.id);
  return { token, user: { id: user.id, role: user.role, fullName: user.fullName }, telegramUser: tUser };
}

// Direct link: web-authenticated user opens the Mini App → client sends initData
export async function linkWithInitData(ctx: AuthContext, initData: string) {
  const tUser = await verifyInitData(initData);
  await linkTelegramToUser(ctx.userId, tUser);
  const settings = await getSettings();
  return { linked: true, telegramUser: tUser, botUsername: settings.telegramBotUsername || null };
}

// ── Round 22 — ورود با شمارهٔ موبایل ──
// خواستهٔ مدیر: «اگر طرف توی وب شماره‌اش را گذاشته باشد و شمارهٔ تلگرامش همان
// بود، خودش وارد اکانتش شود». کاربر شماره‌اش را از تلگرام به اشتراک می‌گذارد
// (request_contact / WebApp.requestContact) — تلگرام خودش مالکیت شماره را تأیید
// کرده است؛ اگر کاربر فعالی با همین شمارهٔ نرمال‌شده وجود داشته باشد، هویت
// تلگرام به همان حساب وصل می‌شود و نشست صادر می‌گردد (بدون نیاز به کد اتصال).
export async function linkTelegramByPhone(phone: string, tUser: TelegramUser): Promise<LinkResult> {
  const { normalizePhone } = await import("./telegram-signup");
  let normalized: string;
  try {
    normalized = normalizePhone(phone);
  } catch {
    throw Errors.validation("شمارهٔ موبایل به اشتراک گذاشته‌شده معتبر نیست.");
  }

  const user = await db.user.findFirst({ where: { phone: normalized } });
  if (!user) {
    throw new ApiError(
      "NOT_FOUND",
      "حسابی با این شمارهٔ موبایل در پلتفرم پیدا نشد. ابتدا شمارهٔ خود را در پروفایل نسخهٔ وب ثبت کنید یا با «کد اتصال» وارد شوید.",
      404
    );
  }
  if (user.status !== "ACTIVE") throw Errors.forbidden("حساب کاربری این شماره فعال نیست.");

  // اگر این هویت تلگرام قبلاً به کاربر دیگری وصل بوده، مالکیت شماره (که تلگرام
  // تأییدش کرده) مالکیت حساب را اثبات می‌کند → پیوند به حساب درست منتقل می‌شود.
  const existing = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(tUser.id) } },
  });
  if (existing && existing.userId !== user.id) {
    await db.externalIdentity.delete({ where: { id: existing.id } });
    await audit({
      actorId: user.id,
      action: "admin_action",
      metadata: { telegramRelinkByPhone: true, previousUserId: existing.userId },
    });
  }

  await linkTelegramToUser(user.id, tUser);
  const { token } = await createSession(user.id);
  return { token, user: { id: user.id, role: user.role, fullName: user.fullName }, telegramUser: tUser };
}

// Bot-service session resolution: telegram id → linked session. When unlinked, the
// response carries the live signup-request status so the bot can render the right
// state (no request → registration CTA; PENDING → waiting screen; REJECTED → retry).
// Called over localhost with the shared internal secret only — no client-identity trust.
export async function resolveTelegramSession(telegramId: number) {
  const identity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(telegramId) } },
    include: { user: true },
  });
  if (!identity || !identity.user || identity.user.status !== "ACTIVE") {
    const { telegramSignupStatus } = await import("./telegram-signup");
    const signup = await telegramSignupStatus(telegramId);
    return {
      linked: false as const,
      signup:
        signup.status === "NONE"
          ? null
          : {
              status: signup.status,
              fullName: signup.request?.fullName ?? null,
              role: signup.request?.role ?? null,
              roleLabel: signup.request?.roleLabel ?? null,
              levelLabel: signup.request?.levelLabel ?? null,
              grade: signup.request?.grade ?? null,
              schoolName: signup.request?.schoolName ?? null,
              rejectReason: signup.request?.rejectReason ?? null,
            },
    };
  }
  const user = identity.user;
  const { token } = await createSession(user.id);
  await audit({
    actorId: user.id,
    tenantId: user.tenantId,
    action: "login",
    metadata: { channel: "telegram", via: "bot" },
  });
  return {
    linked: true as const,
    token,
    user: {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      grade: user.grade,
      tenantId: user.tenantId,
    },
  };
}

// ── Unlink (round 18 — «خروج» in the Mini App / bot) ──
// Detaching the ExternalIdentity means the Mini App stops auto-logging-in and the
// bot session can no longer be resolved. Idempotent: unlinking an unlinked account
// succeeds silently. The user's own web sessions stay untouched (logout is separate).

export async function unlinkTelegramForUser(ctx: AuthContext) {
  const existing = await db.externalIdentity.findFirst({
    where: { userId: ctx.userId, provider: "telegram" },
  });
  if (existing) {
    await db.externalIdentity.delete({ where: { id: existing.id } });
    await audit({
      actorId: ctx.userId,
      tenantId: ctx.tenantId,
      action: "logout",
      metadata: { channel: "telegram", unlinked: true },
    });
    return { unlinked: true, telegramId: existing.externalUserId };
  }
  return { unlinked: true, telegramId: null };
}

// Bot-service variant: the user pressed «خروج» in the bot → the bot calls this with
// its telegram id (localhost + X-Bot-Secret only — no client-identity trust).
export async function unlinkTelegramById(telegramId: number) {
  const existing = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(telegramId) } },
    include: { user: true },
  });
  if (existing) {
    await db.externalIdentity.delete({ where: { id: existing.id } });
    await audit({
      actorId: existing.userId,
      tenantId: existing.user.tenantId,
      action: "logout",
      metadata: { channel: "telegram", via: "bot", unlinked: true },
    });
    return { unlinked: true, userId: existing.userId };
  }
  return { unlinked: true, userId: null };
}
