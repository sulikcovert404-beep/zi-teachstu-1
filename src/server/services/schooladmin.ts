import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson } from "@/server/core/json";
import { DEFAULT_PLAN_LIMITS } from "@/server/core/constants";

// School Admin service — spec §3.2. Sees only own tenant's data (tenant from server-side session).

export async function schoolAdminOverview(tenantId: string) {
  const school = await db.school.findUnique({ where: { tenantId } });
  if (!school) throw Errors.notFound("مدرسه");

  const [teachers, students, classes, activeSub, usageToday, exams, assignments, resultsCount] = await Promise.all([
    db.user.count({ where: { tenantId, role: "TEACHER", status: "ACTIVE" } }),
    db.user.count({ where: { tenantId, role: "STUDENT", status: "ACTIVE" } }),
    db.classroom.count({ where: { tenantId, status: "ACTIVE" } }),
    db.subscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { currentPeriodEnd: "desc" },
    }),
    db.usageEvent.count({ where: { tenantId, createdAt: { gte: startOfToday() } } }),
    db.exam.count({ where: { tenantId } }),
    db.assignment.count({ where: { tenantId } }),
    db.examResult.count({ where: { attempt: { tenantId } } }),
  ]);

  const results = await db.examResult.findMany({
    where: { attempt: { tenantId } },
    select: { score: true, maxScore: true },
    take: 300,
  });
  const avgScore = results.length
    ? Math.round((results.reduce((s, r) => s + r.score / Math.max(1, r.maxScore), 0) / results.length) * 100)
    : null;

  return {
    school: { id: school.id, name: school.name, status: school.status },
    stats: {
      teachers,
      students,
      classes,
      exams,
      assignments,
      avgScore,
      resultsCount,
      aiCallsToday: usageToday,
    },
    subscription: activeSub
      ? {
          planCode: activeSub.plan.code,
          planName: activeSub.plan.displayName,
          status: activeSub.status,
          currentPeriodEnd: activeSub.currentPeriodEnd,
        }
      : null,
  };
}

