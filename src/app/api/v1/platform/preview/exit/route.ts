import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireAuth } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { exitRolePreview } from "@/server/services/platform";

export const dynamic = "force-dynamic";

// Spec §6 — exit preview restores plain SUPER_ADMIN context.
// NOTE: must check the REAL role (not effective) — during an active preview the
// effective role is the previewed one, so requireRole(SUPER_ADMIN) would always 403.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  if (ctx.realRole !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  return ok(await exitRolePreview(ctx));
});
