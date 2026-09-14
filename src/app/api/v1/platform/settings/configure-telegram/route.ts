import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { autoConfigureBot } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — one-click bot setup: menu button → Mini App URL, Persian commands,
// description/about text, cached bot username (SUPER_ADMIN, settings UI).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SUPER_ADMIN);
  return Response.json(await autoConfigureBot(ctx));
});
