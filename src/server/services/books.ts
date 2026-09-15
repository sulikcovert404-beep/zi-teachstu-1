import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { FEATURES, ROLES } from "@/server/core/constants";
import { fromJson, toJson } from "@/server/core/json";
import { aiComplete, aiSpeak } from "@/server/ai/gateway";
import { PROMPTS } from "@/server/ai/prompts";
import { getSettings } from "./settings";
import { requireFeature } from "./plan";
import { awardPoints, POINT_REASONS } from "./points";
import { audit } from "./audit";
import { attachOriginalPdf } from "./pdf-extract";
import { renderDocPdf, renderQuizPdf } from "./pdf-export";
import {
  getTelegramAsset,
  listTelegramAssets,
  invalidateTelegramAsset,
  purgeTelegramAssets,
  proxyTelegramAsset,
  telegramDeepLink,
  tooBigError,
  tgStorageRuntime,
  uploadTelegramAsset,
  type TelegramAssetKind,
} from "./telegram-storage";
import { isLevelCode, levelLabel, isValidGradeForLevel } from "@/lib/education-levels";
import type { AuthContext } from "@/server/auth/session";

// Round 16 + Round 18 — Smart Library (کتاب‌خانه هوشمند).
// Round 28 — معماری درس‌محور (خواستهٔ مدیر): آپلود کتاب «فقط» تشخیص ساختار را اجرا
// می‌کند (چند درس/فصل/پودمان/مهارت دارد)؛ خلاصه/جزوه/سؤال/شکل/پادکست دیگر برای
// «کل کتاب» ساخته نمی‌شود بلکه «برای هر درس» و به‌صورت تنبل: اولین کاربری که درسی
// را انتخاب کند تولید را شروع می‌کند (claim اتمیک)، بقیه نتیجهٔ ذخیره‌شده را فوراً
// می‌گیرند. پرامپت‌های همهٔ کارها سن‌سنجیده‌اند (بلوک سن بر اساس دورهٔ تحصیلی کتاب).
// کتاب‌های قدیمی که از قبل محتوای کل‌کتاب دارند روی مسیر قبلی می‌مانند (سازگاری کامل).

const STORAGE_DIR = path.join(process.cwd(), "storage", "books");
const BOOK_TEXT_MIN = 800;
const BOOK_TEXT_MAX = 60_000;

export interface BookQuizItem {
  id: string;
  kind: "mc" | "tf" | "fb" | "short";
  prompt: string;
  options?: string[];
  correctIndex?: number;
  correct?: boolean;
  answer?: string; // fill-in-blank reference (short word/phrase)
  referenceAnswer?: string;
  explanation?: string;
  difficulty?: string;
  topic?: string;
}

export interface BookQuiz {
  mc: BookQuizItem[];
  tf: BookQuizItem[];
  fb: BookQuizItem[];
  short: BookQuizItem[];
}

export interface BookFigure {
  id: string;
  title: string;
  svg: string; // sanitized inline SVG (educational diagram)
  caption: string;
}

export type ArtifactKind = "summary" | "notes" | "quiz" | "figures" | "podcast";

export const ARTIFACT_KINDS: ArtifactKind[] = ["summary", "notes", "quiz", "figures", "podcast"];

// ── Permissions (manager requirement: default OFF, admin enables per tenant) ──

export async function booksUploadPermission(ctx: AuthContext) {
  const settings = await getSettings();
  const role = ctx.effectiveRole;
  if (role === ROLES.SUPER_ADMIN) return { can: true, label: "مدیر کل — همیشه مجاز" };
  if (!ctx.tenantId) return { can: false, label: "بدون سازمان فعال" };
  if (role === ROLES.SCHOOL_ADMIN && settings.booksUploadTenants.includes(ctx.tenantId)) {
    return { can: true, label: "به‌عنوان مدیر مدرسه فعال شده است" };
  }
  if (role === ROLES.TEACHER && settings.teacherBookUploadTenants.includes(ctx.tenantId)) {
    return { can: true, label: "به‌عنوان معلم فعال شده است" };
  }
  return { can: false, label: "برای نقش شما فعال نیست" };
}

// ── Upload ──

export interface CreateBookInput {
  title: string;
  text: string;
  subject?: string;
  level?: string; // course level code (PRE_PRIMARY | PRIMARY | MIDDLE_1 | MIDDLE_2 | TECHNICAL)
  gradeLevel?: string;
  author?: string;
  description?: string;
  coverEmoji?: string;
  classroomId?: string | null;
  // Round 20 — keep the original PDF (file upload or fetched from a download link)
  // so students can download the real book. Both come from the extract endpoints.
  pdfStorageKey?: string | null;
  pdfFileName?: string | null;
}

const EMOJI_RE = /^[\p{Extended_Pictographic}\u2190-\u21FF\u2600-\u27BF]$/u;

export async function createBook(ctx: AuthContext, input: CreateBookInput) {
  const perm = await booksUploadPermission(ctx);
  if (!perm.can) {
    throw Errors.forbidden(
      "قابلیت افزودن کتاب برای شما فعال نیست. مدیر کل پلتفرم باید آن را در «تنظیمات و اتصال‌ها» فعال کند."
    );
  }

  const title = (input.title ?? "").trim();
  const text = (input.text ?? "").replace(/\r\n/g, "\n").trim();
  if (title.length < 2 || title.length > 120) throw Errors.validation("عنوان کتاب باید بین ۲ تا ۱۲۰ نویسه باشد.");
  if (text.length < BOOK_TEXT_MIN) throw Errors.validation(`متن کتاب باید حداقل ${BOOK_TEXT_MIN} نویسه باشد.`);
  if (text.length > BOOK_TEXT_MAX) throw Errors.validation(`متن کتاب حداکثر ${BOOK_TEXT_MAX.toLocaleString("fa-IR")} نویسه است.`);
  if (input.level !== undefined && input.level !== null && !isLevelCode(input.level)) {
    throw Errors.validation("دورهٔ تحصیلی انتخابی معتبر نیست.");
  }
  if (!isValidGradeForLevel(input.level ?? null, input.gradeLevel ?? null)) {
    throw Errors.validation("پایهٔ انتخابی با دورهٔ تحصیلی هم‌خوانی ندارد.");
  }

  // teacher uploads may scope the book to one of their classrooms
  let classroomId: string | null = null;
  if (input.classroomId && ctx.effectiveRole === ROLES.TEACHER) {
    const classroom = await db.classroom.findFirst({
      where: { id: input.classroomId, tenantId: ctx.tenantId ?? undefined, teacherId: ctx.userId },
    });
    if (!classroom) throw Errors.validation("کلاس انتخابی معتبر نیست.");
    classroomId = classroom.id;
  }

  // Round 28 — رزرو سهمیهٔ آپلود سبک‌تر شد: فقط «یک» فراخوانی تشخیص ساختار (SUMMARIZER)
  // در لحظهٔ آپلود مصرف می‌شود؛ تولید محتوای هر درس جدا و در لحظهٔ اولین انتخاب است.
  if (ctx.effectiveRole === ROLES.TEACHER && ctx.tenantId) {
    await requireFeature(ctx, FEATURES.SUMMARIZER);
  }

  const isPlatform = ctx.effectiveRole === ROLES.SUPER_ADMIN;
  const book = await db.book.create({
    data: {
      tenantId: isPlatform ? null : ctx.tenantId,
      classroomId,
      addedById: ctx.userId,
      title,
      author: input.author?.trim().slice(0, 80) || null,
      subject: input.subject?.trim().slice(0, 60) || null,
      level: input.level?.trim().slice(0, 20) || null,
      gradeLevel: input.gradeLevel?.trim().slice(0, 30) || null,
      description: input.description?.trim().slice(0, 300) || null,
      coverEmoji: input.coverEmoji && EMOJI_RE.test(input.coverEmoji) ? input.coverEmoji : "📘",
      contentText: text,
      charCount: text.length,
      status: "GENERATING",
      // Manager round-18 rule: platform books skip approval; school/teacher uploads
      // stay hidden from students until a SUPER_ADMIN approves them.
      approvalStatus: isPlatform ? "NOT_REQUIRED" : "PENDING",
    },
  });

  // Round 20 — جابه‌جایی PDF اصلی (اگر از فایل یا لینک آمده) کنار ردیف کتاب
  let created = book;
  if (input.pdfStorageKey) {
    const attached = await attachOriginalPdf(book.id, input.pdfStorageKey, input.pdfFileName);
    if (attached) {
      created = await db.book.update({
        where: { id: book.id },
        data: { originalPdfPath: attached.path, originalPdfName: attached.name },
      });
      // Round 23 — «هیچ چیزی در هاست ذخیره نشه»: PDF اصلی به چت ذخیره‌سازی تلگرام
      // منتقل و نسخهٔ محلی حذف می‌شود (fileId دائمی در TelegramAsset ثبت می‌شود).
      void pushOriginalPdfToTelegram(book.id).catch(() => undefined);
    }
  }

  await audit({
    actorId: ctx.userId,
    tenantId: book.tenantId,
    action: "admin_action",
    targetType: "book",
    targetId: book.id,
    metadata: {
      title,
      charCount: text.length,
      scope: book.tenantId ? "tenant" : "platform",
      approval: book.approvalStatus,
      withOriginalPdf: Boolean(input.pdfStorageKey),
    },
  });

  // fire-and-forget: Round 28 — آپلود فقط «تشخیص درس‌ها» را اجرا می‌کند (سریع و ارزان)؛
  // تولید محتوا به اولین انتخابِ هر درس موکول شده است (تولید تنبل درس‌محور).
  void detectBookLessons(book.id).catch(async (e) => {
    await db.book
      .update({
        where: { id: book.id },
        data: { status: "FAILED", lessonsStatus: "FAILED", errorReason: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
      })
      .catch(() => undefined);
  });

  return bookSummary({ ...created, lessonsCount: 0 });
}

export async function reviewBookApproval(
  ctx: AuthContext,
  bookId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string
) {
  if (ctx.effectiveRole !== ROLES.SUPER_ADMIN) {
    throw Errors.forbidden("بررسی و تأیید کتاب‌های مدارس فقط توسط مدیر کل پلتفرم انجام می‌شود.");
  }
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw Errors.notFound("کتاب");
  if (!book.tenantId) throw Errors.validation("کتاب عمومی پلتفرم نیازی به تأیید ندارد.");
  if (book.approvalStatus === decision) return { bookId, approvalStatus: book.approvalStatus, changed: false };

  await db.book.update({
    where: { id: bookId },
    data: {
      approvalStatus: decision,
      approvalNote: decision === "REJECTED" && note ? note.trim().slice(0, 300) : null,
    },
  });
  await audit({
    actorId: ctx.userId,
    tenantId: book.tenantId,
    action: "admin_action",
    targetType: "book",
    targetId: bookId,
    metadata: { approval: decision, title: book.title },
  });
  return { bookId, approvalStatus: decision, changed: true };
}

// ── Generation pipeline ──

async function generateBookArtifacts(bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) return;
  for (const kind of ARTIFACT_KINDS) {
    await generateArtifact(book, kind);
  }
  await refreshBookStatus(bookId);
}

// ───────────────────────── Round 28 — تشخیص درس‌ها (تنها کار آپلود) ─────────────────────────

interface DetectedUnit {
  index: number;
  title: string;
  topics?: string[];
}

