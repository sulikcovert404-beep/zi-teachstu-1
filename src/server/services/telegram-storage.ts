import { db } from "@/lib/db";
import { getSettings } from "./settings";
import { Errors } from "@/server/core/errors";
import type { ApiError } from "@/server/core/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Round 23 — «ذخیره‌سازی کامل در تلگرام» (Telegram-as-Storage)
//
// Manager: «کلا هیچ چیز در هاست ذخیره نشه؛ همه چیز داخل اکانت تلگرام بات ذخیره
// بشه و هر وقت کاربر درخواست کرد — چه از وب چه از خود تلگرام — بهش دسترسی بده».
//
// HOW IT WORKS (and why it is feasible):
//  1. The bot uploads each binary ONCE to the *storage chat* (default: the first
//     linked SUPER_ADMIN's private chat with the bot; a dedicated channel can be
//     configured in platform settings). Telegram returns a PERMANENT file_id.
//  2. That file_id is persisted in TelegramAsset. Sending the file again to ANY
//     user (bot command, Mini App, web download) reuses the file_id — instant,
//     zero re-upload, zero host disk.
//  3. Web downloads proxy through getFile (≤20MB). Bigger binaries are served by
//     the bot itself via a t.me deep-link (file_id sends have no size limit).
// Limits honored: bot multipart upload ≤50MB/file; getFile download ≤20MB/file.
//
// Everything here is best-effort by design: when Telegram is not configured the
// platform gracefully keeps working with local files (round-20 behavior).
// ─────────────────────────────────────────────────────────────────────────────

export type TelegramAssetKind =
  | "ORIGINAL_PDF"
  | "PODCAST_AUDIO"
  | "SUMMARY_PDF"
  | "NOTES_PDF"
  | "QUIZ_PDF_MC"
  | "QUIZ_PDF_TF"
  | "QUIZ_PDF_FB"
  | "QUIZ_PDF_SHORT"
  | "QUIZ_PDF_MIXED";

export const TG_UPLOAD_LIMIT = 50 * 1024 * 1024; // bot multipart upload cap
export const TG_PROXY_LIMIT = 20 * 1024 * 1024; // getFile download cap (web proxy)

interface TgStorageRuntime {
  enabled: boolean;
  token: string;
  chatId: string; // resolved target (explicit setting or first super-admin identity)
  explicitChatId: string;
}

const tgApi = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function fetchTgJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit,
  timeoutMs = 90_000
): Promise<{ ok: true; result: T } | { ok: false; description: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: T; description?: string }
      | null;
    if (!json) return { ok: false, description: `HTTP ${res.status}` };
    if (!json.ok) return { ok: false, description: json.description ?? "UNKNOWN" };
    return { ok: true, result: json.result as T };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** چتِ ذخیره‌سازی: تنظیم صریح مدیر، یا اولین هویت تلگرامیِ مدیرِ کلِ فعال (چت خصوصی خودش با بات). */
async function resolveStorageChatId(explicitChatId: string): Promise<string | null> {
  const trimmed = explicitChatId.trim();
  if (trimmed) return trimmed;
  const owner = await db.externalIdentity.findFirst({
    where: {
      provider: "telegram",
      user: { role: "SUPER_ADMIN", status: "ACTIVE" },
    },
    orderBy: { createdAt: "asc" },
    select: { externalUserId: true },
  });
  return owner?.externalUserId ?? null; // private chat id == telegram user id
}

export async function tgStorageRuntime(): Promise<TgStorageRuntime | null> {
  const s = await getSettings();
  if (!s.telegramStorageEnabled || !s.telegramBotToken) return null;
  const chatId = await resolveStorageChatId(s.telegramStorageChatId);
  if (!chatId) {
    console.warn("[tg-storage] no storage chat resolvable (no linked SUPER_ADMIN telegram identity and no explicit chat id)");
    return null;
  }
  return { enabled: true, token: s.telegramBotToken, chatId, explicitChatId: s.telegramStorageChatId.trim() };
}

export async function getTelegramAsset(bookId: string, kind: TelegramAssetKind) {
  return db.telegramAsset.findUnique({
    where: { bookId_kind: { bookId, kind } },
  });
}

export async function listTelegramAssets(bookId: string) {
  return db.telegramAsset.findMany({ where: { bookId } });
}

