import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { enrollStudent } from "@/server/services/schooladmin";

export const dynamic = "force-dynamic";

// Enroll a student into a class (spec §92 / §16)
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  if (!body?.classroomId || !body?.studentId)
    throw Errors.validation("شناسه کلاس و دانش‌آموز الزامی است.");
  return ok(await enrollStudent(tenantId, String(body.classroomId), String(body.studentId)));
});
