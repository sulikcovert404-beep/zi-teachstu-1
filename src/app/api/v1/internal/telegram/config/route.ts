import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

// GET — bot-service bootstrap: the mini-service polls this (localhost + X-Bot-Secret)
// for the bot token, Mini App URL, and cached bot username. Enabled=false when no token.
export const GET = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const s = await getSettings();
  return Response.json({
    enabled: !!s.telegramBotToken,
    token: s.telegramBotToken || null,
    miniAppUrl: s.telegramMiniAppUrl || null,
    botUsername: s.telegramBotUsername || null,
  });
});
