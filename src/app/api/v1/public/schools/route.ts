import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { searchPublicSchools } from "@/server/services/telegram-signup";

export const dynamic = "force-dynamic";

// GET — public school discovery for the registration wizard (استان → شهر → منطقه → مدرسه).
// Returns ACTIVE schools with their tenant ids; the signup request references tenantId.
// No auth: school names/locations are directory data needed BEFORE any account exists.
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  return ok(
    await searchPublicSchools({
      province: sp.get("province"),
      city: sp.get("city"),
      district: sp.get("district"),
      q: sp.get("q"),
    })
  );
});
