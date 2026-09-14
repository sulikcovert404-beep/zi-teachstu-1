import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson, toJson } from "@/server/core/json";
import { audit } from "./audit";

// Teacher service — spec §3.3. Teacher only ever touches classrooms where teacherId = self
// AND tenant matches (server-side ownership checks, spec §32).

export async function teacherOverview(tenantId: string, teacherId: string) {
  const classrooms = await db.classroom.findMany({
    where: { tenantId, teacherId, status: "ACTIVE" },
    include: {
      _count: { select: { memberships: { where: { revokedAt: null } }, assignments: true } },
      school: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const classIds = classrooms.map((c) => c.id);
  const [assignmentsCount, examsCount, recentResults] = await Promise.all([
    classIds.length
      ? db.assignment.count({ where: { tenantId, classroomId: { in: classIds } } })
      : Promise.resolve(0),
    db.exam.count({ where: { tenantId, createdBy: teacherId } }),
    db.examResult.findMany({
      where: { attempt: { tenantId, assignment: { classroomId: { in: classIds } } } },
      select: { score: true, maxScore: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const avg = recentResults.length
    ? Math.round((recentResults.reduce((s, r) => s + r.score / Math.max(1, r.maxScore), 0) / recentResults.length) * 100)
    : null;

  return {
    classes: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      subject: c.subject,
      schoolName: c.school.name,
      studentCount: c._count.memberships,
      assignmentsCount: c._count.assignments,
    })),
    stats: {
      classCount: classrooms.length,
      studentCount: classrooms.reduce((s, c) => s + c._count.memberships, 0),
      assignmentsCount,
      examsCount,
      avgExamScore: avg,
      gradedResults: recentResults.length,
    },
  };
}

export async function listClassStudents(tenantId: string, teacherId: string, classroomId: string) {
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, tenantId, teacherId }, // ownership check
  });
  if (!classroom) throw Errors.notFound("کلاس");

  const memberships = await db.classMembership.findMany({
    where: { classroomId, revokedAt: null },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, grade: true, status: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const studentIds = memberships.map((m) => m.userId);
  const results = studentIds.length
    ? await db.examResult.findMany({
        where: { attempt: { tenantId, studentId: { in: studentIds }, assignment: { classroomId } } },
        select: { score: true, maxScore: true, attempt: { select: { studentId: true } } },
      })
    : [];

  const byStudent = new Map<string, { total: number; count: number }>();
  for (const r of results) {
    const cur = byStudent.get(r.attempt.studentId) ?? { total: 0, count: 0 };
    cur.total += r.maxScore > 0 ? r.score / r.maxScore : 0;
    cur.count += 1;
    byStudent.set(r.attempt.studentId, cur);
  }

  return memberships.map((m) => {
    const agg = byStudent.get(m.userId);
    return {
      id: m.user.id,
      fullName: m.user.fullName,
      email: m.user.email,
      grade: m.user.grade,
      examsTaken: agg?.count ?? 0,
      avgScore: agg && agg.count > 0 ? Math.round((agg.total / agg.count) * 100) : null,
    };
  });
}

export async function listTeacherAssignments(tenantId: string, teacherId: string) {
  const assignments = await db.assignment.findMany({
    where: { tenantId, createdBy: teacherId },
    include: {
      classroom: { select: { id: true, name: true, subject: true } },
      exam: { select: { id: true, title: true, durationMinutes: true } },
      _count: { select: { attempts: { where: { state: "GRADED" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return assignments.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    status: a.status,
    classroom: a.classroom,
    exam: a.exam,
    dueAt: a.dueAt,
    publishAt: a.publishAt,
    gradedAttempts: a._count.attempts,
  }));
}

export async function createAssignment(
  tenantId: string,
  teacherId: string,
  input: {
    classroomId: string;
    title: string;
    description?: string;
    examId?: string;
    dueAt?: string | null;
    closeAt?: string | null;
    publishNow?: boolean;
  }
) {
  const classroom = await db.classroom.findFirst({ where: { id: input.classroomId, tenantId, teacherId } });
  if (!classroom) throw Errors.notFound("کلاس");
  if (input.examId) {
    const exam = await db.exam.findFirst({ where: { id: input.examId, tenantId } });
    if (!exam) throw Errors.notFound("آزمون");
    const questionCount = await db.question.count({ where: { examId: input.examId, tenantId } });
    if (questionCount === 0) throw Errors.conflict("EXAM_EMPTY", "آزمون بدون سؤال قابل انتساب نیست.");
  }
  const publishAt = input.publishNow === false ? new Date(Date.now() + 86400000) : new Date();
  const assignment = await db.assignment.create({
    data: {
      tenantId,
      classroomId: input.classroomId,
      createdBy: teacherId,
      title: input.title,
      description: input.description ?? null,
      examId: input.examId ?? null,
      status: "PUBLISHED",
      publishAt,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      closeAt: input.closeAt ? new Date(input.closeAt) : null,
    },
  });
  await audit({
    actorId: teacherId,
    tenantId,
    action: "assignment_created",
    targetType: "assignment",
    targetId: assignment.id,
    metadata: { classroomId: input.classroomId, examId: input.examId ?? null },
  });
  return assignment;
}

// ── Exams ──

export async function listTeacherExams(tenantId: string, teacherId: string) {
  const exams = await db.exam.findMany({
    where: { tenantId, createdBy: teacherId },
    include: {
      _count: { select: { questions: true, attempts: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return exams.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    durationMinutes: e.durationMinutes,
    status: e.status,
    questionCount: e._count.questions,
    attemptCount: e._count.attempts,
    createdAt: e.createdAt,
  }));
}

export async function getExamDetail(tenantId: string, teacherId: string, examId: string) {
  const exam = await db.exam.findFirst({
    where: { id: examId, tenantId, createdBy: teacherId },
    include: { questions: { orderBy: { createdAt: "asc" } } },
  });
  if (!exam) throw Errors.notFound("آزمون");
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    questions: exam.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: fromJson<string[]>(q.options, []),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      difficulty: q.difficulty,
      topic: q.topic,
      points: q.points,
      aiGenerated: q.aiGenerated,
    })),
  };
}

export async function createExam(
  tenantId: string,
  teacherId: string,
  input: {
    title: string;
    description?: string;
    durationMinutes?: number;
    questions: Array<{
      type: string;
      prompt: string;
      options?: string[];
      correctAnswer: string;
      explanation?: string;
      difficulty?: string;
      topic?: string;
      points?: number;
    }>;
  }
) {
  if (!input.questions?.length) throw Errors.validation("آزمون باید حداقل یک سؤال داشته باشد.");
  for (const q of input.questions) {
    if (!q.prompt?.trim()) throw Errors.validation("متن سؤال نمی‌تواند خالی باشد.");
    if (q.type === "MULTIPLE_CHOICE" && (!q.options || q.options.length < 2))
      throw Errors.validation("سؤال چهارگزینه‌ای نیاز به حداقل دو گزینه دارد.");
  }
  const exam = await db.exam.create({
    data: {
      tenantId,
      createdBy: teacherId,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes ?? 20,
      status: "PUBLISHED",
      questions: {
        create: input.questions.map((q) => ({
          tenantId,
          createdBy: teacherId,
          type: q.type,
          prompt: q.prompt,
          options: q.options ? toJson(q.options) : null,
          correctAnswer: String(q.correctAnswer),
          explanation: q.explanation ?? null,
          difficulty: q.difficulty ?? "MEDIUM",
          topic: q.topic ?? null,
          points: q.points ?? 1,
          aiGenerated: false,
        })),
      },
    },
  });
  await audit({
    actorId: teacherId,
    tenantId,
    action: "exam_created",
    targetType: "exam",
    targetId: exam.id,
    metadata: { questionCount: input.questions.length },
  });
  return exam;
}

// Teacher sees results ONLY for own classrooms (spec §18.4)
export async function teacherExamResults(tenantId: string, teacherId: string) {
  const results = await db.examResult.findMany({
    where: {
      attempt: {
        tenantId,
        assignment: { classroom: { teacherId } },
      },
    },
    include: {
      attempt: {
        select: {
          id: true,
          student: { select: { id: true, fullName: true } },
          exam: { select: { id: true, title: true } },
          assignment: { select: { id: true, title: true, classroom: { select: { name: true } } } },
          submittedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return results.map((r) => ({
    id: r.id,
    student: r.attempt.student,
    exam: r.attempt.exam,
    assignment: { id: r.attempt.assignment.id, title: r.attempt.assignment.title, classroom: r.attempt.assignment.classroom.name },
    score: r.score,
    maxScore: r.maxScore,
    percent: r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0,
    submittedAt: r.attempt.submittedAt,
  }));
}

// ── Class resources (spec §3.3) ──
export async function listResources(tenantId: string, teacherId: string, classroomId?: string) {
  return db.classResource.findMany({
    where: {
      tenantId,
      createdBy: teacherId,
      ...(classroomId ? { classroomId, classroom: { teacherId } } : { classroom: { teacherId } }),
    },
    include: { classroom: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createResource(
  tenantId: string,
  teacherId: string,
  input: { classroomId: string; title: string; description?: string; url?: string }
) {
  const classroom = await db.classroom.findFirst({ where: { id: input.classroomId, tenantId, teacherId } });
  if (!classroom) throw Errors.notFound("کلاس");
  if (input.url && !/^https?:\/\//i.test(input.url)) throw Errors.validation("آدرس لینک معتبر نیست.");
  return db.classResource.create({
    data: {
      tenantId,
      classroomId: input.classroomId,
      createdBy: teacherId,
      title: input.title,
      description: input.description ?? null,
      url: input.url ?? null,
    },
  });
}
