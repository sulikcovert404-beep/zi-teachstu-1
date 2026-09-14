import { NextRequest } from "next/server";
import { handler, fail } from "@/server/core/respond";
import { telegramAuth } from "@/server/services/identity";

export const dynamic = "force-dynamic";

// Spec §22/§23 — Telegram channel adapter endpoint (Mini App initData login).
// initData is HMAC-verified server-side with the stored bot token; the client-provided
// identity is never trusted. Linked → session token; unknown → linked:false so the
// client renders the account-linking flow. No client-provided role/tenant is trusted here.
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await telegramAuth(typeof body?.initData === "string" ? body.initData : null);
    return Response.json(result);
  } catch (e) {
    return fail(e);
  }
});
