import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { updatePlatformSchool } from "@/server/services/platform";

export const dynamic = "force-dynamic";

// PATCH — update school info (name / استان / شهر / منطقه / status) — SUPER_ADMIN.
export const PATCH = handler(
  async (req: NextRequest, { params }: { params: Promise<{ schoolId: string }> }) => {
    const { schoolId } = await params;
    const ctx = await requireRole(req, ROLES.SUPER_ADMIN);
    const body = await req.json().catch(() => ({}));
    return ok(
      await updatePlatformSchool(ctx, schoolId, {
        name: body?.name !== undefined ? String(body.name ?? "") : undefined,
        province: body?.province !== undefined ? (body.province ? String(body.province) : null) : undefined,
        city: body?.city !== undefined ? (body.city ? String(body.city) : null) : undefined,
        district: body?.district !== undefined ? (body.district ? String(body.district) : null) : undefined,
        status: body?.status !== undefined ? String(body.status) : undefined,
      })
    );
  }
);
