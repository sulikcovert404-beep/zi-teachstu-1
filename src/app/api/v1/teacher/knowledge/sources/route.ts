import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createSource, listSources } from "@/server/services/rag";

export const dynamic = "force-dynamic";

// Knowledge Base (Milestone D — spec §12): source list + ingestion
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  await requireTenantId(ctx);
  return ok({ sources: await listSources(ctx) });
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  return ok(
    await createSource(ctx, {
      title: body?.title,
      description: body?.description,
      subject: body?.subject,
      classroomId: body?.classroomId,
      content: body?.content,
    })
  );
});
