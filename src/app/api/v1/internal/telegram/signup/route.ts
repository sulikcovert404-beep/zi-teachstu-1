import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireBotSecret } from "@/server/core/internal";
import { submitTelegramSignup } from "@/server/services/telegram-signup";
import type { TelegramUser } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — bot-service registration submit (localhost, X-Bot-Secret).
// The bot collected {fullName, role, school, level/grade} through its wizard and the
// user's phone via Telegram's native contact-share button; the telegram identity is
// trusted here because the bot received it directly from Telegram's update stream.
export const POST = handler(async (req: NextRequest) => {
  requireBotSecret(req);
  const body = await req.json().catch(() => ({}));
  const u = body?.telegramUser as Record<string, unknown> | undefined;
  const telegramId = Number(u?.id);
  if (!Number.isInteger(telegramId) || telegramId <= 0 || typeof u?.firstName !== "string") {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "اطلاعات کاربر تلگرام نامعتبر است." } },
      { status: 422 }
    );
  }
  const tUser: TelegramUser = {
    id: telegramId,
    firstName: u.firstName,
    lastName: typeof u.lastName === "string" ? u.lastName : undefined,
    username: typeof u.username === "string" ? u.username : undefined,
  };
  const result = await submitTelegramSignup(tUser, {
    fullName: String(body?.fullName ?? ""),
    role: String(body?.role ?? ""),
    tenantId: String(body?.tenantId ?? ""),
    level: body?.level ? String(body.level) : null,
    grade: body?.grade ? String(body.grade) : null,
    phone: String(body?.phone ?? ""),
  });
  return ok(result, { status: 201 });
});
