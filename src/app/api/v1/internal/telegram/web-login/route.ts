import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { getSettings } from "@/server/services/settings";
import { createWebLoginUrl } from "@/server/services/telegram-signup";
import { db } from "@/lib/db";
import { Errors } from "@/server/core/errors";

export const dynamic = "force-dynamic";

// POST — bot-service one-time browser login link («🌐 ورود در مرورگر»).
// The bot asks for a single-use URL for a LINKED telegram user; the link carries a
// 3-minute, single-consumption token (?tglt=…) that the web app exchanges at
// POST /api/v1/auth/web-login — the user lands directly on their role dashboard.
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

  const settings = await getSettings();
  if (!settings.telegramMiniAppUrl) {
    throw Errors.channelNotConfigured("آدرس مینی‌اپ (لینک HTTPS عمومی) هنوز در تنظیمات ذخیره نشده است.");
  }

  const identity = await db.externalIdentity.findUnique({
    where: { provider_externalUserId: { provider: "telegram", externalUserId: String(telegramId) } },
    include: { user: true },
  });
  if (!identity || !identity.user || identity.user.status !== "ACTIVE") {
    throw Errors.forbidden("ابتدا حساب خود را متصل کنید یا ثبت‌نام کنید.");
  }

  const result = await createWebLoginUrl(identity.user.id, settings.telegramMiniAppUrl);
  return ok({ ...result, role: identity.user.role, fullName: identity.user.fullName });
});
