import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { FEATURES } from "@/server/core/constants";
import { aiComplete } from "@/server/ai/gateway";
import { PROMPTS } from "@/server/ai/prompts";
import { requireFeature } from "./plan";
import type { AuthContext } from "@/server/auth/session";
import { fromJson, toJson } from "@/server/core/json";
import { audit } from "./audit";

// ── Student Tutor (spec §11.1) ──

export async function listThreads(ctx: AuthContext) {
  const tenantId = await mustTenant(ctx);
  return db.tutorThread.findMany({
    where: { tenantId, studentId: ctx.userId },
    include: { _count: { select: { messages: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getThreadMessages(ctx: AuthContext, threadId: string) {
  const tenantId = await mustTenant(ctx);
  const thread = await db.tutorThread.findFirst({ where: { id: threadId, tenantId, studentId: ctx.userId } });
  if (!thread) throw Errors.notFound("گفتگو");
  const messages = await db.tutorMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return { thread: { id: thread.id, title: thread.title }, messages };
}

export async function tutorChat(
  ctx: AuthContext,
  input: { threadId?: string; message: string; title?: string }
) {
  const tenantId = await mustTenant(ctx);
  if (!input.message?.trim() || input.message.length > 4000)
    throw Errors.validation("پیام نامعتبر است (حداکثر ۴۰۰۰ کاراکتر).");

  await requireFeature(ctx, FEATURES.AI_TUTOR);

  let thread = input.threadId
    ? await db.tutorThread.findFirst({ where: { id: input.threadId, tenantId, studentId: ctx.userId } })
    : null;
  if (input.threadId && !thread) throw Errors.notFound("گفتگو");

  if (!thread) {
    thread = await db.tutorThread.create({
      data: {
        tenantId,
        studentId: ctx.userId,
        title: (input.title ?? input.message).slice(0, 60),
      },
    });
  }

  const history = await db.tutorMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  history.reverse();

  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  const system = PROMPTS.studentTutor.build(user?.grade ?? null);

  const [userMsg] = await Promise.all([
    db.tutorMessage.create({ data: { threadId: thread.id, role: "user", content: input.message } }),
  ]);

  const ai = await aiComplete({
    feature: FEATURES.AI_TUTOR,
    systemPrompt: system,
    userMessage: input.message,
    history: history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    tenantId,
    userId: ctx.userId,
  });

  const assistantMsg = await db.tutorMessage.create({
    data: { threadId: thread.id, role: "assistant", content: ai.content },
  });

  return {
    threadId: thread.id,
    threadTitle: thread.title,
    userMessage: { id: userMsg.id, role: "user", content: userMsg.content, createdAt: userMsg.createdAt },
    assistantMessage: {
      id: assistantMsg.id,
      role: "assistant",
      content: assistantMsg.content,
      createdAt: assistantMsg.createdAt,
    },
    usage: ai.usage,
  };
}

// ── Summarizer (spec §11.2) ──

export async function summarize(ctx: AuthContext, input: { text: string; mode: string }) {
  const tenantId = await mustTenant(ctx);
  if (!input.text?.trim() || input.text.length < 40)
    throw Errors.validation("متن برای خلاصه‌سازی باید حداقل ۴۰ کاراکتر باشد.");
  if (input.text.length > 20000) input.text = input.text.slice(0, 20000);
  const mode = ["SHORT", "FULL", "KEYPOINTS", "EXAM"].includes(input.mode) ? input.mode : "SHORT";

  await requireFeature(ctx, FEATURES.SUMMARIZER);

  const ai = await aiComplete({
    feature: FEATURES.SUMMARIZER,
    systemPrompt: PROMPTS.summarizer.build(mode),
    userMessage: `متن زیر را خلاصه کن:\n\n${input.text}`,
    tenantId,
    userId: ctx.userId,
  });
  return { summary: ai.content, mode, usage: ai.usage };
}

// ── Question Generator (spec §11.3) — used by teachers ──

export async function generateQuestions(
  ctx: AuthContext,
  input: { content: string; type: string; difficulty: string; count: number }
) {
  const tenantId = await mustTenant(ctx);
  if (!input.content?.trim() || input.content.length < 30)
    throw Errors.validation("محتوای مرجع باید حداقل ۳۰ کاراکتر باشد.");
  if (input.content.length > 15000) input.content = input.content.slice(0, 15000);
  const type = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "FILL_IN_BLANK"].includes(input.type)
    ? input.type
    : "MULTIPLE_CHOICE";
  const difficulty = ["EASY", "MEDIUM", "HARD"].includes(input.difficulty) ? input.difficulty : "MEDIUM";
  const count = Math.min(Math.max(input.count ?? 5, 1), 10);

  await requireFeature(ctx, FEATURES.QUESTION_GENERATOR);

  const ai = await aiComplete({
    feature: FEATURES.QUESTION_GENERATOR,
    systemPrompt: PROMPTS.questionGenerator.build(type, difficulty),
    userMessage: `بر اساس محتوای زیر دقیقاً ${count} سؤال بساز:\n\n${input.content}`,
    tenantId,
    userId: ctx.userId,
    maxOutputChars: 6000,
  });

  // Structured output parsing (spec §98) — tolerant extraction of JSON block
  const parsed = extractJson<{ questions: Array<Record<string, unknown>> }>(ai.content);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  await audit({
    actorId: ctx.userId,
    tenantId,
    action: "question_generated",
    metadata: { count: questions.length, type, difficulty },
  });

  return {
    raw: ai.content,
    questions: questions.slice(0, count),
    parsedOk: questions.length > 0,
    usage: ai.usage,
  };
}

// ── Flashcard Maker (spec §11.8) ──

export async function generateFlashcards(
  ctx: AuthContext,
  input: { text: string; title?: string; save: boolean }
) {
  const tenantId = await mustTenant(ctx);
  if (!input.text?.trim() || input.text.length < 40)
    throw Errors.validation("متن باید حداقل ۴۰ کاراکتر باشد.");
  if (input.text.length > 15000) input.text = input.text.slice(0, 15000);

  await requireFeature(ctx, FEATURES.FLASHCARDS);

  const ai = await aiComplete({
    feature: FEATURES.FLASHCARDS,
    systemPrompt: PROMPTS.flashcardMaker.build(),
    userMessage: `از متن زیر فلش‌کارت بساز:\n\n${input.text}`,
    tenantId,
    userId: ctx.userId,
    maxOutputChars: 6000,
  });

  const parsed = extractJson<{ cards: Array<{ front: string; back: string }> }>(ai.content);
  const cards = (Array.isArray(parsed?.cards) ? parsed.cards : [])
    .filter((c) => c?.front && c?.back)
    .slice(0, 20);

  let deckId: string | null = null;
  if (input.save && cards.length > 0) {
    const deck = await db.flashcardDeck.create({
      data: {
        tenantId,
        ownerId: ctx.userId,
        title: input.title?.slice(0, 80) || "فلش‌کارت جدید",
        sourceText: input.text.slice(0, 500),
        cards: {
          create: cards.map((c, i) => ({ front: String(c.front), back: String(c.back), position: i })),
        },
      },
      include: { cards: true },
    });
    deckId = deck.id;
  }
  return { cards, deckId, parsedOk: cards.length > 0, usage: ai.usage };
}

export async function listDecks(ctx: AuthContext) {
  const tenantId = await mustTenant(ctx);
  return db.flashcardDeck.findMany({
    where: { tenantId, ownerId: ctx.userId },
    include: { cards: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function deleteDeck(ctx: AuthContext, deckId: string) {
  const tenantId = await mustTenant(ctx);
  const deck = await db.flashcardDeck.findFirst({ where: { id: deckId, tenantId, ownerId: ctx.userId } });
  if (!deck) throw Errors.notFound("دسته فلش‌کارت");
  await db.flashcardDeck.delete({ where: { id: deckId } });
  return { deleted: true };
}

// ── Study Planner (spec §11.9) ──

export async function createStudyPlan(
  ctx: AuthContext,
  input: { goal: string; examDate?: string | null; availableHoursDay: number; subjects: string }
) {
  const tenantId = await mustTenant(ctx);
  if (!input.goal?.trim() || input.goal.length < 5) throw Errors.validation("هدف مطالعه را وارد کنید.");
  const hours = Math.min(Math.max(input.availableHoursDay ?? 2, 1), 12);

  await requireFeature(ctx, FEATURES.STUDY_PLANNER);

  const existing = await db.studyPlan.findFirst({ where: { tenantId, studentId: ctx.userId } });
  const progress = existing ? fromJson<any>(existing.planJson, null) : null;

  const ai = await aiComplete({
    feature: FEATURES.STUDY_PLANNER,
    systemPrompt: PROMPTS.studyPlanner.build(),
    userMessage: `هدف: ${input.goal}
${input.examDate ? `تاریخ آزمون: ${input.examDate}` : "بدون تاریخ آزمون مشخص"}
منابع/درس‌ها: ${input.subjects || "عمومی"}
ساعت آزاد روزانه: ${hours}
${progress ? `برنامه قبلی موجود است؛ بر اساس آن بهبود بده.` : ""}
امروز: ${new Date().toISOString().slice(0, 10)}
برای ۱۴ روز آینده برنامه بساز.`,
    tenantId,
    userId: ctx.userId,
    maxOutputChars: 6000,
  });

  const parsed = extractJson<any>(ai.content);

  const plan = await db.studyPlan.upsert({
    where: { id: existing?.id ?? "_" },
    create: {
      tenantId,
      studentId: ctx.userId,
      goal: input.goal.slice(0, 200),
      examDate: input.examDate ? new Date(input.examDate) : null,
      availableHoursDay: hours,
      planJson: toJson(parsed ?? { raw: ai.content }),
    },
    update: {
      goal: input.goal.slice(0, 200),
      examDate: input.examDate ? new Date(input.examDate) : null,
      availableHoursDay: hours,
      planJson: toJson(parsed ?? { raw: ai.content }),
    },
  });

  return { planId: plan.id, plan: parsed ?? { raw: ai.content }, usage: ai.usage };
}

export async function getStudyPlan(ctx: AuthContext) {
  const tenantId = await mustTenant(ctx);
  const plan = await db.studyPlan.findFirst({
    where: { tenantId, studentId: ctx.userId },
    orderBy: { createdAt: "desc" },
  });
  if (!plan) return null;
  return {
    id: plan.id,
    goal: plan.goal,
    examDate: plan.examDate,
    availableHoursDay: plan.availableHoursDay,
    plan: fromJson<any>(plan.planJson, null),
    createdAt: plan.createdAt,
  };
}

// ── Teacher Assistant (spec §11.10) ──

export async function teacherAssist(ctx: AuthContext, input: { message: string; task?: string }) {
  const tenantId = await mustTenant(ctx);
  if (!input.message?.trim() || input.message.length > 6000)
    throw Errors.validation("درخواست نامعتبر است.");

  await requireFeature(ctx, FEATURES.TEACHER_ASSISTANT);

  const ai = await aiComplete({
    feature: FEATURES.TEACHER_ASSISTANT,
    systemPrompt: PROMPTS.teacherAssistant.build(),
    userMessage: `${input.task ? `نوع درخواست: ${input.task}\n\n` : ""}${input.message}`,
    tenantId,
    userId: ctx.userId,
    maxOutputChars: 8000,
  });
  return { content: ai.content, usage: ai.usage };
}

// ── helpers ──

async function mustTenant(ctx: AuthContext): Promise<string> {
  if (!ctx.tenantId) throw Errors.forbidden("این قابلیت به سازمان متصل نیست.");
  return ctx.tenantId;
}

function extractJson<T>(raw: string): T | null {
  // Tolerant: find first { ... } JSON block in the response
  const start = raw.indexOf("{");
  if (start === -1) return null;
  for (let end = raw.length; end > start; end--) {
    const candidate = raw.slice(start, end);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      if (candidate.endsWith("}")) continue;
    }
  }
  return null;
}
