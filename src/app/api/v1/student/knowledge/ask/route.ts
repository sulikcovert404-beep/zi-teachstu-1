import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { askStudentSourceGuardian } from "@/server/services/rag";

export const dynamic = "force-dynamic";

// Student Source Guardian Q&A (spec §11.13 / §99) — retrieval is scoped to the
// student's allowed sources BEFORE any retrieval runs; quota/paywall enforced
// server-side via requireFeature inside the service.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((s: unknown) => typeof s === "string" && s.length > 0)
    : undefined;
  return ok(
    await askStudentSourceGuardian(ctx, {
      question: typeof body?.question === "string" ? body.question : "",
      sourceIds,
    })
  );
});
