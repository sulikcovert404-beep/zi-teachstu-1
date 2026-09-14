import crypto from "crypto";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { ROLES, ROLE_LABELS_FA } from "@/server/core/constants";
import { audit } from "./audit";
import { publicUser } from "./identity";
import { isValidGradeForLevel, isLevelCode, levelLabel } from "@/lib/education-levels";
import type { AuthContext } from "@/server/auth/session";
import type { TelegramUser } from "./telegram";

// Round 17 — Telegram registration with approval (ثبت‌نام از طریق تلگرام).
// Flow: user (bot or Mini App) submits {fullName, role, school, level/grade, phone}
// → TelegramSignupRequest(PENDING) → approval by SUPER_ADMIN / SCHOOL_ADMIN / TEACHER
// → canonical User (passwordless) + ExternalIdentity(telegram) + audit.
// The account is then usable directly in the bot & Mini App; web access works via
// one-time WebLoginToken links («باز کردن در مرورگر»).

const PHONE_RE = /^09\d{9}$/;

export function normalizePhone(raw: string): string {
  // Accept 09xxxxxxxxx, +989xxxxxxxxx, 989xxxxxxxxx, 9xxxxxxxxx → 09xxxxxxxxx
  const digits = (raw ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "");
  let n = digits;
  if (n.startsWith("0098")) n = n.slice(4);
  else if (n.startsWith("98")) n = n.slice(2);
  if (n.startsWith("9") && n.length === 10) n = "0" + n;
  if (!PHONE_RE.test(n)) {
    throw Errors.validation("شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).");
  }
  return n;
}

export interface SignupSubmitInput {
  fullName: string;
  role: string; // STUDENT | TEACHER
  tenantId: string; // selected school tenant
  level?: string | null;
  grade?: string | null;
  phone: string;
}

function validateSignupInput(input: SignupSubmitInput) {
  const fullName = (input.fullName ?? "").trim();
  if (fullName.length < 3 || fullName.length > 80) {
    throw Errors.validation("نام و نام خانوادگی باید بین ۳ تا ۸۰ نویسه باشد.");
  }
  if (input.role !== ROLES.STUDENT && input.role !== ROLES.TEACHER) {
    throw Errors.validation("نقش ثبت‌نام باید دانش‌آموز یا معلم باشد.");
  }
  if (input.level !== undefined && input.level !== null && input.level !== "" && !isLevelCode(input.level)) {
    throw Errors.validation("دورهٔ تحصیلی انتخابی معتبر نیست.");
  }
  if (input.level && !isValidGradeForLevel(input.level, input.grade ?? null)) {
    throw Errors.validation("پایهٔ تحصیلی با دورهٔ انتخابی هم‌خوانی ندارد.");
  }
  const phone = normalizePhone(input.phone);
  return { fullName, phone, level: input.level || null, grade: input.grade?.trim() || null };
}

// Submit (idempotent per telegram account): a PENDING request is replaced, but an
// already-APPROVED telegram id is rejected (the account already exists).
export async function submitTelegramSignup(tUser: TelegramUser, input: SignupSubmitInput) {
  // already linked?
  const identity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(tUser.id) } },
  });
  if (identity) {
    throw Errors.conflict("TELEGRAM_ALREADY_LINKED", "این حساب تلگرام قبلاً به حسابی متصل شده است.");
  }

  const v = validateSignupInput(input);

  // selected school must exist and be ACTIVE
  const tenant = await db.tenant.findUnique({
    where: { id: input.tenantId },
    include: { school: true },
  });
  if (!tenant || !tenant.school || tenant.status !== "ACTIVE") {
    throw Errors.validation("مدرسهٔ انتخابی معتبر نیست.");
  }

  // phone must not belong to another user
  const phoneOwner = await db.user.findFirst({ where: { phone: v.phone }, select: { id: true } });
  if (phoneOwner) {
    throw Errors.conflict("PHONE_TAKEN", "این شمارهٔ موبایل قبلاً برای حساب دیگری ثبت شده است.");
  }

  const existing = await db.telegramSignupRequest.findUnique({ where: { telegramId: String(tUser.id) } });
  const data = {
    telegramId: String(tUser.id),
    telegramUsername: tUser.username ?? null,
    phone: v.phone,
    fullName: v.fullName,
    role: input.role,
    level: v.level,
    grade: v.grade,
    tenantId: tenant.id,
    status: "PENDING",
    rejectReason: null,
    reviewedById: null,
  };

  const row = existing
    ? await db.telegramSignupRequest.update({ where: { id: existing.id }, data })
    : await db.telegramSignupRequest.create({ data });

  await audit({
    actorId: null,
    tenantId: tenant.id,
    action: "admin_action",
    targetType: "telegram_signup",
    targetId: row.id,
    metadata: { submitted: true, role: input.role, via: "telegram" },
  });

  return signupRequestSummary(row, tenant);
}

