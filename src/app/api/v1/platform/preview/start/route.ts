import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { startRolePreview } from "@/server/services/platform";

export const dynamic = "force-dynamic";

// Spec §6 — Secure Role Preview start. Only SUPER_ADMIN; server-validated tenant; short-lived; audited.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SUPER_ADMIN);
  const body = await req.json().catch(() => null);
  const effectiveRole = typeof body?.effectiveRole === "string" ? body.effectiveRole : "";
  if (!effectiveRole) throw Errors.validation("نقش هدف الزامی است.");
  return ok(
    await startRolePreview(ctx, {
      effectiveRole,
      tenantId: body?.tenantId ? String(body.tenantId) : null,
    })
  );
});
