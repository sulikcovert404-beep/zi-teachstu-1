import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { getSettingsForClient, updateSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

// Round 16 — Platform settings (SUPER_ADMIN only). Secrets are masked in GET;
// PUT accepts partial updates and only replaces a secret when a new value is provided.
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  return Response.json(await getSettingsForClient());
});

export const PUT = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.SUPER_ADMIN);
  const body = await req.json().catch(() => ({}));
  const updated = await updateSettings(ctx, body ?? {});
  return Response.json(updated);
});
