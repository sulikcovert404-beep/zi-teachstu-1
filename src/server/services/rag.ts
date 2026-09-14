import { z } from "zod";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { FEATURES } from "@/server/core/constants";
import { aiComplete } from "@/server/ai/gateway";
import { RAG_PROMPTS } from "@/server/ai/rag-prompts";
import { requireFeature, type Entitlement } from "./plan";
import { audit } from "./audit";
import type { AuthContext } from "@/server/auth/session";

// ── Milestone D (spec §12) — RAG Knowledge Base with Source Guardian ──
// Pipeline: Upload/Ingest → validation → chunking → metadata → retrieval
// → context builder → AI gateway → response + sources.
// SQLite has no vector store → lexical BM25-style retrieval in JS (tenant-filtered FIRST:
// permission is resolved before retrieval runs — spec §12).

const CHUNK_TARGET = 900; // ~900 chars per chunk at sentence boundaries
const CHUNK_MIN = 200; // smaller neighbors get merged forward
const MAX_CONTEXT_CHARS = 6000; // total context cap
const TOP_K = 6; // chunks per query
const BM25_K1 = 1.5;
const BM25_B = 0.75;

export const NO_MATCH_ANSWER =
  "پاسخی برای این پرسش در منابع موجود یافت نشد. برای دریافت پاسخ، ابتدا منبع مرتبطی در دانش‌نامه ثبت کنید.";

// ── Persian text normalization + lexical retrieval ──

const ARABIC_TO_PERSIAN: Record<string, string> = {
  ي: "ی", // Arabic yeh → Persian yeh
  ك: "ک", // Arabic kaf → Persian kaf
  "ة": "ه",
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  "ؤ": "و",
  "ئ": "ی",
  ى: "ی", // alef maqsura → yeh
};

// Normalize for MATCHING only (display text is never altered):
// strip diacritics/tatweel, turn ZWNJ into a boundary, fold Arabic letters to Persian.
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // fatha/damma/kasra… + tatweel
    .replace(/\u200C/g, " ") // ZWNJ → boundary (so «حرکت‌شناسی» matches «حرکت»)
    .replace(/[يكةأإآٱؤئى]/g, (ch) => ARABIC_TO_PERSIAN[ch] ?? ch);
}

function tokenize(s: string): string[] {
  return normalizeForMatch(s)
    .split(/[^\u0600-\u06FF\u0750-\u077Fa-zA-Z0-9]+/)
    .filter((t) => t.length > 0);
}

// ~60 Persian stopwords — dropped from QUERY terms (documents keep full token stats).
const STOPWORDS = new Set([
  "و","در","به","از","که","این","آن","را","با","است","بود","شد","برای","تا","بر","هم","یا",
  "اگر","چه","هر","آنها","ایشان","وی","خود","کرد","کند","کنم","کنیم","کنید","کنند","کردند",
  "می","های","ها","شود","شده","نیست","هست","هستند","دارد","دارم","داریم","دارید","دارند",
  "اما","ولی","زیر","رو","وقتی","چون","چرا","کجا","چگونه","چطور","چند","چیست","کدام","چیز",
  "برخی","بعضی","دیگر","همان","اینها","آنان","ما","شما","من","تو","او","خودم","خودش",
  "نیز","فقط","بسیار","خیلی","مانند","مثل","طبق","بدون","درباره","مورد","باید","پس","بلکه",
]);

