import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { getExamDetail } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: NextRequest, { params }: { params: Promise<{ examId: string }> }) => {
    const { examId } = await params;
    const ctx = await requireRole(req, ROLES.TEACHER);
    const tenantId = await requireTenantId(ctx);
    return ok(await getExamDetail(tenantId, ctx.userId, examId));
  }
);
