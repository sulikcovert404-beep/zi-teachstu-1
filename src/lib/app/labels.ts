// Client-safe labels (mirror of server constants — UI display only, authority is server-side)
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

export const PLAN_MARKETING_LABELS_FA: Record<string, string> = {
  STUDENT_FREE: "رایگان",
  STUDENT_PRO: "دانش‌آموز پرو",
  TEACHER_FREE: "رایگان معلم",
  SCHOOL_FREE: "مدرسه (رایگان)",
};

export const INVOICE_STATUS_LABELS_FA: Record<string, string> = {
  PENDING: "در انتظار پرداخت",
  PAID: "پرداخت‌شده",
  FAILED: "ناموفق",
  REFUNDED: "بازپرداخت‌شده",
};

export const ROLE_LABELS_FA: Record<string, string> = {
  SUPER_ADMIN: "مدیر کل پلتفرم",
  SCHOOL_ADMIN: "مدیر مدرسه",
  TEACHER: "معلم",
  STUDENT: "دانش‌آموز",
};

export const QUESTION_TYPE_LABELS_FA: Record<string, string> = {
  MULTIPLE_CHOICE: "چهارگزینه‌ای",
  TRUE_FALSE: "صحیح/غلط",
  SHORT_ANSWER: "تشریحی",
  FILL_IN_BLANK: "جای خالی",
};

export const DIFFICULTY_LABELS_FA: Record<string, string> = {
  EASY: "آسان",
  MEDIUM: "متوسط",
  HARD: "سخت",
};

export const AUDIT_ACTION_LABELS_FA: Record<string, string> = {
  login: "ورود",
  logout: "خروج",
  role_changed: "تغییر نقش",
  subscription_changed: "تغییر اشتراک",
  preview_started: "شروع پیش‌نمایش نقش",
  preview_ended: "پایان پیش‌نمایش نقش",
  exam_started: "شروع آزمون",
  exam_submitted: "تحویل آزمون",
  assignment_created: "ایجاد تکلیف",
  exam_created: "ایجاد آزمون",
  tenant_changed: "تغییر سازمان",
  admin_action: "اقدام مدیریتی",
  feature_flag_changed: "تغییر فلگ قابلیت",
  question_generated: "تولید سؤال",
  knowledge_qa: "پرسش از منابع (دانش‌نامه)",
  knowledge_source_created: "ثبت منبع دانش‌نامه",
  knowledge_source_deleted: "حذف منبع دانش‌نامه",
  podcast_generated: "تولید پادکست صوتی",
};
