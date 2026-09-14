import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { listTelegramSignups } from "@/server/services/telegram-signup";

export const dynamic = "force-dynamic";

// GET — pending Telegram registration requests (round 17).
// SUPER_ADMIN sees all; SCHOOL_ADMIN and TEACHER see their own school's requests
// (teachers may approve student signups — manager decision); students get nothing.
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok(await listTelegramSignups(ctx));
});
