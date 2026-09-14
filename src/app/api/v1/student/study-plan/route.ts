import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createStudyPlan, getStudyPlan } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const plan = await getStudyPlan(ctx);
  return ok({ plan }); // null => real empty state (spec §53)
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(
    await createStudyPlan(ctx, {
      goal: typeof body?.goal === "string" ? body.goal : "",
      examDate: typeof body?.examDate === "string" ? body.examDate : null,
      availableHoursDay: Number(body?.availableHoursDay) || 2,
      subjects: typeof body?.subjects === "string" ? body.subjects : "",
    })
  );
});
