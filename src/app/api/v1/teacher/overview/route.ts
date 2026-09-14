import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { teacherOverview } from "@/server/services/teacher";
import { myEntitlements } from "@/server/services/plan";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const [overview, entitlements] = await Promise.all([
    teacherOverview(tenantId, ctx.userId),
    myEntitlements(ctx),
  ]);
  return ok({ ...overview, entitlements });
});