/** JSON مقاوم: فهرست واحدها را از پاسخ AI بیرون می‌کشد حتی اگر wrapper/متن اضافه داشته باشد */
function parseDetectedUnits(raw: string): { unitKind: string; units: DetectedUnit[] } | null {
  const s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const tryParse = (txt: string): { unitKind: string; units: DetectedUnit[] } | null => {
    let j: unknown;
    try {
      j = JSON.parse(txt);
    } catch {
      return null;
    }
    if (!j || typeof j !== "object") return null;
    const obj = j as Record<string, unknown>;
    if (!Array.isArray(obj.units)) return null;
    const units: DetectedUnit[] = [];
    obj.units.slice(0, 40).forEach((u, i) => {
      if (!u || typeof u !== "object") return;
      const o = u as Record<string, unknown>;
      if (typeof o.title !== "string" || !o.title.trim() || o.title.trim().length > 120) return;
      units.push({
        index: typeof o.index === "number" ? o.index : i + 1,
        title: o.title,
        topics: Array.isArray(o.topics)
          ? o.topics.filter((t): t is string => typeof t === "string").slice(0, 4)
          : undefined,
      });
    });
    if (units.length === 0) return null;
    return {
      unitKind: typeof obj.unitKind === "string" && obj.unitKind.trim() ? obj.unitKind.trim() : "درس",
      units,
    };
  };
  const direct = tryParse(s);
  if (direct) return direct;
  // fallback: اولین { … } متوازن را بیرون بکش
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const inner = tryParse(s.slice(start, end + 1));
    if (inner) return inner;
  }
  return null;
}

/**
 * تشخیص ساختار کتاب: تنها فراخوانی AI هنگام آپلود (خواستهٔ مدیر).
 * خروجی: ردیف‌های BookLesson با وضعیت PENDING — تولید محتوای هر درس تنبل است.
 * fallback: اگر AI شکست خورد، یک واحد «کل کتاب» ساخته می‌شود تا پلتفرم قابل استفاده بماند.
 */
export async function detectBookLessons(bookId: string): Promise<void> {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) return;
  await db.book.update({ where: { id: bookId }, data: { lessonsStatus: "GENERATING", status: "GENERATING", errorReason: null } });

  let unitKind = "درس";
  let units: DetectedUnit[] = [];
  try {
    const ai = await aiComplete({
      feature: FEATURES.SUMMARIZER,
      systemPrompt: PROMPTS.bookLessons.build(book.title),
      userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 50_000)}`,
      tenantId: book.tenantId,
      userId: book.addedById,
      maxOutputChars: 8_000,
      temperature: 0.2,
    });
    const parsed = parseDetectedUnits(ai.content);
    if (parsed && parsed.units.length > 0) {
      unitKind = parsed.unitKind.slice(0, 20);
      units = parsed.units;
    }
  } catch (e) {
    console.error(`[books] lesson detection failed for ${bookId}: ${e instanceof Error ? e.message : e}`);
  }

  if (units.length === 0) {
    // fallback: کل کتاب به‌عنوان یک واحد — پلتفرم همیشه قابل استفاده می‌ماند
    unitKind = "کل کتاب";
    units = [{ index: 1, title: "کل کتاب" }];
  }

  // درس‌های قبلی (در صورت retry) را پاک کن و از نو بساز
  await db.bookLesson.deleteMany({ where: { bookId } });
  await db.bookLesson.createMany({
    data: units.map((u, i) => ({
      bookId,
      order: i + 1,
      title: u.title.trim().slice(0, 120),
      kind: unitKind,
      status: "PENDING",
    })),
  });

  await db.book.update({
    where: { id: bookId },
    data: { lessonsStatus: "READY", lessonsKind: unitKind, status: "READY" },
  });
}

// ───────────────────────── Round 28 — تولید تنبل درس‌محور ─────────────────────────

/** شکل مشترک کتاب/درس برای پرامپت‌های سن‌سنج */
function promptCtxFor(
  book: { title: string; subject: string | null; gradeLevel: string | null; level: string | null },
  lesson?: { order: number; title: string; kind: string } | null
) {
  return {
    title: book.title,
    subject: book.subject,
    grade: book.gradeLevel,
    level: book.level,
    lesson: lesson ?? null,
  };
}

async function generateLessonArtifact(
  book: { id: string; title: string; subject: string | null; gradeLevel: string | null; level: string | null; author: string | null; contentText: string; tenantId: string | null; addedById: string },
  lesson: { id: string; order: number; title: string; kind: string },
  kind: ArtifactKind
) {
  const ctx = promptCtxFor(book, lesson);
  const lessonId = lesson.id;
  try {
    if (kind === "summary") {
      const ai = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookSummary.build(ctx),
        userMessage: `متن کامل کتاب «${book.title}» (برای پردازش ${lesson.kind} ${lesson.order} — «${lesson.title}»):\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 12_000,
      });
      await db.bookLesson.update({ where: { id: lessonId }, data: { summary: ai.content, summaryStatus: "READY" } });
    } else if (kind === "notes") {
      const ai = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookStudyNotes.build(ctx),
        userMessage: `متن کامل کتاب «${book.title}» (برای پردازش ${lesson.kind} ${lesson.order} — «${lesson.title}»):\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 10_000,
      });
      await db.bookLesson.update({ where: { id: lessonId }, data: { studyNotes: ai.content, studyNotesStatus: "READY" } });
    } else if (kind === "quiz") {
      const ai = await aiComplete({
        feature: FEATURES.QUESTION_GENERATOR,
        systemPrompt: PROMPTS.bookQuiz.build(ctx),
        userMessage: `متن کامل کتاب «${book.title}» (برای پردازش ${lesson.kind} ${lesson.order} — «${lesson.title}»):\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 18_000,
      });
      const quiz = parseBookQuiz(ai.content);
      if (!quiz) throw new Error("QUIZ_PARSE_FAILED");
      await db.bookLesson.update({
        where: { id: lessonId },
        data: {
          quiz: toJson(quiz),
          quizStatus: "READY",
          quizCount: quiz.mc.length + quiz.tf.length + quiz.fb.length + quiz.short.length,
        },
      });
    } else if (kind === "figures") {
      const ai = await aiComplete({
        feature: FEATURES.QUESTION_GENERATOR,
        systemPrompt: PROMPTS.bookFigures.build(ctx),
        userMessage: `متن کامل کتاب «${book.title}» (برای پردازش ${lesson.kind} ${lesson.order} — «${lesson.title}»):\n\n${book.contentText.slice(0, 30_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 12_000,
      });
      const figures = parseBookFigures(ai.content);
      await db.bookLesson.update({
        where: { id: lessonId },
        data: { figures: toJson(figures), figuresStatus: "READY", figuresCount: figures.length },
      });
    } else {
      // پادکست درس — متن سن‌سنج + گویندهٔ Gemini TTS (صدا/لحن ادمین بر اساس دورهٔ تحصیلی)
      const scriptAi = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookPodcastScript.build(ctx),
        userMessage: `متن کامل کتاب «${book.title}» (برای پردازش ${lesson.kind} ${lesson.order} — «${lesson.title}»):\n\n${book.contentText.slice(0, 30_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 3_200,
      });
      const script = scriptAi.content.slice(0, 3000);
      const spoken = await aiSpeak({
        feature: FEATURES.PODCAST,
        text: script,
        tenantId: book.tenantId,
        userId: book.addedById,
        levelHint: book.level,
      });
      await fs.mkdir(STORAGE_DIR, { recursive: true });
      const filePath = path.join(STORAGE_DIR, `lesson-${lessonId}.wav`);
      await fs.writeFile(filePath, spoken.audio);
      const stored = await uploadTelegramAsset({
        bookId: book.id,
        kind: `PODCAST_AUDIO_L:${lessonId}` as TelegramAssetKind,
        bytes: spoken.audio,
        fileName: `podcast-${safeFileName(book.title)}-${lesson.order}.wav`,
        asAudio: true,
        audioMeta: {
          title: `پادکست ${lesson.kind} ${lesson.order} — ${book.title}`.slice(0, 60),
          performer: "پلتفرم آموزش هوشمند ایران",
          durationSec: spoken.durationSec,
        },
        caption: `🎙 پادکست ${lesson.kind} ${lesson.order} «${lesson.title}» از کتاب «${book.title}»`,
      });
      if (stored) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        await db.bookLesson.update({
          where: { id: lessonId },
          data: { podcastPath: null, podcastTelegram: true, podcastStatus: "READY", podcastDurationSec: spoken.durationSec },
        });
      } else {
        await db.bookLesson.update({
          where: { id: lessonId },
          data: { podcastPath: filePath, podcastTelegram: false, podcastStatus: "READY", podcastDurationSec: spoken.durationSec },
        });
      }
    }
  } catch (e) {
    await markLessonArtifactFailed(lessonId, lessonArtifactStatusField(kind), e);
  }
}

function lessonArtifactStatusField(kind: ArtifactKind): "summaryStatus" | "studyNotesStatus" | "quizStatus" | "figuresStatus" | "podcastStatus" {
  switch (kind) {
    case "summary":
      return "summaryStatus";
    case "notes":
      return "studyNotesStatus";
    case "quiz":
      return "quizStatus";
    case "figures":
      return "figuresStatus";
    default:
      return "podcastStatus";
  }
}

async function markLessonArtifactFailed(
  lessonId: string,
  field: "summaryStatus" | "studyNotesStatus" | "quizStatus" | "figuresStatus" | "podcastStatus",
  e: unknown
) {
  console.error(`[books] lesson artifact ${field} failed for ${lessonId}: ${e instanceof Error ? e.message : e}`);
  await db.bookLesson
    .update({ where: { id: lessonId }, data: { [field]: "FAILED" } as Record<string, string> })
    .catch(() => undefined);
}

async function refreshLessonStatus(lessonId: string) {
  const lesson = await db.bookLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return;
  const statuses = [lesson.summaryStatus, lesson.studyNotesStatus, lesson.quizStatus, lesson.figuresStatus, lesson.podcastStatus];
  const ready = statuses.filter((s) => s === "READY").length;
  const status = ready === statuses.length ? "READY" : ready > 0 ? "PARTIAL" : "FAILED";
  await db.bookLesson.update({ where: { id: lessonId }, data: { status } }).catch(() => undefined);
}

async function generateLessonArtifacts(bookId: string, lessonId: string) {
  const [book, lesson] = await Promise.all([
    db.book.findUnique({ where: { id: bookId } }),
    db.bookLesson.findUnique({ where: { id: lessonId } }),
  ]);
  if (!book || !lesson || lesson.bookId !== bookId) return;
  for (const kind of ARTIFACT_KINDS) {
    await generateLessonArtifact(book, lesson, kind);
  }
  await refreshLessonStatus(lessonId);
}

