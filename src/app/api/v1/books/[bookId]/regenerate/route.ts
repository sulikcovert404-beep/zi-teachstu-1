import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { regenerateBookArtifact, ARTIFACT_KINDS, type ArtifactKind } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — re-run generation for one artifact {kind: summary|notes|quiz|figures|podcast|lessons}.
// Round 28 — kind=lessons: بازاجرای تشخیص درس‌های کتاب (retry بعد از خطای موقت).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? "");
  const valid = [...ARTIFACT_KINDS, "lessons"] as string[];
  if (!valid.includes(kind)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "نوع بازتولید نامعتبر است (summary | notes | quiz | figures | podcast | lessons)." } },
      { status: 422 }
    );
  }
  return Response.json(await regenerateBookArtifact(ctx, bookId, kind as ArtifactKind | "lessons"));
});