export interface SignupStatusResult {
  status: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  request: {
    id: string;
    fullName: string;
    role: string;
    roleLabel: string;
    levelLabel: string | null;
    grade: string | null;
    phone: string;
    schoolName: string | null;
    schoolProvince: string | null;
    schoolCity: string | null;
    status: string;
    rejectReason: string | null;
    createdAt: Date;
  } | null;
  linked: boolean;
}

export async function telegramSignupStatus(telegramId: number): Promise<SignupStatusResult> {
  const identity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(telegramId) } },
  });
  if (identity) return { status: "APPROVED", request: null, linked: true };

  const row = await db.telegramSignupRequest.findUnique({
    where: { telegramId: String(telegramId) },
    include: { tenant: { include: { school: true } } },
  });
  if (!row) return { status: "NONE", request: null, linked: false };
  return {
    status: row.status as SignupStatusResult["status"],
    request: requestForClient(row),
    linked: false,
  };
}

function requestForClient(row: { id: string; fullName: string; role: string; level: string | null; grade: string | null; phone: string; status: string; rejectReason: string | null; createdAt: Date; tenant?: { name: string; school?: { province: string | null; city: string | null } | null } | null }) {
  return {
    id: row.id,
    fullName: row.fullName,
    role: row.role,
    roleLabel: ROLE_LABELS_FA[row.role] ?? row.role,
    levelLabel: levelLabel(row.level),
    grade: row.grade,
    phone: row.phone,
    schoolName: row.tenant?.name ?? null,
    schoolProvince: row.tenant?.school?.province ?? null,
    schoolCity: row.tenant?.school?.city ?? null,
    status: row.status,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
  };
}

function signupRequestSummary(row: { id: string; status: string; fullName: string }, tenant: { name: string }) {
  return {
    id: row.id,
    status: row.status,
    fullName: row.fullName,
    schoolName: tenant.name,
    message: "درخواست ثبت‌نام شما ثبت شد و پس از تأیید مدیر مدرسه فعال می‌شود.",
  };
}

// ── Reviewer side ──

