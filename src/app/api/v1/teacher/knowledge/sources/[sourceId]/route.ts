import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { deleteSource, sourceDetail } from "@/server/services/rag";

export const dynamic = "force-dynamic";

// Knowledge Base (Milestone D — spec §12): source detail + tenant-scoped delete
export const GET = handler(
  async (req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await params;
    const ctx = await requireRole(req, ROLES.TEACHER);
    await requireTenantId(ctx);
    return ok(await sourceDetail(ctx, sourceId));
  }
);

export const DELETE = handler(
  async (req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) => {
    const { sourceId } = await params;
    const ctx = await requireRole(req, ROLES.TEACHER);
    await requireTenantId(ctx);
    return ok(await deleteSource(ctx, sourceId));
  }
);
