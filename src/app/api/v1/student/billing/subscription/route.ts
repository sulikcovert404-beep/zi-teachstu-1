import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { mySubscription } from "@/server/services/billing";

export const dynamic = "force-dynamic";

// Current personal subscription state (null when none ACTIVE) — spec §41.
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok({ subscription: await mySubscription(ctx) });
});
