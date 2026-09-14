/**
 * Seed — REAL usable data (spec §92 school onboarding). No fake KPIs.
 * Demo accounts (dev credentials, not production secrets):
 *   owner@platform.ir    / 123456   → SUPER_ADMIN
 *   admin@school.ir      / 123456   → SCHOOL_ADMIN (دبیرستان نمونه ایرانیان)
 *   teacher@school.ir    / 123456   → TEACHER (ریاضی)
 *   student@school.ir    / 123456   → STUDENT (دهم)
 * Additional students get graded attempts THROUGH the real service flow,
 * so all analytics/progress are computed from genuine business-logic outputs.
 */
import { db } from "../src/lib/db";
import { hashPassword } from "../src/server/auth/password";
import { ensurePlansSeeded } from "../src/server/services/plan";
import { startAttempt, saveAnswers, submitAttempt } from "../src/server/services/exam";
import { toJson } from "../src/server/core/json";

async function main() {
  console.log("🌱 Seeding AI Education Platform Iran …");

  // Clean slate (idempotent reseed for dev)
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.usageEvent.deleteMany(),
    db.examResult.deleteMany(),
    db.examAttempt.deleteMany(),
    db.question.deleteMany(),
    db.assignment.deleteMany(),
    db.exam.deleteMany(),
    db.classResource.deleteMany(),
    db.classMembership.deleteMany(),
    db.classroom.deleteMany(),
    db.flashcard.deleteMany(),
    db.flashcardDeck.deleteMany(),
    db.studyPlan.deleteMany(),
    db.tutorMessage.deleteMany(),
    db.tutorThread.deleteMany(),
    db.subscription.deleteMany(),
    db.session.deleteMany(),
    db.externalIdentity.deleteMany(),
    db.school.deleteMany(),
    db.user.deleteMany(),
    db.tenant.deleteMany(),
    db.featureFlag.deleteMany(),
    db.plan.deleteMany(),
  ]);

  await ensurePlansSeeded();

  // ── Tenant + School ──
  const tenant = await db.tenant.create({
    data: { name: "دبیرستان نمونه ایرانیان", slug: "iranians-demo", status: "ACTIVE" },
  });
  const school = await db.school.create({
    data: { tenantId: tenant.id, name: "دبیرستان نمونه ایرانیان", status: "ACTIVE" },
  });

  // ── Users ──
  const owner = await db.user.create({
    data: {
      role: "SUPER_ADMIN",
      fullName: "مدیر پلتفرم",
      email: "owner@platform.ir",
      passwordHash: hashPassword("123456"),
      status: "ACTIVE",
    },
  });
  const admin = await db.user.create({
    data: {
      role: "SCHOOL_ADMIN",
      fullName: "علی رضایی (مدیر مدرسه)",
      email: "admin@school.ir",
      passwordHash: hashPassword("123456"),
      tenantId: tenant.id,
      status: "ACTIVE",
    },
  });
  const teacher = await db.user.create({
    data: {
      role: "TEACHER",
      fullName: "مریم محمدی",
      email: "teacher@school.ir",
      passwordHash: hashPassword("123456"),
      tenantId: tenant.id,
      status: "ACTIVE",
    },
  });
  const student = await db.user.create({
    data: {
      role: "STUDENT",
      fullName: "سارا احمدی",
      email: "student@school.ir",
      passwordHash: hashPassword("123456"),
      tenantId: tenant.id,
      grade: "دهم",
      status: "ACTIVE",
    },
  });
  const extraStudents = await Promise.all(
    [
      { fullName: "رضا کریمی", email: "reza@school.ir" },
      { fullName: "نگار موسوی", email: "negar@school.ir" },
      { fullName: "امیر حسینی", email: "amir@school.ir" },
      { fullName: "الهام صادقی", email: "elham@school.ir" },
      { fullName: "پویا نوری", email: "pouya@school.ir" },
    ].map((s) =>
      db.user.create({
        data: {
          role: "STUDENT",
          fullName: s.fullName,
          email: s.email,
          passwordHash: hashPassword("123456"),
          tenantId: tenant.id,
          grade: "دهم",
          status: "ACTIVE",
        },
      })
    )
  );

  // ── Classroom + memberships ──
  const classroom = await db.classroom.create({
    data: {
      tenantId: tenant.id,
      schoolId: school.id,
      name: "ریاضی ۱ — دهم",
      grade: "دهم",
      subject: "ریاضی",
      teacherId: teacher.id,
      status: "ACTIVE",
    },
  });
  for (const stu of [student, ...extraStudents]) {
    await db.classMembership.create({
      data: { classroomId: classroom.id, userId: stu.id, role: "STUDENT" },
    });
  }

  // ── Exam with real questions ──
  const now = Date.now();
  const exam = await db.exam.create({
    data: {
      tenantId: tenant.id,
      createdBy: teacher.id,
      title: "کوییز فصل ۲ — معادله و تابع",
      description: "آزمون کوتاه از مبحث معادله خط و تابع",
      durationMinutes: 15,
      status: "PUBLISHED",
    },
  });
  const questionsData = [
    {
      type: "MULTIPLE_CHOICE",
      prompt: "معادلهٔ خطی ۳x − ۶ = ۰ چه ریشه‌ای دارد؟",
      options: ["۲", "−۲", "۳", "۶"],
      correctAnswer: "0",
      explanation: "۳x = ۶ ⇒ x = ۲ است.",
      difficulty: "EASY",
      topic: "معادله خط",
      points: 2,
    },
    {
      type: "MULTIPLE_CHOICE",
      prompt: "تابع f(x)=2x+3 در x=۴ چه مقداری می‌گیرد؟",
      options: ["۸", "۱۱", "۹", "۷"],
      correctAnswer: "1",
      explanation: "f(۴)=۲×۴+۳=۱۱.",
      difficulty: "EASY",
      topic: "تابع",
      points: 2,
    },
    {
      type: "TRUE_FALSE",
      prompt: "نمودار تابع y=−x+۱ از مبدأ گذشته‌است.",
      options: ["صحیح", "غلط"],
      correctAnswer: "1",
      explanation: "در x=۰ مقدار y=۱ است؛ پس از مبدأ نمی‌گذرد.",
      difficulty: "MEDIUM",
      topic: "نمودار تابع",
      points: 1,
    },
    {
      type: "FILL_IN_BLANK",
      prompt: "شیب خط y=۵x−۲ برابر است با … (فقط عدد را بنویسید)",
      options: [],
      correctAnswer: "5",
      explanation: "در شکل y=mx+b، شیب m=۵ است.",
      difficulty: "MEDIUM",
      topic: "شیب خط",
      points: 2,
    },
    {
      type: "SHORT_ANSWER",
      prompt: "تعریف دامنهٔ یک تابع را به‌طور کامل بنویسید.",
      options: [],
      correctAnswer: "دامنهٔ تابع مجموعهٔ تمام مقادیر مجازی است که متغیر مستقل می‌تواند بگیرد.",
      explanation: "دامنه مجموعه مقادیر ورودی مجاز تابع است.",
      difficulty: "HARD",
      topic: "مفهوم تابع",
      points: 3,
    },
  ];
  for (const q of questionsData) {
    await db.question.create({
      data: {
        tenantId: tenant.id,
        examId: exam.id,
        createdBy: teacher.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options.length ? toJson(q.options) : null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic: q.topic,
        points: q.points,
        aiGenerated: false,
      },
    });
  }

  // ── Assignment targeting the exam ──
  const assignment = await db.assignment.create({
    data: {
      tenantId: tenant.id,
      classroomId: classroom.id,
      createdBy: teacher.id,
      title: "کوییز معادله و تابع (فصل ۲)",
      description: "لطفاً تا مهلت مقرر آزمون را انجام دهید. نمره ثبت می‌شود.",
      status: "PUBLISHED",
      publishAt: new Date(now - 3600_000),
      dueAt: new Date(now + 3 * 86400_000),
      closeAt: new Date(now + 5 * 86400_000),
      examId: exam.id,
    },
  });

  // A plain (non-exam) homework assignment
  await db.assignment.create({
    data: {
      tenantId: tenant.id,
      classroomId: classroom.id,
      createdBy: teacher.id,
      title: "تمرین صفحهٔ ۴۸ کتاب ریاضی",
      description: "حل تمرین‌های ۱ تا ۶ صفحهٔ ۴۸ و ارسال در جلسهٔ بعد.",
      status: "PUBLISHED",
      publishAt: new Date(now - 7200_000),
      dueAt: new Date(now + 2 * 86400_000),
      closeAt: null,
      examId: null,
    },
  });

  // ── Real graded attempts for extra students (through real service flow) ──
  const examQuestions = await db.question.findMany({
    where: { examId: exam.id },
    orderBy: { createdAt: "asc" },
  });

  // Answer profiles (index into examQuestions): null = unanswered
  const profiles: Array<(string | null)[]> = [
    ["0", "1", "1", "5", "دامنه مجموعه مقادیر مجازی است که متغیر مستقل می‌تواند بگیرد."], // reza
    ["0", "1", "0", "4", "مجموعه مقادیر مجاز متغیر مستقل"], // negar
    ["0", "0", "1", "5", null], // amir
    ["1", "1", null, "3", null], // elham
    ["0", "1", "1", null, "نمی‌دانم"], // pouya
  ];

  for (let i = 0; i < extraStudents.length; i++) {
    const stu = extraStudents[i];
    const profile = profiles[i] ?? [];
    const answers: Record<string, string> = {};
    examQuestions.forEach((q, qi) => {
      const a = profile[qi];
      if (a !== null && a !== undefined) answers[q.id] = a;
    });
    const started = await startAttempt(tenant.id, stu.id, assignment.id);
    await saveAnswers(tenant.id, stu.id, started.attemptId, answers);
    await submitAttempt(tenant.id, stu.id, started.attemptId);
  }

  // ── Class resource ──
  await db.classResource.create({
    data: {
      tenantId: tenant.id,
      classroomId: classroom.id,
      createdBy: teacher.id,
      title: "جزوهٔ فصل ۲ — معادله و تابع",
      description: "جزوهٔ کلاسی همراه با مثال‌های حل‌شده",
      url: null,
    },
  });

  // ── Feature flags (explicit keys, all enabled) ──
  const flagKeys = [
    "feature.AI_TUTOR",
    "feature.SUMMARIZER",
    "feature.QUESTION_GENERATOR",
    "feature.TEACHER_ASSISTANT",
    "feature.FLASHCARDS",
    "feature.STUDY_PLANNER",
  ];
  for (const key of flagKeys) {
    await db.featureFlag.create({
      data: { key, enabled: true, scope: "global", description: "کنترل قابلیت " + key.replace("feature.", "") },
    });
  }

  console.log("✅ Seed complete.");
  console.log("   Accounts → owner@platform.ir / admin@school.ir / teacher@school.ir / student@school.ir — رمز همه: 123456");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
