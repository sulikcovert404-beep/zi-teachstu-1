import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { generateFlashcards } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(
    await generateFlashcards(ctx, {
      text: typeof body?.text === "string" ? body.text : "",
      title: typeof body?.title === "string" ? body.title : undefined,
      save: body?.save !== false,
    })
  );
});
