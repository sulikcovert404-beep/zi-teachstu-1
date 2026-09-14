import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { schoolAdminOverview, tenantPlanInfo } from "@/server/services/schooladmin";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const [overview, plan] = await Promise.all([schoolAdminOverview(tenantId), tenantPlanInfo(tenantId)]);
  return ok({ ...overview, planInfo: plan });
});
