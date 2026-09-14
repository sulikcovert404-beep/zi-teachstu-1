import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { studentProgress } from "@/server/services/exam";

export const dynamic = "force-dynamic";

// Spec §19 — progress computed only from real data; nulls when no data exists.
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const tenantId = await requireTenantId(ctx);
  return ok(await studentProgress(tenantId, ctx.userId));
});
