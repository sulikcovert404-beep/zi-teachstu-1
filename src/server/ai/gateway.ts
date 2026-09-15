import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { FEATURES, type Feature } from "@/server/core/constants";
import { getSettings, resolveAiProvider } from "@/server/services/settings";
import { geminiFetch, type GeminiTransport } from "@/server/services/gemini-net";

// Spec §10 — CENTRAL AI GATEWAY. No feature may call a provider directly.
// Responsibilities: provider selection, retry, timeout, cost accounting, usage metering,
// safety (empty-response rejection), logging without secrets, request trace.

export interface AIRequest {
  feature: Feature;
  systemPrompt: string;
  userMessage: string;
  history?: { role: "user" | "assistant"; content: string }[];
  tenantId: string | null;
  userId: string;
  maxOutputChars?: number;
  temperature?: number;
}

export interface AIResponse {
  content: string;
  usage: {
    inputUnits: number;
    outputUnits: number;
    estimatedCost: number; // milli-toman (unit cost estimate)
    provider: string;
    model: string;
    attempts: number;
    latencyMs: number;
  };
}

const PROVIDER = "zai";
const MODEL = "glm";
const TIMEOUT_MS = 60_000;
const GEMINI_TIMEOUT_MS = 90_000; // gemini pro can be slow on long outputs
const MAX_ATTEMPTS = 2;

// Estimated unit cost per 1K chars (milli-toman) — for metering/accounting only
const COST_PER_1K_CHARS = 5;

function estimateUnits(text: string): number {
  return Math.ceil(text.length / 4); // ~chars→token heuristic
}

async function callProvider(req: AIRequest, signal: AbortSignal): Promise<string> {
  const zai = await ZAI.create();
  const messages: { role: "assistant" | "user"; content: string }[] = [
    { role: "assistant", content: req.systemPrompt },
    ...(req.history ?? []).slice(-12), // bounded context
    { role: "user", content: req.userMessage },
  ];
  // SDK type declares a single body argument, but the underlying fetch accepts
  // request options (incl. AbortSignal) as the second argument at runtime.
  const createWithSignal = zai.chat.completions.create as unknown as (
    body: Record<string, unknown>,
    opts?: { signal?: AbortSignal }
  ) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  const completion = await createWithSignal(
    {
      messages,
      thinking: { type: "disabled" },
    },
    { signal }
  );
  const content = completion.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new Error("EMPTY_AI_RESPONSE");
  return content.trim();
}

