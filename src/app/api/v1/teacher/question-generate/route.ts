import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { generateQuestions } from "@/server/services/ai";

export const dynamic = "force-dynamic";

// AI Question Generator — gated + metered through the central gateway (spec §11.3)
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  return ok(
    await generateQuestions(ctx, {
      content: typeof body?.content === "string" ? body.content : "",
      type: typeof body?.type === "string" ? body.type : "MULTIPLE_CHOICE",
      difficulty: typeof body?.difficulty === "string" ? body.difficulty : "MEDIUM",
      count: Number(body?.count) || 5,
    })
  );
});
