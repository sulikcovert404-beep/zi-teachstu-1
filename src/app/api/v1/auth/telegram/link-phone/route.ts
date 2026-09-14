import { NextRequest } from "next/server";
import { handler, fail } from "@/server/core/respond";
import { verifyInitData, linkTelegramByPhone } from "@/server/services/telegram";
import { publicUser } from "@/server/services/identity";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Round 22 — POST (Mini App, no prior web session): the unlinked Mini App user
// taps «ورود با شمارهٔ تلفن» → WebApp.requestContact() shares the phone → the
// client posts {initData, phone}. initData is HMAC-verified; the phone is
// normalized and matched against ACTIVE accounts. On match: link + session token
// (same response shape as /api/v1/auth/telegram so the client can adopt it).
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body?.initData !== "string" || !body.initData.trim()) {
      throw Object.assign(new Error("دادهٔ ورودی تلگرام ارسال نشده است."), {
        code: "VALIDATION_ERROR",
        status: 422,
      });
    }
    if (typeof body?.phone !== "string" || !body.phone.trim()) {
      throw Object.assign(new Error("شمارهٔ موبایل ارسال نشده است."), {
        code: "VALIDATION_ERROR",
        status: 422,
      });
    }
    const tUser = await verifyInitData(body.initData);
    const result = await linkTelegramByPhone(body.phone.trim(), tUser);
    const user = await db.user.findUnique({ where: { id: result.user.id } });
    if (!user) throw Object.assign(new Error("حساب کاربری یافت نشد."), { code: "NOT_FOUND", status: 404 });
    return Response.json({ linked: true, token: result.token, user: publicUser(user) });
  } catch (e: any) {
    // NOT_FOUND = «حسابی با این شماره پیدا نشد» → 200 with linked:false so the
    // Mini App can show the Persian hint instead of a hard error.
    if (e?.code === "NOT_FOUND") {
      return Response.json({ linked: false, reason: "PHONE_NOT_FOUND", message: e.message });
    }
    return fail(e);
  }
});
