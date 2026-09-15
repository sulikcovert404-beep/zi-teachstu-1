import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { regenerateLessonArtifact, ARTIFACT_KINDS, type ArtifactKind } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — Round 28 — بازتولید یک مصنوعِ درس {kind: summary|notes|quiz|figures|podcast}.
// ایجادکنندهٔ کتاب/مدیر کل همیشه مجاز؛ سایر کاربران فقط وقتی آن مصنوع FAILED شده.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string; lessonId: string }> }) => {
  const { bookId, lessonId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? "");
  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "نوع بازتولید نامعتبر است (summary | notes | quiz | figures | podcast)." } },
      { status: 422 }
    );
  }
  return Response.json(await regenerateLessonArtifact(ctx, bookId, lessonId, kind as ArtifactKind));
});
