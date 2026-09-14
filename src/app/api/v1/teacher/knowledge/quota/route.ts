import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES, FEATURES } from "@/server/core/constants";
import { checkFeature } from "@/server/services/plan";

export const dynamic = "force-dynamic";

// Current KNOWLEDGE_QA entitlement for the Source Guardian UI quota display
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  await requireTenantId(ctx);
  return ok({ quota: await checkFeature(ctx, FEATURES.KNOWLEDGE_QA) });
});
