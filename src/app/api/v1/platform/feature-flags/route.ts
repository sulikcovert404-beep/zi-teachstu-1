import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listFeatureFlags, setFeatureFlag } from "@/server/services/platform";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  return ok({ flags: await listFeatureFlags() });
});

export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  const body = await req.json().catch(() => null);
  if (!body?.key || typeof body.key !== "string") throw Errors.validation("کلید فلگ الزامی است.");
  return ok({ flag: await setFeatureFlag(body.key, !!body.enabled) });
});
