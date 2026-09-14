import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listClassStudents } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

// Students of an owned classroom only (server-side ownership check)
export const GET = handler(
  async (req: NextRequest, { params }: { params: Promise<{ classroomId: string }> }) => {
    const { classroomId } = await params;
    const ctx = await requireRole(req, ROLES.TEACHER);
    const tenantId = await requireTenantId(ctx);
    return ok({ students: await listClassStudents(tenantId, ctx.userId, classroomId) });
  }
);
