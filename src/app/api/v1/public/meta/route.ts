import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { EDUCATION_LEVELS } from "@/lib/education-levels";
import { curriculumForMeta } from "@/lib/curriculum";
import { IRAN_PROVINCES } from "@/lib/iran-locations";

export const dynamic = "force-dynamic";

// GET — public reference metadata for registration flows (Mini App + telegram bot):
// course levels (پیش‌دبستانی/ابتدایی/متوسطهٔ اول/متوسطهٔ دوم/هنرستان), the full
// curriculum structure (دوره → پایه → درس, round 18) and Iran provinces → cities.
// Districts are derived client-side from the same shared data module (districtsOfCity).
// No auth — reference data only.
export const GET = handler(async (_req: NextRequest) => {
  return ok({
    levels: EDUCATION_LEVELS.map((l) => ({ code: l.code, label: l.label, emoji: l.emoji, grades: l.grades })),
    curriculum: curriculumForMeta(),
    provinces: IRAN_PROVINCES.map((p) => ({ name: p.name, cities: p.cities })),
  });
});