/** آپلود باینری به چتِ ذخیره‌سازی تلگرام و ثبت file_id دائمی — خروجی null یعنی «غیرفعال/ناموفق» و مسیر محلی همچنان معتبر است. */
export async function uploadTelegramAsset(opts: {
  bookId: string;
  kind: TelegramAssetKind;
  bytes: Uint8Array;
  fileName: string;
  caption?: string;
  asAudio?: boolean;
  audioMeta?: { title: string; performer?: string; durationSec?: number };
}): Promise<{ fileId: string; sizeBytes: number } | null> {
  const book = await db.book.findUnique({ where: { id: opts.bookId }, select: { id: true } });
  if (!book) return null; // کتاب حذف شده — آپلود بی‌معناست

  const cfg = await tgStorageRuntime();
  if (!cfg) return null;
  if (opts.bytes.length > TG_UPLOAD_LIMIT) {
    console.warn(
      `[tg-storage] ${opts.kind} of ${opts.bookId} is ${(opts.bytes.length / 1048576).toFixed(1)}MB — over the 50MB bot upload cap; keeping local fallback`
    );
    return null;
  }

  const fd = new FormData();
  fd.append("chat_id", cfg.chatId);
  if (opts.caption) fd.append("caption", opts.caption.slice(0, 900));
  fd.append("disable_notification", "true"); // آپلودهای انبوه نباید مدیر را اذیت کنند

  if (opts.asAudio) {
    fd.append("audio", new Blob([new Uint8Array(opts.bytes)], { type: "audio/wav" }), opts.fileName);
    if (opts.audioMeta?.title) fd.append("title", opts.audioMeta.title.slice(0, 60));
    if (opts.audioMeta?.performer) fd.append("performer", opts.audioMeta.performer.slice(0, 60));
    if (opts.audioMeta?.durationSec) fd.append("duration", String(Math.max(0, Math.round(opts.audioMeta.durationSec))));
  } else {
    fd.append(
      "document",
      new Blob([new Uint8Array(opts.bytes)], { type: "application/pdf" }),
      opts.fileName
    );
  }

  const method = opts.asAudio ? "sendAudio" : "sendDocument";
  const res = await fetchTgJson<{
    message_id: number;
    audio?: { file_id: string; file_unique_id: string };
    document?: { file_id: string; file_unique_id: string };
  }>(tgApi(cfg.token, method), { method: "POST", body: fd }, 120_000);

  if (!res.ok) {
    console.warn(`[tg-storage] ${method} failed for ${opts.kind}/${opts.bookId}: ${res.description}`);
    return null;
  }
  const file = res.result.audio ?? res.result.document;
  if (!file?.file_id) return null;

  // جایگزینی asset قبلی — پیام قدیمی چت ذخیره‌سازی را تمیز می‌کنیم (best-effort)
  const prev = await getTelegramAsset(opts.bookId, opts.kind);
  if (prev?.messageId && prev.storageChatId) {
    void fetchTgJson(
      tgApi(cfg.token, "deleteMessage") +
        `?chat_id=${encodeURIComponent(prev.storageChatId)}&message_id=${encodeURIComponent(prev.messageId)}`,
      { method: "POST" },
      15_000
    ).catch(() => undefined);
  }

  await db.telegramAsset.upsert({
    where: { bookId_kind: { bookId: opts.bookId, kind: opts.kind } },
    create: {
      bookId: opts.bookId,
      kind: opts.kind,
      fileId: file.file_id,
      fileUniqueId: file.file_unique_id,
      fileName: opts.fileName.slice(0, 150),
      sizeBytes: opts.bytes.length,
      messageId: String(res.result.message_id),
      storageChatId: cfg.chatId,
    },
    update: {
      fileId: file.file_id,
      fileUniqueId: file.file_unique_id,
      fileName: opts.fileName.slice(0, 150),
      sizeBytes: opts.bytes.length,
      messageId: String(res.result.message_id),
      storageChatId: cfg.chatId,
    },
  });

  console.log(
    `[tg-storage] stored ${opts.kind} of book ${opts.bookId} in Telegram (${(opts.bytes.length / 1024).toFixed(0)}KB, message ${res.result.message_id})`
  );
  return { fileId: file.file_id, sizeBytes: opts.bytes.length };
}

/** باطل‌کردن asset (مثلاً هنگام بازتولید) — پیام تلگرام حذف، ردیف پاک. */
export async function invalidateTelegramAsset(bookId: string, kind: TelegramAssetKind): Promise<void> {
  const asset = await getTelegramAsset(bookId, kind);
  if (!asset) return;
  const cfg = await tgStorageRuntime();
  if (cfg && asset.messageId && asset.storageChatId) {
    void fetchTgJson(
      tgApi(cfg.token, "deleteMessage") +
        `?chat_id=${encodeURIComponent(asset.storageChatId)}&message_id=${encodeURIComponent(asset.messageId)}`,
      { method: "POST" },
      15_000
    ).catch(() => undefined);
  }
  await db.telegramAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
}

/** پاک‌سازی همهٔ assetهای یک کتاب (هنگام حذف کتاب) — ردیف‌ها با cascade هم پاک می‌شوند ولی پیام‌ها را خودمان تمیز می‌کنیم. */
export async function purgeTelegramAssets(bookId: string): Promise<void> {
  const assets = await listTelegramAssets(bookId);
  if (assets.length === 0) return;
  const cfg = await tgStorageRuntime();
  for (const a of assets) {
    if (cfg && a.messageId && a.storageChatId) {
      await fetchTgJson(
        tgApi(cfg.token, "deleteMessage") +
          `?chat_id=${encodeURIComponent(a.storageChatId)}&message_id=${encodeURIComponent(a.messageId)}`,
        { method: "POST" },
        15_000
      ).catch(() => undefined);
    }
  }
  await db.telegramAsset.deleteMany({ where: { bookId } }).catch(() => undefined);
}

