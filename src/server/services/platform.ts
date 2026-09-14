import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { fromJson } from "@/server/core/json";
import { ROLES, ROLE_LABELS_FA, type Role } from "@/server/core/constants";
import { clearPreview, createSession, type AuthContext } from "@/server/auth/session";
import { audit } from "./audit";
import { isValidProvince, isValidCity, isValidDistrict } from "@/lib/iran-locations";

// Platform (SUPER_ADMIN) service — spec §3.1, §6 (Secure Role Preview), §80.

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function platformOverview() {
  const [tenants, users, schools, classes, exams, assignments, attempts, activeSessions, aiCallsToday, failedAiToday] =
    await Promise.all([
      db.tenant.count(),
      db.user.count(),
      db.school.count(),
      db.classroom.count(),
      db.exam.count(),
      db.assignment.count(),
      db.examAttempt.count(),
      db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.usageEvent.count({ where: { createdAt: { gte: startOfToday() } } }),
      db.usageEvent.count({ where: { createdAt: { gte: startOfToday() }, success: false } }),
    ]);
  return {
    tenants, users, schools, classes, exams, assignments, attempts, activeSessions,
    aiCallsToday, failedAiToday,
  };
}

export async function listTenants() {
  const tenants = await db.tenant.findMany({
    include: {
      school: { select: { name: true, status: true, province: true, city: true, district: true } },
      _count: { select: { users: true, classrooms: true, exams: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    schoolName: t.school?.name ?? null,
    schoolProvince: t.school?.province ?? null,
    schoolCity: t.school?.city ?? null,
    schoolDistrict: t.school?.district ?? null,
    userCount: t._count.users,
    classCount: t._count.classrooms,
    examCount: t._count.exams,
    createdAt: t.createdAt,
  }));
}

// ── Round 17: school registry with location (استان/شهر/منطقه) ──
// Admins create schools with their geographic location so students can find them
// through the cascading province→city→district selector during Telegram signup.

export interface SchoolInput {
  name?: string; // omitted on PATCH → keeps the current name (see validateLocation fallback)
  province?: string | null;
  city?: string | null;
  district?: string | null;
  status?: string;
}

function validateLocation(input: SchoolInput, requireLocation: boolean) {
  const name = (input.name ?? "").trim();
  if (name.length < 3 || name.length > 120) throw Errors.validation("نام مدرسه باید بین ۳ تا ۱۲۰ نویسه باشد.");
  const province = input.province?.trim() || null;
  const city = input.city?.trim() || null;
  const district = input.district?.trim() || null;
  if (requireLocation && (!province || !city)) {
    throw Errors.validation("استان و شهر مدرسه را انتخاب کنید (برای یافتن راحت توسط دانش‌آموزان لازم است).");
  }
  if (province && !isValidProvince(province)) throw Errors.validation("استان انتخابی معتبر نیست.");
  if (province && city && !isValidCity(province, city)) throw Errors.validation("شهر انتخابی در این استان وجود ندارد.");
  if (province && city && district && !isValidDistrict(province, city, district)) {
    throw Errors.validation("منطقهٔ انتخابی معتبر نیست.");
  }
  return { name, province, city, district };
}

function slugify(name: string): string {
  const base = name
    .replace(/[\s\u200c]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "school";
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export async function createPlatformSchool(ctx: AuthContext, input: SchoolInput) {
  const v = validateLocation(input, true);
  const tenant = await db.tenant.create({
    data: { name: v.name, slug: slugify(v.name), status: "ACTIVE" },
  });
  const school = await db.school.create({
    data: {
      tenantId: tenant.id,
      name: v.name,
      province: v.province,
      city: v.city,
      district: v.district,
      status: "ACTIVE",
    },
  });
  await audit({
    actorId: ctx.userId,
    tenantId: tenant.id,
    action: "admin_action",
    targetType: "school",
    targetId: school.id,
    metadata: { created: true, province: v.province, city: v.city, district: v.district },
  });
  return {
    id: school.id,
    tenantId: tenant.id,
    name: school.name,
    province: school.province,
    city: school.city,
    district: school.district,
    status: school.status,
  };
}

export async function updatePlatformSchool(ctx: AuthContext, schoolId: string, input: SchoolInput) {
  const school = await db.school.findUnique({ where: { id: schoolId }, include: { tenant: true } });
  if (!school) throw Errors.notFound("مدرسه");
  const v = validateLocation(
    { ...input, name: input.name ?? school.name, province: input.province ?? school.province ?? "", city: input.city ?? school.city ?? "" },
    false
  );
  const status = input.status && ["ACTIVE", "SUSPENDED"].includes(input.status) ? input.status : school.status;
  const updated = await db.school.update({
    where: { id: schoolId },
    data: { name: v.name, province: v.province, city: v.city, district: v.district, status },
  });
  if (v.name !== school.tenant.name) {
    await db.tenant.update({ where: { id: school.tenantId }, data: { name: v.name } });
  }
  await audit({
    actorId: ctx.userId,
    tenantId: school.tenantId,
    action: "admin_action",
    targetType: "school",
    targetId: schoolId,
    metadata: { updated: true },
  });
  return {
    id: updated.id,
    tenantId: updated.tenantId,
    name: updated.name,
    province: updated.province,
    city: updated.city,
    district: updated.district,
    status: updated.status,
  };
}

export async function listUsers(opts: { role?: string; q?: string; take?: number }) {
  const users = await db.user.findMany({
    where: {
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.q ? { OR: [{ fullName: { contains: opts.q } }, { email: { contains: opts.q } }] } : {}),
    },
    select: {
      id: true, fullName: true, email: true, role: true, status: true, grade: true,
      tenant: { select: { name: true } }, createdAt: true,
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 200,
  });
  return users.map((u) => ({ ...u, roleLabel: ROLE_LABELS_FA[u.role] ?? u.role }));
}

export async function listPlans() {
  const plans = await db.plan.findMany({ orderBy: { priceMonthly: "asc" } });
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.displayName,
    roleScope: p.roleScope,
    priceMonthly: p.priceMonthly,
    limits: fromJson<Record<string, number>>(p.limits, {}),
    active: p.active,
  }));
}

export async function platformUsage() {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const events = await db.usageEvent.findMany({
    where: { createdAt: { gte: since } },
    select: { feature: true, createdAt: true, success: true, estimatedCost: true },
  });
  const byFeature: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const costByDay: Record<string, number> = {};
  for (const e of events) {
    byFeature[e.feature] = (byFeature[e.feature] ?? 0) + 1;
    const day = e.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    costByDay[day] = (costByDay[day] ?? 0) + e.estimatedCost;
  }
  return {
    total14d: events.length,
    byFeature,
    byDay,
    costByDay,
    estimatedCostTotal: events.reduce((s, e) => s + e.estimatedCost, 0), // milli-toman
  };
}

export async function listAudit(limit = 100) {
  const logs = await db.auditLog.findMany({
    include: { actor: { select: { fullName: true, role: true } }, tenant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return logs.map((l) => ({
    id: l.id,
    actorName: l.actor?.fullName ?? "سیستم",
    actorRole: l.actor?.role ?? null,
    tenantName: l.tenant?.name ?? null,
    action: l.action,
    targetType: l.targetType,
    targetId: l.targetId,
    metadata: fromJson<Record<string, unknown> | null>(l.metadata, null),
    createdAt: l.createdAt,
  }));
}

export async function listFeatureFlags() {
  return db.featureFlag.findMany({ orderBy: { key: "asc" } });
}

export async function setFeatureFlag(key: string, enabled: boolean) {
  const existing = await db.featureFlag.findUnique({ where: { key } });
  if (existing) {
    const updated = await db.featureFlag.update({ where: { key }, data: { enabled } });
    await audit({ action: "feature_flag_changed", targetType: "feature_flag", targetId: key, metadata: { enabled } });
    return updated;
  }
  return db.featureFlag.create({ data: { key, enabled, scope: "global" } });
}

export async function aiProviderStatus() {
  // Aggregate recent gateway health from usage events (no secrets — spec §80)
  const since = new Date(Date.now() - 3600 * 1000);
  const [total, failed, avgLatencyEvents] = await Promise.all([
    db.usageEvent.count({ where: { createdAt: { gte: since } } }),
    db.usageEvent.count({ where: { createdAt: { gte: since }, success: false } }),
    db.usageEvent.findMany({ where: { createdAt: { gte: since } }, select: { inputUnits: true, outputUnits: true } }),
  ]);
  const units = avgLatencyEvents.reduce((s, e) => s + e.inputUnits + e.outputUnits, 0);
  return {
    provider: "zai",
    model: "glm",
    status: total === 0 ? "IDLE" : failed === 0 ? "HEALTHY" : failed / total > 0.3 ? "DEGRADED" : "HEALTHY_WITH_ERRORS",
    callsLastHour: total,
    failedLastHour: failed,
    unitsLastHour: units,
  };
}

// ── Secure Role Preview (spec §6) ──
// - Only SUPER_ADMIN may start a preview. DB role stays SUPER_ADMIN.
// - Preview tenant is validated server-side. Short-lived. Audited.
export async function startRolePreview(
  ctx: AuthContext,
  input: { effectiveRole: string; tenantId?: string | null }
): Promise<{ token: string; expiresAt: Date; effectiveRole: Role; previewTenantId: string | null }> {
  if (ctx.realRole !== ROLES.SUPER_ADMIN)
    throw Errors.forbidden("فقط مدیر کل پلتفرم می‌تواند پیش‌نمایش نقش را آغاز کند.");

  // Single active preview per admin (spec §6) — checked across ALL sessions of the user,
  // because the preview lives on a separate session token than the caller's own session.
  const activePreview = await db.session.findFirst({
    where: {
      userId: ctx.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      previewRole: { not: null },
      previewExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (activePreview)
    throw Errors.conflict("PREVIEW_ACTIVE", "یک پیش‌نمایش فعال دارید. ابتدا از آن خارج شوید.");

  const effectiveRole = input.effectiveRole as Role;
  if (!["STUDENT", "TEACHER", "SCHOOL_ADMIN"].includes(effectiveRole))
    throw Errors.validation("پیش‌نمایش فقط برای نقش‌های دانش‌آموز، معلم و مدیر مدرسه ممکن است.");

  let previewTenantId: string | null = null;
  // Spec §4.5/§6 — preview tenant is validated server-side and REQUIRED for every
  // school-scoped role (teacher/student/admin without tenant context would 403 everywhere).
  const tenantId = input.tenantId ?? null;
  if (tenantId) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Errors.notFound("سازمان");
    previewTenantId = tenant.id;
  }
  if (!previewTenantId)
    throw Errors.validation("برای پیش‌نمایش نقش، انتخاب سازمان الزامی است.");

  const { token, expiresAt } = await createSession(ctx.userId, {
    previewRole: effectiveRole,
    previewTenantId,
  });

  await audit({
    actorId: ctx.userId,
    tenantId: previewTenantId,
    action: "preview_started",
    targetType: "role_preview",
    targetId: effectiveRole,
    metadata: { effectiveRole, previewTenantId },
  });

  return { token, expiresAt, effectiveRole, previewTenantId };
}

export async function exitRolePreview(ctx: AuthContext): Promise<{ token: string; expiresAt: Date }> {
  if (!ctx.preview.active) throw Errors.conflict("NO_ACTIVE_PREVIEW", "پیش‌نمایش فعالی وجود ندارد.");
  await audit({
    actorId: ctx.userId,
    tenantId: ctx.preview.previewTenantId,
    action: "preview_ended",
    targetType: "role_preview",
    targetId: ctx.effectiveRole,
    metadata: { effectiveRole: ctx.effectiveRole },
  });
  await clearPreview(ctx.sessionTokenHash); // current session returns to SUPER_ADMIN context
  // Issue a fresh plain session for safety
  const { token, expiresAt } = await createSession(ctx.userId);
  return { token, expiresAt };
}
