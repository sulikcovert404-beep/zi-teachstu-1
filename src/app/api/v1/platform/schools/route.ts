import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { createPlatformSchool } from "@/server/services/platform";

export const dynamic = "force-dynamic";

// POST — create a school with its location (استان/شهر/منطقه) — SUPER_ADMIN.
// Creates Tenant + School; the location powers the province→city→district selector
// students use to find their school during Telegram registration.
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SUPER_ADMIN);
  const body = await req.json().catch(() => ({}));
  return ok(
    await createPlatformSchool(ctx, {
      name: String(body?.name ?? ""),
      province: body?.province ? String(body.province) : null,
      city: body?.city ? String(body.city) : null,
      district: body?.district ? String(body.district) : null,
    }),
    { status: 201 }
  );
});
