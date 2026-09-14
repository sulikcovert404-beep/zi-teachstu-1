import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getSettings } from "@/server/services/settings";
import { createWebLoginUrl } from "@/server/services/telegram-signup";
import { Errors } from "@/server/core/errors";

export const dynamic = "force-dynamic";

// POST — authenticated user (typically inside the Mini App) requests a one-time
// browser link. The client opens it via WebApp.openLink() → external browser →
// the web app auto-logs-in and shows the user's own role dashboard.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const settings = await getSettings();
  if (!settings.telegramMiniAppUrl) {
    throw Errors.channelNotConfigured("آدرس مینی‌اپ (لینک HTTPS عمومی) هنوز در تنظیمات ذخیره نشده است.");
  }
  const result = await createWebLoginUrl(ctx.userId, settings.telegramMiniAppUrl);
  return ok(result);
});
