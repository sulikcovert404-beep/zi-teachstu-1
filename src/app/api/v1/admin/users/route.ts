import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createTenantUser } from "@/server/services/schooladmin";

export const dynamic = "force-dynamic";

// School onboarding (spec §92): create teacher/student inside own tenant
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "TEACHER" || body?.role === "STUDENT" ? body.role : null;
  if (!fullName || fullName.length < 3) throw Errors.validation("نام کامل الزامی است.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Errors.validation("ایمیل معتبر نیست.");
  if (password.length < 6) throw Errors.validation("رمز عبور باید حداقل ۶ کاراکتر باشد.");
  if (!role) throw Errors.validation("نقش باید معلم یا دانش‌آموز باشد.");
  return ok(
    await createTenantUser(tenantId, {
      fullName,
      email,
      password,
      role,
      grade: typeof body?.grade === "string" ? body.grade : undefined,
    })
  );
});
