import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { checkoutStudentPro } from "@/server/services/billing";

export const dynamic = "force-dynamic";

// STUDENT-only purchase (spec §41): mock gateway → PAID invoice + ACTIVE personal
// STUDENT_PRO subscription (created or extended — never resets remaining time).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  const body = await req.json().catch(() => null);
  return ok(await checkoutStudentPro(ctx, body));
});
