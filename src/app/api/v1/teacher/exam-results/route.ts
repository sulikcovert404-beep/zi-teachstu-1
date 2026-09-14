import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { teacherExamResults } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

// Teacher sees exam results ONLY for own classrooms (spec §18.4)
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  return ok({ results: await teacherExamResults(tenantId, ctx.userId) });
});
