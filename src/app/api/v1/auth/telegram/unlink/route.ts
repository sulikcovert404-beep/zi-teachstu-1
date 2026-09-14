import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { unlinkTelegramForUser } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — authenticated user detaches their OWN Telegram account (round 18 «خروج»).
// Used by the Mini App logout flow so the next Mini App open does NOT auto-login,
// and by the web profile (اتصال تلگرام dialog) to disconnect. Web sessions stay alive.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok(await unlinkTelegramForUser(ctx));
});
