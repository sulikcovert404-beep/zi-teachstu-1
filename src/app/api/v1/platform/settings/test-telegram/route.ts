import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { getBotInfo } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — getMe probe with the stored bot token (SUPER_ADMIN, settings UI).
export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  const me = await getBotInfo();
  return Response.json({ ok: true, botUsername: me.username, botName: me.first_name, botId: me.id });
});
