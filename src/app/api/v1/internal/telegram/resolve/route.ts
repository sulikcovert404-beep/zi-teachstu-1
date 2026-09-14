import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { resolveTelegramSession } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — bot-service session resolution for a telegram user id (localhost only).
export const POST = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const body = await req.json().catch(() => ({}));
  const telegramId = Number(body?.telegramId);
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "شناسهٔ تلگرام نامعتبر است." } },
      { status: 422 }
    );
  }
  return Response.json(await resolveTelegramSession(telegramId));
});
