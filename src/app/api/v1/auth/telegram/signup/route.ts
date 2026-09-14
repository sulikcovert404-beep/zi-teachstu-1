import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { verifyInitData } from "@/server/services/telegram";
import { submitTelegramSignup } from "@/server/services/telegram-signup";

export const dynamic = "force-dynamic";

// POST — Mini App registration submit (ثبت‌نام از طریق تلگرام).
// initData is HMAC-verified server-side → the telegram identity is trusted, but NONE
// of the submitted profile fields are (they are validated and stored as a PENDING
// request awaiting admin/manager/teacher approval).
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const tUser = await verifyInitData(typeof body?.initData === "string" ? body.initData : "");
  const result = await submitTelegramSignup(tUser, {
    fullName: String(body?.fullName ?? ""),
    role: String(body?.role ?? ""),
    tenantId: String(body?.tenantId ?? ""),
    level: body?.level ? String(body.level) : null,
    grade: body?.grade ? String(body.grade) : null,
    phone: String(body?.phone ?? ""),
  });
  return ok(result, { status: 201 });
});