async function generateArtifact(book: { id: string; title: string; subject: string | null; gradeLevel: string | null; level: string | null; author: string | null; contentText: string; tenantId: string | null; addedById: string }, kind: ArtifactKind) {
  const bookId = book.id;
  // Round 28 — پرامپت‌های سن‌سنج (مسیر قدیمیِ کل‌کتاب برای کتاب‌های legacy)
  const ctx = promptCtxFor(book, null);
  try {
    if (kind === "summary") {
      const ai = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookSummary.build(ctx),
        userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 12_000,
      });
      await db.book.update({ where: { id: bookId }, data: { summary: ai.content, summaryStatus: "READY" } });
      // Round 23 — خلاصهٔ PDF (وزیرمتن) همان‌جا رندر و در تلگرام ذخیره می‌شود
      await renderAndUploadArtifactPdf(book, "SUMMARY_PDF", () =>
        buildSummaryPdfFor({ ...book, summary: ai.content })
      );
    } else if (kind === "notes") {
      const ai = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookStudyNotes.build(ctx),
        userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 10_000,
      });
      await db.book.update({ where: { id: bookId }, data: { studyNotes: ai.content, studyNotesStatus: "READY" } });
      await renderAndUploadArtifactPdf(book, "NOTES_PDF", () =>
        buildStudyNotesPdfFor({ ...book, studyNotes: ai.content })
      );
    } else if (kind === "quiz") {
      const ai = await aiComplete({
        feature: FEATURES.QUESTION_GENERATOR,
        systemPrompt: PROMPTS.bookQuiz.build(ctx),
        userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 50_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 18_000,
      });
      const quiz = parseBookQuiz(ai.content);
      if (!quiz) throw new Error("QUIZ_PARSE_FAILED");
      await db.book.update({
        where: { id: bookId },
        data: {
          quiz: toJson(quiz),
          quizStatus: "READY",
          quizCount: quiz.mc.length + quiz.tf.length + quiz.fb.length + quiz.short.length,
        },
      });
      // برگهٔ آزمون MC به‌عنوان مدل اصلی همین‌جا در تلگرام ذخیره می‌شود
      await renderAndUploadArtifactPdf(book, "QUIZ_PDF_MC", () =>
        buildQuizPdfFor(book, quiz, "MC")
      );
    } else if (kind === "figures") {
      const ai = await aiComplete({
        feature: FEATURES.QUESTION_GENERATOR,
        systemPrompt: PROMPTS.bookFigures.build(ctx),
        userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 30_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 12_000,
      });
      const figures = parseBookFigures(ai.content);
      await db.book.update({
        where: { id: bookId },
        data: { figures: toJson(figures), figuresStatus: "READY", figuresCount: figures.length },
      });
    } else {
      // podcast (script → TTS → WAV on disk)
      const scriptAi = await aiComplete({
        feature: FEATURES.SUMMARIZER,
        systemPrompt: PROMPTS.bookPodcastScript.build(ctx),
        userMessage: `متن کامل کتاب:\n\n${book.contentText.slice(0, 30_000)}`,
        tenantId: book.tenantId,
        userId: book.addedById,
        maxOutputChars: 3_200,
      });
      const script = scriptAi.content.slice(0, 3000);
      const spoken = await aiSpeak({
        feature: FEATURES.PODCAST,
        text: script,
        tenantId: book.tenantId,
        userId: book.addedById,
        levelHint: book.level,
      });
      await fs.mkdir(STORAGE_DIR, { recursive: true });
      const filePath = path.join(STORAGE_DIR, `${bookId}.wav`);
      await fs.writeFile(filePath, spoken.audio);
      // Round 23 — پادکست به چت ذخیره‌سازی تلگرام می‌رود؛ اگر موفق بود نسخهٔ محلی پاک می‌شود
      const stored = await uploadTelegramAsset({
        bookId,
        kind: "PODCAST_AUDIO",
        bytes: spoken.audio,
        fileName: `podcast-${safeFileName(book.title)}.wav`,
        asAudio: true,
        audioMeta: {
          title: `پادکست ${book.title}`.slice(0, 60),
          performer: "پلتفرم آموزش هوشمند ایران",
          durationSec: spoken.durationSec,
        },
        caption: `🎙 پادکست کتاب «${book.title}» — ذخیره‌سازی تلگرامی پلتفرم آموزش هوشمند`,
      });
      if (stored) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        await db.book.update({
          where: { id: bookId },
          data: { podcastPath: null, podcastTelegram: true, podcastStatus: "READY", podcastDurationSec: spoken.durationSec },
        });
      } else {
        await db.book.update({
          where: { id: bookId },
          data: { podcastPath: filePath, podcastTelegram: false, podcastStatus: "READY", podcastDurationSec: spoken.durationSec },
        });
      }
    }
  } catch (e) {
    await markArtifactFailed(bookId, artifactStatusField(kind), e);
  }
}

function artifactStatusField(kind: ArtifactKind): "summaryStatus" | "studyNotesStatus" | "quizStatus" | "figuresStatus" | "podcastStatus" {
  switch (kind) {
    case "summary":
      return "summaryStatus";
    case "notes":
      return "studyNotesStatus";
    case "quiz":
      return "quizStatus";
    case "figures":
      return "figuresStatus";
    default:
      return "podcastStatus";
  }
}

async function markArtifactFailed(
  bookId: string,
  field: "summaryStatus" | "studyNotesStatus" | "quizStatus" | "figuresStatus" | "podcastStatus",
  e: unknown
) {
  console.error(`[books] artifact ${field} failed for ${bookId}: ${e instanceof Error ? e.message : e}`);
  await db.book
    .update({ where: { id: bookId }, data: { [field]: "FAILED" } as Record<string, string> })
    .catch(() => undefined);
}

async function refreshBookStatus(bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) return;
  const statuses = [book.summaryStatus, book.studyNotesStatus, book.quizStatus, book.figuresStatus, book.podcastStatus];
  const ready = statuses.filter((s) => s === "READY").length;
  const status = ready === statuses.length ? "READY" : ready > 0 ? "PARTIAL" : "FAILED";
  await db.book.update({ where: { id: bookId }, data: { status } }).catch(() => undefined);
}

// ── Round 23 — «ذخیره‌سازی کامل در تلگرام»: helperهای انتقال باینری‌ها ──

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 60) || "book";
}

/** PDF اصلی کتاب را از دیسک به چت ذخیره‌سازی تلگرام می‌برد و نسخهٔ محلی را حذف می‌کند. */
async function pushOriginalPdfToTelegram(bookId: string): Promise<void> {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book?.originalPdfPath) return;
  const bytes = await fs.readFile(book.originalPdfPath).catch(() => null);
  if (!bytes) return;
  const stored = await uploadTelegramAsset({
    bookId,
    kind: "ORIGINAL_PDF",
    bytes,
    fileName: safeFileName(book.originalPdfName ?? `${book.title}.pdf`),
    caption: `📚 کتاب «${book.title}» — نسخهٔ اصلی PDF · ذخیره‌سازی تلگرامی پلتفرم آموزش هوشمند`,
  });
  if (stored) {
    await fs.rm(book.originalPdfPath, { force: true }).catch(() => undefined);
    await db.book
      .update({ where: { id: bookId }, data: { originalPdfPath: null, originalPdfTelegram: true } })
      .catch(() => undefined);
    console.log(`[tg-storage] original PDF of book ${bookId} moved to Telegram — local copy deleted`);
  }
}

/** پادکست WAV محلی را به تلگرام می‌برد و نسخهٔ محلی را حذف می‌کند. */
async function pushPodcastWavToTelegram(bookId: string): Promise<boolean> {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book?.podcastPath || book.podcastStatus !== "READY") return false;
  const bytes = await fs.readFile(book.podcastPath).catch(() => null);
  if (!bytes) return false;
  const stored = await uploadTelegramAsset({
    bookId,
    kind: "PODCAST_AUDIO",
    bytes,
    fileName: `podcast-${safeFileName(book.title)}.wav`,
    asAudio: true,
    audioMeta: {
      title: `پادکست ${book.title}`.slice(0, 60),
      performer: "پلتفرم آموزش هوشمند ایران",
      durationSec: book.podcastDurationSec ?? undefined,
    },
    caption: `🎙 پادکست کتاب «${book.title}» — ذخیره‌سازی تلگرامی پلتفرم آموزش هوشمند`,
  });
  if (stored) {
    await fs.rm(book.podcastPath, { force: true }).catch(() => undefined);
    await db.book
      .update({ where: { id: bookId }, data: { podcastPath: null, podcastTelegram: true } })
      .catch(() => undefined);
    return true;
  }
  return false;
}

/** رندر PDF فارسی از متن دیتابیس + آپلود به تلگرام — خطا هرگز وضعیت artifact را خراب نمی‌کند (فقط لاگ). */
async function renderAndUploadArtifactPdf(
  book: { id: string; title: string },
  kind: "SUMMARY_PDF" | "NOTES_PDF" | "QUIZ_PDF_MC",
  build: () => Promise<{ pdf: Uint8Array; filename: string }>
): Promise<void> {
  try {
    const built = await build();
    const label =
      kind === "SUMMARY_PDF" ? "خلاصهٔ هوشمند" : kind === "NOTES_PDF" ? "جزوهٔ درسی" : "نمونه‌سؤال (برگهٔ آزمون)";
    await uploadTelegramAsset({
      bookId: book.id,
      kind,
      bytes: built.pdf,
      fileName: built.filename,
      caption: `📦 ${label} کتاب «${book.title}» — PDF با فونت فارسی (وزیرمتن) · ذخیره‌سازی تلگرامی پلتفرم`,
    });
  } catch (e) {
    console.warn(
      `[tg-storage] eager ${kind} render/upload skipped for ${book.id}: ${e instanceof Error ? e.message : e}`
    );
  }
}

export async function regenerateBookArtifact(ctx: AuthContext, bookId: string, kind: ArtifactKind | "lessons") {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw Errors.notFound("کتاب");
  if (book.addedById !== ctx.userId && ctx.effectiveRole !== ROLES.SUPER_ADMIN) {
    throw Errors.forbidden("فقط ایجادکنندهٔ کتاب یا مدیر کل می‌تواند بازتولید کند.");
  }

  // Round 28 — بازاجرای «تشخیص درس‌ها» (مثلاً بعد از خطای موقت شبکه/پروکسی)
  if (kind === "lessons") {
    await db.book.update({
      where: { id: bookId },
      data: { lessonsStatus: "GENERATING", status: "GENERATING", errorReason: null },
    });
    void detectBookLessons(bookId).catch(async (e) => {
      await db.book
        .update({
          where: { id: bookId },
          data: { status: "FAILED", lessonsStatus: "FAILED", errorReason: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
        })
        .catch(() => undefined);
    });
    return { queued: true, kind };
  }

  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) throw Errors.validation("نوع محتوای درخواستی معتبر نیست.");

  // Round 23 — assetهای تلگرامیِ مرتبط با این artifact باطل می‌شوند تا نسخهٔ تازه جایگزین شود
  const related: TelegramAssetKind[] =
    kind === "summary"
      ? ["SUMMARY_PDF"]
      : kind === "notes"
        ? ["NOTES_PDF"]
        : kind === "quiz"
          ? ["QUIZ_PDF_MC", "QUIZ_PDF_TF", "QUIZ_PDF_FB", "QUIZ_PDF_SHORT", "QUIZ_PDF_MIXED"]
          : kind === "podcast"
            ? ["PODCAST_AUDIO"]
            : [];
  for (const assetKind of related) {
    await invalidateTelegramAsset(bookId, assetKind);
  }
  if (kind === "podcast") {
    await db.book.update({ where: { id: bookId }, data: { podcastTelegram: false } }).catch(() => undefined);
  }

  await db.book.update({
    where: { id: bookId },
    data: { [artifactStatusField(kind)]: "PENDING", status: "GENERATING", errorReason: null } as Record<string, string | null>,
  });

  void (async () => {
    await generateArtifact(book, kind);
    await refreshBookStatus(bookId);
  })().catch(() => undefined);

  return { queued: true, kind };
}

// ── Quiz parsing (tolerant, spec §98) ──

/** stored quiz JSON → normalized shape (older rows may lack `fb`) */
function parseQuiz(raw: string | null): BookQuiz {
  const q = fromJson<Partial<BookQuiz>>(raw, {});
  return {
    mc: Array.isArray(q.mc) ? q.mc : [],
    tf: Array.isArray(q.tf) ? q.tf : [],
    fb: Array.isArray(q.fb) ? q.fb : [],
    short: Array.isArray(q.short) ? q.short : [],
  };
}

/** extract the JSON array that follows `"key":` — tolerant of truncation (force-closes) */
function extractQuizArray(raw: string, key: string): unknown[] {
  const keyIdx = raw.indexOf(`"${key}"`);
  if (keyIdx === -1) return [];
  const openIdx = raw.indexOf("[", keyIdx);
  if (openIdx === -1) return [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = openIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const slice = end === -1 ? `${raw.slice(openIdx)}]` : raw.slice(openIdx, end + 1); // truncated → force-close
  try {
    const arr = JSON.parse(slice);
    return Array.isArray(arr) ? arr : [];
  } catch {
    // last resort: pull out individual {...} objects and parse each
    const out: unknown[] = [];
    let d = 0;
    let str = false;
    let escp = false;
    let objStart = -1;
    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (escp) {
        escp = false;
        continue;
      }
      if (ch === "\\") {
        escp = true;
        continue;
      }
      if (ch === '"') {
        str = !str;
        continue;
      }
      if (str) continue;
      if (ch === "{") {
        if (d === 0) objStart = i;
        d++;
      } else if (ch === "}") {
        d--;
        if (d === 0 && objStart !== -1) {
          try {
            out.push(JSON.parse(slice.slice(objStart, i + 1)));
          } catch {
            /* skip malformed item */
          }
          objStart = -1;
        }
      }
    }
    return out;
  }
}

