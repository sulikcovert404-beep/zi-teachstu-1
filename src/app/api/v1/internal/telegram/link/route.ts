import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { redeemLinkCode, parseInitDataUser } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — the user sent a 6-digit linking code to the bot; the bot service redeems it
// here (localhost + X-Bot-Secret). Accepts either {code, telegramUser} or
// {code, initData} (bot forwards initData when available — same HMAC verification).
export const POST = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  let tUser: { id: number; firstName: string; lastName?: string; username?: string } | null = null;
  if (typeof body?.initData === "string" && body.initData) {
    // verified via the bot token inside verifyInitData — but here we only need the
    // identity; the bot service already received it from Telegram directly.
    tUser = parseInitDataUser(body.initData)?.user ?? null;
  }
  if (!tUser && body?.telegramUser && typeof body.telegramUser === "object") {
    const u = body.telegramUser as Record<string, unknown>;
    if (Number.isInteger(Number(u.id)) && typeof u.firstName === "string") {
      tUser = {
        id: Number(u.id),
        firstName: u.firstName,
        lastName: typeof u.lastName === "string" ? u.lastName : undefined,
        username: typeof u.username === "string" ? u.username : undefined,
      };
    }
  }

  if (!tUser) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "اطلاعات کاربر تلگرام ارسال نشده است." } },
      { status: 422 }
    );
  }

  return Response.json(await redeemLinkCode(code, tUser));
});
