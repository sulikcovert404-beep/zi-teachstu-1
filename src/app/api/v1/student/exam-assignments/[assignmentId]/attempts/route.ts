import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { startAttempt } from "@/server/services/exam";

export const dynamic = "force-dynamic";

// POST /api/v1/student/exam-assignments/{assignment_id}/attempts (spec §27)
// Race-safe, idempotent start with question snapshot (spec §18.4)
export const POST = handler(
  async (req: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) => {
    const { assignmentId } = await params;
    const ctx = await requireRole(req, ROLES.STUDENT);
    const tenantId = await requireTenantId(ctx);
    return ok(await startAttempt(tenantId, ctx.userId, assignmentId));
  }
);