function parseBookQuiz(raw: string): BookQuiz | null {
  let s = raw.trim();
  // strip markdown code fences if the model wrapped the JSON
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence && fence[1].includes("{")) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start === -1) return null;

  // fast path: whole-object parse (tolerant backward scan for trailing junk)
  let obj: Record<string, unknown> | null = null;
  for (let end = s.length; end > start; end--) {
    const candidate = s.slice(start, end);
    if (!candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") {
        obj = parsed as Record<string, unknown>;
        break;
      }
    } catch {
      /* keep scanning */
    }
  }

  // slow path: per-array extraction (handles TRUNCATED output from longer 4-model quizzes)
  const mcRaw = obj && Array.isArray(obj.mc) ? obj.mc : extractQuizArray(s, "mc");
  const tfRaw = obj && Array.isArray(obj.tf) ? obj.tf : extractQuizArray(s, "tf");
  const fbRaw = obj && Array.isArray(obj.fb) ? obj.fb : extractQuizArray(s, "fb");
  const shortRaw = obj && Array.isArray(obj.short) ? obj.short : extractQuizArray(s, "short");
  const obj2 = obj ?? {};

  const mc = (Array.isArray(mcRaw) ? mcRaw : Array.isArray(obj2.mc) ? obj2.mc : [])
    .map((q, i): BookQuizItem | null => {
      if (!q || typeof q !== "object") return null;
      const r = q as Record<string, unknown>;
      const options = Array.isArray(r.options)
        ? r.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 5)
        : [];
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      const correctIndex = Number(r.correctIndex);
      if (!prompt || options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
        return null;
      }
      return {
        id: `mc-${i + 1}`,
        kind: "mc",
        prompt,
        options,
        correctIndex,
        explanation: typeof r.explanation === "string" ? r.explanation.trim() : "",
        difficulty: typeof r.difficulty === "string" ? r.difficulty : "MEDIUM",
        topic: typeof r.topic === "string" ? r.topic : undefined,
      };
    })
    .filter((q): q is BookQuizItem => !!q)
    .slice(0, 8);

  const tf = (Array.isArray(tfRaw) ? tfRaw : [])
    .map((q, i): BookQuizItem | null => {
      if (!q || typeof q !== "object") return null;
      const r = q as Record<string, unknown>;
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      if (!prompt) return null;
      const correct = r.correct === true || r.correct === "true" || r.correct === 0 || r.correct === "0";
      return {
        id: `tf-${i + 1}`,
        kind: "tf",
        prompt,
        correct,
        explanation: typeof r.explanation === "string" ? r.explanation.trim() : "",
        topic: typeof r.topic === "string" ? r.topic : undefined,
      };
    })
    .filter((q): q is BookQuizItem => !!q)
    .slice(0, 6);

  // fill-in-blank (جای خالی) — round 18
  const fb = (Array.isArray(fbRaw) ? fbRaw : [])
    .map((q, i): BookQuizItem | null => {
      if (!q || typeof q !== "object") return null;
      const r = q as Record<string, unknown>;
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      const answer = typeof r.answer === "string" ? r.answer.trim() : typeof r.correctAnswer === "string" ? r.correctAnswer.trim() : "";
      if (!prompt || !answer || answer.length > 80) return null;
      return {
        id: `fb-${i + 1}`,
        kind: "fb",
        prompt,
        answer,
        explanation: typeof r.explanation === "string" ? r.explanation.trim() : "",
        topic: typeof r.topic === "string" ? r.topic : undefined,
      };
    })
    .filter((q): q is BookQuizItem => !!q)
    .slice(0, 6);

  const short = (Array.isArray(shortRaw) ? shortRaw : [])
    .map((q, i): BookQuizItem | null => {
      if (!q || typeof q !== "object") return null;
      const r = q as Record<string, unknown>;
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      const referenceAnswer = typeof r.referenceAnswer === "string" ? r.referenceAnswer.trim() : "";
      if (!prompt || !referenceAnswer) return null;
      return {
        id: `short-${i + 1}`,
        kind: "short",
        prompt,
        referenceAnswer,
        topic: typeof r.topic === "string" ? r.topic : undefined,
      };
    })
    .filter((q): q is BookQuizItem => !!q)
    .slice(0, 6);

  if (mc.length === 0 && tf.length === 0 && fb.length === 0 && short.length === 0) return null;
  return { mc, tf, fb, short };
}

// ── Figure parsing + sanitization (round 18 — شکل‌های آموزشی SVG) ──

function sanitizeSvg(raw: string): string | null {
  let svg = String(raw).trim();
  if (!svg.toLowerCase().startsWith("<svg")) return null;
  if (svg.length > 12_000) return null;
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|xlink:href)\s*=\s*"\s*(javascript|data):[^"]*"/gi, "")
    .replace(/(href|xlink:href)\s*=\s*'\s*(javascript|data):[^']*'/gi, "");
  if (!svg.toLowerCase().includes("</svg>")) return null;
  return svg;
}

function parseBookFigures(raw: string): BookFigure[] {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence && fence[1].includes("{")) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start === -1) return [];
  let parsed: unknown = null;
  for (let end = s.length; end > start; end--) {
    const candidate = s.slice(start, end);
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      if (!candidate.endsWith("}")) continue;
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.figures)) return [];
  const out: BookFigure[] = [];
  for (let i = 0; i < obj.figures.length && out.length < 3; i++) {
    const f = obj.figures[i];
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 120) : "";
    const svg = typeof r.svg === "string" ? sanitizeSvg(r.svg) : null;
    if (!title || !svg) continue;
    out.push({
      id: `fig-${i + 1}`,
      title,
      svg,
      caption: typeof r.caption === "string" ? r.caption.trim().slice(0, 300) : "",
    });
  }
  return out;
}

// ── Visibility & listing ──

async function activeClassroomIds(userId: string, tenantId: string | null): Promise<string[]> {
  if (!tenantId) return [];
  const memberships = await db.classMembership.findMany({
    where: { userId, revokedAt: null, classroom: { tenantId } },
    select: { classroomId: true },
  });
  return memberships.map((m) => m.classroomId);
}

function bookSummary(book: {
  id: string;
  title: string;
  author: string | null;
  subject: string | null;
  level: string | null;
  gradeLevel: string | null;
  description: string | null;
  coverEmoji: string;
  charCount: number;
  status: string;
  summaryStatus: string;
  studyNotesStatus: string;
  quizStatus: string;
  figuresStatus: string;
  figuresCount: number;
  podcastStatus: string;
  podcastDurationSec: number | null;
  quizCount: number;
  approvalStatus: string;
  approvalNote: string | null;
  originalPdfPath: string | null;
  originalPdfName: string | null;
  originalPdfTelegram: boolean;
  podcastTelegram: boolean;
  lessonsStatus: string;
  lessonsKind: string | null;
  lessonsCount: number;
  createdAt: Date;
  tenantId: string | null;
  classroomId: string | null;
  addedById: string;
}) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    subject: book.subject,
    level: book.level,
    levelLabel: levelLabel(book.level),
    gradeLevel: book.gradeLevel,
    description: book.description,
    coverEmoji: book.coverEmoji,
    charCount: book.charCount,
    status: book.status,
    summaryStatus: book.summaryStatus,
    studyNotesStatus: book.studyNotesStatus,
    quizStatus: book.quizStatus,
    figuresStatus: book.figuresStatus,
    figuresCount: book.figuresCount,
    podcastStatus: book.podcastStatus,
    podcastDurationSec: book.podcastDurationSec,
    quizCount: book.quizCount,
    approvalStatus: book.approvalStatus,
    approvalNote: book.approvalNote,
    hasOriginalPdf: Boolean(book.originalPdfPath) || book.originalPdfTelegram,
    originalPdfInTelegram: book.originalPdfTelegram,
    podcastInTelegram: book.podcastTelegram,
    // Round 28 — معماری درس‌محور
    lessonsStatus: book.lessonsStatus,
    lessonsKind: book.lessonsKind,
    lessonsCount: book.lessonsCount,
    createdAt: book.createdAt,
    scope: book.tenantId ? (book.classroomId ? "CLASSROOM" : "TENANT") : "PLATFORM",
    addedById: book.addedById,
  };
}

export async function listBooks(ctx: AuthContext, levelFilter?: string | null) {
  const [perm, classroomIds] = await Promise.all([
    booksUploadPermission(ctx),
    activeClassroomIds(ctx.userId, ctx.tenantId),
  ]);

  const levelWhere = levelFilter && isLevelCode(levelFilter) ? { level: levelFilter } : {};

  // Round 18 visibility rules:
  //  - SUPER_ADMIN: everything.
  //  - STUDENT: platform books + only APPROVED school/teacher books.
  //  - TEACHER / SCHOOL_ADMIN: platform books + own tenant books at any approval state
  //    (they need to see the pending/rejected status of their uploads).
  const isStudent = ctx.effectiveRole === ROLES.STUDENT;
  const approvalGate = isStudent ? { approvalStatus: "APPROVED" as const } : {};

  const where =
    ctx.effectiveRole === ROLES.SUPER_ADMIN
      ? levelWhere // platform admin sees everything
      : {
          ...levelWhere,
          OR: [
            { tenantId: null, classroomId: null },
            ...(ctx.tenantId ? [{ tenantId: ctx.tenantId, classroomId: null, ...approvalGate }] : []),
            ...(classroomIds.length > 0 ? [{ classroomId: { in: classroomIds }, ...approvalGate }] : []),
          ],
        };

  const books = await db.book.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      addedBy: { select: { fullName: true } },
      tenant: { select: { name: true } },
      _count: { select: { lessons: true } },
    },
  });

  // per-user best attempts (for «بهترین رکورد» display)
  const attempts = await db.bookQuizAttempt.groupBy({
    by: ["bookId"],
    where: { userId: ctx.userId },
    _max: { score: true },
    _count: { _all: true },
  });
  const bestByBook = new Map(attempts.map((a) => [a.bookId, { best: a._max.score ?? 0, tries: a._count._all }]));

  return {
    canUpload: perm.can,
    canUploadLabel: perm.label,
    role: ctx.effectiveRole,
    books: books.map((b) => ({
      ...bookSummary({ ...b, lessonsCount: b._count.lessons }),
      addedByName: b.addedBy?.fullName ?? null,
      tenantName: b.tenant?.name ?? null,
      mine: b.addedById === ctx.userId,
      myBest: bestByBook.get(b.id)?.best ?? null,
      myTries: bestByBook.get(b.id)?.tries ?? 0,
    })),
  };
}

async function visibleBook(ctx: AuthContext, bookId: string) {
  const book = await db.book.findUnique({
    where: { id: bookId },
    include: { addedBy: { select: { fullName: true } }, tenant: { select: { name: true } } },
  });
  if (!book) throw Errors.notFound("کتاب");
  if (ctx.effectiveRole === ROLES.SUPER_ADMIN) return book;
  if (book.tenantId === null) return book;
  if (book.tenantId !== ctx.tenantId) throw Errors.notFound("کتاب");
  if (book.classroomId) {
    const classroomIds = await activeClassroomIds(ctx.userId, ctx.tenantId);
    if (!classroomIds.includes(book.classroomId)) throw Errors.notFound("کتاب");
  }
  // students only see APPROVED school/teacher books (round 18)
  if (ctx.effectiveRole === ROLES.STUDENT && book.approvalStatus !== "APPROVED") {
    throw Errors.notFound("کتاب");
  }
  return book;
}