export async function listTelegramSignups(ctx: AuthContext) {
  const where =
    ctx.effectiveRole === ROLES.SUPER_ADMIN
      ? {}
      : ctx.effectiveRole === ROLES.SCHOOL_ADMIN || ctx.effectiveRole === ROLES.TEACHER
        ? { tenantId: ctx.tenantId ?? "__none__" }
        : { tenantId: "__none__" }; // students see nothing

  const rows = await db.telegramSignupRequest.findMany({
    where,
    include: { tenant: { include: { school: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return {
    scope: ctx.effectiveRole,
    counts: {
      PENDING: rows.filter((r) => r.status === "PENDING").length,
      APPROVED: rows.filter((r) => r.status === "APPROVED").length,
      REJECTED: rows.filter((r) => r.status === "REJECTED").length,
    },
    requests: rows.map((r) => ({
      ...requestForClient(r),
      telegramUsername: r.telegramUsername,
      reviewed: r.status !== "PENDING",
    })),
  };
}

function assertReviewerScope(ctx: AuthContext, row: { tenantId: string }) {
  if (ctx.effectiveRole === ROLES.SUPER_ADMIN) return;
  if (ctx.effectiveRole === ROLES.SCHOOL_ADMIN || ctx.effectiveRole === ROLES.TEACHER) {
    if (ctx.tenantId !== row.tenantId) {
      throw Errors.forbidden("این درخواست مربوط به مدرسهٔ شما نیست.");
    }
    return;
  }
  throw Errors.forbidden();
}

export async function reviewTelegramSignup(
  ctx: AuthContext,
  requestId: string,
  action: "APPROVE" | "REJECT",
  reason?: string
) {
  const row = await db.telegramSignupRequest.findUnique({
    where: { id: requestId },
    include: { tenant: { include: { school: true } } },
  });
  if (!row) throw Errors.notFound("درخواست ثبت‌نام");
  if (row.status !== "PENDING") {
    throw Errors.conflict("SIGNUP_ALREADY_REVIEWED", "این درخواست قبلاً بررسی شده است.");
  }
  assertReviewerScope(ctx, row);

  if (action === "REJECT") {
    const updated = await db.telegramSignupRequest.update({
      where: { id: row.id },
      data: { status: "REJECTED", rejectReason: reason?.trim().slice(0, 200) || "بدون دلیل ذکر شده", reviewedById: ctx.userId },
    });
    await audit({
      actorId: ctx.userId,
      tenantId: row.tenantId,
      action: "admin_action",
      targetType: "telegram_signup",
      targetId: row.id,
      metadata: { reviewed: "REJECTED" },
    });
    return { status: "REJECTED", id: updated.id };
  }

  // APPROVE — create the canonical user + link the telegram identity atomically.
  const existingIdentity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: row.telegramId } },
  });
  if (existingIdentity) {
    throw Errors.conflict("TELEGRAM_ALREADY_LINKED", "این حساب تلگرام قبلاً متصل شده است.");
  }

  const user = await db.user.create({
    data: {
      role: row.role,
      status: "ACTIVE",
      fullName: row.fullName,
      email: null, // passwordless telegram-native account
      passwordHash: null,
      phone: row.phone,
      level: row.level,
      grade: row.grade,
      tenantId: row.tenantId,
    },
  });

  await db.externalIdentity.create({
    data: {
      userId: user.id,
      provider: "telegram",
      externalUserId: row.telegramId,
      metadata: JSON.stringify({
        username: row.telegramUsername ?? null,
        via: "telegram_signup",
        approvedBy: ctx.userId,
      }),
    },
  });

  await db.telegramSignupRequest.update({
    where: { id: row.id },
    data: { status: "APPROVED", rejectReason: null, reviewedById: ctx.userId },
  });

  await audit({
    actorId: ctx.userId,
    tenantId: row.tenantId,
    action: "admin_action",
    targetType: "user",
    targetId: user.id,
    metadata: { created: true, role: user.role, via: "telegram_signup" },
  });

  return {
    status: "APPROVED",
    id: row.id,
    user: { id: user.id, fullName: user.fullName, role: user.role, roleLabel: ROLE_LABELS_FA[user.role] ?? user.role },
    schoolName: row.tenant.name,
  };
}

// ── Public school discovery (استان → شهر → منطقه → مدرسه) ──

export async function searchPublicSchools(params: {
  province?: string | null;
  city?: string | null;
  district?: string | null;
  q?: string | null;
}) {
  const where: Record<string, unknown> = { status: "ACTIVE" };
  if (params.province) where.province = params.province;
  if (params.city) where.city = params.city;
  if (params.district) where.district = params.district;
  if (params.q) where.name = { contains: params.q };

  const schools = await db.school.findMany({
    where,
    include: { tenant: { select: { id: true, name: true, status: true } } },
    orderBy: [{ province: "asc" }, { city: "asc" }, { name: "asc" }],
    take: 60,
  });

  return {
    schools: schools
      .filter((s) => s.tenant.status === "ACTIVE")
      .map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        name: s.name,
        province: s.province,
        city: s.city,
        district: s.district,
      })),
  };
}

// ── One-time web login tokens («باز کردن در مرورگر») ──

const WEB_LOGIN_TTL_MS = 3 * 60_000; // ۳ دقیقه — کوتاه و یک‌بارمصرف

async function mintWebLoginToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.webLoginToken.create({
    data: {
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      userId,
      expiresAt: new Date(Date.now() + WEB_LOGIN_TTL_MS),
    },
  });
  return token;
}

function miniAppUrlJoin(baseAppUrl: string, token: string): string {
  const base = baseAppUrl.replace(/\/+$/, "");
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}tglt=${token}`;
}

export async function createWebLoginUrl(userId: string, baseAppUrl: string): Promise<{ url: string; expiresInSec: number }> {
  const token = await mintWebLoginToken(userId);
  return { url: miniAppUrlJoin(baseAppUrl, token), expiresInSec: Math.floor(WEB_LOGIN_TTL_MS / 1000) };
}

export async function consumeWebLoginToken(token: string) {
  const clean = (token ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(clean)) throw Errors.validation("لینک ورود نامعتبر است.");
  const tokenHash = crypto.createHash("sha256").update(clean).digest("hex");
  const row = await db.webLoginToken.findUnique({ where: { tokenHash } });
  if (!row || row.consumedAt || row.expiresAt < new Date()) {
    throw Errors.validation("لینک ورود منقضی یا قبلاً استفاده شده است. از بات دوباره لینک بگیرید.");
  }
  await db.webLoginToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  const user = await db.user.findUnique({ where: { id: row.userId } });
  if (!user || user.status !== "ACTIVE") throw Errors.forbidden("حساب کاربری فعال نیست.");

  const { createSession } = await import("@/server/auth/session");
  const { token: sessionToken, expiresAt } = await createSession(user.id);
  await audit({
    actorId: user.id,
    tenantId: user.tenantId,
    action: "login",
    metadata: { channel: "web", via: "web_login_token" },
  });
  return { token: sessionToken, expiresAt, user: publicUser(user) };
}
