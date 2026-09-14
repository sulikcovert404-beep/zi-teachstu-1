// Shared types & helpers for the School Admin dashboard (spec §20)
// NOTE: types mirror the verified /api/v1/admin/* response shapes.

export const GRADE_OPTIONS = ["هفتم", "هشتم", "نهم", "دهم", "یازدهم", "دوازدهم"] as const;

export const PLAN_SCOPE_FA: Record<string, string> = {
  STUDENT: "دانش‌آموز",
  TEACHER: "معلم",
  SCHOOL: "مدرسه",
};

export function statusLabelFa(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "فعال";
    case "SUSPENDED":
      return "معلق";
    case "PAST_DUE":
      return "پرداخت عقب‌افتاده";
    case "TRIALING":
      return "دورهٔ آزمایشی";
    case "CANCELED":
      return "لغو شده";
    case "DEFAULT":
      return "پیش‌فرض";
    case "ARCHIVED":
      return "بایگانی";
    default:
      return status;
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── API response types ──

export interface OverviewResponse {
  school: { id: string; name: string; status: string };
  stats: {
    teachers: number;
    students: number;
    classes: number;
    exams: number;
    assignments: number;
    avgScore: number | null;
    resultsCount?: number;
    aiCallsToday: number;
  };
  subscription: {
    planCode: string;
    planName: string;
    status: string;
    currentPeriodEnd: string;
  } | null;
  planInfo: {
    current: {
      planCode: string;
      planName: string;
      status: string;
      currentPeriodEnd: string | null;
      limits: Record<string, number>;
    };
    catalog: Array<{
      code: string;
      name: string;
      roleScope: string;
      priceMonthly: number;
      limits: Record<string, number>;
    }>;
  };
}

export interface TeacherRow {
  id: string;
  fullName: string;
  email: string | null;
  status: string;
  createdAt: string;
  taughtClassrooms: Array<{ id: string; name: string; subject: string }>;
}

export interface StudentRow {
  id: string | null; // membership id — null for students not yet enrolled anywhere
  user: {
    id: string;
    fullName: string;
    email: string | null;
    grade: string | null;
    status: string;
  };
  classroom: { id: string; name: string; subject: string } | null;
  createdAt?: string | null;
}

export interface ClassRow {
  id: string;
  name: string;
  grade: string;
  subject: string;
  teacher: { id: string; fullName: string } | null;
  schoolName: string;
  studentCount: number;
  assignmentsCount: number;
  status: string;
}

export interface UsageResponse {
  total14d: number;
  byFeature: Record<string, number>;
  byDay: Record<string, number>;
}

export interface PerformanceRow {
  examTitle: string;
  classroom: string;
  score: number;
  maxScore: number;
  percent: number;
  createdAt: string;
}
