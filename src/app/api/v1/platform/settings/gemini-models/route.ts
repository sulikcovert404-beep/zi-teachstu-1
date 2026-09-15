import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { Errors } from "@/server/core/errors";
import { listGeminiModels } from "@/server/services/telegram";
import { getSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

// POST — فهرست زندهٔ مدل‌های جمینای (SUPER_ADMIN). دو مسیر:
//   ۱) ListModels رسمی گوگل؛ ۲) اگر گوگل ListModels را برای موقعیت سرور بسته
//   باشد، «آزمون مستقیم» مدل‌ها (countTokens) — با همان کلید.
// body: { key?: string } — کلید اختیاری برای پیش‌نمایش مدل‌ها *قبل از ذخیرهٔ کلید*؛
// در نبودش از کلید ذخیره‌شدهٔ پلتفرم استفاده می‌شود. کلید هرگز در پاسخ برنمی‌گردد.
export const POST = handler(async (req: NextRequest) => {
  await requireRole(req, ROLES.SUPER_ADMIN);
  const body = await req.json().catch(() => ({}));

  let apiKey = typeof body?.key === "string" ? body.key.trim() : "";
  if (!apiKey) {
    // کلید ذخیره‌شده — مستقل از اینکه ارائه‌دهندهٔ فعال روی zai یا gemini باشد
    const s = await getSettings();
    apiKey = s.geminiApiKey;
  }
  if (!apiKey) {
    throw Errors.validation(
      "برای دریافت فهرست زندهٔ مدل‌ها، ابتدا کلید API جمینای را در کادر بالا وارد کنید (یا ذخیره‌شده باشد)."
    );
  }

  // حداکثر ۹۰ ثانیه — مسیر آزمون مستقیم ممکن است چند دستهٔ پروب داشته باشد
  const result = await Promise.race([
    listGeminiModels(apiKey),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Errors.conflict("GEMINI_MODELS_FAILED", "دریافت فهرست مدل‌ها بیش از حد طول کشید — دوباره تلاش کنید.")), 90_000)
    ),
  ]);

  return ok(result);
});
