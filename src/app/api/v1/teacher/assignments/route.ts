import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createAssignment, listTeacherAssignments } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  return ok({ assignments: await listTeacherAssignments(tenantId, ctx.userId) });
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length < 3) throw Errors.validation("عنوان تکلیف باید حداقل ۳ کاراکتر باشد.");
  return ok(
    await createAssignment(tenantId, ctx.userId, {
      classroomId: String(body?.classroomId ?? ""),
      title,
      description: typeof body?.description === "string" ? body.description.slice(0, 2000) : undefined,
      examId: body?.examId ? String(body.examId) : undefined,
      dueAt: typeof body?.dueAt === "string" ? body.dueAt : null,
      closeAt: typeof body?.closeAt === "string" ? body.closeAt : null,
      publishNow: body?.publishNow !== false,
    })
  );
});
