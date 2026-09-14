import { db } from "@/lib/db";
import { fromJson, toJson } from "@/server/core/json";
import { Errors } from "@/server/core/errors";
import { audit } from "./audit";
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
  return {
    aiProvider: provider === "gemini" ? "gemini" : "zai",
    geminiApiKey: g<string>(KEYS.geminiApiKey, ""),
    geminiModel: isGeminiModel(model) ? model : DEFAULT_SETTINGS.geminiModel,
    telegramBotToken: g<string>(KEYS.telegramBotToken, ""),
    telegramMiniAppUrl: g<string>(KEYS.telegramMiniAppUrl, ""),
    telegramBotUsername: g<string>(KEYS.telegramBotUsername, ""),
    booksUploadTenants: g<string[]>(KEYS.booksUploadTenants, []),
    teacherBookUploadTenants: g<string[]>(KEYS.teacherBookUploadTenants, []),
  };
}

export async function getSettingsForClient(): Promise<
  Omit<PlatformSettings, "geminiApiKey" | "telegramBotToken"> & {
    hasGeminiKey: boolean;
    geminiApiKeyMasked: string;
    hasTelegramToken: boolean;
    telegramTokenMasked: string;
    geminiModels: Array<{ code: string; label: string }>;
  }
> {
  const s = await getSettings();
  const mask = (v: string) => (v ? `••••••••${v.slice(-4)}` : "");
  return {
    aiProvider: s.aiProvider,
    geminiModel: s.geminiModel,
    telegramMiniAppUrl: s.telegramMiniAppUrl,
    telegramBotUsername: s.telegramBotUsername,
    booksUploadTenants: s.booksUploadTenants,
    teacherBookUploadTenants: s.teacherBookUploadTenants,
    hasGeminiKey: !!s.geminiApiKey,
    geminiApiKeyMasked: mask(s.geminiApiKey),
    hasTelegramToken: !!s.telegramBotToken,
    telegramTokenMasked: mask(s.telegramBotToken),
    geminiModels: GEMINI_MODELS.map((m) => ({ code: m.code, label: m.label })),
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
