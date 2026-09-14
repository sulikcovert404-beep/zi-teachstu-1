import { NextRequest } from "next/server";
import { handler, fail } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookPodcast } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — stream the generated podcast WAV (attachment download; auth-scoped).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  try {
    const { bookId } = await params;
    const ctx = await requireAuth(req);
    const { audio, filename, contentType, durationSec } = await bookPodcast(ctx, bookId);
    const encoded = encodeURIComponent(filename);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(audio.length),
        "Content-Disposition": `attachment; filename="podcast.wav"; filename*=UTF-8''${encoded}`,
        "X-Podcast-Duration-Sec": String(durationSec ?? ""),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
});
