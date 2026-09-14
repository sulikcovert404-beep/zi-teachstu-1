import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { unlinkTelegramById } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — the user pressed «خروج / قطع اتصال» in the bot; the bot service calls this
// (localhost + X-Bot-Secret) with the telegram id. The ExternalIdentity is deleted,
// so the bot session can no longer be resolved and the Mini App stops auto-login.
export const POST = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const body = await req.json().catch(() => ({}));
  const telegramId = Number(body?.telegramId);
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "شناسهٔ تلگرام ارسال نشده است." } },
      { status: 422 }
    );
  }
  return Response.json(await unlinkTelegramById(telegramId));
});
