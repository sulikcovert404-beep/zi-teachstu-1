import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listUsers } from "@/server/services/platform";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  const url = new URL(req.url);
  const role = url.searchParams.get("role") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  return ok({ users: await listUsers({ role, q }) });
});
