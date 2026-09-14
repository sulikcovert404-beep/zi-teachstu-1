import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookQuizPdf } from "@/server/services/books";

export const dynamic = "force-dynamic";

// Round 22 — نمونه‌سؤال به‌صورت PDF با «چارچوب رسمی برگهٔ آزمون»:
// کاور دوره/پایه/درس + راهنما + کادر نام‌و‌نام‌خانوادگی + سؤال‌های شماره‌گذاری‌شده
// با گزینه‌های شبکه‌ای/خط نقطه‌چین + پاسخ‌نامهٔ تشریحی در صفحهٔ جدا.
// ?model=MC|TF|FB|SHORT|MIXED (پیش‌فرض MC)
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const model = new URL(req.url).searchParams.get("model") ?? "MC";
  const { pdf, filename } = await bookQuizPdf(ctx, bookId, model);
  const encoded = encodeURIComponent(filename);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="quiz.pdf"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
});
