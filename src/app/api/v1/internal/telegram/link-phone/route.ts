import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { linkTelegramByPhone } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// Round 22 — POST (bot secret): the user shared their phone number with the bot
// (KeyboardButton request_contact); if an ACTIVE platform account holds the same
// normalized phone, the telegram identity is linked to it and a bot session token
// is issued — no 6-digit code needed.
export const POST = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const body = await req.json().catch(() => ({}));
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  let tUser: { id: number; firstName: string; lastName?: string; username?: string } | null = null;
  if (body?.telegramUser && typeof body.telegramUser === "object") {
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

  if (!phone || !tUser) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "شمارهٔ موبایل یا اطلاعات کاربر تلگرام ارسال نشده است." } },
      { status: 422 }
    );
  }

  return Response.json(await linkTelegramByPhone(phone, tUser));
});
