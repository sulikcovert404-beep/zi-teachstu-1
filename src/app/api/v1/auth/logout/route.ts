import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { logout } from "@/server/services/identity";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const result = await logout(ctx);
  const res = ok(result);
  res.cookies.delete("aep_session");
  return res;
});
