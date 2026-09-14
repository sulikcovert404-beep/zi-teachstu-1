import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { teacherAssist } from "@/server/services/ai";

export const dynamic = "force-dynamic";

// Teacher Assistant (spec §11.10) — through central AI gateway
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER, ROLES.SCHOOL_ADMIN);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  return ok(
    await teacherAssist(ctx, {
      message: typeof body?.message === "string" ? body.message : "",
      task: typeof body?.task === "string" ? body.task : undefined,
    })
  );
});
