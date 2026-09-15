import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { submitBookLessonQuiz } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — Round 28 — ثبت پاسخ‌های آزمونِ یک درس {model, answers:{itemId: value}} →
// تصحیح سمت سرور + امتیاز فقط برای بهبود رکورد شخصیِ «همین درس» (ضد تکرار).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string; lessonId: string }> }) => {
  const { bookId, lessonId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const model = String(body?.model ?? "MC");
  const answers =
    body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : {};
  return Response.json(await submitBookLessonQuiz(ctx, bookId, lessonId, model, answers));
});