export async function getBook(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  const myAttempts = await db.bookQuizAttempt.findMany({
    where: { bookId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const figures = book.figuresStatus === "READY" ? fromJson<BookFigure[]>(book.figures, []) : [];
  // Round 23 — fileIdهای تلگرامی برای ارسال لحظه‌ای توسط بات (بدون دانلود مجدد)
  const tgAssets = await db.telegramAsset.findMany({
    where: { bookId },
    select: { kind: true, fileId: true },
  });
  // Round 28 — فهرست درس‌ها (معماری درس‌محور) برای کتاب‌های جدید
  const lessonRows = await db.bookLesson.findMany({
    where: { bookId },
    orderBy: { order: "asc" },
    select: {
      id: true, order: true, title: true, kind: true, status: true,
      summaryStatus: true, studyNotesStatus: true, quizStatus: true, figuresStatus: true, podcastStatus: true,
      quizCount: true, podcastDurationSec: true,
    },
  });
  return {
    ...bookSummary({ ...book, lessonsCount: lessonRows.length }),
    addedByName: book.addedBy?.fullName ?? null,
    tenantName: book.tenant?.name ?? null,
    mine: book.addedById === ctx.userId,
    summary: book.summaryStatus === "READY" ? book.summary : null,
    studyNotes: book.studyNotesStatus === "READY" ? book.studyNotes : null,
    figures,
    quizModels:
      book.quizStatus === "READY"
        ? (["mc", "tf", "fb", "short"] as const).map((k) => ({
            kind: k,
            label: k === "mc" ? "چهارگزینه‌ای" : k === "tf" ? "درست/غلط" : k === "fb" ? "جای خالی" : "تشریحی کوتاه",
            count: parseQuiz(book.quiz)[k].length,
          }))
        : [],
    errorReason: book.errorReason,
    lessons: lessonRows,
    telegramFiles: Object.fromEntries(tgAssets.map((a) => [a.kind, a.fileId])) as Record<string, string>,
    myAttempts: myAttempts.map((a) => ({
      id: a.id,
      quizModel: a.quizModel,
      score: a.score,
      maxScore: a.maxScore,
      pointsAwarded: a.pointsAwarded,
      createdAt: a.createdAt,
    })),
  };
}

// ───────────────────────── Round 28 — API عمومی درس‌ها ─────────────────────────

async function visibleLesson(ctx: AuthContext, bookId: string, lessonId: string) {
  const book = await visibleBook(ctx, bookId);
  const lesson = await db.bookLesson.findFirst({ where: { id: lessonId, bookId } });
  if (!lesson) throw Errors.notFound("درس");
  return { book, lesson };
}

function lessonPayload(lesson: {
  id: string; bookId: string; order: number; title: string; kind: string; status: string;
  summary: string | null; summaryStatus: string;
  studyNotes: string | null; studyNotesStatus: string;
  quiz: string | null; quizStatus: string; quizCount: number;
  figures: string | null; figuresStatus: string; figuresCount: number;
  podcastStatus: string; podcastDurationSec: number | null; podcastTelegram: boolean;
  errorReason: string | null; generatedById: string | null; firstAccessAt: Date | null;
}) {
  return {
    id: lesson.id,
    bookId: lesson.bookId,
    order: lesson.order,
    title: lesson.title,
    kind: lesson.kind,
    status: lesson.status,
    summary: lesson.summaryStatus === "READY" ? lesson.summary : null,
    summaryStatus: lesson.summaryStatus,
    studyNotes: lesson.studyNotesStatus === "READY" ? lesson.studyNotes : null,
    studyNotesStatus: lesson.studyNotesStatus,
    quizStatus: lesson.quizStatus,
    quizCount: lesson.quizCount,
    quizModels:
      lesson.quizStatus === "READY" && lesson.quiz
        ? (["mc", "tf", "fb", "short"] as const).map((k) => ({
            kind: k,
            label: k === "mc" ? "چهارگزینه‌ای" : k === "tf" ? "درست/غلط" : k === "fb" ? "جای خالی" : "تشریحی کوتاه",
            count: parseQuiz(lesson.quiz)[k].length,
          }))
        : [],
    figures: lesson.figuresStatus === "READY" ? fromJson<BookFigure[]>(lesson.figures, []) : [],
    figuresStatus: lesson.figuresStatus,
    figuresCount: lesson.figuresCount,
    podcastStatus: lesson.podcastStatus,
    podcastDurationSec: lesson.podcastDurationSec,
    podcastInTelegram: lesson.podcastTelegram,
    errorReason: lesson.errorReason,
    generatedById: lesson.generatedById,
    firstAccessAt: lesson.firstAccessAt,
  };
}

/**
 * GET درس — قلب معماری تنبل (خواستهٔ مدیر):
 * اولین انتخاب‌کننده claim اتمیک می‌گیرد (PENDING→GENERATING) و تولید شروع می‌شود؛
 * انتخاب‌کننده‌های بعدی وضعیت/محتوای موجود را فوراً می‌گیرند (poll تا READY).
 */
export async function getBookLesson(ctx: AuthContext, bookId: string, lessonId: string) {
  const { book, lesson } = await visibleLesson(ctx, bookId, lessonId);

  if (lesson.status === "PENDING") {
    // claim اتمیک — فقط یکی برنده است؛ بقیه همان وضعیت GENERATED را می‌بینند
    const claimed = await db.bookLesson.updateMany({
      where: { id: lessonId, status: "PENDING" },
      data: { status: "GENERATING", generatedById: ctx.userId, firstAccessAt: new Date(), errorReason: null },
    });
    if (claimed.count === 1) {
      void generateLessonArtifacts(bookId, lessonId).catch((e) =>
        console.error(`[books] lesson generation crashed for ${lessonId}: ${e instanceof Error ? e.message : e}`)
      );
    }
    const fresh = await db.bookLesson.findUnique({ where: { id: lessonId } });
    return {
      ...lessonPayload(fresh ?? lesson),
      bookTitle: book.title,
      level: book.level,
      levelLabel: levelLabel(book.level),
      gradeLevel: book.gradeLevel,
      subject: book.subject,
    };
  }

  return {
    ...lessonPayload(lesson),
    bookTitle: book.title,
    level: book.level,
    levelLabel: levelLabel(book.level),
    gradeLevel: book.gradeLevel,
    subject: book.subject,
  };
}

/** بازتولید یک مصنوع درس — مجاز برای ایجادکنندهٔ کتاب/مدیر کل همیشه؛ بقیه فقط وقتی FAILED */
export async function regenerateLessonArtifact(ctx: AuthContext, bookId: string, lessonId: string, kind: ArtifactKind) {
  const { book, lesson } = await visibleLesson(ctx, bookId, lessonId);
  if (!ARTIFACT_KINDS.includes(kind)) throw Errors.validation("نوع محتوای درخواستی معتبر نیست.");
  const isManager = book.addedById === ctx.userId || ctx.effectiveRole === ROLES.SUPER_ADMIN;
  const field = lessonArtifactStatusField(kind);
  if (!isManager && lesson[field] !== "FAILED") {
    throw Errors.forbidden("بازتولید فقط وقتی محتوا ناموفق بوده یا توسط ایجادکنندهٔ کتاب/مدیر کل ممکن است.");
  }
  if (kind === "podcast") {
    await invalidateTelegramAsset(bookId, `PODCAST_AUDIO_L:${lessonId}` as TelegramAssetKind);
    await db.bookLesson.update({ where: { id: lessonId }, data: { podcastTelegram: false } }).catch(() => undefined);
  }
  await db.bookLesson.update({
    where: { id: lessonId },
    data: { [field]: "PENDING", status: "GENERATING", errorReason: null } as Record<string, string | null>,
  });
  void (async () => {
    await generateLessonArtifact(book, lesson, kind);
    await refreshLessonStatus(lessonId);
  })().catch(() => undefined);
  return { queued: true, kind, lessonId };
}

/** نمونه‌سؤال‌های یک درس (بدون پاسخ‌ها — تصحیح سمت سرور) */
export async function getBookLessonQuiz(ctx: AuthContext, bookId: string, lessonId: string, model: string) {
  const { book, lesson } = await visibleLesson(ctx, bookId, lessonId);
  if (lesson.quizStatus !== "READY" || !lesson.quiz) {
    throw Errors.validation("نمونه‌سؤال‌های این درس هنوز آماده نشده است.");
  }
  const quizModel = (QUIZ_MODELS as readonly string[]).includes(model) ? (model as QuizModel) : "MC";
  const quiz = parseQuiz(lesson.quiz);
  const items = quizItemsForModel(quiz, quizModel);
  if (items.length === 0) throw Errors.validation("این مدل سؤال برای درس موجود نیست.");
  return {
    bookId,
    lessonId,
    bookTitle: book.title,
    lessonTitle: lesson.title,
    lessonOrder: lesson.order,
    model: quizModel,
    modelLabel: quizModelLabel(quizModel),
    maxScore: items.length,
    items: items.map((it) => ({
      id: it.id,
      kind: it.kind,
      prompt: it.prompt,
      options: it.options ?? (it.kind === "tf" ? ["صحیح", "غلط"] : undefined),
      topic: it.topic ?? null,
    })),
  };
}

/** تصحیح آزمون درس — همان منطق کتاب، با رکورد best جدا برای هر درس */
export async function submitBookLessonQuiz(
  ctx: AuthContext,
  bookId: string,
  lessonId: string,
  model: string,
  answers: Record<string, unknown>
) {
  const { book, lesson } = await visibleLesson(ctx, bookId, lessonId);
  if (lesson.quizStatus !== "READY" || !lesson.quiz) {
    throw Errors.validation("نمونه‌سؤال‌های این درس هنوز آماده نشده است.");
  }
  const quizModel = (QUIZ_MODELS as readonly string[]).includes(model) ? (model as QuizModel) : "MC";
  const quiz = parseQuiz(lesson.quiz);
  const items = quizItemsForModel(quiz, quizModel);

  const normAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      normAnswers[k] = String(v);
    }
  }

  // رکورد بهترین نمره «همین درس» — امتیاز فقط برای بهبود (ضد تکرار)
  const prevAgg = await db.bookQuizAttempt.aggregate({
    where: { bookId, lessonId, userId: ctx.userId },
    _max: { score: true },
  });
  const previousBest = prevAgg._max.score ?? 0;

  let score = 0;
  const maxScore = items.length;
  const perQuestion: Array<{
    id: string; kind: string; prompt: string; yourAnswer: string | null;
    correct: boolean | null; correctAnswer: string; explanation: string | null;
  }> = [];

  for (const it of items) {
    const raw = normAnswers[it.id];
    if (it.kind === "mc") {
      const chosen = raw === undefined || raw === "" ? null : Number(raw);
      const ok = chosen !== null && chosen === it.correctIndex;
      if (ok) score += 1;
      perQuestion.push({
        id: it.id, kind: it.kind, prompt: it.prompt,
        yourAnswer: chosen !== null && it.options ? (it.options[chosen] ?? null) : null,
        correct: ok,
        correctAnswer: it.options ? it.options[it.correctIndex ?? 0] : "",
        explanation: it.explanation ?? null,
      });
    } else if (it.kind === "tf") {
      const normalized = raw === undefined || raw === "" ? null : raw === "true" || raw === "0" ? "true" : "false";
      const ok = normalized !== null && (normalized === "true") === !!it.correct;
      if (ok) score += 1;
      perQuestion.push({
        id: it.id, kind: it.kind, prompt: it.prompt,
        yourAnswer: normalized === null ? null : normalized === "true" ? "صحیح" : "غلط",
        correct: ok,
        correctAnswer: it.correct ? "صحیح" : "غلط",
        explanation: it.explanation ?? null,
      });
    } else if (it.kind === "fb") {
      const answered = typeof raw === "string" && raw.trim().length >= 1;
      const ok = answered && fbMatches(raw, it.answer ?? "");
      if (ok) score += 1;
      perQuestion.push({
        id: it.id, kind: it.kind, prompt: it.prompt,
        yourAnswer: answered ? raw.trim().slice(0, 200) : null,
        correct: ok,
        correctAnswer: it.answer ?? "",
        explanation: it.explanation ?? null,
      });
    } else {
      const answered = typeof raw === "string" && raw.trim().length >= 1;
      if (answered) score += 1;
      perQuestion.push({
        id: it.id, kind: it.kind, prompt: it.prompt,
        yourAnswer: typeof raw === "string" ? raw.slice(0, 500) : null,
        correct: null,
        correctAnswer: it.referenceAnswer ?? "",
        explanation: "پاسخ نمونه برای خودآزمایی — پاسخ شما را با آن مقایسه کنید.",
      });
    }
  }

  const pointsToAward = Math.max(0, score - previousBest);

  const attempt = await db.bookQuizAttempt.create({
    data: {
      bookId,
      lessonId,
      userId: ctx.userId,
      quizModel,
      answers: toJson(normAnswers),
      score,
      maxScore,
      pointsAwarded: pointsToAward,
    },
  });

  if (pointsToAward > 0) {
    await awardPoints(ctx.userId, pointsToAward, POINT_REASONS.BOOK_QUIZ, "BookLesson", lessonId);
  }

  await audit({
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    action: "exam_submitted",
    targetType: "book_lesson_quiz",
    targetId: lessonId,
    metadata: { model: quizModel, score, maxScore, points: pointsToAward, bookId },
  });

  return {
    attemptId: attempt.id,
    bookId,
    lessonId,
    bookTitle: book.title,
    lessonTitle: lesson.title,
    lessonOrder: lesson.order,
    model: quizModel,
    modelLabel: quizModelLabel(quizModel),
    score,
    maxScore,
    percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
    previousBest,
    newBest: score > previousBest,
    pointsAwarded: pointsToAward,
    perQuestion,
  };
}

/** فایل پادکست یک درس — تلگرام اول، fallback محلی */
export async function bookLessonPodcast(ctx: AuthContext, bookId: string, lessonId: string) {
  const { book, lesson } = await visibleLesson(ctx, bookId, lessonId);
  if (lesson.podcastStatus !== "READY") {
    throw Errors.validation("پادکست این درس هنوز تولید نشده است.");
  }
  const safeTitle = `${book.title}-${lesson.order}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const tgAsset = await getTelegramAsset(bookId, `PODCAST_AUDIO_L:${lessonId}` as TelegramAssetKind);
  if (tgAsset) {
    const proxied = await proxyTelegramAsset(
      { fileId: tgAsset.fileId, fileName: tgAsset.fileName, sizeBytes: tgAsset.sizeBytes },
      { fallbackName: `podcast-${safeTitle}.wav`, contentType: "audio/wav" }
    ).catch(() => null);
    if (proxied && proxied.ok) {
      return {
        audio: proxied.data,
        durationSec: lesson.podcastDurationSec ?? null,
        filename: proxied.filename,
        contentType: "audio/wav" as const,
      };
    }
    if (lesson.podcastPath) {
      const localStat = await fs.stat(lesson.podcastPath).catch(() => null);
      if (localStat) {
        return {
          audio: await fs.readFile(lesson.podcastPath),
          durationSec: lesson.podcastDurationSec ?? null,
          filename: `podcast-${safeTitle}.wav`,
          contentType: "audio/wav" as const,
        };
      }
    }
    if (proxied && !proxied.ok && proxied.tooBig) {
      throw tooBigError(proxied.sizeBytes, await telegramDeepLink(bookId, `PODCAST_AUDIO_L:${lessonId}` as TelegramAssetKind));
    }
  }
  if (!lesson.podcastPath) throw Errors.notFound("فایل پادکست درس");
  const stat = await fs.stat(lesson.podcastPath).catch(() => null);
  if (!stat) throw Errors.notFound("فایل پادکست درس");
  return {
    audio: await fs.readFile(lesson.podcastPath),
    durationSec: lesson.podcastDurationSec ?? null,
    filename: `podcast-${safeTitle}.wav`,
    contentType: "audio/wav" as const,
  };
}

export async function deleteBook(ctx: AuthContext, bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw Errors.notFound("کتاب");
  const isOwner = book.addedById === ctx.userId;
  const isSuperAdmin = ctx.effectiveRole === ROLES.SUPER_ADMIN;
  // school admin may delete own-tenant books
  const isTenantAdmin = ctx.effectiveRole === ROLES.SCHOOL_ADMIN && book.tenantId === ctx.tenantId;
  if (!isOwner && !isSuperAdmin && !isTenantAdmin) {
    throw Errors.forbidden("فقط ایجادکنندهٔ کتاب، مدیر همان سازمان یا مدیر کل می‌تواند حذف کند.");
  }
  if (book.podcastPath) {
    await fs.rm(book.podcastPath, { force: true }).catch(() => undefined);
  }
  if (book.originalPdfPath) {
    await fs.rm(book.originalPdfPath, { force: true }).catch(() => undefined);
  }
  // Round 28 — فایل‌های پادکست محلی درس‌ها هم تمیز شوند (ردیف‌ها cascade می‌شوند)
  const lessonPodcasts = await db.bookLesson.findMany({
    where: { bookId, podcastPath: { not: null } },
    select: { podcastPath: true },
  });
  for (const lp of lessonPodcasts) {
    if (lp.podcastPath) await fs.rm(lp.podcastPath, { force: true }).catch(() => undefined);
  }
  // Round 23 — پیام‌های ذخیره‌سازی تلگرام هم تمیز شوند (ردیف‌ها با cascade پاک می‌شوند)
  await purgeTelegramAssets(bookId);
  await db.book.delete({ where: { id: bookId } });
  await audit({
    actorId: ctx.userId,
    tenantId: book.tenantId,
    action: "admin_action",
    targetType: "book",
    targetId: bookId,
    metadata: { deleted: true, title: book.title },
  });
  return { deleted: true };
}

// ── Quiz taking (web + Telegram, same endpoints) ──

const QUIZ_MODELS = ["MC", "TF", "MIXED", "FB", "SHORT"] as const;
export type QuizModel = (typeof QUIZ_MODELS)[number];

export function quizModelLabel(model: string): string {
  return model === "MC"
    ? "چهارگزینه‌ای"
    : model === "TF"
      ? "درست/غلط"
      : model === "MIXED"
        ? "ترکیبی"
        : model === "FB"
          ? "جای خالی"
          : "تشریحی کوتاه";
}

function quizItemsForModel(quiz: BookQuiz, model: QuizModel): BookQuizItem[] {
  if (model === "MC") return quiz.mc;
  if (model === "TF") return quiz.tf;
  if (model === "FB") return quiz.fb;
  if (model === "SHORT") return quiz.short;
  return [...quiz.mc, ...quiz.tf, ...quiz.fb];
}

export async function getBookQuiz(ctx: AuthContext, bookId: string, model: string) {
  const book = await visibleBook(ctx, bookId);
  if (book.quizStatus !== "READY" || !book.quiz) {
    throw Errors.validation("نمونه‌سؤال‌های این کتاب هنوز آماده نشده است.");
  }
  const quizModel = (QUIZ_MODELS as readonly string[]).includes(model) ? (model as QuizModel) : "MC";
  const quiz = parseQuiz(book.quiz);

  const items = quizItemsForModel(quiz, quizModel);
  if (items.length === 0) throw Errors.validation("این مدل سؤال برای کتاب موجود نیست.");

  // strip correct answers — grading is server-side only
  return {
    bookId,
    bookTitle: book.title,
    model: quizModel,
    modelLabel: quizModelLabel(quizModel),
    maxScore: items.length,
    items: items.map((it) => ({
      id: it.id,
      kind: it.kind,
      prompt: it.prompt,
      options: it.options ?? (it.kind === "tf" ? ["صحیح", "غلط"] : undefined),
      topic: it.topic ?? null,
    })),
  };
}

// Persian-tolerant normalization for fill-in-blank grading (ی/ک عربی، نیم‌فاصله، اعراب، نشانه‌ها)
function normalizeFa(s: string): string {
  return s
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/[\u200c\u200f\u200e\u202A-\u202E]/g, "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[.,،؛;:!؟?«»"'()\[\]{}\-_/]/g, " ")
    .replace(/[\s\u00A0]+/g, " ")
    .trim()
    .toLowerCase();
}

function fbMatches(userAnswer: string, reference: string): boolean {
  const a = normalizeFa(userAnswer);
  const b = normalizeFa(reference);
  if (!a || !b) return false;
  if (a === b) return true;
  // tolerate small additions (e.g. «سلول‌های» ↔ «سلول»)
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

export async function submitBookQuiz(
  ctx: AuthContext,
  bookId: string,
  model: string,
  answers: Record<string, unknown>
) {
  const book = await visibleBook(ctx, bookId);
  if (book.quizStatus !== "READY" || !book.quiz) {
    throw Errors.validation("نمونه‌سؤال‌های این کتاب هنوز آماده نشده است.");
  }
  const quizModel = (QUIZ_MODELS as readonly string[]).includes(model) ? (model as QuizModel) : "MC";
  const quiz = parseQuiz(book.quiz);
  const items = quizItemsForModel(quiz, quizModel);

  const normAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      normAnswers[k] = String(v);
    }
  }

  // previous best (points only for improvement — no farming)
  const prevAgg = await db.bookQuizAttempt.aggregate({
    where: { bookId, userId: ctx.userId },
    _max: { score: true },
  });
  const previousBest = prevAgg._max.score ?? 0;

  let score = 0;
  const maxScore = items.length;
  const perQuestion: Array<{
    id: string;
    kind: string;
    prompt: string;
    yourAnswer: string | null;
    correct: boolean | null;
    correctAnswer: string;
    explanation: string | null;
  }> = [];

  for (const it of items) {
    const raw = normAnswers[it.id];
    if (it.kind === "mc") {
      const chosen = raw === undefined || raw === "" ? null : Number(raw);
      const ok = chosen !== null && chosen === it.correctIndex;
      if (ok) score += 1;
      perQuestion.push({
        id: it.id,
        kind: it.kind,
        prompt: it.prompt,
        yourAnswer: chosen !== null && it.options ? (it.options[chosen] ?? null) : null,
        correct: ok,
        correctAnswer: it.options ? it.options[it.correctIndex ?? 0] : "",
        explanation: it.explanation ?? null,
      });
    } else if (it.kind === "tf") {
      const normalized = raw === undefined || raw === "" ? null : raw === "true" || raw === "0" ? "true" : "false";
      const ok = normalized !== null && (normalized === "true") === !!it.correct;
      if (ok) score += 1;
      perQuestion.push({
        id: it.id,
        kind: it.kind,
        prompt: it.prompt,
        yourAnswer: normalized === null ? null : normalized === "true" ? "صحیح" : "غلط",
        correct: ok,
        correctAnswer: it.correct ? "صحیح" : "غلط",
        explanation: it.explanation ?? null,
      });
    } else if (it.kind === "fb") {
      const answered = typeof raw === "string" && raw.trim().length >= 1;
      const ok = answered && fbMatches(raw, it.answer ?? "");
      if (ok) score += 1;
      perQuestion.push({
        id: it.id,
        kind: it.kind,
        prompt: it.prompt,
        yourAnswer: answered ? raw.trim().slice(0, 200) : null,
        correct: ok,
        correctAnswer: it.answer ?? "",
        explanation: it.explanation ?? null,
      });
    } else {
      // short answers: participation scoring + reference answer for self-check
      const answered = typeof raw === "string" && raw.trim().length >= 1;
      if (answered) score += 1;
      perQuestion.push({
        id: it.id,
        kind: it.kind,
        prompt: it.prompt,
        yourAnswer: typeof raw === "string" ? raw.slice(0, 500) : null,
        correct: null, // self-check model — no auto grading
        correctAnswer: it.referenceAnswer ?? "",
        explanation: "پاسخ نمونه برای خودآزمایی — پاسخ شما را با آن مقایسه کنید.",
      });
    }
  }

  const pointsToAward = Math.max(0, score - previousBest);

  const attempt = await db.bookQuizAttempt.create({
    data: {
      bookId,
      userId: ctx.userId,
      quizModel,
      answers: toJson(normAnswers),
      score,
      maxScore,
      pointsAwarded: pointsToAward,
    },
  });

  if (pointsToAward > 0) {
    await awardPoints(ctx.userId, pointsToAward, POINT_REASONS.BOOK_QUIZ, "Book", bookId);
  }

  await audit({
    actorId: ctx.userId,
    tenantId: ctx.tenantId,
    action: "exam_submitted",
    targetType: "book_quiz",
    targetId: bookId,
    metadata: { model: quizModel, score, maxScore, points: pointsToAward },
  });

  return {
    attemptId: attempt.id,
    bookId,
    bookTitle: book.title,
    model: quizModel,
    modelLabel: quizModelLabel(quizModel),
    score,
    maxScore,
    percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
    previousBest,
    newBest: score > previousBest,
    pointsAwarded: pointsToAward,
    perQuestion,
  };
}

export async function listMyBookAttempts(ctx: AuthContext, bookId: string) {
  await visibleBook(ctx, bookId);
  const attempts = await db.bookQuizAttempt.findMany({
    where: { bookId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return attempts.map((a) => ({
    id: a.id,
    quizModel: a.quizModel,
    modelLabel: quizModelLabel(a.quizModel),
    score: a.score,
    maxScore: a.maxScore,
    pointsAwarded: a.pointsAwarded,
    createdAt: a.createdAt,
  }));
}

// ── Podcast artifact ──

// ── Original PDF (round 20 — the real book, file-upload or fetched-from-link) ──

export async function bookOriginalPdf(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  // Round 23 — اول از تلگرام (fileId دائمی)؛ فقط اگر >۲۰MB بود و نسخهٔ محلی موجود بود، محلی را می‌دهیم
  const tgAsset = await getTelegramAsset(bookId, "ORIGINAL_PDF");
  if (tgAsset) {
    const proxied = await proxyTelegramAsset(
      { fileId: tgAsset.fileId, fileName: tgAsset.fileName, sizeBytes: tgAsset.sizeBytes },
      { fallbackName: book.originalPdfName ?? `${book.title}.pdf`, contentType: "application/pdf" }
    ).catch(() => null);
    if (proxied && proxied.ok) {
      return { data: proxied.data, filename: proxied.filename };
    }
    if (book.originalPdfPath) {
      const localStat = await fs.stat(book.originalPdfPath).catch(() => null);
      if (localStat) {
        const data = await fs.readFile(book.originalPdfPath);
        const name = (book.originalPdfName ?? `${book.title}.pdf`).replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 100);
        return { data, filename: /\.pdf$/i.test(name) ? name : `${name}.pdf` };
      }
    }
    if (proxied && !proxied.ok && proxied.tooBig) {
      throw tooBigError(proxied.sizeBytes, await telegramDeepLink(bookId, "ORIGINAL_PDF"));
    }
  }
  if (!book.originalPdfPath) {
    throw Errors.notFound("نسخهٔ اصلی (PDF) این کتاب");
  }
  const stat = await fs.stat(book.originalPdfPath).catch(() => null);
  if (!stat) throw Errors.notFound("فایل PDF کتاب");
  const data = await fs.readFile(book.originalPdfPath);
  const name = (book.originalPdfName ?? `${book.title}.pdf`).replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 100);
  return { data, filename: /\.pdf$/i.test(name) ? name : `${name}.pdf` };
}

export async function bookPodcast(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  if (book.podcastStatus !== "READY") {
    throw Errors.validation("پادکست این کتاب هنوز تولید نشده است.");
  }
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  // Round 23 — اول از تلگرام؛ fallback محلی فقط وقتی asset نبود یا پروکسی شکست خورد
  const tgAsset = await getTelegramAsset(bookId, "PODCAST_AUDIO");
  if (tgAsset) {
    const proxied = await proxyTelegramAsset(
      { fileId: tgAsset.fileId, fileName: tgAsset.fileName, sizeBytes: tgAsset.sizeBytes },
      { fallbackName: `podcast-${safeTitle}.wav`, contentType: "audio/wav" }
    ).catch(() => null);
    if (proxied && proxied.ok) {
      return {
        audio: proxied.data,
        durationSec: book.podcastDurationSec ?? null,
        filename: proxied.filename,
        contentType: "audio/wav",
      };
    }
    if (book.podcastPath) {
      const localStat = await fs.stat(book.podcastPath).catch(() => null);
      if (localStat) {
        const audio = await fs.readFile(book.podcastPath);
        return {
          audio,
          durationSec: book.podcastDurationSec ?? null,
          filename: `podcast-${safeTitle}.wav`,
          contentType: "audio/wav",
        };
      }
    }
    if (proxied && !proxied.ok && proxied.tooBig) {
      throw tooBigError(proxied.sizeBytes, await telegramDeepLink(bookId, "PODCAST_AUDIO"));
    }
  }
  if (!book.podcastPath) {
    throw Errors.notFound("فایل پادکست");
  }
  const stat = await fs.stat(book.podcastPath).catch(() => null);
  if (!stat) throw Errors.notFound("فایل پادکست");
  const audio = await fs.readFile(book.podcastPath);
  return {
    audio,
    durationSec: book.podcastDurationSec ?? null,
    filename: `podcast-${safeTitle}.wav`,
    contentType: "audio/wav",
  };
}

// ── Persian RTL .docx (shared by summary + study-notes) ──

async function buildMarkdownDocx(opts: { title: string; metaBits: string; footer: string; markdown: string; docKind: string }) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");

  const rtlRun = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({
      text,
      rightToLeft: true,
      bold: o.bold,
      size: o.size,
      color: o.color,
      font: "Vazirmatn",
    });

  function boldSplit(text: string): Array<InstanceType<typeof TextRun>> {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((p) => {
      if (p.startsWith("**") && p.endsWith("**")) return rtlRun(p.slice(2, -2), { bold: true });
      return rtlRun(p, {});
    });
  }

  // minimal markdown-ish → docx mapping (headings, bullets, **bold**, tables → lines)
  const paragraphs: Array<InstanceType<typeof Paragraph>> = [];
  paragraphs.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      children: [rtlRun(opts.title, { bold: true, size: 44 })],
    })
  );
  paragraphs.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [rtlRun(opts.metaBits || opts.docKind, { size: 24, color: "6B7280" })],
    })
  );
  paragraphs.push(
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [rtlRun(opts.footer, { size: 20, color: "9CA3AF" })],
    })
  );
  paragraphs.push(new Paragraph({ children: [] })); // spacer

  for (const rawLine of opts.markdown.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ children: [] }));
      continue;
    }
    // markdown table rows → keep readable as text rows
    const tableRow = /^\|(.+)\|$/.exec(line);
    if (tableRow) {
      const cells = tableRow[1]
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c && !/^[-: ]+$/.test(c));
      if (cells.length === 0) continue;
      paragraphs.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          indent: { right: 360 },
          children: [rtlRun("• ", { bold: true }), ...boldSplit(cells.join(" — "))],
        })
      );
      continue;
    }
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      paragraphs.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: [rtlRun(headingMatch[2], { bold: true, size: level === 1 ? 34 : level === 2 ? 30 : 26 })],
        })
      );
      continue;
    }
    const bulletMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          indent: { right: 360 },
          children: [rtlRun("•  ", { bold: true }), ...boldSplit(bulletMatch[1])],
        })
      );
      continue;
    }
    paragraphs.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.JUSTIFIED,
        children: boldSplit(line),
      })
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Vazirmatn", size: 24 } },
      },
    },
    sections: [{ children: paragraphs }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

function docxMetaBits(book: { subject: string | null; gradeLevel: string | null; level: string | null; author: string | null }): string {
  const bits = [book.level ? levelLabel(book.level) : null, book.gradeLevel ? `پایهٔ ${book.gradeLevel}` : null, book.subject, book.author].filter(Boolean);
  return bits.join(" · ");
}

export async function bookSummaryDocx(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  if (book.summaryStatus !== "READY" || !book.summary) {
    throw Errors.validation("خلاصهٔ این کتاب هنوز تولید نشده است.");
  }
  const docx = await buildMarkdownDocx({
    title: book.title,
    metaBits: docxMetaBits(book),
    footer: "پلتفرم آموزش هوشمند ایران",
    markdown: book.summary,
    docKind: "خلاصهٔ هوشمند کتاب",
  });
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return { docx, filename: `summary-${safeTitle}.docx` };
}

export async function bookStudyNotesDocx(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  if (book.studyNotesStatus !== "READY" || !book.studyNotes) {
    throw Errors.validation("جزوهٔ این کتاب هنوز تولید نشده است.");
  }
  const docx = await buildMarkdownDocx({
    title: `جزوهٔ ${book.title}`,
    metaBits: docxMetaBits(book),
    footer: "پلتفرم آموزش هوشمند ایران",
    markdown: book.studyNotes,
    docKind: "جزوهٔ درسی هوشمند",
  });
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return { docx, filename: `jozve-${safeTitle}.docx` };
}

// ── Round 22 — PDF خروجی فارسی (Chromium + Vazirmatn) ──
// خواستهٔ مدیر: «حتماً خروجی PDF با فونت مناسب فارسی» و سؤال‌ها با چارچوب رسمی
// برگهٔ آزمون. هر سه سند با همان موتور رندر وب ساخته می‌شوند تا شکل‌دهی حروف
// فارسی بی‌نقص باشد؛ فونت وزیرمتن داخل فایل جاسازی می‌شود.
// Round 23 — هر PDF یک بار رندر می‌شود و در تلگرام (fileId) می‌ماند؛ درخواست‌های
// بعدی مستقیماً از تلگرام پروکسی می‌شوند — روی هاست هیچ باینری‌ای نوشته نمی‌شود.

function pdfMetaBits(book: { subject: string | null; gradeLevel: string | null; level: string | null; author: string | null }): string[] {
  const bits = [
    book.level ? levelLabel(book.level) : null,
    book.gradeLevel ? `پایهٔ ${book.gradeLevel}` : null,
    book.subject ? `درس: ${book.subject}` : null,
    book.author ? `نویسنده: ${book.author}` : null,
  ].filter(Boolean) as string[];
  return bits;
}

type BookPdfMeta = {
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  level: string | null;
  author: string | null;
};

async function buildSummaryPdfFor(book: BookPdfMeta & { summary: string }) {
  const pdf = await renderDocPdf({
    title: book.title,
    kind: "خلاصهٔ هوشمند کتاب",
    metaBits: pdfMetaBits(book),
    markdown: book.summary,
    footerNote: "خلاصهٔ هوشمند کتاب",
    intro: "این خلاصه به‌صورت خودکار از متن کامل کتاب تولید شده است — برای مرور سریع پیش از آزمون مناسب است.",
  });
  return { pdf, filename: `summary-${safeFileName(book.title)}.pdf` };
}

async function buildStudyNotesPdfFor(book: BookPdfMeta & { studyNotes: string }) {
  const pdf = await renderDocPdf({
    title: `جزوهٔ ${book.title}`,
    kind: "جزوهٔ درسی هوشمند",
    metaBits: pdfMetaBits(book),
    markdown: book.studyNotes,
    footerNote: "جزوهٔ درسی هوشمند",
    intro: "جزوهٔ ساختاریافته با نکات کلیدی — برای مطالعهٔ هدفمند و مرور فصل‌به‌فصل آماده شده است.",
  });
  return { pdf, filename: `jozve-${safeFileName(book.title)}.pdf` };
}

async function buildQuizPdfFor(book: BookPdfMeta, quiz: BookQuiz, model: QuizModel) {
  const items = quizItemsForModel(quiz, model);
  const pdf = await renderQuizPdf({
    title: `نمونه‌سؤال — ${book.title}`,
    metaBits: pdfMetaBits(book),
    modelLabel: quizModelLabel(model),
    questions: items.map((it) => ({
      kind: it.kind,
      prompt: it.prompt,
      options: it.options,
      correctIndex: it.correctIndex,
      correct: it.correct,
      answer: it.answer,
      referenceAnswer: it.referenceAnswer,
      explanation: it.explanation,
      topic: it.topic,
    })),
    footerNote: "نمونه‌سؤال هوشمند",
  });
  return { pdf, filename: `quiz-${model.toLowerCase()}-${safeFileName(book.title)}.pdf` };
}

/** اگر asset تلگرامی موجود باشد پروکسی می‌کنیم؛ وگرنه رندر + آپلود در تلگرام برای دفعات بعد. */
async function proxyOrRender(
  bookId: string,
  kind: TelegramAssetKind,
  fallbackName: string,
  render: () => Promise<{ pdf: Uint8Array; filename: string }>
): Promise<{ pdf: Uint8Array; filename: string }> {
  const asset = await getTelegramAsset(bookId, kind);
  if (asset) {
    const proxied = await proxyTelegramAsset(
      { fileId: asset.fileId, fileName: asset.fileName, sizeBytes: asset.sizeBytes },
      { fallbackName, contentType: "application/pdf" }
    ).catch(() => null);
    if (proxied && proxied.ok) {
      return { pdf: proxied.data, filename: proxied.filename };
    }
    if (proxied && !proxied.ok && proxied.tooBig) {
      throw tooBigError(proxied.sizeBytes, await telegramDeepLink(bookId, kind));
    }
  }
  const built = await render();
  // کش در تلگرام — بار بعدی بدون رندر، مستقیم از تلگرام سرو می‌شود
  void uploadTelegramAsset({
    bookId,
    kind,
    bytes: built.pdf,
    fileName: built.filename,
    caption: `📦 محتوای هوشمند کتاب — PDF با فونت فارسی (وزیرمتن) · ذخیره‌سازی تلگرامی پلتفرم`,
  }).catch(() => undefined);
  return built;
}

export async function bookSummaryPdf(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  const summary = book.summary;
  if (book.summaryStatus !== "READY" || !summary) {
    throw Errors.validation("خلاصهٔ این کتاب هنوز تولید نشده است.");
  }
  return proxyOrRender(bookId, "SUMMARY_PDF", `summary-${safeFileName(book.title)}.pdf`, () =>
    buildSummaryPdfFor({ ...book, summary })
  );
}

export async function bookStudyNotesPdf(ctx: AuthContext, bookId: string) {
  const book = await visibleBook(ctx, bookId);
  const studyNotes = book.studyNotes;
  if (book.studyNotesStatus !== "READY" || !studyNotes) {
    throw Errors.validation("جزوهٔ این کتاب هنوز تولید نشده است.");
  }
  return proxyOrRender(bookId, "NOTES_PDF", `jozve-${safeFileName(book.title)}.pdf`, () =>
    buildStudyNotesPdfFor({ ...book, studyNotes })
  );
}

export async function bookQuizPdf(ctx: AuthContext, bookId: string, model: string) {
  const book = await visibleBook(ctx, bookId);
  if (book.quizStatus !== "READY" || !book.quiz) {
    throw Errors.validation("نمونه‌سؤال‌های این کتاب هنوز آماده نشده است.");
  }
  const quizModel = (QUIZ_MODELS as readonly string[]).includes(model) ? (model as QuizModel) : "MC";
  const quiz = parseQuiz(book.quiz);
  const items = quizItemsForModel(quiz, quizModel);
  if (items.length === 0) throw Errors.validation("این مدل سؤال برای کتاب موجود نیست.");
  const kind: TelegramAssetKind = `QUIZ_PDF_${quizModel}` as TelegramAssetKind;
  return proxyOrRender(bookId, kind, `quiz-${quizModel.toLowerCase()}-${safeFileName(book.title)}.pdf`, () =>
    buildQuizPdfFor(book, quiz, quizModel)
  );
}

// ── Round 23 — انتقال دستی یک کتاب به ذخیره‌سازی تلگرام (برای کتاب‌های قدیمی) ──

export async function migrateBookToTelegram(ctx: AuthContext, bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw Errors.notFound("کتاب");
  if (book.addedById !== ctx.userId && ctx.effectiveRole !== ROLES.SUPER_ADMIN) {
    throw Errors.forbidden("فقط ایجادکنندهٔ کتاب یا مدیر کل می‌تواند انتقال به تلگرام انجام دهد.");
  }
  const cfg = await tgStorageRuntime();
  if (!cfg) {
    throw Errors.channelNotConfigured(
      "ذخیره‌سازی تلگرام آماده نیست — توکن بات باید در تنظیمات ثبت شده باشد و حساب مدیر کل به تلگرام متصل باشد (یا شناسهٔ چت ذخیره‌سازی را در تنظیمات وارد کنید)."
    );
  }

  const migrated: Array<{ kind: string; label: string; sizeBytes: number }> = [];
  const skipped: Array<{ kind: string; label: string; reason: string }> = [];

  // ۱) PDF اصلی
  if (await getTelegramAsset(bookId, "ORIGINAL_PDF")) {
    skipped.push({ kind: "ORIGINAL_PDF", label: "PDF اصلی کتاب", reason: "از قبل در تلگرام ذخیره است" });
  } else if (book.originalPdfPath) {
    await pushOriginalPdfToTelegram(bookId);
    const asset = await getTelegramAsset(bookId, "ORIGINAL_PDF");
    if (asset) migrated.push({ kind: "ORIGINAL_PDF", label: "PDF اصلی کتاب", sizeBytes: asset.sizeBytes });
    else skipped.push({ kind: "ORIGINAL_PDF", label: "PDF اصلی کتاب", reason: "آپلود به تلگرام ناموفق بود — بعداً دوباره تلاش کنید" });
  } else if (book.originalPdfTelegram) {
    skipped.push({ kind: "ORIGINAL_PDF", label: "PDF اصلی کتاب", reason: "از قبل در تلگرام ذخیره است" });
  } else {
    skipped.push({ kind: "ORIGINAL_PDF", label: "PDF اصلی کتاب", reason: "این کتاب PDF اصلی ندارد" });
  }

  // ۲) پادکست
  if (await getTelegramAsset(bookId, "PODCAST_AUDIO")) {
    skipped.push({ kind: "PODCAST_AUDIO", label: "پادکست کتاب", reason: "از قبل در تلگرام ذخیره است" });
  } else if (book.podcastPath && book.podcastStatus === "READY") {
    const ok = await pushPodcastWavToTelegram(bookId);
    if (ok) {
      const asset = await getTelegramAsset(bookId, "PODCAST_AUDIO");
      migrated.push({ kind: "PODCAST_AUDIO", label: "پادکست کتاب", sizeBytes: asset?.sizeBytes ?? 0 });
    } else {
      skipped.push({ kind: "PODCAST_AUDIO", label: "پادکست کتاب", reason: "آپلود به تلگرام ناموفق بود — بعداً دوباره تلاش کنید" });
    }
  } else if (book.podcastStatus !== "READY") {
    skipped.push({ kind: "PODCAST_AUDIO", label: "پادکست کتاب", reason: "پادکست هنوز تولید نشده است" });
  } else {
    skipped.push({ kind: "PODCAST_AUDIO", label: "پادکست کتاب", reason: "فایل محلی پادکست موجود نیست — با «بازتولید» دوباره بسازید" });
  }

  // ۳) خلاصه/جزوه/نمونه‌سؤال MC — اگر متن‌ها READY باشند رندر و آپلود می‌شوند
  const fresh = await db.book.findUnique({ where: { id: bookId } });
  if (fresh) {
    const freshSummary = fresh.summary;
    if (fresh.summaryStatus === "READY" && freshSummary) {
      if (await getTelegramAsset(bookId, "SUMMARY_PDF")) {
        skipped.push({ kind: "SUMMARY_PDF", label: "خلاصهٔ PDF", reason: "از قبل در تلگرام ذخیره است" });
      } else {
        await renderAndUploadArtifactPdf(fresh, "SUMMARY_PDF", () => buildSummaryPdfFor({ ...fresh, summary: freshSummary }));
        const asset = await getTelegramAsset(bookId, "SUMMARY_PDF");
        if (asset) migrated.push({ kind: "SUMMARY_PDF", label: "خلاصهٔ PDF", sizeBytes: asset.sizeBytes });
        else skipped.push({ kind: "SUMMARY_PDF", label: "خلاصهٔ PDF", reason: "رندر/آپلود ناموفق بود" });
      }
    } else {
      skipped.push({ kind: "SUMMARY_PDF", label: "خلاصهٔ PDF", reason: "خلاصه هنوز تولید نشده است" });
    }

    const freshNotes = fresh.studyNotes;
    if (fresh.studyNotesStatus === "READY" && freshNotes) {
      if (await getTelegramAsset(bookId, "NOTES_PDF")) {
        skipped.push({ kind: "NOTES_PDF", label: "جزوهٔ PDF", reason: "از قبل در تلگرام ذخیره است" });
      } else {
        await renderAndUploadArtifactPdf(fresh, "NOTES_PDF", () => buildStudyNotesPdfFor({ ...fresh, studyNotes: freshNotes }));
        const asset = await getTelegramAsset(bookId, "NOTES_PDF");
        if (asset) migrated.push({ kind: "NOTES_PDF", label: "جزوهٔ PDF", sizeBytes: asset.sizeBytes });
        else skipped.push({ kind: "NOTES_PDF", label: "جزوهٔ PDF", reason: "رندر/آپلود ناموفق بود" });
      }
    } else {
      skipped.push({ kind: "NOTES_PDF", label: "جزوهٔ PDF", reason: "جزوه هنوز تولید نشده است" });
    }

    if (fresh.quizStatus === "READY" && fresh.quiz) {
      if (await getTelegramAsset(bookId, "QUIZ_PDF_MC")) {
        skipped.push({ kind: "QUIZ_PDF_MC", label: "نمونه‌سؤال PDF", reason: "از قبل در تلگرام ذخیره است" });
      } else {
        await renderAndUploadArtifactPdf(fresh, "QUIZ_PDF_MC", () =>
          buildQuizPdfFor(fresh, parseQuiz(fresh.quiz), "MC")
        );
        const asset = await getTelegramAsset(bookId, "QUIZ_PDF_MC");
        if (asset) migrated.push({ kind: "QUIZ_PDF_MC", label: "نمونه‌سؤال PDF", sizeBytes: asset.sizeBytes });
        else skipped.push({ kind: "QUIZ_PDF_MC", label: "نمونه‌سؤال PDF", reason: "رندر/آپلود ناموفق بود" });
      }
    } else {
      skipped.push({ kind: "QUIZ_PDF_MC", label: "نمونه‌سؤال PDF", reason: "نمونه‌سؤال هنوز تولید نشده است" });
    }
  }

  const assets = await listTelegramAssets(bookId);
  await audit({
    actorId: ctx.userId,
    tenantId: book.tenantId,
    action: "admin_action",
    targetType: "book",
    targetId: bookId,
    metadata: { migratedToTelegram: migrated.map((m) => m.kind) },
  });
  return {
    ok: true,
    bookId,
    title: book.title,
    migrated,
    skipped,
    storage: {
      chatId: cfg.chatId,
      assets: assets.length,
      bytes: assets.reduce((n, a) => n + a.sizeBytes, 0),
    },
  };
}
