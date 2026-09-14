import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getBookQuiz } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — quiz questions for a model (?model=MC|TF|MIXED|SHORT). Correct answers are
// stripped; grading is server-side only (same endpoint serves web + Telegram).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const model = req.nextUrl.searchParams.get("model") ?? "MC";
  return Response.json(await getBookQuiz(ctx, bookId, model));
});
