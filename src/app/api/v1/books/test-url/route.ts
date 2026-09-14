import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { Errors } from "@/server/core/errors";
import { testPdfUrl } from "@/server/services/pdf-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Round 21 — POST /api/v1/books/test-url
// { url: "https://…/book.pdf" } → { ok: true, fileName, sizeBytes, sourceUrl }
// «باکس تست لینک دانلود کتاب» در پنل مدیریت کل پلتفرم: مدیر لینک را می‌چسباند،
// سرور همان دانلود امن (SSRF-گارد، ریدایرکت اعتبارسنجی‌شده، سقف ۲۵ مگابایت، امضای PDF)
// را انجام می‌دهد؛ اگر دانلود ممکن نشد، خطای دقیق فارسی برمی‌گردد (۴۲۲). مجوزها
// دقیقاً همان قواعد آپلود کتاب است.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!url.trim()) throw Errors.validation("لینک دانلود کتاب را وارد کنید.");
  const result = await testPdfUrl(ctx, url);
  return Response.json(result, { status: 200 });
});
