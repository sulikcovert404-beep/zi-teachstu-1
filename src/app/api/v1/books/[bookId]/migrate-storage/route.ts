import { NextRequest } from "next/server";
import { ok, fail, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { migrateBookToTelegram } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — Round 23 «ذخیره‌سازی کامل در تلگرام»: انتقال باینری‌های یک کتاب موجود
// (PDF اصلی، پادکست WAV، خلاصه/جزوه/نمونه‌سؤال PDF) از هاست به چت ذخیره‌سازی
// تلگرام؛ نسخه‌های محلی حذف و fileIdهای دائمی ثبت می‌شوند.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  try {
    const { bookId } = await params;
    const ctx = await requireAuth(req);
    const result = await migrateBookToTelegram(ctx, bookId);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
});
