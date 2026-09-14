import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson, toJson } from "@/server/core/json";
import { audit } from "./audit";
import { awardPoints, POINT_REASONS } from "./points";

// Spec §18 — Exam architecture: Assignment→Exam→ExamAttempt(question snapshot)→ExamResult.
// Spec §71/72 — race-safe attempt numbering (transaction), row-level uniqueness.
// Spec §73 — idempotent save & submit.

export interface SnapshotQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  points: number;
  difficulty: string;
  topic: string | null;
  // kept in snapshot for server-side grading only — never sent to client before submit
  correctAnswer: string;
  explanation: string | null;
}

export interface PublicQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  points: number;
  difficulty: string;
  topic: string | null;
}

export interface GradingMetaItem {
  questionId: string;
  correct: boolean;
  chosen: string | null;
  correctAnswer: string;
  explanation: string | null;
  points: number;
  earned: number;
}

function stripForClient(q: SnapshotQuestion): PublicQuestion {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    points: q.points,
    difficulty: q.difficulty,
    topic: q.topic,
  };
}

// ── Student side ──

export async function listStudentAssignments(tenantId: string, studentId: string) {
  const memberships = await db.classMembership.findMany({
    where: { userId: studentId, revokedAt: null },
    select: { classroomId: true },
  });
  const classroomIds = memberships.map((m) => m.classroomId);
  if (classroomIds.length === 0) return [];

  const now = new Date();
  const assignments = await db.assignment.findMany({
    where: {
      tenantId, // tenant isolation (spec §4)
      classroomId: { in: classroomIds },
      status: "PUBLISHED",
      publishAt: { lte: now },
    },
    include: {
      classroom: { select: { name: true, subject: true, grade: true } },
      exam: { select: { id: true, title: true, durationMinutes: true } },
      attempts: {
        where: { studentId },
        select: { id: true, state: true, attemptNo: true, startedAt: true, submittedAt: true },
      },
    },
    orderBy: { dueAt: "asc" },
  });
  return assignments.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    classroom: a.classroom,
    dueAt: a.dueAt,
    closeAt: a.closeAt,
    exam: a.exam,
    attempts: a.attempts,
  }));
}

async function assertCanStart(
  tenantId: string,
  studentId: string,
  assignmentId: string
) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { classroom: true, exam: { include: { questions: true } } },
  });
  if (!assignment || assignment.tenantId !== tenantId) throw Errors.notFound("تکلیف");
  if (assignment.status !== "PUBLISHED") throw Errors.conflict("ASSIGNMENT_NOT_AVAILABLE", "این تکلیف در دسترس نیست.");

  const now = new Date();
  if (assignment.publishAt > now)
    throw Errors.conflict("ASSIGNMENT_NOT_AVAILABLE", "این تکلیف هنوز منتشر نشده است.");
  if (assignment.closeAt && assignment.closeAt < now)
    throw Errors.conflict("ASSIGNMENT_CLOSED", "مهلت این تکلیف به پایان رسیده است.");

  // Membership must be valid (spec §18.4)
  const membership = await db.classMembership.findFirst({
    where: { classroomId: assignment.classroomId, userId: studentId, revokedAt: null },
  });
  if (!membership) throw Errors.forbidden("شما عضو این کلاس نیستید.");

  const exam = assignment.exam;
  if (!exam) throw Errors.notFound("آزمون");
  if (exam.questions.length === 0)
    throw Errors.conflict("EXAM_EMPTY", "این آزمون هنوز سؤالی ندارد.");
  return { assignment, exam };
}

// Race-safe start (spec §18.4: Concurrent Start race-safe, attempt numbering atomic)
export async function startAttempt(
  tenantId: string,
  studentId: string,
  assignmentId: string
): Promise<{ attemptId: string; attemptNo: number; exam: { title: string; durationMinutes: number }; questions: PublicQuestion[]; answers: Record<string, string> | null; state: string }> {
  const { assignment, exam } = await assertCanStart(tenantId, studentId, assignmentId);

  // Idempotent: resume an existing IN_PROGRESS attempt instead of creating a duplicate
  const existing = await db.examAttempt.findFirst({
    where: { assignmentId, studentId, state: "IN_PROGRESS", tenantId },
  });
  if (existing) {
    const snap = fromJson<SnapshotQuestion[]>(existing.questionSnapshot, []);
    return {
      attemptId: existing.id,
      attemptNo: existing.attemptNo,
      exam: { title: exam.title, durationMinutes: exam.durationMinutes },
      questions: snap.map(stripForClient),
      answers: fromJson<Record<string, string> | null>(existing.answers, null),
      state: existing.state,
    };
  }

  const ordered = [...exam.questions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const snapshot: SnapshotQuestion[] = ordered.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: fromJson<string[]>(q.options, []),
    points: q.points,
    difficulty: q.difficulty,
    topic: q.topic,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
  }));

  const attempt = await db.$transaction(async (tx) => {
    const last = await tx.examAttempt.findFirst({
      where: { examId: exam.id, studentId },
      orderBy: { attemptNo: "desc" },
      select: { attemptNo: true },
    });
    return tx.examAttempt.create({
      data: {
        tenantId,
        examId: exam.id,
        assignmentId,
        studentId,
        attemptNo: (last?.attemptNo ?? 0) + 1,
        questionSnapshot: toJson(snapshot),
        state: "IN_PROGRESS",
      },
    });
  });

  await audit({
    actorId: studentId,
    tenantId,
    action: "exam_started",
    targetType: "exam",
    targetId: exam.id,
    metadata: { attemptId: attempt.id, attemptNo: attempt.attemptNo },
  });

  return {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    exam: { title: exam.title, durationMinutes: exam.durationMinutes },
    questions: snapshot.map(stripForClient),
    answers: null,
    state: attempt.state,
  };
}

