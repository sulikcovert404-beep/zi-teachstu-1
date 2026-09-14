import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { tutorChat } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(
    await tutorChat(ctx, {
      threadId: typeof body?.threadId === "string" ? body.threadId : undefined,
      message: typeof body?.message === "string" ? body.message : "",
      title: typeof body?.title === "string" ? body.title : undefined,
    })
  );
});