// Round 16 — BYO Gemini provider (manager request). Same contract as callProvider:
// (systemPrompt, history, userMessage) → text. REST generateContent with
// x-goog-api-key header (key never logged, never returned). Roles map 1:1
// (assistant→model) per the Gemini contents schema.
// Round 27 — تمام ترافیک از geminiFetch می‌گذرد: پروکسی HTTP (با احراز هویت)
// در صورت تنظیم، بدون دست‌زدن به کد و در هر میزبانی.
async function callGemini(
  req: AIRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  tr: GeminiTransport
): Promise<string> {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    ...(req.history ?? [])
      .slice(-12)
      .map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: req.userMessage }] },
  ];
  const body = {
    system_instruction: { parts: [{ text: req.systemPrompt }] },
    contents,
    generationConfig: {
      temperature: typeof req.temperature === "number" ? req.temperature : 0.7,
      maxOutputTokens: 8192,
    },
  };
  const res = await geminiFetch(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal,
  }, tr);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error(`GEMINI_AUTH_FAILED:${res.status}`);
    }
    if (res.status === 429) throw new Error("GEMINI_RATE_LIMITED:429");
    throw new Error(`GEMINI_HTTP_${res.status}:${errText.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("EMPTY_AI_RESPONSE");
  return text;
}

export async function aiComplete(req: AIRequest): Promise<AIResponse> {
  const started = Date.now();
  const providerConfig = await resolveAiProvider().catch(() => ({ provider: "zai" as const }));
  const useGemini = providerConfig.provider === "gemini";
  const activeProvider = useGemini ? "gemini" : PROVIDER;
  const activeModel = useGemini ? providerConfig.model : MODEL;
  const timeoutMs = useGemini ? GEMINI_TIMEOUT_MS : TIMEOUT_MS;

  let lastError: unknown = null;
  let content: string | null = null;
  let attempts = 0;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    attempts = i;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      content = useGemini
        ? await callGemini(
            req,
            providerConfig.apiKey,
            providerConfig.model,
            controller.signal,
            { proxyUrl: providerConfig.proxyUrl }
          )
        : await callProvider(req, controller.signal);
      clearTimeout(timer);
      break;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      // Invalid key / quota will not heal within a retry — fail fast with a precise message.
      if (e instanceof Error && /^GEMINI_AUTH_FAILED/.test(e.message)) break;
      if (i < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 600 * i)); // backoff
    }
  }

  const inputUnits = estimateUnits(req.systemPrompt + req.userMessage + JSON.stringify(req.history ?? ""));
  const outputUnits = content ? estimateUnits(content) : 0;
  const estimatedCost = Math.ceil(((inputUnits + outputUnits) / 1000) * COST_PER_1K_CHARS);

  // Metering (spec §9) — success AND failure are recorded
  await db.usageEvent
    .create({
      data: {
        userId: req.userId,
        tenantId: req.tenantId,
        feature: req.feature,
        provider: activeProvider,
        model: activeModel,
        inputUnits,
        outputUnits,
        estimatedCost,
        success: !!content,
      },
    })
    .catch(() => undefined); // metering must never break the request path

  if (!content) {
    // request trace without secrets
    console.error(
      `[ai-gateway] feature=${req.feature} provider=${activeProvider} failed after ${attempts} attempts: ${
        lastError instanceof Error ? lastError.message : "unknown"
      }`
    );
    if (lastError instanceof Error && /^GEMINI_AUTH_FAILED/.test(lastError.message)) {
      throw Errors.providerUnavailable(
        "کلید API جمینای نامعتبر است یا دسترسی ندارد. کلید را در «تنظیمات و اتصال‌ها» بررسی کنید."
      );
    }
    if (lastError instanceof Error && /^GEMINI_RATE_LIMITED/.test(lastError.message)) {
      throw Errors.providerUnavailable(
        "سهمیهٔ جمینای به پایان رسیده است (429). کمی بعد تلاش کنید یا کلید دیگری تنظیم کنید."
      );
    }
    // Provider auth/connectivity failures are upstream outages, not app bugs →
    // surface a clean, retryable 503 instead of a generic 500 (spec §10 safe failure).
    if (isProviderOutage(lastError)) throw Errors.providerUnavailable();
    throw Errors.internal();
  }

  if (req.maxOutputChars && content.length > req.maxOutputChars) {
    content = content.slice(0, req.maxOutputChars);
  }

  return {
    content,
    usage: { inputUnits, outputUnits, estimatedCost, provider: activeProvider, model: activeModel, attempts, latencyMs: Date.now() - started },
  };
}

// Auth/availability failures from the upstream provider (e.g. credential or
// connectivity problems) — the caller cannot fix these by changing the request.
function isProviderOutage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /401|403|missing X-Token|invalid X-Token|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|GEMINI_HTTP_5\d\d|GEMINI_HTTP_429|abort/i.test(msg);
}

// ── Milestone G — Text-to-Speech (Podcast) ──
// The TTS provider accepts ≤1024 chars per request and returns a mono 24kHz WAV.
// Longer text is split at sentence boundaries, synthesized chunk-by-chunk, and
// the PCM payloads are merged into one valid WAV (single RIFF header) with a
// short pause between chunks — spec §13/§10: all audio synthesis flows through
// THIS gateway with metering, never from a feature service directly.

const TTS_MAX_INPUT_CHARS = 3000; // hard cap per podcast request (~3 min audio)
const TTS_CHUNK_CHARS = 1000; // per-request cap with safety margin below 1024
const TTS_PAUSE_MS = 350; // breathing room between spoken chunks
export const TTS_VOICES = ["tongtong", "xiaochen", "jam", "kazi", "douji"] as const;
export type TTSVoice = (typeof TTS_VOICES)[number];

export interface SpeakRequest {
  feature: Feature;
  text: string;
  tenantId: string | null;
  userId: string;
  voice?: TTSVoice;
  speed?: number; // 0.5 – 2.0
  /** Round 28 — کد دورهٔ تحصیلی محتوا (PRE_PRIMARY | PRIMARY | …) — انتخاب
   *  صدای گویندهٔ جمینای و لحن متناسب با سن از تنظیمات ادمین. */
  levelHint?: string | null;
}

export interface SpeakResponse {
  audio: Buffer; // merged WAV (audio/wav)
  contentType: "audio/wav";
  chunks: number;
  chars: number;
  durationSec: number;
  usage: {
    inputUnits: number;
    outputUnits: number;
    estimatedCost: number;
    provider: string;
    model: string;
    attempts: number;
    latencyMs: number;
  };
}

// Split at sentence enders (Persian + Latin) without exceeding the chunk cap.
// Exported for service-level reuse and tests.
export function splitForSpeech(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?؟؛…:])|(?<=\n)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (s.length > TTS_CHUNK_CHARS) {
      // hard-split pathological runs at word boundaries
      let rest = s;
      while (rest.length > TTS_CHUNK_CHARS) {
        let cut = rest.lastIndexOf(" ", TTS_CHUNK_CHARS);
        if (cut < TTS_CHUNK_CHARS * 0.5) cut = TTS_CHUNK_CHARS;
        if (buf) { chunks.push(buf); buf = ""; }
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) {
        if (buf && buf.length + 1 + rest.length <= TTS_CHUNK_CHARS) buf = `${buf} ${rest}`;
        else { if (buf) chunks.push(buf); buf = rest; }
      }
    } else if (buf && buf.length + 1 + s.length <= TTS_CHUNK_CHARS) {
      buf = `${buf} ${s}`;
    } else {
      if (buf) chunks.push(buf);
      buf = s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean).slice(0, 5); // 5 chunks max ≈ TTS_MAX_INPUT_CHARS
}

interface WavInfo {
  dataStart: number;
  data: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

// Minimal RIFF/WAVE parser: walks chunk list to find `fmt ` and `data`.
// Exported for tests.
export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("INVALID_WAV");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      data = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!data || !sampleRate || !channels || !bitsPerSample) throw new Error("INVALID_WAV");
  return { dataStart: 0, data, sampleRate, channels, bitsPerSample };
}

// Merge per-chunk WAVs into a single valid WAV + silence gaps between chunks.
// Exported for tests.
export function mergeWavs(chunks: Buffer[], pauseFrames: number, ref: WavInfo): Buffer {
  const parts: Buffer[] = [];
  const silence = Buffer.alloc((ref.bitsPerSample / 8) * ref.channels * pauseFrames, 0);
  chunks.forEach((c, i) => {
    parts.push(parseWav(c).data);
    if (i < chunks.length - 1 && silence.length > 0) parts.push(silence);
  });
  const total = parts.reduce((sum, b) => sum + b.length, 0);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + total, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(ref.channels, 22);
  header.writeUInt32LE(ref.sampleRate, 24);
  header.writeUInt32LE(ref.sampleRate * ref.channels * (ref.bitsPerSample / 8), 28);
  header.writeUInt16LE(ref.channels * (ref.bitsPerSample / 8), 32);
  header.writeUInt16LE(ref.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(total, 40);
  return Buffer.concat([header, ...parts]);
}

async function ttsChunk(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  text: string,
  voice: TTSVoice,
  speed: number,
  signal: AbortSignal
): Promise<Buffer> {
  const createTts = zai.audio.tts.create as unknown as (
    body: Record<string, unknown>,
    opts?: { signal?: AbortSignal }
  ) => Promise<Response>;
  const response = await createTts(
    { input: text, voice, speed, response_format: "wav", stream: false },
    { signal }
  );
  const ab = await response.arrayBuffer();
  const buffer = Buffer.from(new Uint8Array(ab));
  if (buffer.length < 44) throw new Error("EMPTY_TTS_RESPONSE");
  return buffer;
}

// ── Round 28 — گویندهٔ Gemini TTS (خواستهٔ مدیر) ──
// مدل‌های TTS رسمی گوگل ۲.۵: خروجی PCM 16-bit mono 24kHz در inlineData است؛
// ما آن را به WAV استاندارد (هدر RIFF) تبدیل و چانک‌ها را با مکث می‌چسبانیم.
// صدا و «لحن» (دستور طبیعی زبان در ابتدای متن) از تنظیمات ادمین می‌آید —
// با override برای هر دورهٔ تحصیلی (صدای شادتر برای ابتدایی و…).
const GEMINI_TTS_TIMEOUT_MS = 90_000;
const GEMINI_TTS_CHUNK_CHARS = 2500; // خروجی هر چانک ~۲.۵ دقیقه صوت
const GEMINI_TTS_MAX_CHUNKS = 3; // سقف کل ~۳۰ ثانیه×… مطابق سقف ۳۰۰۰ نویسهٔ موجود
const GEMINI_TTS_SAMPLE_RATE = 24_000;

/** PCM خام → WAV معتبر (RIFF/PCM 16-bit mono) */
function pcmToWav(pcm: Buffer, sampleRate = GEMINI_TTS_SAMPLE_RATE, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function splitForGeminiTts(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?؟؛…:])|(?<=\n)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (s.length > GEMINI_TTS_CHUNK_CHARS) {
      let rest = s;
      while (rest.length > GEMINI_TTS_CHUNK_CHARS) {
        let cut = rest.lastIndexOf(" ", GEMINI_TTS_CHUNK_CHARS);
        if (cut < GEMINI_TTS_CHUNK_CHARS * 0.5) cut = GEMINI_TTS_CHUNK_CHARS;
        if (buf) { chunks.push(buf); buf = ""; }
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) {
        if (buf && buf.length + 1 + rest.length <= GEMINI_TTS_CHUNK_CHARS) buf = `${buf} ${rest}`;
        else { if (buf) chunks.push(buf); buf = rest; }
      }
    } else if (buf && buf.length + 1 + s.length <= GEMINI_TTS_CHUNK_CHARS) {
      buf = `${buf} ${s}`;
    } else {
      if (buf) chunks.push(buf);
      buf = s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean).slice(0, GEMINI_TTS_MAX_CHUNKS);
}

interface GeminiTtsConfig {
  model: string;
  voice: string;
  stylePrompt: string;
  apiKey: string;
  proxyUrl: string;
}

async function resolveGeminiTts(levelHint?: string | null): Promise<GeminiTtsConfig | null> {
  const provider = await resolveAiProvider().catch(() => null);
  if (!provider || provider.provider !== "gemini") return null; // فقط وقتی ارائه‌دهندهٔ فعال جمیناست
  const s = await getSettings();
  if (!s.geminiTtsEnabled) return null; // ادمین خاموشش کرده → zai
  const voice = (levelHint && s.geminiTtsVoiceByLevel[levelHint]) || s.geminiTtsVoice;
  const style = (levelHint && s.geminiTtsStylePromptByLevel[levelHint]) || s.geminiTtsStylePrompt;
  return {
    model: s.geminiTtsModel,
    voice,
    stylePrompt: style,
    apiKey: provider.apiKey,
    proxyUrl: provider.proxyUrl,
  };
}

async function geminiTtsChunk(
  cfg: GeminiTtsConfig,
  text: string,
  signal: AbortSignal
): Promise<Buffer> {
  // لحن/سبک به‌صورت دستور طبیعی در ابتدای متن (الگوی رسمی گوگل TTS)
  const spoken = cfg.stylePrompt.trim() ? `${cfg.stylePrompt.trim()}\n\n${text}` : text;
  const body = {
    contents: [{ parts: [{ text: spoken }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: cfg.voice },
        },
      },
    },
  };
  const res = await geminiFetch(
    `/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify(body),
      signal,
    },
    { proxyUrl: cfg.proxyUrl }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GEMINI_TTS_HTTP_${res.status}:${errText.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  };
  const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("GEMINI_TTS_EMPTY_RESPONSE");
  const pcm = Buffer.from(b64, "base64");
  if (pcm.length < 100) throw new Error("GEMINI_TTS_EMPTY_RESPONSE");
  // نرخ نمونه‌برداری از MIME رسمی (audio/L16;codec=pcm;rate=24000) parse می‌شود
  const mime = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.mimeType)?.inlineData?.mimeType ?? "";
  const rateMatch = /rate=(\d{4,6})/.exec(mime);
  const rate = rateMatch ? Number(rateMatch[1]) : GEMINI_TTS_SAMPLE_RATE;
  return pcmToWav(pcm, rate);
}

