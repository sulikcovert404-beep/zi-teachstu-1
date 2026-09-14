import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookStudyNotesDocx } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — download the study notes (جزوه) as a real Persian RTL .docx (Word) file.
// NOTE: the folder segment is `notes.docx` so the file extension reads naturally;
// the [bookId] param precedes it.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const { docx, filename } = await bookStudyNotesDocx(ctx, bookId);
  const encoded = encodeURIComponent(filename);
  return new Response(new Uint8Array(docx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Length": String(docx.length),
      "Content-Disposition": `attachment; filename="jozve.docx"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
});
