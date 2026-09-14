import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { submitAttempt } from "@/server/services/exam";

export const dynamic = "force-dynamic";

// POST /api/v1/student/exam-attempts/{attempt_id}/submit — idempotent, server-side grading (spec §27)
export const POST = handler(
  async (req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) => {
    const { attemptId } = await params;
    const ctx = await requireRole(req, ROLES.STUDENT);
    const tenantId = await requireTenantId(ctx);
    return ok(await submitAttempt(tenantId, ctx.userId, attemptId));
  }
);
