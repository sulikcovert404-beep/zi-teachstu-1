import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { Errors } from "@/server/core/errors";
import { extractPdfText } from "@/server/services/pdf-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Round 19 — POST /api/v1/books/extract-pdf
// multipart/form-data { file: <book.pdf> } → { text, pages, chars, truncated, fileName }.
// Permission-gated exactly like book upload (SUPER_ADMIN always; school/teacher when
// the platform admin enabled the capability for their tenant). The client fills the
// extracted text into the review textarea; the book itself is still created via the
// regular POST /api/v1/books contract.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw Errors.validation("فایل PDF ارسال نشد — فیلد «file» در فرم لازم است.");
  }
  const result = await extractPdfText(ctx, file);
  return Response.json(result, { status: 200 });
});