// ── Web proxy: getFile → one-hour download URL → stream bytes ──

interface ProxyOk {
  ok: true;
  data: Uint8Array;
  filename: string;
  contentType: string;
}
interface ProxyTooBig {
  ok: false;
  tooBig: true;
  sizeBytes: number;
}

/** دانلود فایل از تلگرام برای سرو روی وب (محدودیت getFile = ۲۰ مگابایت). */
export async function proxyTelegramAsset(
  asset: { fileId: string; fileName: string | null; sizeBytes: number },
  opts: { fallbackName: string; contentType?: "application/pdf" | "audio/wav" }
): Promise<ProxyOk | ProxyTooBig> {
  if (asset.sizeBytes > 0 && asset.sizeBytes > TG_PROXY_LIMIT) {
    return { ok: false, tooBig: true, sizeBytes: asset.sizeBytes };
  }
  const s = await getSettings();
  if (!s.telegramBotToken) throw Errors.channelNotConfigured("بات تلگرام پیکربندی نشده است.");
  const token = s.telegramBotToken;

  const info = await fetchTgJson<{ file_path: string }>(
    `${tgApi(token, "getFile")}?file_id=${encodeURIComponent(asset.fileId)}`,
    { method: "GET" },
    30_000
  );
  if (!info.ok) {
    // فایل‌های بزرگ‌تر از ۲۰MB همین‌جا رد می‌شوند («file is too big»)
    if (/too big/i.test(info.description)) {
      return { ok: false, tooBig: true, sizeBytes: asset.sizeBytes || 0 };
    }
    throw Errors.internal();
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const dl = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`, {
      signal: ac.signal,
    });
    if (!dl.ok) throw Errors.internal();
    const buf = new Uint8Array(await dl.arrayBuffer());
    if (buf.length > TG_PROXY_LIMIT) return { ok: false, tooBig: true, sizeBytes: buf.length };
    const name = (asset.fileName ?? opts.fallbackName).replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 100);
    return {
      ok: true,
      data: buf,
      filename: /\.(pdf|wav)$/i.test(name) ? name : `${name}.${opts.contentType === "audio/wav" ? "wav" : "pdf"}`,
      contentType: opts.contentType ?? "application/pdf",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** لینک عمیق «دریافت از تلگرام» برای فایل‌های بزرگ‌تر از سقف پروکسی وب. */
export async function telegramDeepLink(bookId: string, kind: TelegramAssetKind): Promise<string | null> {
  const s = await getSettings();
  let username = s.telegramBotUsername;
  if (!username) {
    const me = await fetchTgJson<{ username?: string }>(
      `${tgApi(s.telegramBotToken, "getMe")}`,
      { method: "GET" },
      15_000
    );
    if (me.ok && me.result.username) username = me.result.username;
  }
  if (!username) return null;
  return `https://t.me/${username}?start=file_${kind.toLowerCase()}_${bookId}`;
}

/** خطای استاندارد با deep-link — respond.ts آن را به‌شکل {error:{code,message,deepLink}} سریال می‌کند. */
export function tooBigError(sizeBytes: number, deepLink: string | null): ApiError {
  const mb = (sizeBytes / 1048576).toFixed(1);
  const err = Errors.validation(
    deepLink
      ? `حجم این فایل ${mb} مگابایت است — بیش از سقف دانلود مستقیم وب (۲۰ مگابایت). فایل کامل و بی‌کیفیت‌افت از خود تلگرام دریافت می‌شود: ${deepLink}`
      : `حجم این فایل ${mb} مگابایت است — بیش از سقف دانلود مستقیم وب. از داخل تلگرام (بات) دریافتش کنید.`
  ) as ApiError & { deepLink?: string };
  if (deepLink) (err as ApiError & { deepLink?: string }).deepLink = deepLink;
  return err;
}

export async function telegramStorageStats(): Promise<{ assets: number; bytes: number }> {
  const agg = await db.telegramAsset.aggregate({ _count: { id: true }, _sum: { sizeBytes: true } });
  return { assets: agg._count.id, bytes: agg._sum.sizeBytes ?? 0 };
}

/** وضعیت کامل برای کارت تنظیمات وب (بدون افشای توکن). */
export async function telegramStorageClientInfo(): Promise<{
  enabled: boolean;
  configured: boolean;
  storageChatId: string | null; // چتِ حل‌شده
  explicitChatId: string;
  assets: number;
  bytes: number;
  botUsername: string | null;
  uploadLimitMb: number;
  proxyLimitMb: number;
}> {
  const [s, chatId, stats] = await Promise.all([
    getSettings(),
    resolveStorageChatId((await getSettings()).telegramStorageChatId),
    telegramStorageStats(),
  ]);
  return {
    enabled: s.telegramStorageEnabled,
    configured: Boolean(s.telegramBotToken && chatId),
    storageChatId: chatId,
    explicitChatId: s.telegramStorageChatId,
    assets: stats.assets,
    bytes: stats.bytes,
    botUsername: s.telegramBotUsername || null,
    uploadLimitMb: 50,
    proxyLimitMb: 20,
  };
}
