import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { createLinkCode } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — authenticated user (any role) requests a 6-digit linking code to send
// to the Telegram bot (spec §22 linking flow; code TTL = 10 minutes).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return Response.json(await createLinkCode(ctx));
});
