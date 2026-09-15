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

export const GEMINI_MODELS = [
  { code: "gemini-2.5-pro", label: "جمینای ۲.۵ پرو (قوی‌ترین)" },
  { code: "gemini-2.5-flash", label: "جمینای ۲.۵ فلش (متعادل)" },
  { code: "gemini-2.5-flash-lite", label: "جمینای ۲.۵ فلش لایت (سریع/اقتصادی)" },
  { code: "gemini-2.0-flash", label: "جمینای ۲.۰ فلش" },
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number]["code"];

export interface PlatformSettings {
  aiProvider: "zai" | "gemini";
  geminiApiKey: string;
  geminiModel: GeminiModel;
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
  geminiModel: "gemini-2.5-flash",
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
  telegramBotToken: "telegram.botToken",
  telegramMiniAppUrl: "telegram.miniAppUrl",
  telegramBotUsername: "telegram.botUsername",
  booksUploadTenants: "books.uploadTenants",
  teacherBookUploadTenants: "books.teacherUploadTenants",
  telegramStorageEnabled: "telegram.storageEnabled",
  telegramStorageChatId: "telegram.storageChatId",
} as const;

function isGeminiModel(v: unknown): v is GeminiModel {
  return typeof v === "string" && GEMINI_MODELS.some((m) => m.code === v);
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

  // ── Round 24 — Self-heal from the file mirror ──
  // اگر جدول تنظیمات خالی/پاک شده باشد (مثلاً بعد از db push) و رازهای حیاتی
  // در آینهٔ فایلی موجود باشند، به دیتابیس بازگردانده می‌شوند تا بات تلگرام و
  // ارائه‌دهندهٔ جمینای بدون دخالت مدیر دوباره زنده شوند.
  if (!geminiApiKey || !telegramBotToken) {
    const backup = await readSettingsBackup();
    const restore: Array<[string, string]> = [];
    if (!telegramBotToken && backup.telegramBotToken) {
      telegramBotToken = backup.telegramBotToken;
      restore.push([KEYS.telegramBotToken, toJson(telegramBotToken)]);
    }
    if (!geminiApiKey && backup.geminiApiKey) {
      geminiApiKey = backup.geminiApiKey;
      restore.push([KEYS.geminiApiKey, toJson(geminiApiKey)]);
    }
    if (!telegramMiniAppUrl && backup.telegramMiniAppUrl) {
      telegramMiniAppUrl = backup.telegramMiniAppUrl;
      restore.push([KEYS.telegramMiniAppUrl, toJson(telegramMiniAppUrl)]);
    }
    if (!telegramBotUsername && backup.telegramBotUsername) {
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
  }

  return {
    aiProvider: provider === "gemini" ? "gemini" : "zai",
    geminiApiKey,
    geminiModel: isGeminiModel(model) ? model : DEFAULT_SETTINGS.geminiModel,
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
  telegramBotToken?: unknown; // same semantics
  telegramMiniAppUrl?: unknown;
  booksUploadTenants?: unknown;
  teacherBookUploadTenants?: unknown;
  telegramStorageEnabled?: unknown;
  telegramStorageChatId?: unknown;
}

function str(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" ? v.trim() : undefined;
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

  if (input.geminiModel !== undefined && isGeminiModel(input.geminiModel)) {
    patch.geminiModel = toJson(input.geminiModel);
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
  | { provider: "gemini"; apiKey: string; model: string }
  | { provider: "zai" }
> {
  const s = await getSettings();
  if (s.aiProvider === "gemini" && s.geminiApiKey) {
    return { provider: "gemini", apiKey: s.geminiApiKey, model: s.geminiModel };
  }
  return { provider: "zai" };
}
