import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { askSourceGuardian } from "@/server/services/rag";

export const dynamic = "force-dynamic";

// Source Guardian Q&A (spec §11.13 / §99) — retrieval-grounded, gateway-metered
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((s: unknown) => typeof s === "string" && s.length > 0)
    : undefined;
  return ok(
    await askSourceGuardian(ctx, {
      question: typeof body?.question === "string" ? body.question : "",
      sourceIds,
    })
  );
});
