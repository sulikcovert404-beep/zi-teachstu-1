import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { linkWithInitData } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — direct linking: an already web-authenticated user opens the Mini App,
// the client sends Telegram initData, and the current account gets linked
// (idempotent; refuses when the telegram identity belongs to another user).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  if (typeof body?.initData !== "string" || !body.initData.trim()) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "دادهٔ تلگرام ارسال نشده است." } },
      { status: 422 }
    );
  }
  return Response.json(await linkWithInitData(ctx, body.initData));
});
