import { db } from "@/lib/db";
import { hashPassword } from "@/server/auth/password";
import { ensurePlansSeeded } from "@/server/services/plan";
import { toJson } from "@/server/core/json";

// ── Self-healing demo data (Round 24 hotfix) ──
// ریشهٔ باگ «ایمیل یا رمز عبور نادرست است» روی حساب‌های نمونه: خالی‌شدن کامل
// دیتابیس بعد از prisma db push (پاک‌شدن جدول‌ها در SQLite). این سرویس در مسیرِ
// ورود فراخوانی می‌شود؛ اگر جدول کاربران کاملاً خالی باشد، حساب‌های نمونه را
// به‌صورت خودکار بازسازی می‌کند تا صفحهٔ ورود هرگز از کار نیفتد.
// Idempotent + race-safe: no-op وقتی کاربری وجود دارد؛ خطای هم‌زمانی بی‌اثر است.

const DEMO_PASSWORD = "123456";

let ensurePromise: Promise<void> | null = null;

export async function ensureDemoData(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = seedDemoData().catch((e) => {
      // reset so a later request can retry after a transient failure
      ensurePromise = null;
      console.error("[ensureDemoData] failed:", e);
    });
  }
  return ensurePromise;
}

async function seedDemoData(): Promise<void> {
  const userCount = await db.user.count();
  if (userCount > 0) return;

  console.warn("[ensureDemoData] دیتابیس خالی است — بازسازی حساب‌های نمونه…");
  await ensurePlansSeeded();

  // ── Tenant + School ──
  const tenant = await db.tenant.create({
    data: { name: "دبیرستان نمونه ایرانیان", slug: "iranians-demo", status: "ACTIVE" },
  });
  const school = await db.school.create({
    data: { tenantId: tenant.id, name: "دبیرستان نمونه ایرانیان", status: "ACTIVE" },
  });

  // ── Four hero demo accounts (matching the login screen quick-login cards) ──
  await db.user.createMany({
    data: [
      {
        role: "SUPER_ADMIN",
        fullName: "مدیر پلتفرم",
        email: "owner@platform.ir",
        passwordHash: hashPassword(DEMO_PASSWORD),
        status: "ACTIVE",
      },
      {
        role: "SCHOOL_ADMIN",
        fullName: "علی رضایی (مدیر مدرسه)",
        email: "admin@school.ir",
        passwordHash: hashPassword(DEMO_PASSWORD),
        tenantId: tenant.id,
        status: "ACTIVE",
      },
      {
        role: "TEACHER",
        fullName: "مریم محمدی",
        email: "teacher@school.ir",
        passwordHash: hashPassword(DEMO_PASSWORD),
        tenantId: tenant.id,
        status: "ACTIVE",
      },
      {
        role: "STUDENT",
        fullName: "سارا احمدی",
        email: "student@school.ir",
        passwordHash: hashPassword(DEMO_PASSWORD),
        tenantId: tenant.id,
        grade: "دهم",
        status: "ACTIVE",
      },
      ...[
        { fullName: "رضا کریمی", email: "reza@school.ir" },
        { fullName: "نگار موسوی", email: "negar@school.ir" },
        { fullName: "امیر حسینی", email: "amir@school.ir" },
        { fullName: "الهام صادقی", email: "elham@school.ir" },
        { fullName: "پویا نوری", email: "pouya@school.ir" },
      ].map((s) => ({
        role: "STUDENT",
        fullName: s.fullName,
        email: s.email,
        passwordHash: hashPassword(DEMO_PASSWORD),
        tenantId: tenant.id,
        grade: "دهم",
        status: "ACTIVE",
      })),
    ],
  });

  // ── Feature flags (all AI features on) ──
  const flagKeys = [
    "feature.AI_TUTOR",
    "feature.SUMMARIZER",
    "feature.QUESTION_GENERATOR",
    "feature.TEACHER_ASSISTANT",
    "feature.FLASHCARDS",
    "feature.STUDY_PLANNER",
  ];
  const existingFlags = await db.featureFlag.findMany({ select: { key: true } });
  const existing = new Set(existingFlags.map((f) => f.key));
  await db.featureFlag.createMany({
    data: flagKeys
      .filter((k) => !existing.has(k))
      .map((key) => ({ key, enabled: true, scope: "global", description: "کنترل قابلیت " + key.replace("feature.", "") })),
    // NOTE: skipDuplicates پشتیبانی SQLite ندارد؛ تکرارها بالا دستی فیلتر شده‌اند.
  });

  console.warn("[ensureDemoData] ✅ حساب‌های نمونه بازسازی شدند (owner/admin/teacher/student).");
}
