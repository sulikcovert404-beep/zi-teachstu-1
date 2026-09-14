import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { teacherOverview } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const overview = await teacherOverview(tenantId, ctx.userId);
  return ok({ classes: overview.classes });
});
