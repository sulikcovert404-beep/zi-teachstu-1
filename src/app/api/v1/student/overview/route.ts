import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listStudentAssignments, studentProgress } from "@/server/services/exam";
import { myEntitlements } from "@/server/services/plan";
import { getPointsSummary } from "@/server/services/points";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Student dashboard bootstrap: today's data, assignments, progress, entitlements (spec §20)
// Round 16 — now includes the points total and smart-library stats (books visible to
// this student, so the UI can advertise the library even before first visit).
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const tenantId = await requireTenantId(ctx);

  const classroomIds = await db.classMembership.findMany({
    where: { userId: ctx.userId, revokedAt: null, classroom: { tenantId } },
    select: { classroomId: true },
  });
  const myClassroomIds = classroomIds.map((m) => m.classroomId);

  const [assignments, progress, entitlements, points, bookCount, quizTries] = await Promise.all([
    listStudentAssignments(tenantId, ctx.userId),
    studentProgress(tenantId, ctx.userId),
    myEntitlements(ctx),
    getPointsSummary(ctx.userId),
    db.book.count({
      where: {
        OR: [
          { tenantId: null, classroomId: null },
          { tenantId, classroomId: null },
          ...(myClassroomIds.length > 0 ? [{ classroomId: { in: myClassroomIds } }] : []),
        ],
      },
    }),
    db.bookQuizAttempt.count({ where: { userId: ctx.userId } }),
  ]);
  const now = new Date();
  return ok({
    today: {
      dueSoon: assignments
        .filter((a) => a.dueAt && a.dueAt > now && (!a.closeAt || a.closeAt > now))
        .slice(0, 5),
      openExams: assignments.filter((a) => a.exam && !a.attempts.some((t: any) => t.state === "GRADED")).length,
    },
    assignments,
    progress,
    entitlements,
    points: { total: points.total, last30Days: points.last30Days },
    library: { bookCount, quizTries },
  });
});