/** تولید گفتار با Gemini TTS؛ اگر شکست خورد به zai برمی‌گردیم تا پادکست هرگز نمرود */
async function aiSpeakWithGemini(
  cfg: GeminiTtsConfig,
  text: string,
  req: SpeakRequest
): Promise<SpeakResponse | null> {
  const chunks = splitForGeminiTts(text);
  if (chunks.length === 0) return null;
  const started = Date.now();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wavChunks: Buffer[] = [];
    let ok = true;
    for (const chunk of chunks) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TTS_TIMEOUT_MS);
      try {
        wavChunks.push(await geminiTtsChunk(cfg, chunk, controller.signal));
      } catch (e) {
        lastError = e;
        ok = false;
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (ok) {
      const ref = parseWav(wavChunks[0]);
      const pauseFrames = Math.round((ref.sampleRate * TTS_PAUSE_MS) / 1000);
      const audio = mergeWavs(wavChunks, pauseFrames, ref);
      const durationSec =
        Math.round(((audio.length - 44) / (ref.sampleRate * ref.channels * (ref.bitsPerSample / 8))) * 10) / 10;
      const inputUnits = text.length;
      const outputUnits = Math.ceil(audio.length / 1000);
      const estimatedCost = Math.ceil(((inputUnits + outputUnits) / 1000) * COST_PER_1K_CHARS);
      await db.usageEvent
        .create({
          data: {
            userId: req.userId,
            tenantId: req.tenantId,
            feature: req.feature,
            provider: "gemini",
            model: cfg.model,
            inputUnits,
            outputUnits,
            estimatedCost,
            success: true,
          },
        })
        .catch(() => undefined);
      return {
        audio,
        contentType: "audio/wav",
        chunks: chunks.length,
        chars: text.length,
        durationSec,
        usage: {
          inputUnits,
          outputUnits,
          estimatedCost,
          provider: "gemini",
          model: cfg.model,
          attempts: attempt,
          latencyMs: Date.now() - started,
        },
      };
    }
    if (lastError instanceof Error && /GEMINI_TTS_HTTP_4\d\d/.test(lastError.message)) break; // 4xx با retry درست نمی‌شود
    await new Promise((r) => setTimeout(r, 600 * attempt));
  }
  console.error(
    `[ai-gateway] feature=${req.feature} gemini-tts failed (falling back to zai): ${
      lastError instanceof Error ? lastError.message : "unknown"
    }`
  );
  // ثبت شکست برای داشبورد مصرف
  await db.usageEvent
    .create({
      data: {
        userId: req.userId,
        tenantId: req.tenantId,
        feature: req.feature,
        provider: "gemini",
        model: cfg.model,
        inputUnits: text.length,
        outputUnits: 0,
        estimatedCost: 0,
        success: false,
      },
    })
    .catch(() => undefined);
  return null; // → فراخواننده به zai برمی‌گردد
}