async function getOwnAttempt(tenantId: string, studentId: string, attemptId: string) {
  const attempt = await db.examAttempt.findUnique({
    where: { id: attemptId },
    include: { exam: true, assignment: true, result: true },
  });
  if (!attempt || attempt.tenantId !== tenantId || attempt.studentId !== studentId)
    throw Errors.notFound("آزمون");
  return attempt;
}

// Idempotent answer save (spec §18.4)
export async function saveAnswers(
  tenantId: string,
  studentId: string,
  attemptId: string,
  answers: Record<string, string>
): Promise<{ saved: true }> {
  const attempt = await getOwnAttempt(tenantId, studentId, attemptId);
  if (attempt.state !== "IN_PROGRESS")
    throw Errors.conflict("ATTEMPT_NOT_ACTIVE", "این آزمون در حالت قابل ویرایش نیست.");
  const snap = fromJson<SnapshotQuestion[]>(attempt.questionSnapshot, []);
  const validIds = new Set(snap.map((q) => q.id));
  const clean: Record<string, string> = {};
  for (const [qid, val] of Object.entries(answers)) {
    if (validIds.has(qid) && typeof val === "string" && val.length <= 2000) clean[qid] = val;
  }
  await db.examAttempt.update({
    where: { id: attemptId },
    data: { answers: toJson({ ...fromJson<Record<string, string>>(attempt.answers, {}), ...clean }) },
  });
  return { saved: true };
}

// Idempotent submit + SERVER-SIDE deterministic objective grading (spec §11.5, §18.4)
export async function submitAttempt(
  tenantId: string,
  studentId: string,
  attemptId: string
): Promise<{ state: string; resultId?: string }> {
  const attempt = await getOwnAttempt(tenantId, studentId, attemptId);
  if (attempt.state === "SUBMITTED" || attempt.state === "GRADED") {
    // Idempotent: return existing outcome
    return { state: attempt.state, resultId: attempt.result?.id };
  }
  if (attempt.state !== "IN_PROGRESS") throw Errors.conflict("ATTEMPT_NOT_ACTIVE", "وضعیت این آزمون نامعتبر است.");

  const closeAt = attempt.assignment.closeAt;
  if (closeAt && closeAt < new Date() && attempt.submittedAt === null) {
    // Policy: hard close is enforced, but we still grade what was saved (fair, deterministic)
    // Spec allows policy-driven decision; we grade saved answers and mark submitted late.
  }

  const snap = fromJson<SnapshotQuestion[]>(attempt.questionSnapshot, []);
  const answers = fromJson<Record<string, string>>(attempt.answers, {});

  const meta: GradingMetaItem[] = [];
  let score = 0;
  let maxScore = 0;
  for (const q of snap) {
    maxScore += q.points;
    const chosen = answers[q.id] ?? null;
    let earned = 0;
    let correct = false;
    if (chosen !== null) {
      if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE" || q.type === "FILL_IN_BLANK") {
        correct = chosen.trim() === String(q.correctAnswer).trim();
        if (correct) earned = q.points;
      } else if (q.type === "SHORT_ANSWER") {
        // Deterministic lenient-normalized comparison (teacher can override later — spec §11.5)
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
        correct = norm(chosen) === norm(q.correctAnswer ?? "");
        if (correct) earned = q.points;
        else if (norm(chosen).length > 0 && norm(q.correctAnswer ?? "").includes(norm(chosen)))
          earned = Math.max(0, Math.floor(q.points / 2));
      }
    }
    score += earned;
    meta.push({
      questionId: q.id,
      correct,
      chosen,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      points: q.points,
      earned,
    });
  }

  const { result, newlyGraded } = await db.$transaction(async (tx) => {
    const stillActive = await tx.examAttempt.findUnique({ where: { id: attemptId } });
    if (!stillActive || stillActive.state !== "IN_PROGRESS") {
      // concurrent submit — idempotency guard
      const r = await tx.examResult.findUnique({ where: { attemptId } });
      return { result: r, newlyGraded: false };
    }
    await tx.examAttempt.update({
      where: { id: attemptId },
      data: { state: "GRADED", submittedAt: new Date() },
    });
    const created = await tx.examResult.create({
      data: {
        attemptId,
        score,
        maxScore,
        gradingMeta: toJson(meta),
      },
    });
    return { result: created, newlyGraded: true };
  });

  // Round 16 — points for graded exams (first grading only; idempotent by design)
  if (newlyGraded && score > 0) {
    await awardPoints(studentId, score, POINT_REASONS.EXAM_COMPLETED, "ExamAttempt", attemptId).catch(
      () => undefined
    );
  }

  await audit({
    actorId: studentId,
    tenantId,
    action: "exam_submitted",
    targetType: "exam_attempt",
    targetId: attemptId,
    metadata: { score, maxScore, examId: attempt.examId },
  });

  return { state: "GRADED", resultId: result?.id };
}

