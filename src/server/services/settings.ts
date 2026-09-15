import { db } from "@/lib/db";
import { fromJson, toJson } from "@/server/core/json";
import { Errors } from "@/server/core/errors";
import { audit } from "./audit";
import { readSettingsBackup, writeSettingsBackup, pickBackupValues } from "./settings-backup";
import type { AuthContext } from "@/server/auth/session";

// Round 16 — Platform settings store (key/value JSON in PlatformSetting table).
// Owns: AI provider selection (zai ↔ gemini BYO key + model), Telegram bot token,
// Mini App URL, and per-tenant book-upload permissions.
// Secrets (gemini key, bot token) NEVER leave the server unmasked (spec §32).

// Round 25 — فهرست ایستا به‌روز شد: گوگل ۲.۵‌ها را برای کاربران جدید بازنشسته
// کرده است (تأیید زنده: 2.5-flash→3.6-flash؛ 2.5-pro→3.1-pro-preview).
// این فقط «fallback» است — فهرست واقعی همیشه با دکمهٔ «دریافت از گوگل» زنده
// گرفته می‌شود (ListModels یا آزمون مستقیم در محدودیت جغرافیایی).
export const GEMINI_MODELS = [
  { code: "gemini-3.6-flash", label: "جمینای ۳.۶ فلش (جایگزین ۲.۵ — پیشنهادی)" },
  { code: "gemini-3.1-pro-preview", label: "جمینای ۳.۱ پرو پیش‌نمایش (قوی — جایگزین ۲.۵ پرو)" },
  { code: "gemini-flash-latest", label: "جمینای فلش (همیشه جدیدترین)" },
  { code: "gemini-flash-lite-latest", label: "جمینای فلش لایت (همیشه جدیدترین)" },
  { code: "gemini-pro-latest", label: "جمینای پرو (همیشه جدیدترین)" },
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number]["code"];

export interface PlatformSettings {
  aiProvider: "zai" | "gemini";
  geminiApiKey: string;
  geminiModel: GeminiModel;
  // Round 27 — پروکسی HTTP خروجی جمینای (مثلاً http://user:pass@host:port روی سرور
  // مدیر در کشورهای مجاز گوگل) — "" = اتصال مستقیم. قابل تغییر در هر میزبانی، بدون کد.
  geminiProxyUrl: string;
  telegramBotToken: string;
  telegramMiniAppUrl: string;
  telegramBotUsername: string; // cached from getMe
  booksUploadTenants: string[]; // tenant ids where SCHOOL_ADMIN can upload books
  teacherBookUploadTenants: string[]; // tenant ids where TEACHER can upload books/handouts
  // Round 23 — Telegram-as-Storage (ذخیره‌سازی کامل در تلگرام)
  telegramStorageEnabled: boolean; // default ON
  telegramStorageChatId: string; // "" = auto → first linked SUPER_ADMIN telegram chat
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  aiProvider: "zai",
  geminiApiKey: "",
  geminiModel: "gemini-flash-latest", // مستعار رسمی گوگل — همیشه به جدیدترین فلش اشاره می‌کند
  geminiProxyUrl: "",
  telegramBotToken: "",
  telegramMiniAppUrl: "",
  telegramBotUsername: "",
  booksUploadTenants: [],
  teacherBookUploadTenants: [],
  telegramStorageEnabled: true,
  telegramStorageChatId: "",
};

const KEYS = {
  aiProvider: "ai.provider",
  geminiApiKey: "ai.gemini.apiKey",
  geminiModel: "ai.gemini.model",
  geminiProxyUrl: "ai.gemini.proxyUrl",
  telegramBotToken: "telegram.botToken",
  telegramMiniAppUrl: "telegram.miniAppUrl",
  telegramBotUsername: "telegram.botUsername",
  booksUploadTenants: "books.uploadTenants",
  teacherBookUploadTenants: "books.teacherUploadTenants",
  telegramStorageEnabled: "telegram.storageEnabled",
  telegramStorageChatId: "telegram.storageChatId",
} as const;

