import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getBookLesson } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — Round 28 — جزئیات یک درس + قلب معماری تنبل:
// اولین انتخاب‌کنندهٔ درس تولید همهٔ محتواها را با AI شروع می‌کند (claim اتمیک)؛
// انتخاب‌های بعدی همان خروجی ذخیره‌شده را فوراً می‌گیرند.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string; lessonId: string }> }) => {
  const { bookId, lessonId } = await params;
  const ctx = await requireAuth(req);
  return Response.json(await getBookLesson(ctx, bookId, lessonId));
});
