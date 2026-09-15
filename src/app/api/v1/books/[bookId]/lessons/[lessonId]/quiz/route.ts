import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getBookLessonQuiz } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — Round 28 — نمونه‌سؤال‌های یک درس (?model=MC|TF|MIXED|FB|SHORT).
// پاسخ‌های صحیح هرگز به کلاینت نمی‌روند — تصحیح فقط سمت سرور.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string; lessonId: string }> }) => {
  const { bookId, lessonId } = await params;
  const ctx = await requireAuth(req);
  const model = req.nextUrl.searchParams.get("model") ?? "MC";
  return Response.json(await getBookLessonQuiz(ctx, bookId, lessonId, model));
});