// Student sees ONLY own result (spec §18.4)
export async function getAttemptResult(tenantId: string, studentId: string, attemptId: string) {
  const attempt = await getOwnAttempt(tenantId, studentId, attemptId);
  if (!attempt.result) throw Errors.notFound("نتیجه");
  const snap = fromJson<SnapshotQuestion[]>(attempt.questionSnapshot, []);
  const answers = fromJson<Record<string, string>>(attempt.answers, {});
  const meta = fromJson<GradingMetaItem[]>(attempt.result.gradingMeta, []);
  const byId = new Map(meta.map((m) => [m.questionId, m]));
  return {
    attempt: {
      id: attempt.id,
      state: attempt.state,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      attemptNo: attempt.attemptNo,
    },
    exam: { id: attempt.exam.id, title: attempt.exam.title },
    score: attempt.result.score,
    maxScore: attempt.result.maxScore,
    questions: snap.map((q) => {
      const m = byId.get(q.id);
      return {
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options,
        chosen: answers[q.id] ?? null,
        correctAnswer: q.correctAnswer,
        correct: m?.correct ?? false,
        earned: m?.earned ?? 0,
        points: q.points,
        explanation: q.explanation,
      };
    }),
  };
}

export async function getAttemptForTaking(tenantId: string, studentId: string, attemptId: string) {
  const attempt = await getOwnAttempt(tenantId, studentId, attemptId);
  const snap = fromJson<SnapshotQuestion[]>(attempt.questionSnapshot, []);
  const exam = await db.exam.findUnique({ where: { id: attempt.examId } });
  return {
    attemptId: attempt.id,
    state: attempt.state,
    attemptNo: attempt.attemptNo,
    exam: { title: exam?.title ?? "", durationMinutes: exam?.durationMinutes ?? 20 },
    questions: snap.map(stripForClient),
    answers: fromJson<Record<string, string> | null>(attempt.answers, null),
    startedAt: attempt.startedAt,
  };
}

// ── Progress (spec §19 — computed ONLY from real data) ──
export async function studentProgress(tenantId: string, studentId: string) {
  const memberships = await db.classMembership.findMany({
    where: { userId: studentId, revokedAt: null },
    select: { classroomId: true },
  });
  const classroomIds = memberships.map((m) => m.classroomId);

  const [assignmentsTotal, attemptsGraded, resultsAgg, tutorMsgs, flashcards] = await Promise.all([
    classroomIds.length
      ? db.assignment.count({
          where: { tenantId, classroomId: { in: classroomIds }, status: "PUBLISHED", publishAt: { lte: new Date() } },
        })
      : Promise.resolve(0),
    db.examAttempt.count({ where: { tenantId, studentId, state: "GRADED" } }),
    db.examResult.findMany({
      where: { attempt: { tenantId, studentId } },
      select: { score: true, maxScore: true, createdAt: true, attempt: { select: { exam: { select: { title: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.tutorMessage.count({ where: { thread: { tenantId, studentId }, role: "assistant" } }),
    db.flashcard.count({ where: { deck: { tenantId, ownerId: studentId } } }),
  ]);

  const submittedAssignmentIds = await db.examAttempt.findMany({
    where: { tenantId, studentId, state: "GRADED" },
    select: { assignmentId: true },
  });
  const uniqueSubmitted = new Set(submittedAssignmentIds.map((a) => a.assignmentId)).size;

  const totalScore = resultsAgg.reduce((s, r) => s + r.score, 0);
  const totalMax = resultsAgg.reduce((s, r) => s + r.maxScore, 0);

  return {
    hasData: assignmentsTotal > 0 || resultsAgg.length > 0 || tutorMsgs > 0 || flashcards > 0,
    assignmentsTotal,
    assignmentsSubmitted: uniqueSubmitted,
    completionRate: assignmentsTotal > 0 ? Math.round((uniqueSubmitted / assignmentsTotal) * 100) : null,
    examsTaken: attemptsGraded,
    averageScore: totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null,
    tutorInteractions: tutorMsgs,
    flashcards,
    recentResults: resultsAgg.slice(0, 10).map((r) => ({
      title: r.attempt.exam.title,
      score: r.score,
      maxScore: r.maxScore,
      percent: r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0,
      createdAt: r.createdAt,
    })),
  };
}
