import { z } from "zod";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson } from "@/server/core/json";
import { DEFAULT_PLAN_LIMITS, PLAN_CODES } from "@/server/core/constants";
import { audit } from "@/server/services/audit";
import { myEntitlements, type Entitlement } from "@/server/services/plan";
import type { AuthContext } from "@/server/auth/session";

// Spec §41 — Subscription & Billing (STUDENT_PRO purchase flow).
// Spec §42 — paywall must show value BEFORE payment: getUpgradePreview exposes
// current plan + real usage + side-by-side quota comparison; checkout is the only
// state-changing operation (mock payment gateway — sandbox, deterministic success).

const STUDENT_FEATURES = [
  "AI_TUTOR",
  "SUMMARIZER",
  "QUESTION_GENERATOR",
  "FLASHCARDS",
  "STUDY_PLANNER",
  "KNOWLEDGE_QA",
  "PODCAST",
] as const;

// Volume discounts (spec §41 pricing): 3 months → 5%, 12 months → 10%
const PERIOD_DISCOUNTS: Record<number, number> = { 1: 0, 3: 0.05, 12: 0.1 };

export interface InvoiceRow {
  number: string;
  planCode: string;
  periodMonths: number;
  amount: number;
  status: string;
  paymentRef: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SubscriptionRow {
  planCode: string;
  planName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  daysRemaining: number;
}

export interface UpgradePreview {
  currentPlan: { code: string; name: string };
  proPlan: { code: string; name: string; priceMonthly: number };
  entitlements: Entitlement[];
  comparison: Array<{ feature: string; freeLimit: number; proLimit: number; usedToday: number }>;
  periods: Array<{ months: number; discountPercent: number; total: number }>;
}

const CheckoutSchema = z.object({
  periodMonths: z
    .number()
    .int()
    .refine((v) => v === 1 || v === 3 || v === 12, {
      message: "مدت اشتراک باید یکی از مقادیر ۱، ۳ یا ۱۲ ماه باشد.",
    }),
});

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

export function computeTotal(priceMonthly: number, months: number): number {
  const raw = priceMonthly * months * (1 - (PERIOD_DISCOUNTS[months] ?? 0));
  return Math.round(raw / 1000) * 1000; // rounded to nearest 1,000 تومان
}

function toInvoiceRow(inv: {
  number: string;
  planCode: string;
  periodMonths: number;
  amount: number;
  status: string;
  paymentRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
}): InvoiceRow {
  return {
    number: inv.number,
    planCode: inv.planCode,
    periodMonths: inv.periodMonths,
    amount: inv.amount,
    status: inv.status,
    paymentRef: inv.paymentRef,
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

function toSubscriptionRow(sub: {
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  plan: { code: string; displayName: string };
}): SubscriptionRow {
  const daysRemaining = Math.max(
    0,
    Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 3600 * 1000))
  );
  return {
    planCode: sub.plan.code,
    planName: sub.plan.displayName,
    status: sub.status,
    currentPeriodStart: sub.currentPeriodStart.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    daysRemaining,
  };
}

// ── Value preview (spec §42: value BEFORE payment) ──
export async function getUpgradePreview(ctx: AuthContext): Promise<UpgradePreview> {
  const [proPlan, entitlements] = await Promise.all([
    db.plan.findUnique({ where: { code: PLAN_CODES.STUDENT_PRO } }),
    myEntitlements(ctx),
  ]);
  if (!proPlan) throw Errors.notFound("پلن «دانش‌آموز پرو»");

  const freeLimits = DEFAULT_PLAN_LIMITS.STUDENT_FREE ?? {};
  const proLimits = {
    ...(DEFAULT_PLAN_LIMITS.STUDENT_PRO ?? {}),
    ...fromJson<Record<string, number>>(proPlan.limits, {}),
  };

  const comparison = STUDENT_FEATURES.map((feature) => ({
    feature,
    freeLimit: freeLimits[feature] ?? 0,
    proLimit: proLimits[feature] ?? 0,
    usedToday: entitlements.find((e) => e.feature === feature)?.usedToday ?? 0,
  }));

  const periods = [1, 3, 12].map((months) => ({
    months,
    discountPercent: Math.round((PERIOD_DISCOUNTS[months] ?? 0) * 100),
    total: computeTotal(proPlan.priceMonthly, months),
  }));

  return {
    currentPlan: {
      code: entitlements[0]?.planCode ?? "—",
      name: entitlements[0]?.planName ?? "بدون پلن",
    },
    proPlan: {
      code: proPlan.code,
      name: proPlan.displayName,
      priceMonthly: proPlan.priceMonthly,
    },
    entitlements,
    comparison,
    periods,
  };
}

// ── Mock checkout: invoice + ACTIVE personal STUDENT_PRO subscription ──
export async function checkoutStudentPro(ctx: AuthContext, input: unknown): Promise<{
  invoice: InvoiceRow;
  subscription: SubscriptionRow;
}> {
  const parsed = CheckoutSchema.safeParse(input);
  if (!parsed.success) {
    throw Errors.validation("مدت اشتراک باید یکی از مقادیر ۱، ۳ یا ۱۲ ماه باشد.");
  }
  const periodMonths = parsed.data.periodMonths;

  const proPlan = await db.plan.findUnique({ where: { code: PLAN_CODES.STUDENT_PRO } });
  if (!proPlan || !proPlan.active) throw Errors.notFound("پلن «دانش‌آموز پرو»");

  const amount = computeTotal(proPlan.priceMonthly, periodMonths);
  const paymentRef = `MOCK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date();

  // Single-ACTIVE-personal-subscription invariant: expire every other ACTIVE
  // personal row so plan resolution (activePlanFor) is unambiguous.
  const activePersonal = await db.subscription.findMany({
    where: { userId: ctx.userId, status: "ACTIVE" },
    include: { plan: true },
  });
  const currentPro = activePersonal.find((s) => s.plan.code === PLAN_CODES.STUDENT_PRO);
  const others = activePersonal.filter((s) => s.id !== currentPro?.id);
  if (others.length > 0) {
    await db.subscription.updateMany({
      where: { id: { in: others.map((s) => s.id) } },
      data: { status: "EXPIRED" },
    });
  }

  let subscription;
  if (currentPro) {
    // Extend from the later of (now, currentPeriodEnd) — never resets remaining time.
    const base = currentPro.currentPeriodEnd > now ? currentPro.currentPeriodEnd : now;
    const updated = await db.subscription.update({
      where: { id: currentPro.id },
      data: { currentPeriodEnd: addDays(base, periodMonths * 30), status: "ACTIVE" },
      include: { plan: true },
    });
    subscription = updated;
  } else {
    const created = await db.subscription.create({
      data: {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        planId: proPlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: addDays(now, periodMonths * 30),
      },
      include: { plan: true },
    });
    subscription = created;
  }

  const invoice = await createPaidInvoice(ctx, {
    subscriptionId: subscription.id,
    periodMonths,
    amount,
    paymentRef,
    paidAt: now,
  });

  // Spec §31 — audit with sanitized metadata only (no secrets / payment data)
  await audit({
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    action: "subscription_changed",
    targetType: "subscription",
    targetId: subscription.id,
    metadata: {
      planCode: proPlan.code,
      periodMonths,
      amount,
      invoiceNumber: invoice.number,
    },
  });

  return { invoice, subscription: toSubscriptionRow(subscription) };
}

async function createPaidInvoice(
  ctx: AuthContext,
  data: {
    subscriptionId: string;
    periodMonths: number;
    amount: number;
    paymentRef: string;
    paidAt: Date;
  }
): Promise<InvoiceRow> {
  const year = data.paidAt.getFullYear();
  const baseSeq = (await db.invoice.count()) + 1;

  // INV-YYYY-0000; retry on unique collision (concurrent checkouts) with bumped seq,
  // final fallback = timestamp suffix — number stays unique per spec §41.
  for (let attempt = 0; attempt < 5; attempt++) {
    const number =
      attempt < 4
        ? `INV-${year}-${String(baseSeq + attempt).padStart(4, "0")}`
        : `INV-${year}-${String(Date.now()).slice(-6)}`;
    try {
      const inv = await db.invoice.create({
        data: {
          number,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          planCode: PLAN_CODES.STUDENT_PRO,
          periodMonths: data.periodMonths,
          amount: data.amount,
          status: "PAID",
          paymentMethod: "MOCK_GATEWAY",
          paymentRef: data.paymentRef,
          paidAt: data.paidAt,
          subscriptionId: data.subscriptionId,
        },
      });
      return toInvoiceRow(inv);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") continue; // unique constraint on number → next candidate
      throw e;
    }
  }
  throw Errors.internal();
}

// ── History / current state ──
export async function myInvoices(ctx: AuthContext): Promise<InvoiceRow[]> {
  const rows = await db.invoice.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(toInvoiceRow);
}

export async function mySubscription(ctx: AuthContext): Promise<SubscriptionRow | null> {
  const sub = await db.subscription.findFirst({
    where: { userId: ctx.userId, status: "ACTIVE" },
    include: { plan: true },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub) return null;
  return toSubscriptionRow(sub);
}
