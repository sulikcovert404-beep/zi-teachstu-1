import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { verifyInitData } from "@/server/services/telegram";
import { telegramSignupStatus } from "@/server/services/telegram-signup";

export const dynamic = "force-dynamic";

// POST — Mini App registration status (initData-verified). Response states:
//   NONE     → render the registration wizard
//   PENDING  → render the waiting-for-approval screen
//   APPROVED → linked:true (the account exists — re-auth via /auth/telegram)
//   REJECTED → show reason + retry CTA
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const tUser = await verifyInitData(typeof body?.initData === "string" ? body.initData : "");
  return ok(await telegramSignupStatus(tUser.id));
});
