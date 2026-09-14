import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";
import {
  ROLES,
  SESSION_TTL_HOURS,
  PREVIEW_TTL_MINUTES,
  type Role,
} from "@/server/core/constants";
import { generateSessionToken, hashToken } from "./password";

// Spec §5.3 / §6 — server-issued sessions; the session record itself is the authority.
// Secure Role Preview lives ONLY on the session record: real DB role stays SUPER_ADMIN.

export interface AuthContext {
  userId: string;
  realRole: Role; // persistent DB role
  effectiveRole: Role; // == realRole, except during an active, unexpired preview
  tenantId: string | null; // server-resolved tenant (never from client input — spec §4)
  preview: {
    active: boolean;
    previewTenantId: string | null;
    expiresAt: Date | null;
  };
  sessionTokenHash: string;
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  // Fallback: HttpOnly cookie (set for browser navigations)
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)aep_session=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const token = extractToken(req);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;

  const realRole = session.user.role as Role;
  // Preview is only honored for SUPER_ADMIN with an unexpired preview window
  const previewActive =
    realRole === ROLES.SUPER_ADMIN &&
    !!session.previewRole &&
    !!session.previewExpiresAt &&
    session.previewExpiresAt > new Date();

  return {
    userId: session.user.id,
    realRole,
    effectiveRole: previewActive ? (session.previewRole as Role) : realRole,
    tenantId: previewActive ? session.previewTenantId ?? null : session.user.tenantId,
    preview: {
      active: previewActive,
      previewTenantId: session.previewTenantId,
      expiresAt: session.previewExpiresAt,
    },
    sessionTokenHash: session.tokenHash,
  };
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const ctx = await resolveAuth(req);
  if (!ctx) throw Errors.unauthenticated();
  return ctx;
}

export async function requireRole(req: Request, ...allowed: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth(req);
  // Effective role governs the surface the user currently operates (spec §6)
  if (!allowed.includes(ctx.effectiveRole)) throw Errors.forbidden();
  return ctx;
}

// Tenant scope: server-side membership resolution (spec §4 — tenant never authoritative from client)
export async function requireTenantId(ctx: AuthContext): Promise<string> {
  if (!ctx.tenantId) {
    throw Errors.forbidden("زمینه سازمانی شما معتبر نیست.");
  }
  return ctx.tenantId;
}

export async function createSession(
  userId: string,
  opts: { previewRole?: Role; previewTenantId?: string | null } = {}
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      previewRole: opts.previewRole ?? null,
      previewTenantId: opts.previewTenantId ?? null,
      previewExpiresAt: opts.previewRole
        ? new Date(Date.now() + PREVIEW_TTL_MINUTES * 60 * 1000)
        : null,
    },
  });
  return { token, expiresAt };
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await db.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
}

export async function clearPreview(tokenHash: string): Promise<void> {
  await db.session.update({
    where: { tokenHash },
    data: { previewRole: null, previewTenantId: null, previewExpiresAt: null },
  });
}
