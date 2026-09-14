import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson, toJson } from "@/server/core/json";
import { DEFAULT_PLAN_LIMITS, ROLES, type Feature } from "@/server/core/constants";
import type { AuthContext } from "@/server/auth/session";

// Spec §41 — Plan / Subscription / Entitlement / Usage / Limit resolution.
// Feature check = Role + Plan + Usage Remaining (+ Feature Flag).

export interface Entitlement {
  planCode: string;
  planName: string;
  feature: Feature;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  allowed: boolean;
}

async function activePlanFor(ctx: AuthContext): Promise<{ code: string; name: string } | null> {
  // Personal subscription first, then tenant (school) subscription, then role default
  const personal = await db.subscription.findFirst({
    where: { userId: ctx.userId, status: "ACTIVE" },
    include: { plan: true },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (personal) return { code: personal.plan.code, name: personal.plan.displayName };

  if (ctx.tenantId) {
    // Tenant-level plan = a school-owned subscription (userId: null).
    // Personal subscriptions (e.g. a student's STUDENT_PRO purchase) record tenantId for
    // accounting but must NEVER change plan resolution for other members of the tenant.
    const tenantSub = await db.subscription.findFirst({
      where: { tenantId: ctx.tenantId, userId: null, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { currentPeriodEnd: "desc" },
    });
    if (tenantSub) return { code: tenantSub.plan.code, name: tenantSub.plan.displayName };
  }

  // Role-based default plan (spec §7)
  if (ctx.effectiveRole === ROLES.STUDENT) return { code: "STUDENT_FREE", name: "رایگان" };
  if (ctx.effectiveRole === ROLES.TEACHER) return { code: "TEACHER_FREE", name: "رایگان معلم" };
  if (ctx.effectiveRole === ROLES.SCHOOL_ADMIN) return { code: "SCHOOL_FREE", name: "مدرسه رایگان" };
  return null;
}

async function planLimits(planCode: string | null): Promise<Record<string, number>> {
  if (planCode) {
    const plan = await db.plan.findUnique({ where: { code: planCode } });
    if (plan) return fromJson<Record<string, number>>(plan.limits, {});
  }
  return {};
}

async function usedToday(userId: string, feature: Feature): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return db.usageEvent.count({
    where: { userId, feature, createdAt: { gte: since }, success: true },
  });
}

export async function checkFeature(ctx: AuthContext, feature: Feature): Promise<Entitlement> {
  const plan = await activePlanFor(ctx);
  const planCode = plan?.code ?? null;
  const limits = { ...(DEFAULT_PLAN_LIMITS[planCode ?? ""] ?? {}), ...(await planLimits(planCode)) };
  const dailyLimit = limits[feature] ?? 0;
  const used = await usedToday(ctx.userId, feature);

  // Feature flag check (global disable wins — spec §81)
  const flag = await db.featureFlag.findUnique({ where: { key: `feature.${feature}` } });
  const flagAllows = !flag || flag.enabled;

  const remaining = Math.max(0, dailyLimit - used);
  const allowed = flagAllows && remaining > 0;

  return {
    planCode: planCode ?? "—",
    planName: plan?.name ?? "بدون پلن",
    feature,
    dailyLimit,
    usedToday: used,
    remaining,
    allowed,
  };
}

// Backend-enforced gate: throws RATE_LIMITED (spec §42 — paywall must be backend-enforced)
export async function requireFeature(ctx: AuthContext, feature: Feature): Promise<Entitlement> {
  const ent = await checkFeature(ctx, feature);
  if (!ent.allowed) {
    if (ent.dailyLimit === 0) {
      throw Errors.forbidden("این قابلیت در پلن شما فعال نیست. برای دسترسی پلن خود را ارتقا دهید.");
    }
    throw Errors.rateLimited(
      `سهمیه امروز شما برای این قابلیت ({used}/{limit}) به پایان رسیده است. فردا دوباره تلاش کنید یا پلن خود را ارتقا دهید.`.replace("{used}", String(ent.usedToday)).replace("{limit}", String(ent.dailyLimit))
    );
  }
  return ent;
}

export async function myEntitlements(ctx: AuthContext): Promise<Entitlement[]> {
  const features: Feature[] = [
    "AI_TUTOR",
    "SUMMARIZER",
    "QUESTION_GENERATOR",
    "TEACHER_ASSISTANT",
    "FLASHCARDS",
    "STUDY_PLANNER",
    "KNOWLEDGE_QA",
    "PODCAST",
  ];
  return Promise.all(features.map((f) => checkFeature(ctx, f)));
}

// ── Plan catalog management (SUPER_ADMIN) ──
export async function ensurePlansSeeded(): Promise<void> {
  const count = await db.plan.count();
  if (count > 0) return;
  await db.plan.createMany({
    data: [
      {
        code: "STUDENT_FREE",
        displayName: "رایگان",
        roleScope: "STUDENT",
        priceMonthly: 0,
        limits: toJson(DEFAULT_PLAN_LIMITS.STUDENT_FREE),
      },
      {
        code: "STUDENT_PRO",
        displayName: "دانش‌آموز پرو",
        roleScope: "STUDENT",
        priceMonthly: 149000,
        limits: toJson(DEFAULT_PLAN_LIMITS.STUDENT_PRO),
      },
      {
        code: "TEACHER_FREE",
        displayName: "رایگان معلم",
        roleScope: "TEACHER",
        priceMonthly: 0,
        limits: toJson(DEFAULT_PLAN_LIMITS.TEACHER_FREE),
      },
      {
        code: "SCHOOL_FREE",
        displayName: "مدرسه (رایگان)",
        roleScope: "SCHOOL",
        priceMonthly: 0,
        limits: toJson(DEFAULT_PLAN_LIMITS.SCHOOL_FREE),
      },
    ],
  });
}