// Round 25 — کد مدل حالا «قالب‌محور» اعتبارسنجی می‌شود، نه فهرست ایستا:
// فهرست زندهٔ گوگل (ListModels) مدل‌های جدیدی برمی‌گرداند که در GEMINI_MODELS نیستند
// و نباید رد/بازنشانی شوند. قالب = کد شناسهٔ امن برای URL generateContent.
function isModelCode(v: unknown): v is GeminiModel {
  return typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(v);
}

export async function getSettings(): Promise<PlatformSettings> {
  const rows = await db.platformSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const g = <T>(key: string, fallback: T): T => fromJson<T>(map.get(key) ?? null, fallback);

  const provider = g<string>(KEYS.aiProvider, DEFAULT_SETTINGS.aiProvider);
  const model = g<string>(KEYS.geminiModel, DEFAULT_SETTINGS.geminiModel);
  let geminiApiKey = g<string>(KEYS.geminiApiKey, "");
  let telegramBotToken = g<string>(KEYS.telegramBotToken, "");
  let telegramMiniAppUrl = g<string>(KEYS.telegramMiniAppUrl, "");
  let telegramBotUsername = g<string>(KEYS.telegramBotUsername, "");
  const geminiProxyUrl = g<string>(KEYS.geminiProxyUrl, "");

  // ── Round 24/26 — Self-heal from the file mirror ──
  // اگر «ردیفِ» تنظیمات کلیدی از جدول حذف شده باشد (مثلاً پاک‌شدن کامل
  // دیتابیس با prisma db push) و مقدارش در آینهٔ فایلی موجود باشد، به
  // دیتابیس بازگردانده می‌شود تا بات تلگرام و ارائه‌دهندهٔ جمینای دوباره
  // زنده شوند.
  // 🔑 اصلاح راند ۲۶: معیار «نبودِ ردیف» است نه «خالی‌بودن مقدار» — اگر
  // مدیر عمداً کلید/توکن را پاک کند، ردیف با مقدار خالی باقی می‌ماند و
  // نباید از آینه بازگردانی شود (قبلاً پاک‌کردن کلید بی‌صدا خنثی می‌شد).
  const backup = await readSettingsBackup();
  const restore: Array<[string, string]> = [];
  if (!map.has(KEYS.telegramBotToken) && backup.telegramBotToken) {
    telegramBotToken = backup.telegramBotToken;
    restore.push([KEYS.telegramBotToken, toJson(telegramBotToken)]);
  }
  if (!map.has(KEYS.geminiApiKey) && backup.geminiApiKey) {
    geminiApiKey = backup.geminiApiKey;
    restore.push([KEYS.geminiApiKey, toJson(geminiApiKey)]);
  }
  if (!map.has(KEYS.telegramMiniAppUrl) && backup.telegramMiniAppUrl) {
    telegramMiniAppUrl = backup.telegramMiniAppUrl;
    restore.push([KEYS.telegramMiniAppUrl, toJson(telegramMiniAppUrl)]);
  }
  if (!map.has(KEYS.telegramBotUsername) && backup.telegramBotUsername) {
    telegramBotUsername = backup.telegramBotUsername;
    restore.push([KEYS.telegramBotUsername, toJson(telegramBotUsername)]);
  }
  if (restore.length) {
    console.warn(
      `[settings] 🛡 بازیابی ${restore.length} تنظیم حساس از آینهٔ فایلی (توکن بات/کلید جمینای).`
    );
    await db
      .$transaction(
        restore.map(([key, value]) =>
          db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
        )
      )
      .catch((e) => console.error("[settings] restore-from-backup failed:", e));
  }

  return {
    aiProvider: provider === "gemini" ? "gemini" : "zai",
    geminiApiKey,
    geminiModel: isModelCode(model) ? model : DEFAULT_SETTINGS.geminiModel,
    geminiProxyUrl,
    telegramBotToken,
    telegramMiniAppUrl,
    telegramBotUsername,
    booksUploadTenants: g<string[]>(KEYS.booksUploadTenants, []),
    teacherBookUploadTenants: g<string[]>(KEYS.teacherBookUploadTenants, []),
    telegramStorageEnabled: g<boolean>(KEYS.telegramStorageEnabled, true),
    telegramStorageChatId: g<string>(KEYS.telegramStorageChatId, ""),
  };
}

