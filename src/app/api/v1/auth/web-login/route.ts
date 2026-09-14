import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { consumeWebLoginToken } from "@/server/services/telegram-signup";

export const dynamic = "force-dynamic";

// POST — exchange a one-time ?tglt= token for a session («باز کردن در مرورگر»).
// Called by the web app bootstrap when the URL carries a tglt param (opened from the
// bot or the Mini App). Single-use, 3-minute TTL, hash-only storage — see the
// WebLoginToken model. Response shape matches /auth/login {token, expiresAt, user}.
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  return ok(await consumeWebLoginToken(String(body?.token ?? "")));
});
