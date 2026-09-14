import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listTenantStudents } from "@/server/services/schooladmin";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const url = new URL(req.url);
  const classroomId = url.searchParams.get("classroomId") ?? undefined;
  return ok({ students: await listTenantStudents(tenantId, classroomId) });
});
