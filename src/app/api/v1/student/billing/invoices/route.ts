import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { myInvoices } from "@/server/services/billing";

export const dynamic = "force-dynamic";

// Purchase history of the current user (newest first) — spec §41 billing records.
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return ok({ invoices: await myInvoices(ctx) });
});
