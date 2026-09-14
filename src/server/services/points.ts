import { db } from "@/lib/db";

// Round 16 — Points ledger (gamification). Students earn points by answering book
// sample questions (web + Telegram, same endpoint) and by completing graded exams.
// Append-only; totals are always derived from the ledger.

export const POINT_REASONS = {
  BOOK_QUIZ: "BOOK_QUIZ",
  EXAM_COMPLETED: "EXAM_COMPLETED",
} as const;

export const POINT_REASON_LABELS_FA: Record<string, string> = {
  BOOK_QUIZ: "پاسخ به نمونه‌سؤال کتاب",
  EXAM_COMPLETED: "شرکت در آزمون کلاسی",
};

export async function awardPoints(
  userId: string,
  points: number,
  reason: string,
  refType?: string,
  refId?: string
): Promise<void> {
  if (!Number.isInteger(points) || points <= 0) return; // nothing to award
  await db.pointAward.create({
    data: { userId, points, reason, refType: refType ?? null, refId: refId ?? null },
  });
}

export async function getPointsSummary(userId: string) {
  const [agg, last30, recent] = await Promise.all([
    db.pointAward.aggregate({ where: { userId }, _sum: { points: true } }),
    db.pointAward.aggregate({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      _sum: { points: true },
    }),
    db.pointAward.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);
  return {
    total: agg._sum.points ?? 0,
    last30Days: last30._sum.points ?? 0,
    recent: recent.map((r) => ({
      points: r.points,
      reason: r.reason,
      reasonLabel: POINT_REASON_LABELS_FA[r.reason] ?? r.reason,
      refType: r.refType,
      refId: r.refId,
      createdAt: r.createdAt,
    })),
  };
}
