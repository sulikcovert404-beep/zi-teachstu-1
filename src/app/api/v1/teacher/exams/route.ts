import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createExam, listTeacherExams } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  return ok({ exams: await listTeacherExams(tenantId, ctx.userId) });
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length < 3) throw Errors.validation("عنوان آزمون باید حداقل ۳ کاراکتر باشد.");
  if (!Array.isArray(body?.questions)) throw Errors.validation("فهرست سؤال‌ها الزامی است.");
  return ok(
    await createExam(tenantId, ctx.userId, {
      title,
      description: typeof body?.description === "string" ? body.description.slice(0, 2000) : undefined,
      durationMinutes: Number(body?.durationMinutes) || 20,
      questions: body.questions.map((q: any) => ({
        type: String(q?.type ?? "MULTIPLE_CHOICE"),
        prompt: String(q?.prompt ?? ""),
        options: Array.isArray(q?.options) ? q.options.map((o: any) => String(o)) : undefined,
        correctAnswer: String(q?.correctAnswer ?? ""),
        explanation: typeof q?.explanation === "string" ? q.explanation : undefined,
        difficulty: String(q?.difficulty ?? "MEDIUM"),
        topic: typeof q?.topic === "string" ? q.topic : undefined,
        points: Number(q?.points) || 1,
      })),
    })
  );
});
