import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { Errors } from "@/server/core/errors";
import { extractPdfFromUrl } from "@/server/services/pdf-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Round 20 — POST /api/v1/books/extract-url
// { url: "https://…/book.pdf" } → { text, pages, chars, truncated, fileName, storageKey, sourceUrl }
// The server itself fetches the PDF from the download link (SSRF-guarded: private/local
// hosts blocked, ≤3 validated redirects, 25MB streamed cap, 30s timeout) and runs the
// same RTL-aware extraction as file uploads. Permission-gated exactly like upload.
// Used by the platform admin + teacher forms («لینک دانلود کتاب») and reusable by the
// Telegram bot (which uploads via /extract-pdf instead).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!url.trim()) throw Errors.validation("لینک دانلود کتاب را وارد کنید.");
  const result = await extractPdfFromUrl(ctx, url);
  return Response.json(result, { status: 200 });
});
