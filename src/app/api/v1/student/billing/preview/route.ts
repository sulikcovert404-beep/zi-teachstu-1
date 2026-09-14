import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getUpgradePreview } from "@/server/services/billing";

export const dynamic = "force-dynamic";

// Spec §42 — paywall value preview: current plan + real usage + quota comparison.
// Works for any authenticated user (role-specific checkout gate lives in /checkout).
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok({ preview: await getUpgradePreview(ctx) });
});
