import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { requireRole, requireTenantId } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createResource, listResources } from "@/server/services/teacher";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const url = new URL(req.url);
  const classroomId = url.searchParams.get("classroomId") ?? undefined;
  return ok({ resources: await listResources(tenantId, ctx.userId, classroomId) });
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.TEACHER);
  const tenantId = await requireTenantId(ctx);
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length < 2) throw Errors.validation("عنوان منبع الزامی است.");
  return ok(
    await createResource(tenantId, ctx.userId, {
      classroomId: String(body?.classroomId ?? ""),
      title,
      description: typeof body?.description === "string" ? body.description.slice(0, 1000) : undefined,
      url: typeof body?.url === "string" && body.url.trim() ? body.url.trim() : undefined,
    })
  );
});
