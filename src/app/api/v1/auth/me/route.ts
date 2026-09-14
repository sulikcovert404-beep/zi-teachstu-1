import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { me } from "@/server/services/identity";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok(await me(ctx));
});