export async function aiSpeak(req: SpeakRequest): Promise<SpeakResponse> {
  const started = Date.now();
  const text = req.text.replace(/\s+/g, " ").trim();
  if (text.length < 2) throw Errors.validation("متن برای تبدیل به گفتار خیلی کوتاه است.");
  if (text.length > TTS_MAX_INPUT_CHARS)
    throw Errors.validation("متن پادکست حداکثر ۳٬۰۰۰ نویسه است.");

  const voice: TTSVoice = TTS_VOICES.includes(req.voice as TTSVoice) ? (req.voice as TTSVoice) : "tongtong";
  const speed = typeof req.speed === "number" && req.speed >= 0.5 && req.speed <= 2 ? req.speed : 1;
  const chunks = splitForSpeech(text);
  if (chunks.length === 0) throw Errors.validation("متن قابل گفتار نیست.");

  // ── Round 28 — اول تلاش با گویندهٔ Gemini TTS (تنظیم ادمین) ──
  const geminiTts = await resolveGeminiTts(req.levelHint).catch(() => null);
  if (geminiTts) {
    const spoken = await aiSpeakWithGemini(geminiTts, text, req).catch(() => null);
    if (spoken) return spoken;
    // شکست → ادامه با zai تا پادکست تولید نشود؟ نه — پادکست با صدای جایگزین بهتر از
    // نبودِ پادکست است (خبر در لاگ ثبت شد).
  }

  const zai = await ZAI.create();
  let lastError: unknown = null;
  let wavChunks: Buffer[] = [];
  let attempts = 0;

  // Sequential synthesis — preserves order, keeps provider load predictable.
  for (let i = 0; i < chunks.length; i++) {
    let done = false;
    for (let a = 1; a <= MAX_ATTEMPTS && !done; a++) {
      attempts = a;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        wavChunks.push(await ttsChunk(zai, chunks[i], voice, speed, controller.signal));
        done = true;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 600 * a));
      } finally {
        clearTimeout(timer);
      }
    }
    if (!done) break;
  }

  const inputUnits = text.length;
  const outputUnits = Math.ceil(wavChunks.reduce((s, b) => s + b.length, 0) / 1000);
  const estimatedCost = Math.ceil(((inputUnits + outputUnits) / 1000) * COST_PER_1K_CHARS);

  await db.usageEvent
    .create({
      data: {
        userId: req.userId,
        tenantId: req.tenantId,
        feature: req.feature,
        provider: PROVIDER,
        model: "tts-wav-24k",
        inputUnits,
        outputUnits,
        estimatedCost,
        success: wavChunks.length === chunks.length,
      },
    })
    .catch(() => undefined);

  if (wavChunks.length !== chunks.length || wavChunks.length === 0) {
    console.error(
      `[ai-gateway] feature=${req.feature} tts failed after ${attempts} attempts: ${
        lastError instanceof Error ? lastError.message : "unknown"
      }`
    );
    if (isProviderOutage(lastError)) throw Errors.providerUnavailable();
    throw Errors.internal();
  }

  const ref = parseWav(wavChunks[0]);
  const pauseFrames = Math.round((ref.sampleRate * TTS_PAUSE_MS) / 1000);
  const audio = mergeWavs(wavChunks, pauseFrames, ref);

  return {
    audio,
    contentType: "audio/wav",
    chunks: chunks.length,
    chars: text.length,
    durationSec: Math.round(((audio.length - 44) / (ref.sampleRate * ref.channels * (ref.bitsPerSample / 8))) * 10) / 10,
    usage: {
      inputUnits,
      outputUnits,
      estimatedCost,
      provider: PROVIDER,
      model: "tts-wav-24k",
      attempts,
      latencyMs: Date.now() - started,
    },
  };
}

export const AI_FEATURES = FEATURES; // re-export for callers
