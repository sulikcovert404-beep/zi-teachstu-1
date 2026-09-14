import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { regenerateBookArtifact, ARTIFACT_KINDS, type ArtifactKind } from "@/server/services/books";

export const dynamic = "force-dynamic";

// POST — re-run generation for one artifact {kind: summary|notes|quiz|figures|podcast}.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? "");
  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "نوع بازتولید نامعتبر است (summary | notes | quiz | figures | podcast)." } },
      { status: 422 }
    );
  }
  return Response.json(await regenerateBookArtifact(ctx, bookId, kind as ArtifactKind));
});
