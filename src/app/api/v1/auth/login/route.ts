import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { Errors } from "@/server/core/errors";
import { login } from "@/server/services/identity";
import { ensureDemoData } from "@/server/services/demo-ensure";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw Errors.validation("ایمیل یا رمز عبور معتبر نیست.");

  // Self-heal: اگر دیتابیس خالی شده باشد (مثلاً بعد از db push)، حساب‌های
  // نمونه پیش از احراز هویت بازسازی می‌شوند تا ورود وب هرگز شکست نخورد.
  await ensureDemoData();

  const result = await login(email, password);

  const res = ok({ token: result.token, expiresAt: result.expiresAt, user: result.user, dashboard: result.dashboard });
  // HttpOnly cookie for same-origin browser flows; token also usable as Bearer
  res.cookies.set("aep_session", result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 3600,
  });
  return res;
});
