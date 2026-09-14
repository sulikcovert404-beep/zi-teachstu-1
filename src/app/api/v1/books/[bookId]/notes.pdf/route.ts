import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookStudyNotesPdf } from "@/server/services/books";

export const dynamic = "force-dynamic";

// Round 22 — جزوهٔ کتاب به‌صورت PDF فارسی واقعی (Chromium + Vazirmatn جاسازی‌شده).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const { pdf, filename } = await bookStudyNotesPdf(ctx, bookId);
  const encoded = encodeURIComponent(filename);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="jozve.pdf"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
});
