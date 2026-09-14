import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getPointsSummary } from "@/server/services/points";

export const dynamic = "force-dynamic";

// GET — points summary for the current user (web + Telegram share this endpoint).
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return Response.json(await getPointsSummary(ctx.userId));
});
