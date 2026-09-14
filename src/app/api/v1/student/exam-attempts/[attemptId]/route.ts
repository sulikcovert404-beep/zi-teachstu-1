import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { getAttemptForTaking } from "@/server/services/exam";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) => {
    const { attemptId } = await params;
    const ctx = await requireRole(req, ROLES.STUDENT);
    const tenantId = await requireTenantId(ctx);
    return ok(await getAttemptForTaking(tenantId, ctx.userId, attemptId));
  }
);
