import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { pingGemini } from "@/server/services/telegram";

export const dynamic = "force-dynamic";

// POST — live probe of the configured Gemini key/model (SUPER_ADMIN, settings UI).
export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  return Response.json(await pingGemini());
});