export async function getSettingsForClient(): Promise<
  Omit<PlatformSettings, "geminiApiKey" | "telegramBotToken"> & {
    hasGeminiKey: boolean;
    geminiApiKeyMasked: string;
    hasTelegramToken: boolean;
    telegramTokenMasked: string;
    geminiModels: Array<{ code: string; label: string }>;
    telegramStorage: Awaited<ReturnType<typeof import("./telegram-storage").telegramStorageClientInfo>>;
  }
> {
  const s = await getSettings();
  const mask = (v: string) => (v ? `••••••••${v.slice(-4)}` : "");
  return {
    aiProvider: s.aiProvider,
    geminiModel: s.geminiModel,
    geminiProxyUrl: s.geminiProxyUrl,
    telegramMiniAppUrl: s.telegramMiniAppUrl,
    telegramBotUsername: s.telegramBotUsername,
    telegramStorageEnabled: s.telegramStorageEnabled,
    telegramStorageChatId: s.telegramStorageChatId,
    booksUploadTenants: s.booksUploadTenants,
    teacherBookUploadTenants: s.teacherBookUploadTenants,
    hasGeminiKey: !!s.geminiApiKey,
    geminiApiKeyMasked: mask(s.geminiApiKey),
    hasTelegramToken: !!s.telegramBotToken,
    telegramTokenMasked: mask(s.telegramBotToken),
    geminiModels: GEMINI_MODELS.map((m) => ({ code: m.code, label: m.label })),
    telegramStorage: await import("./telegram-storage").then((m) =>
      m.telegramStorageClientInfo()
    ),
  };
}

export interface SettingsUpdateInput {
  aiProvider?: unknown;
  geminiApiKey?: unknown; // undefined = keep; "" = clear; string = replace
  geminiModel?: unknown;
  geminiProxyUrl?: unknown; // "" = مستقیم
  telegramBotToken?: unknown; // same semantics
  telegramMiniAppUrl?: unknown;
  booksUploadTenants?: unknown;
  teacherBookUploadTenants?: unknown;
  telegramStorageEnabled?: unknown;
  telegramStorageChatId?: unknown;
}

function str(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  // Round 27 — مقدار چسبیده به نقل‌قول (کپی از JSON/راهنما) باید کوت شود؛
  // وگرنه «Invalid URL» در پروکسی و «API key not valid» در گوگل می‌دهد و
  // کاربر را سردرگم می‌کند (در عمل رخ داد: آدرس پروکسی داخل " " ذخیره شد).
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

function idArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500);
}

