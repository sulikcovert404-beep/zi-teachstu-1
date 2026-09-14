import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import { verifyPassword } from "@/server/auth/password";
import { createSession, revokeSession, type AuthContext } from "@/server/auth/session";
import { ROLE_DASHBOARD_PATHS, ROLE_LABELS_FA, type Role } from "@/server/core/constants";
import { audit } from "./audit";

// Spec §5 — Canonical identity. Web login here; telegram/bale resolve via ExternalIdentity.

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash))
    throw Errors.conflict("INVALID_CREDENTIALS", "ایمیل یا رمز عبور نادرست است.");
  if (user.status !== "ACTIVE")
    throw Errors.forbidden("حساب شما غیرفعال است. با پشتیبانی تماس بگیرید.");

  const { token, expiresAt } = await createSession(user.id);
  await audit({ actorId: user.id, tenantId: user.tenantId, action: "login", metadata: { channel: "web" } });

  return {
    token,
    expiresAt,
    user: publicUser(user),
    dashboard: ROLE_DASHBOARD_PATHS[user.role as Role] ?? "/mini-app/",
  };
}

export function publicUser(user: {
  id: string;
  role: string;
  status: string;
  fullName: string;
  email: string | null;
  tenantId: string | null;
  grade: string | null;
}) {
  return {
    id: user.id,
    role: user.role,
    roleLabel: ROLE_LABELS_FA[user.role] ?? user.role,
    fullName: user.fullName,
    email: user.email,
    tenantId: user.tenantId,
    grade: user.grade,
    dashboard: ROLE_DASHBOARD_PATHS[user.role as Role] ?? "/mini-app/",
  };
}

export async function logout(ctx: AuthContext) {
  await revokeSession(ctx.sessionTokenHash);
  await audit({ actorId: ctx.userId, tenantId: ctx.tenantId, action: "logout" });
  return { loggedOut: true };
}

export async function me(ctx: AuthContext) {
  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw Errors.unauthenticated();
  const tenant = user.tenantId
    ? await db.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, slug: true, status: true } })
    : null;
  return {
    user: {
      ...publicUser(user),
      // Effective role = preview role if an active preview exists (spec §6)
      effectiveRole: ctx.effectiveRole,
      effectiveRoleLabel: ROLE_LABELS_FA[ctx.effectiveRole] ?? ctx.effectiveRole,
    },
    tenant: tenant ? { id: user.tenantId, name: tenant.name, slug: tenant.slug } : null,
    preview: ctx.preview.active
      ? {
          active: true,
          realRole: ctx.realRole,
          effectiveRole: ctx.effectiveRole,
          previewTenantId: ctx.preview.previewTenantId,
          expiresAt: ctx.preview.expiresAt,
        }
      : { active: false },
  };
}

// Spec §22/§5.2 — Telegram channel adapter contract. Business logic stays channel-agnostic;
// the adapter only resolves identity → canonical user (initData is HMAC-verified in
// services/telegram.ts — the client-provided identity is NEVER trusted directly).
// Returns a discriminated union: linked accounts get a session; unknown telegram users
// get linked:false so the client can render the account-linking flow.
export type TelegramAuthResult =
  | {
      linked: true;
      token: string;
      expiresAt: Date;
      user: ReturnType<typeof publicUser>;
    }
  | {
      linked: false;
      telegramUser: { id: number; firstName: string; lastName?: string; username?: string };
    };

export async function telegramAuth(initData: string | null): Promise<TelegramAuthResult> {
  if (typeof initData !== "string" || !initData.trim()) {
    throw Errors.validation("دادهٔ ورودی تلگرام ارسال نشده است.");
  }
  const { verifyInitData } = await import("./telegram");
  const tUser = await verifyInitData(initData);

  const identity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(tUser.id) } },
    include: { user: true },
  });

  if (!identity || !identity.user || identity.user.status !== "ACTIVE") {
    return {
      linked: false,
      telegramUser: {
        id: tUser.id,
        firstName: tUser.firstName,
        lastName: tUser.lastName,
        username: tUser.username,
      },
    };
  }

  const user = identity.user;
  const { token, expiresAt } = await createSession(user.id);
  await audit({
    actorId: user.id,
    tenantId: user.tenantId,
    action: "login",
    metadata: { channel: "telegram", via: "initData" },
  });
  return { linked: true, token, expiresAt, user: publicUser(user) };
}
