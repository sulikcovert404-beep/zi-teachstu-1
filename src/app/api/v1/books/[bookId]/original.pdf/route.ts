import { NextRequest } from "next/server";
import { handler, fail } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookOriginalPdf } from "@/server/services/books";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Round 20 — GET — stream the ORIGINAL uploaded book PDF (file upload or fetched from
// the download link) as an attachment download. Auth-scoped to whoever can see the
// book — students get the real textbook, not just the generated خلاصه/جزوه/پادکست.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  try {
    const { bookId } = await params;
    const ctx = await requireAuth(req);
    const { data, filename } = await bookOriginalPdf(ctx, bookId);
    const encoded = encodeURIComponent(filename);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(data.length),
        "Content-Disposition": `attachment; filename="book.pdf"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
});
