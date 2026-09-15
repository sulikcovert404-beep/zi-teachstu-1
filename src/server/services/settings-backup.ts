import { promises as fs } from "node:fs";
import path from "node:path";

// ── Round 24 — Resilient settings mirror (خودترمیمی تنظیمات حساس) ──
// ریشهٔ اتفاق: پاک‌شدن کامل دیتابیس با prisma db push کلید توکن بات و کلید
// جمینای را هم از بین برد و بات تلگرام از کار افتاد. این آینه‌ی فایلی از
// رازهای حیاتی (توکن بات، کلید جمینای، آدرس مینی‌اپ…) در db/settings-backup.json
// نگه‌داری می‌کند (مسیر gitignore شده) و اگر جدول تنظیمات خالی شد، مقادیر
// به‌صورت خودکار به دیتابیس بازگردانده می‌شوند.

export interface SettingsBackup {
  aiProvider?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  telegramBotToken?: string;
  telegramMiniAppUrl?: string;
  telegramBotUsername?: string;
  telegramStorageEnabled?: boolean;
  telegramStorageChatId?: string;
}

const BACKUP_PATH = path.join(process.cwd(), "db", "settings-backup.json");

let cache: SettingsBackup | undefined; // undefined = not loaded yet

export async function readSettingsBackup(): Promise<SettingsBackup> {
  if (cache !== undefined) return cache;
  try {
    const raw = await fs.readFile(BACKUP_PATH, "utf-8");
    cache = JSON.parse(raw) as SettingsBackup;
  } catch {
    cache = {};
  }
  return cache ?? {};
}

export async function writeSettingsBackup(backup: SettingsBackup): Promise<void> {
  cache = backup;
  try {
    await fs.mkdir(path.dirname(BACKUP_PATH), { recursive: true });
    await fs.writeFile(BACKUP_PATH, JSON.stringify(backup, null, 2), "utf-8");
  } catch (e) {
    // Never break the settings save flow because of the mirror
    console.error("[settings-backup] write failed:", e);
  }
}

// Merge helper: keep only defined, non-empty values worth persisting.
export function pickBackupValues(s: {
  aiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  telegramBotToken: string;
  telegramMiniAppUrl: string;
  telegramBotUsername: string;
  telegramStorageEnabled: boolean;
  telegramStorageChatId: string;
}): SettingsBackup {
  const out: SettingsBackup = {};
  if (s.aiProvider) out.aiProvider = s.aiProvider;
  if (s.geminiApiKey) out.geminiApiKey = s.geminiApiKey;
  if (s.geminiModel) out.geminiModel = s.geminiModel;
  if (s.telegramBotToken) out.telegramBotToken = s.telegramBotToken;
  if (s.telegramMiniAppUrl) out.telegramMiniAppUrl = s.telegramMiniAppUrl;
  if (s.telegramBotUsername) out.telegramBotUsername = s.telegramBotUsername;
  out.telegramStorageEnabled = s.telegramStorageEnabled;
  if (s.telegramStorageChatId) out.telegramStorageChatId = s.telegramStorageChatId;
  return out;
}
