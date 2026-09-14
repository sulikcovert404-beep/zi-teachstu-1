import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { reviewBookApproval } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — SUPER_ADMIN approves or rejects a school/teacher book upload (round 18).
// Body: {decision: "APPROVED" | "REJECTED", note?: string}. Students can only see
// APPROVED tenant/classroom books; platform books don't need approval.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision === "REJECTED" ? "REJECTED" : body?.decision === "APPROVED" ? "APPROVED" : null;
  if (!decision) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "تصمیم باید APPROVED یا REJECTED باشد." } },
      { status: 422 }
    );
  }
  const note = typeof body?.note === "string" ? body.note : undefined;
  return Response.json(await reviewBookApproval(ctx, bookId, decision, note));
});
