import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createTenantClassroom, listTenantClasses } from "@/server/services/schooladmin";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  return ok({ classes: await listTenantClasses(tenantId) });
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || !body?.grade || !body?.subject || !body?.teacherId)
    throw Errors.validation("نام کلاس، پایه، درس و معلم الزامی است.");
  return ok(
    await createTenantClassroom(tenantId, {
      name,
      grade: String(body.grade),
      subject: String(body.subject),
      teacherId: String(body.teacherId),
    })
  );
});
