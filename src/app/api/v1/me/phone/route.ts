import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { updateMyPhone } from "@/server/services/identity";

export const dynamic = "force-dynamic";

// Round 22 — PUT: ثبت/به‌روزرسانی شمارهٔ موبایل حساب برای «ورود خودکار با شمارهٔ تلگرام».
export const PUT = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "شمارهٔ موبایل ارسال نشده است." } },
      { status: 422 }
    );
  }
  return Response.json(await updateMyPhone(ctx, phone));
});