export async function updateSettings(ctx: AuthContext, input: SettingsUpdateInput) {
  const patch: Partial<Record<keyof typeof KEYS, string>> = {};

  if (input.aiProvider === "zai" || input.aiProvider === "gemini") {
    // Switching to gemini requires a stored key
    const current = await getSettings();
    if (input.aiProvider === "gemini") {
      const newKey = str(input.geminiApiKey);
      const effectiveKey = newKey === undefined || newKey === "" ? current.geminiApiKey : newKey;
      if (!effectiveKey) {
        throw Errors.validation(
          "برای فعال‌سازی جمینای ابتدا کلید API را وارد و ذخیره کنید."
        );
      }
    }
    patch.aiProvider = toJson(input.aiProvider);
  }

  const geminiKey = str(input.geminiApiKey);
  if (geminiKey !== undefined) patch.geminiApiKey = toJson(geminiKey);

  if (input.geminiModel !== undefined && isModelCode(input.geminiModel)) {
    patch.geminiModel = toJson(input.geminiModel);
  }

  // Round 27 — پروکسی جمینای (اعتبارسنجی سخت‌گیرانه؛ مقدار خالی = مستقیم به گوگل).
  // اعتبارنامهٔ user:pass در آدرس مجاز است (Bun/undici آن را به هدر
  // Proxy-Authorization تبدیل می‌کنند) — با پروکسی واقعی BasicAuth E2E تأیید شد.
  const proxyUrl = str(input.geminiProxyUrl);
  if (proxyUrl !== undefined) {
    let parseOk = false;
    try {
      new URL(proxyUrl);
      parseOk = true;
    } catch {
      parseOk = false;
    }
    if (proxyUrl !== "" && (!parseOk || !/^https?:\/\//i.test(proxyUrl))) {
      throw Errors.validation(
        "آدرس پروکسی جمینای باید یک آدرس http کامل و معتبر باشد (مثلاً http://user:pass@95.135.208.167:8888). پروکسی SOCKS پشتیبانی نمی‌شود و نباید داخل نقل‌قول باشد."
      );
    }
    patch.geminiProxyUrl = toJson(proxyUrl);
  }

  const botToken = str(input.telegramBotToken);
  if (botToken !== undefined) {
    patch.telegramBotToken = toJson(botToken);
    // token replaced → stale cached username must go
    patch.telegramBotUsername = toJson("");
  }

  const miniAppUrl = str(input.telegramMiniAppUrl);
  if (miniAppUrl !== undefined) {
    if (miniAppUrl !== "" && !/^https:\/\/.+/i.test(miniAppUrl)) {
      throw Errors.validation(
        "آدرس مینی‌اپ تلگرام باید با https شروع شود (تلگرام فقط HTTPS می‌پذیرد)."
      );
    }
    patch.telegramMiniAppUrl = toJson(miniAppUrl);
  }

  const uploadTenants = idArray(input.booksUploadTenants);
  if (uploadTenants !== undefined) patch.booksUploadTenants = toJson(uploadTenants);

  const teacherTenants = idArray(input.teacherBookUploadTenants);
  if (teacherTenants !== undefined) patch.teacherBookUploadTenants = toJson(teacherTenants);

  // Round 23 — Telegram-as-Storage toggles
  if (input.telegramStorageEnabled !== undefined) {
    patch.telegramStorageEnabled = toJson(Boolean(input.telegramStorageEnabled));
  }
  const storageChat = str(input.telegramStorageChatId);
  if (storageChat !== undefined) {
    if (storageChat !== "" && !/^(-?\d{3,}|@[A-Za-z0-9_]{4,})$/.test(storageChat)) {
      throw Errors.validation(
        "شناسهٔ چت ذخیره‌سازی باید عددی باشد (مثلاً ۵۳۸۱۱۲۴۹۹۶) یا نام کانال عمومی مثل @my_storage_channel."
      );
    }
    patch.telegramStorageChatId = toJson(storageChat);
  }

  if (Object.keys(patch).length > 0) {
    await db.$transaction(
      Object.entries(patch).map(([field, value]) => {
        const key = KEYS[field as keyof typeof KEYS];
        return db.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      })
    );
  }

  // Round 24 — mirror critical secrets to the file backup so a DB wipe
  // (prisma db push) can never permanently kill the bot token / gemini key.
  const effective = await getSettings();
  await writeSettingsBackup(pickBackupValues(effective));

  await audit({
    actorId: ctx.userId,
    tenantId: null,
    action: "admin_action",
    targetType: "platform_settings",
    metadata: {
      updated: Object.keys(patch).map((k) => KEYS[k as keyof typeof KEYS]),
      // never the values themselves (spec §32 — no secrets in audit logs)
    },
  });

  return getSettingsForClient();
}

// Effective AI provider resolution for the gateway (spec §10 — selection lives here).
export async function resolveAiProvider(): Promise<
  | { provider: "gemini"; apiKey: string; model: string; proxyUrl: string }
  | { provider: "zai" }
> {
  const s = await getSettings();
  if (s.aiProvider === "gemini" && s.geminiApiKey) {
    return {
      provider: "gemini",
      apiKey: s.geminiApiKey,
      model: s.geminiModel,
      proxyUrl: s.geminiProxyUrl.trim(),
    };
  }
  return { provider: "zai" };
}
