import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { saveAnswers } from "@/server/services/exam";

export const dynamic = "force-dynamic";

// PATCH /api/v1/student/exam-attempts/{attempt_id}/answers — idempotent partial save (spec §27)
export const PATCH = handler(
  async (req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) => {
    const { attemptId } = await params;
    const ctx = await requireRole(req, ROLES.STUDENT);
    const tenantId = await requireTenantId(ctx);
    const body = await req.json().catch(() => null);
    if (!body?.answers || typeof body.answers !== "object" || Array.isArray(body.answers))
      throw Errors.validation("ساختار پاسخ‌ها معتبر نیست.");
    return ok(await saveAnswers(tenantId, ctx.userId, attemptId, body.answers));
  }
);
