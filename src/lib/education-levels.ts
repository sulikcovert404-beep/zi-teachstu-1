// Round 17 — Iranian formal education course levels (دوره‌های تحصیلی).
// Single source of truth shared by web, Mini App and the telegram-bot service
// (exposed publicly via GET /api/v1/public/meta).
// Reference structure of public education in Iran:
//   پیش‌دبستانی → ابتدایی (پایهٔ اول تا ششم) → متوسطهٔ اول (هفتم تا نهم)
//   → متوسطهٔ دوم (دهم تا دوازدهم) یا هنرستان (فنی‌حرفه‌ای/کاردانش، دهم تا دوازدهم).

export interface EducationLevel {
  code: string;
  label: string;
  emoji: string;
  grades: string[]; // empty for پیش‌دبستانی
}

export const EDUCATION_LEVELS: EducationLevel[] = [
  { code: "PRE_PRIMARY", label: "پیش‌دبستانی", emoji: "🧸", grades: [] },
  { code: "PRIMARY", label: "ابتدایی", emoji: "🎒", grades: ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم"] },
  { code: "MIDDLE_1", label: "متوسطهٔ اول", emoji: "📗", grades: ["هفتم", "هشتم", "نهم"] },
  { code: "MIDDLE_2", label: "متوسطهٔ دوم", emoji: "📘", grades: ["دهم", "یازدهم", "دوازدهم"] },
  { code: "TECHNICAL", label: "هنرستان", emoji: "🔧", grades: ["دهم", "یازدهم", "دوازدهم"] },
];

export const LEVEL_LABELS_FA: Record<string, string> = Object.fromEntries(
  EDUCATION_LEVELS.map((l) => [l.code, l.label])
);

export function levelLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LEVEL_LABELS_FA[code] ?? null;
}

export function isLevelCode(v: unknown): v is string {
  return typeof v === "string" && EDUCATION_LEVELS.some((l) => l.code === v);
}

export function gradesForLevel(code: string | null | undefined): string[] {
  const lvl = EDUCATION_LEVELS.find((l) => l.code === code);
  return lvl?.grades ?? [];
}

export function isValidGradeForLevel(level: string | null | undefined, grade: string | null | undefined): boolean {
  if (!grade) return true; // grade optional
  const grades = gradesForLevel(level);
  return grades.length === 0 || grades.includes(grade);
}

// Label convention: ابتدایی uses «کلاس سوم» while other levels use «پایهٔ هفتم» —
// matches how Iranian teachers/admins actually talk about each level (round 19).
export function gradeLabelFa(level: string | null | undefined, grade: string): string {
  return level === "PRIMARY" ? `کلاس ${grade}` : `پایهٔ ${grade}`;
}