export async function listTenantTeachers(tenantId: string) {
  const teachers = await db.user.findMany({
    where: { tenantId, role: "TEACHER" },
    select: {
      id: true, fullName: true, email: true, status: true, createdAt: true,
      taughtClassrooms: { where: { tenantId, status: "ACTIVE" }, select: { id: true, name: true, subject: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return teachers;
}

export async function listTenantStudents(tenantId: string, classroomId?: string) {
  const memberships = await db.classMembership.findMany({
    where: {
      revokedAt: null,
      classroom: { tenantId, ...(classroomId ? { id: classroomId } : {}) },
      user: { role: "STUDENT" },
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, grade: true, status: true } },
      classroom: { select: { id: true, name: true, subject: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  if (classroomId) return memberships;
  // Students not yet enrolled in any class (classroom: null) — needed by the school admin enrollment flow
  const enrolledUserIds = memberships.map((m) => m.userId);
  const unenrolled = await db.user.findMany({
    where: { tenantId, role: "STUDENT", status: "ACTIVE", ...(enrolledUserIds.length ? { id: { notIn: enrolledUserIds } } : {}) },
    select: { id: true, fullName: true, email: true, grade: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return [
    ...memberships,
    ...unenrolled.map((u) => ({
      id: null,
      classroomId: null,
      userId: u.id,
      role: "STUDENT",
      createdAt: u.createdAt,
      revokedAt: null,
      user: { id: u.id, fullName: u.fullName, email: u.email, grade: u.grade, status: u.status },
      classroom: null,
    })),
  ];
}

export async function listTenantClasses(tenantId: string) {
  const classes = await db.classroom.findMany({
    where: { tenantId },
    include: {
      teacher: { select: { id: true, fullName: true } },
      school: { select: { name: true } },
      _count: { select: { memberships: { where: { revokedAt: null } }, assignments: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    grade: c.grade,
    subject: c.subject,
    teacher: c.teacher,
    schoolName: c.school.name,
    studentCount: c._count.memberships,
    assignmentsCount: c._count.assignments,
    status: c.status,
  }));
}

export async function tenantUsage(tenantId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const events = await db.usageEvent.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: { feature: true, createdAt: true, success: true },
  });
  const byFeature: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const e of events) {
    byFeature[e.feature] = (byFeature[e.feature] ?? 0) + 1;
    const day = e.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return {
    total14d: events.length,
    byFeature,
    byDay,
  };
}

export async function tenantPerformance(tenantId: string) {
  const results = await db.examResult.findMany({
    where: { attempt: { tenantId } },
    include: {
      attempt: {
        select: {
          exam: { select: { title: true } },
          assignment: { select: { classroom: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return results.map((r) => ({
    examTitle: r.attempt.exam.title,
    classroom: r.attempt.assignment.classroom.name,
    score: r.score,
    maxScore: r.maxScore,
    percent: r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0,
    createdAt: r.createdAt,
  }));
}

// Create a user (teacher/student) inside own tenant — spec §92 onboarding
export async function createTenantUser(
  tenantId: string,
  input: { fullName: string; email: string; password: string; role: "TEACHER" | "STUDENT"; grade?: string }
) {
  const exists = await db.user.findUnique({ where: { email: input.email } });
  if (exists) throw Errors.conflict("EMAIL_TAKEN", "این ایمیل قبلاً ثبت شده است.");
  const { hashPassword } = await import("@/server/auth/password");
  const user = await db.user.create({
    data: {
      role: input.role,
      fullName: input.fullName,
      email: input.email,
      passwordHash: hashPassword(input.password),
      tenantId,
      grade: input.grade ?? null,
    },
  });
  await (await import("./audit")).audit({
    actorId: null,
    tenantId,
    action: "admin_action",
    targetType: "user",
    targetId: user.id,
    metadata: { role: input.role },
  });
  return { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
}

export async function createTenantClassroom(
  tenantId: string,
  input: { name: string; grade: string; subject: string; teacherId: string }
) {
  const school = await db.school.findUnique({ where: { tenantId } });
  if (!school) throw Errors.notFound("مدرسه");
  const teacher = await db.user.findFirst({ where: { id: input.teacherId, tenantId, role: "TEACHER" } });
  if (!teacher) throw Errors.notFound("معلم");
  return db.classroom.create({
    data: {
      tenantId,
      schoolId: school.id,
      name: input.name,
      grade: input.grade,
      subject: input.subject,
      teacherId: input.teacherId,
    },
  });
}

export async function enrollStudent(tenantId: string, classroomId: string, studentId: string) {
  const classroom = await db.classroom.findFirst({ where: { id: classroomId, tenantId } });
  if (!classroom) throw Errors.notFound("کلاس");
  const student = await db.user.findFirst({ where: { id: studentId, tenantId, role: "STUDENT" } });
  if (!student) throw Errors.notFound("دانش‌آموز");
  const existing = await db.classMembership.findUnique({
    where: { classroomId_userId: { classroomId, userId: studentId } },
  });
  if (existing && !existing.revokedAt)
    throw Errors.conflict("ALREADY_ENROLLED", "این دانش‌آموز قبلاً در کلاس ثبت‌نام شده است.");
  if (existing?.revokedAt) {
    // re-enrollment after revocation
    return db.classMembership.update({
      where: { id: existing.id },
      data: { revokedAt: null, createdAt: new Date() },
    });
  }
  return db.classMembership.create({ data: { classroomId, userId: studentId, role: "STUDENT" } });
}

// Active plan limits for the school (drives paywall / upgrade UX)
export async function tenantPlanInfo(tenantId: string) {
  const sub = await db.subscription.findFirst({
    where: { tenantId, status: "ACTIVE" },
    include: { plan: true },
    orderBy: { currentPeriodEnd: "desc" },
  });
  const plans = await db.plan.findMany({ where: { active: true }, orderBy: { priceMonthly: "asc" } });
  return {
    current: sub
      ? {
          planCode: sub.plan.code,
          planName: sub.plan.displayName,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          limits: fromJson<Record<string, number>>(sub.plan.limits, {}),
        }
      : { planCode: "SCHOOL_FREE", planName: "مدرسه (رایگان)", status: "DEFAULT", currentPeriodEnd: null, limits: DEFAULT_PLAN_LIMITS.SCHOOL_FREE },
    catalog: plans.map((p) => ({
      code: p.code,
      name: p.displayName,
      roleScope: p.roleScope,
      priceMonthly: p.priceMonthly,
      limits: fromJson<Record<string, number>>(p.limits, {}),
    })),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
