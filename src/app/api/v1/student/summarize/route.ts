import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { summarize } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(
    await summarize(ctx, {
      text: typeof body?.text === "string" ? body.text : "",
      mode: typeof body?.mode === "string" ? body.mode : "SHORT",
    })
  );
});
