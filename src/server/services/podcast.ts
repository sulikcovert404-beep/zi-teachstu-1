import { z } from "zod";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { FEATURES } from "@/server/core/constants";
import { aiSpeak, TTS_VOICES, type TTSVoice } from "@/server/ai/gateway";
import { requireFeature, type Entitlement } from "./plan";
import { audit } from "./audit";
import type { AuthContext } from "@/server/auth/session";

// ── Milestone G — Podcast (spec §13) — text-to-speech via central AI Gateway ──
// Quota/paywall is backend-enforced (feature PODCAST); synthesis, chunking,
// WAV merging and metering all live in the gateway (spec §10/§26 rule 11).

const PODCAST_MAX_CHARS = 3000; // mirrors the gateway hard cap (~3 min audio)

const speakSchema = z.object({
  title: z.string().trim().max(120, "عنوان پادکست حداکثر ۱۲۰ نویسه است.").optional(),
  text: z
    .string()
    .trim()
    .min(2, "متن پادکست باید حداقل ۲ نویسه باشد.")
    .max(PODCAST_MAX_CHARS, "متن پادکست حداکثر ۳٬۰۰۰ نویسه است."),
  voice: z.enum(TTS_VOICES).optional(),
  speed: z.number().min(0.5, "سرعت گفتار حداقل ۰٫۵ است.").max(2, "سرعت گفتار حداکثر ۲ است.").optional(),
});

export interface PodcastResult {
  audioBase64: string;
  contentType: "audio/wav";
  title: string;
  chars: number;
  chunks: number;
  durationSec: number;
  quota: Entitlement;
}

export async function generatePodcast(
  ctx: AuthContext,
  input: { title?: unknown; text?: unknown; voice?: unknown; speed?: unknown }
): Promise<PodcastResult> {
  if (!ctx.tenantId) throw Errors.forbidden("این قابلیت به سازمان متصل نیست.");

  const parsed = speakSchema.safeParse(input);
  if (!parsed.success) {
    throw Errors.validation(parsed.error.issues[0]?.message ?? "داده ورودی معتبر نیست.");
  }
  const data = parsed.data;

  // Backend-enforced paywall gate (spec §42)
  const quota = await requireFeature(ctx, FEATURES.PODCAST);

  const spoken = await aiSpeak({
    feature: FEATURES.PODCAST,
    text: data.text,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    voice: data.voice as TTSVoice | undefined,
    speed: data.speed,
  });

  await audit({
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    action: "podcast_generated",
    targetType: "podcast",
    metadata: {
      chars: spoken.chars,
      chunks: spoken.chunks,
      durationSec: spoken.durationSec,
      voice: data.voice ?? "tongtong",
      speed: data.speed ?? 1,
    },
  });

  return {
    audioBase64: spoken.audio.toString("base64"),
    contentType: "audio/wav",
    title: data.title?.trim() || "پادکست آموزشی",
    chars: spoken.chars,
    chunks: spoken.chunks,
    durationSec: spoken.durationSec,
    quota,
  };
}
