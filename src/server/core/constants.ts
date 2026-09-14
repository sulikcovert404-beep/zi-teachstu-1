// Canonical constants — single source of truth (spec §3, §7, §76)
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  TEACHER: "TEACHER",
  STUDENT: "STUDENT",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Spec §76 — Canonical role → dashboard map (single place, never duplicated)
export const ROLE_DASHBOARD_PATHS: Record<Role, string> = {
  STUDENT: "/student-dashboard/",
  TEACHER: "/teacher-dashboard/",
  SCHOOL_ADMIN: "/admin-dashboard/",
  SUPER_ADMIN: "/platform/",
};

export const ROLE_LABELS_FA: Record<string, string> = {
  SUPER_ADMIN: "مدیر کل پلتفرم",
  SCHOOL_ADMIN: "مدیر مدرسه",
  TEACHER: "معلم",
  STUDENT: "دانش‌آموز",
};

export const PLAN_CODES = {
  STUDENT_FREE: "STUDENT_FREE",
  STUDENT_PRO: "STUDENT_PRO",
  TEACHER_FREE: "TEACHER_FREE",
  SCHOOL_FREE: "SCHOOL_FREE",
} as const;

export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES];

export const FEATURES = {
  AI_TUTOR: "AI_TUTOR",
  SUMMARIZER: "SUMMARIZER",
  QUESTION_GENERATOR: "QUESTION_GENERATOR",
  TEACHER_ASSISTANT: "TEACHER_ASSISTANT",
  FLASHCARDS: "FLASHCARDS",
  STUDY_PLANNER: "STUDY_PLANNER",
  KNOWLEDGE_QA: "KNOWLEDGE_QA",
  PODCAST: "PODCAST",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export const FEATURE_LABELS_FA: Record<string, string> = {
  AI_TUTOR: "دستیار آموزشی هوشمند",
  SUMMARIZER: "خلاصه‌ساز",
  QUESTION_GENERATOR: "تولید سؤال",
  TEACHER_ASSISTANT: "دستیار معلم",
  FLASHCARDS: "فلش‌کارت",
  STUDY_PLANNER: "برنامه‌ریز مطالعه",
  KNOWLEDGE_QA: "پرسش از منابع (دانش‌نامه)",
  PODCAST: "پادکست صوتی",
};

// Default daily quotas per plan (backend-enforced feature gates — spec §8, §96)
export const DEFAULT_PLAN_LIMITS: Record<string, Record<string, number>> = {
  STUDENT_FREE: {
    AI_TUTOR: 8,
    SUMMARIZER: 3,
    QUESTION_GENERATOR: 2,
    FLASHCARDS: 2,
    STUDY_PLANNER: 1,
    KNOWLEDGE_QA: 3,
    PODCAST: 2,
  },
  STUDENT_PRO: {
    AI_TUTOR: 100,
    SUMMARIZER: 40,
    QUESTION_GENERATOR: 30,
    FLASHCARDS: 20,
    STUDY_PLANNER: 10,
    KNOWLEDGE_QA: 30,
    PODCAST: 15,
  },
  TEACHER_FREE: {
    QUESTION_GENERATOR: 5,
    TEACHER_ASSISTANT: 10,
    SUMMARIZER: 5,
    KNOWLEDGE_QA: 10,
    PODCAST: 3,
  },
  SCHOOL_FREE: {
    QUESTION_GENERATOR: 20,
    TEACHER_ASSISTANT: 40,
    SUMMARIZER: 20,
  },
};

export const SESSION_TTL_HOURS = 24;
export const PREVIEW_TTL_MINUTES = 30; // short-lived role preview (spec §6)
