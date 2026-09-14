import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { aiProviderStatus } from "@/server/services/platform";

export const dynamic = "force-dynamic";

// AI provider health (spec §80) — no secrets exposed
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  return ok(await aiProviderStatus());
});
