import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { myEntitlements } from "@/server/services/plan";

export const dynamic = "force-dynamic";

// Paywall data (spec §42): usage remaining + plan + upgrade signals
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok({ entitlements: await myEntitlements(ctx) });
});
