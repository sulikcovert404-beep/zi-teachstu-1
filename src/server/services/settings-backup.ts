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
  // Round 26 — تنظیمات خروج شبکهٔ جمینای (میان‌کار/پروکسی)؛ راز نیستند اما
  // برای مهاجرت بین میزبان‌ها حیاتی‌اند — همراه بقیه در آینه نگه داشته می‌شوند.
  geminiBaseUrl?: string;
  geminiProxyUrl?: string;
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

// راند ۲۶ — همهٔ فیلدهای حیاتی «همیشه» با آخرین وضعیت ذخیره می‌شوند (حتی خالی).
// قبلاً مقادیر خالی نوشته نمی‌شدند و پاک‌کردن عمدیِ کلید/توکن در آینه می‌ماند؛
// بعد از پاک‌شدن دیتابیس، مقدار قدیمی به‌صورت غلط بازگردانده می‌شد.
// معیار بازگردانی در getSettings «نبودِ ردیف» است، پس مقدار خالیِ آینه یعنی
// «مدیر عمداً پاک کرده» — همین که باید باشد.
export function pickBackupValues(s: {
  aiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiBaseUrl: string;
  geminiProxyUrl: string;
  telegramBotToken: string;
  telegramMiniAppUrl: string;
  telegramBotUsername: string;
  telegramStorageEnabled: boolean;
  telegramStorageChatId: string;
}): SettingsBackup {
  return {
    aiProvider: s.aiProvider || "zai",
    geminiApiKey: s.geminiApiKey ?? "",
    geminiModel: s.geminiModel || "gemini-flash-latest",
    geminiBaseUrl: s.geminiBaseUrl ?? "",
    geminiProxyUrl: s.geminiProxyUrl ?? "",
    telegramBotToken: s.telegramBotToken ?? "",
    telegramMiniAppUrl: s.telegramMiniAppUrl ?? "",
    telegramBotUsername: s.telegramBotUsername ?? "",
    telegramStorageEnabled: s.telegramStorageEnabled,
    telegramStorageChatId: s.telegramStorageChatId ?? "",
  };
}