function queryTerms(question: string): string[] {
  return tokenize(question).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// BM25-lite over chunk token lists.
function bm25Score(query: string[], docTokens: string[], df: Map<string, number>, nDocs: number, avgLen: number): number {
  if (query.length === 0 || docTokens.length === 0) return 0;
  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const norm = BM25_K1 * (1 - BM25_B + BM25_B * (docTokens.length / Math.max(1, avgLen)));
  let score = 0;
  for (const term of query) {
    const f = tf.get(term);
    if (!f) continue;
    const dfv = df.get(term) ?? 0;
    const idf = Math.log(1 + (nDocs - dfv + 0.5) / (dfv + 0.5));
    score += idf * ((f * (BM25_K1 + 1)) / (f + norm));
  }
  return score;
}

// ── Chunking (spec §12 ingestion) ──

export function chunkContent(content: string): string[] {
  // 1) split on newlines → paragraphs; 2) paragraphs → sentences at Persian enders;
  // 3) accumulate up to ~CHUNK_TARGET; 4) merge < CHUNK_MIN forward.
  const sentences: string[] = [];
  for (const para of content.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    for (const s of p.split(/(?<=[.!?؟؛،:])/)) {
      const sentence = s.trim();
      if (!sentence) continue;
      if (sentence.length > CHUNK_TARGET) sentences.push(...hardSplit(sentence));
      else sentences.push(sentence);
    }
  }
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let buf = "";
  for (const sentence of sentences) {
    if (!buf) {
      buf = sentence;
    } else if (buf.length + 1 + sentence.length <= CHUNK_TARGET) {
      buf = `${buf} ${sentence}`;
    } else {
      chunks.push(buf);
      buf = sentence;
    }
  }
  if (buf) chunks.push(buf);

  // merge-forward tiny chunks (< CHUNK_MIN)
  const merged: string[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    const small = last !== undefined && (last.length < CHUNK_MIN || chunk.length < CHUNK_MIN);
    if (small && last.length + 1 + chunk.length <= CHUNK_TARGET + CHUNK_MIN) {
      merged[merged.length - 1] = `${last} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged.map((c) => c.trim()).filter((c) => c.length > 0);
}

function hardSplit(s: string): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > CHUNK_TARGET) {
    let cut = rest.lastIndexOf(" ", CHUNK_TARGET);
    if (cut < CHUNK_TARGET * 0.5) cut = CHUNK_TARGET;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ── Citation helpers ──

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toFaDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}
function faToEnDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
}

function parseCitations(answer: string): number[] {
  const nums: number[] = [];
  const re = /\[\s*([۰-۹0-9]{1,2})\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    const v = Number(faToEnDigits(m[1]));
    if (Number.isInteger(v) && v >= 1) nums.push(v);
  }
  return nums;
}

// ≤160-char snippet centered on the best-matching query term.
function makeSnippet(content: string, terms: string[]): string {
  for (const term of terms) {
    if (term.length < 3) continue;
    const idx = content.indexOf(term);
    if (idx >= 0) {
      const start = Math.max(0, idx - 45);
      const end = Math.min(content.length, start + 160);
      return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
    }
  }
  return content.slice(0, 160);
}

// ── Validation schemas (Persian messages) ──

const createSourceSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "عنوان منبع باید حداقل ۲ نویسه باشد.")
    .max(120, "عنوان منبع حداکثر ۱۲۰ نویسه است."),
  description: z.string().trim().max(500, "توضیحات منبع حداکثر ۵۰۰ نویسه است.").optional(),
  subject: z.string().trim().max(60, "نام درس حداکثر ۶۰ نویسه است.").optional(),
  classroomId: z.string().trim().min(1).optional().nullable(),
  content: z
    .string()
    .min(200, "متن منبع باید حداقل ۲۰۰ نویسه باشد؛ محتوای آموزشی کامل‌تری وارد کنید.")
    .max(100_000, "متن منبع حداکثر ۱۰۰٬۰۰۰ نویسه است."),
});

const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "پرسش باید حداقل ۳ نویسه باشد.")
    .max(1000, "پرسش حداکثر ۱۰۰۰ نویسه است."),
  sourceIds: z.array(z.string().min(1)).max(20, "حداکثر ۲۰ منبع قابل انتخاب است.").optional(),
});

function firstIssue(err: z.ZodError): never {
  throw Errors.validation(err.issues[0]?.message ?? "داده ورودی معتبر نیست.");
}

async function mustTenant(ctx: AuthContext): Promise<string> {
  if (!ctx.tenantId) throw Errors.forbidden("این قابلیت به سازمان متصل نیست.");
  return ctx.tenantId;
}

// ── Source CRUD ──

export async function createSource(
  ctx: AuthContext,
  input: {
    title?: unknown;
    description?: unknown;
    subject?: unknown;
    classroomId?: unknown;
    content?: unknown;
  }
) {
  const tenantId = await mustTenant(ctx);
  const parsed = createSourceSchema.safeParse(input);
  if (!parsed.success) firstIssue(parsed.error);
  const data = parsed.data;

  // tenant isolation: classroom (when provided) must belong to the teacher's tenant
  if (data.classroomId) {
    const classroom = await db.classroom.findFirst({
      where: { id: data.classroomId, tenantId },
      select: { id: true },
    });
    if (!classroom)
      throw Errors.validation("کلاس انتخاب‌شده در سازمان شما یافت نشد.");
  }

  const chunks = chunkContent(data.content);
  if (chunks.length === 0)
    throw Errors.validation("متن منبع قابل قطعه‌بندی نیست؛ محتوای آموزشی معتبرتری وارد کنید.");

  const source = await db.knowledgeSource.create({
    data: {
      tenantId,
      createdBy: ctx.userId,
      classroomId: data.classroomId ?? null,
      title: data.title,
      description: data.description || null,
      subject: data.subject || null,
      status: "READY",
      sourceType: "TEXT",
      charCount: data.content.length,
      chunkCount: chunks.length,
      chunks: {
        create: chunks.map((content, position) => ({
          position,
          content,
          approxTokens: Math.ceil(content.length / 4),
        })),
      },
    },
    select: {
      id: true, title: true, description: true, subject: true, status: true, sourceType: true,
      charCount: true, chunkCount: true, classroomId: true, createdAt: true,
    },
  });

  await audit({
    actorId: ctx.userId,
    tenantId,
    action: "knowledge_source_created",
    targetType: "knowledge_source",
    targetId: source.id,
    metadata: { title: source.title, chunkCount: source.chunkCount, charCount: source.charCount },
  });

  return { source };
}

export async function listSources(ctx: AuthContext) {
  const tenantId = await mustTenant(ctx);
  const sources = await db.knowledgeSource.findMany({
    where: { tenantId },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { fullName: true } },
      _count: { select: { chunks: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return sources.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    subject: s.subject,
    status: s.status,
    sourceType: s.sourceType,
    charCount: s.charCount,
    chunkCount: s._count.chunks,
    classroom: s.classroom ? { id: s.classroom.id, name: s.classroom.name } : null,
    creator: s.creator.fullName,
    createdAt: s.createdAt,
  }));
}

export async function sourceDetail(ctx: AuthContext, sourceId: string) {
  const tenantId = await mustTenant(ctx);
  const source = await db.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { fullName: true } },
      chunks: { orderBy: { position: "asc" }, take: 5 },
      _count: { select: { chunks: true } },
    },
  });
  if (!source) throw Errors.notFound("منبع دانش‌نامه");

  const remainingChunks = Math.max(0, source._count.chunks - source.chunks.length);

  return {
    source: {
      id: source.id,
      title: source.title,
      description: source.description,
      subject: source.subject,
      status: source.status,
      sourceType: source.sourceType,
      charCount: source.charCount,
      chunkCount: source._count.chunks,
      classroom: source.classroom ? { id: source.classroom.id, name: source.classroom.name } : null,
      creator: source.creator.fullName,
      createdAt: source.createdAt,
    },
    chunks: source.chunks.map((c) => ({
      position: c.position,
      approxTokens: c.approxTokens,
      content: c.content,
    })),
    remainingChunks,
  };
}

export async function deleteSource(ctx: AuthContext, sourceId: string) {
  const tenantId = await mustTenant(ctx);
  const source = await db.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
    select: { id: true, title: true },
  });
  if (!source) throw Errors.notFound("منبع دانش‌نامه");

  await db.knowledgeSource.delete({ where: { id: source.id } }); // chunks cascade

  await audit({
    actorId: ctx.userId,
    tenantId,
    action: "knowledge_source_deleted",
    targetType: "knowledge_source",
    targetId: source.id,
    metadata: { title: source.title },
  });

  return { deleted: true };
}

// ── Source Guardian Q&A (spec §11.13 / §99) ──

export interface CitationRef {
  sourceId: string;
  title: string;
  chunkPosition: number;
  snippet: string;
}

export async function askSourceGuardian(
  ctx: AuthContext,
  input: { question?: unknown; sourceIds?: unknown },
  // Student scope (spec §12 — «RAG روی منابع مجاز»): when provided, retrieval only
  // reads sources that are tenant-wide (classroomId = null) or scoped to a
  // classroom the student actively belongs to. Permission resolves BEFORE
  // retrieval, exactly like the teacher path.
  scope?: { classroomIds: string[] }
) {
  const tenantId = await mustTenant(ctx);
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) firstIssue(parsed.error);
  const { question, sourceIds } = parsed.data;

  // 1) quota / paywall gate (backend-enforced, Persian RATE_LIMITED/FORBIDDEN)
  const quota = await requireFeature(ctx, FEATURES.KNOWLEDGE_QA);

  // 2) PERMISSION BEFORE RETRIEVAL — only this tenant's READY sources are ever read
  const sourceWhere: {
    tenantId: string;
    status: string;
    OR?: Array<{ classroomId: null } | { classroomId: { in: string[] } }>;
  } = { tenantId, status: "READY" };
  if (scope) {
    sourceWhere.OR = [
      { classroomId: null }, // shared with the whole tenant
      { classroomId: { in: scope.classroomIds } }, // student's active classrooms
    ];
  }
  const where: {
    source: { tenantId: string; status: string; OR?: Array<{ classroomId: null } | { classroomId: { in: string[] } }> };
    sourceId?: { in: string[] };
  } = { source: sourceWhere };
  if (sourceIds && sourceIds.length > 0) {
    const owned = await db.knowledgeSource.findMany({
      where: { id: { in: sourceIds }, ...sourceWhere },
      select: { id: true },
    });
    if (owned.length !== new Set(sourceIds).size)
      throw Errors.validation("یکی از منابع انتخاب‌شده برای شما قابل دسترسی نیست.");
    where.sourceId = { in: owned.map((o) => o.id) };
  }

  const chunks = await db.knowledgeChunk.findMany({
    where,
    include: { source: { select: { id: true, title: true } } },
    take: 2000,
  });

  const terms = queryTerms(question);

  // 3) retrieval — BM25-lite; 4) no hit → sentinel WITHOUT calling the model (spec §99)
  const scored: Array<{ chunk: (typeof chunks)[number]; score: number }> = [];
  if (chunks.length > 0 && terms.length > 0) {
    const docTokens = chunks.map((c) => tokenize(c.content));
    const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / docTokens.length;
    const df = new Map<string, number>();
    for (const tokens of docTokens) {
      for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    }
    for (let i = 0; i < chunks.length; i++) {
      const score = bm25Score(terms, docTokens[i], df, chunks.length, avgLen);
      if (score > 0) scored.push({ chunk: chunks[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
  }

  if (scored.length === 0) {
    return {
      answer: NO_MATCH_ANSWER,
      foundInSources: false,
      sources: [] as CitationRef[],
      usedChunks: 0,
      usedSourceCount: 0,
      quota,
      usage: null,
    };
  }

  // 5) context builder — numbered blocks, capped at ~6000 chars
  const picked: typeof scored = [];
  let contextLen = 0;
  for (const s of scored) {
    if (picked.length >= TOP_K) break;
    if (contextLen + s.chunk.content.length > MAX_CONTEXT_CHARS && picked.length > 0) break;
    picked.push(s);
    contextLen += s.chunk.content.length;
  }

  const rawTerms = terms.filter((t) => t.length >= 3);
  const blocks = picked.map(
    (s, i) =>
      `[${toFaDigits(i + 1)}] (${s.chunk.source.title} — قطعهٔ ${toFaDigits(s.chunk.position + 1)})\n${s.chunk.content}`
  );

  // 6) central AI gateway — feature KNOWLEDGE_QA
  const ai = await aiComplete({
    feature: FEATURES.KNOWLEDGE_QA,
    systemPrompt: RAG_PROMPTS.sourceGuardian.build(),
    userMessage: `پرسش: ${question}\n\n=== منابع ===\n${blocks.join("\n\n")}`,
    tenantId,
    userId: ctx.userId,
    maxOutputChars: 2500,
  });

  // 7) citation parsing → source map (dedupe by source, cap 4)
  const citations = parseCitations(ai.content);
  const distinctSources = new Set(picked.map((p) => p.chunk.source.id));
  const refused = ai.content.includes("در منابع موجود نیست");
  const sources: CitationRef[] = [];
  const seen = new Set<string>();

  for (const num of citations) {
    const hit = picked[num - 1];
    if (!hit || seen.has(hit.chunk.source.id)) continue;
    seen.add(hit.chunk.source.id);
    sources.push({
      sourceId: hit.chunk.source.id,
      title: hit.chunk.source.title,
      chunkPosition: hit.chunk.position,
      snippet: makeSnippet(hit.chunk.content, rawTerms),
    });
    if (sources.length >= 4) break;
  }
  // model answered but forgot bracket citations → attribute the best-matching source
  if (sources.length === 0 && !refused && picked.length > 0) {
    const best = picked[0];
    sources.push({
      sourceId: best.chunk.source.id,
      title: best.chunk.source.title,
      chunkPosition: best.chunk.position,
      snippet: makeSnippet(best.chunk.content, rawTerms),
    });
  }

  await audit({
    actorId: ctx.userId,
    tenantId,
    action: "knowledge_qa",
    metadata: {
      sourceCount: distinctSources.size,
      questionLen: question.length,
      usedChunks: picked.length,
    },
  });

  return {
    answer: ai.content,
    foundInSources: true,
    sources,
    usedChunks: picked.length,
    usedSourceCount: distinctSources.size,
    quota,
    usage: ai.usage,
  };
}

export type { Entitlement };

// ── Student-facing knowledge access (spec §12 — RAG روی منابع مجاز) ──

// The student's active classroom IDs (memberships that are not revoked).
async function activeClassroomIds(ctx: AuthContext): Promise<string[]> {
  if (!ctx.tenantId) return []; // askSourceGuardian raises the proper Persian error via mustTenant
  const memberships = await db.classMembership.findMany({
    where: { userId: ctx.userId, revokedAt: null, classroom: { tenantId: ctx.tenantId } },
    select: { classroomId: true },
  });
  return memberships.map((m) => m.classroomId);
}

// Sources a student may see & ask against: tenant-wide + own-classroom scoped.
export async function listStudentSources(ctx: AuthContext) {
  const tenantId = await mustTenant(ctx);
  const classroomIds = await activeClassroomIds(ctx);

  const sources = await db.knowledgeSource.findMany({
    where: {
      tenantId,
      status: "READY",
      OR: [{ classroomId: null }, { classroomId: { in: classroomIds } }],
    },
    include: {
      classroom: { select: { name: true } },
      creator: { select: { fullName: true } },
      _count: { select: { chunks: true } },
    },
    orderBy: [{ classroomId: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return {
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      subject: s.subject,
      charCount: s.charCount,
      chunkCount: s._count.chunks,
      classroom: s.classroom ? { name: s.classroom.name } : null,
      creator: s.creator.fullName,
      createdAt: s.createdAt,
    })),
    classrooms: classroomIds.length,
  };
}

// Student Q&A — same Source Guardian pipeline, classroom-scoped retrieval.
export async function askStudentSourceGuardian(
  ctx: AuthContext,
  input: { question?: unknown; sourceIds?: unknown }
) {
  const classroomIds = await activeClassroomIds(ctx);
  return askSourceGuardian(ctx, input, { classroomIds });
}
