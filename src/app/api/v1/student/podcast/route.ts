import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { generatePodcast } from "@/server/services/podcast";

export const dynamic = "force-dynamic";

// Milestone G (spec §13) — convert study text/summary into spoken audio.
// Returns base64-encoded WAV inside JSON so quota metadata travels with the
// audio and every error keeps the standard { error: { code, message } } shape.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(
    await generatePodcast(ctx, {
      title: typeof body?.title === "string" ? body.title : undefined,
      text: typeof body?.text === "string" ? body.text : "",
      voice: typeof body?.voice === "string" ? body.voice : undefined,
      speed: typeof body?.speed === "number" ? body.speed : undefined,
    })
  );
});
