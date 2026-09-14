import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { listMyBookAttempts, submitBookQuiz } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — my previous attempts on this book's quizzes (best-score history).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  return Response.json({ attempts: await listMyBookAttempts(ctx, bookId) });
});

// POST — submit answers {model, answers:{itemId: value}} → server-side grading +
// points awarded on best-improvement (shared by web and Telegram — manager round-16).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const model = String(body?.model ?? "MC");
  const answers =
    body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : {};
  return Response.json(await submitBookQuiz(ctx, bookId, model, answers));
});
