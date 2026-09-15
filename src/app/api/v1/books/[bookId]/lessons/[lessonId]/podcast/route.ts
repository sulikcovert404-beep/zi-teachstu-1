import { NextRequest } from "next/server";
import { handler, fail } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { bookLessonPodcast } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — Round 28 — استریم پادکست یک درس (WAV؛ تلگرام اول، fallback محلی).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string; lessonId: string }> }) => {
  try {
    const { bookId, lessonId } = await params;
    const ctx = await requireAuth(req);
    const { audio, filename, contentType, durationSec } = await bookLessonPodcast(ctx, bookId, lessonId);
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
