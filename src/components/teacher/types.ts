// Shared API payload types + label maps for the Teacher dashboard.
// Shapes mirror /api/v1/teacher/* responses (server: src/server/services/teacher.ts).

export interface TeacherClass {
  id: string;
  name: string;
  grade: string;
  subject: string;
  schoolName: string;
  studentCount: number;
  assignmentsCount: number;
}

export interface Entitlement {
  feature: string;
  planCode: string;
  planName: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  allowed: boolean;
}

export interface TeacherOverview {
  classes: TeacherClass[];
  stats: {
    classCount: number;
    studentCount: number;
    assignmentsCount: number;
    examsCount: number;
    avgExamScore: number | null;
    gradedResults: number;
  };
  entitlements: Entitlement[];
}

export interface ClassStudent {
  id: string;
  fullName: string;
  email: string | null;
  grade: string | null;
  examsTaken: number;
  avgScore: number | null;
}

export interface TeacherAssignment {
  id: string;
  title: string;
  description: string | null;
  status: string;
  classroom: { id: string; name: string; subject: string | null };
  exam: { id: string; title: string; durationMinutes: number } | null;
  dueAt: string | null;
  publishAt: string | null;
  gradedAttempts: number;
}

export interface TeacherExam {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  status: string;
  questionCount: number;
  attemptCount: number;
  createdAt: string;
}

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  status: string;
  questions: QuestionDetail[];
}

export interface QuestionDetail {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string | null;
  difficulty: string;
  topic: string | null;
  points: number;
  aiGenerated: boolean;
}

export interface TeacherExamResult {
  id: string;
  student: { id: string; fullName: string };
  exam: { id: string; title: string };
  assignment: { id: string; title: string; classroom: string };
  score: number;
  maxScore: number;
  percent: number;
  submittedAt: string | null;
}

export interface GeneratedQuestion {
  type: string;
  prompt: string;
  options?: string[] | null;
  correctAnswer: string;
  explanation?: string | null;
  difficulty?: string;
  topic?: string | null;
  points?: number;
}

export interface AiUsage {
  inputUnits?: number;
  outputUnits?: number;
  estimatedCost?: number;
  provider?: string;
  model?: string;
  attempts?: number;
  latencyMs?: number;
}

export interface QuestionGenerateResponse {
  raw: string;
  questions: GeneratedQuestion[];
  parsedOk: boolean;
  usage: AiUsage | null;
}

export interface ClassResource {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  classroom: { id: string; name: string };
  createdAt: string;
}

export const ASSIGNMENT_STATUS_FA: Record<string, string> = {
  PUBLISHED: "منتشرشده",
  DRAFT: "پیش‌نویس",
  CLOSED: "بسته",
};

export const EXAM_STATUS_FA: Record<string, string> = {
  PUBLISHED: "منتشرشده",
  DRAFT: "پیش‌نویس",
  ARCHIVED: "بایگانی",
};

export const QUESTION_TYPES: string[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "FILL_IN_BLANK"];
export const DIFFICULTY_VALUES: string[] = ["EASY", "MEDIUM", "HARD"];
