// Client-safe API types for the platform (SUPER_ADMIN) surface — mirrors server services
// (src/server/services/platform.ts). Display-only; authority stays server-side.

export interface PlatformOverview {
  tenants: number;
  users: number;
  schools: number;
  classes: number;
  exams: number;
  assignments: number;
  attempts: number;
  activeSessions: number;
  aiCallsToday: number;
  failedAiToday: number;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  schoolName: string | null;
  userCount: number;
  classCount: number;
  examCount: number;
  createdAt: string;
}

export interface PlatformUser {
  id: string;
  fullName: string;
  email: string | null;
  role: string;
  roleLabel: string;
  status: string;
  grade: string | null;
  tenant: { name: string } | null;
  createdAt: string;
  _count: { sessions: number };
}

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  roleScope: string;
  priceMonthly: number;
  limits: Record<string, number>;
  active: boolean;
}

export interface PlatformUsage {
  total14d: number;
  byFeature: Record<string, number>;
  byDay: Record<string, number>;
  costByDay: Record<string, number>;
  estimatedCostTotal: number; // milli-toman
}

export type AiProviderStatusValue = "HEALTHY" | "HEALTHY_WITH_ERRORS" | "DEGRADED" | "IDLE";

export interface AiProviderStatus {
  provider: string;
  model: string;
  status: AiProviderStatusValue;
  callsLastHour: number;
  failedLastHour: number;
  unitsLastHour: number;
}

export interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  scope: string;
  scopeValue: string | null;
  updatedAt?: string;
}

export interface AuditLogRow {
  id: string;
  actorName: string;
  actorRole: string | null;
  tenantName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PreviewStartResponse {
  token: string;
  expiresAt: string;
  effectiveRole: string;
  previewTenantId: string | null;
}

// ── Persian label helpers (UI display only) ──

export function tenantStatusFa(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "فعال";
    case "SUSPENDED":
      return "معلق";
    case "PENDING":
      return "در انتظار تأیید";
    default:
      return status;
  }
}

export function userStatusFa(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "فعال";
    case "SUSPENDED":
      return "غیرفعال";
    default:
      return status;
  }
}

export function aiProviderStatusFa(status: AiProviderStatusValue): string {
  switch (status) {
    case "HEALTHY":
      return "سالم";
    case "HEALTHY_WITH_ERRORS":
      return "سالم با خطاهای جزئی";
    case "DEGRADED":
      return "مختل";
    case "IDLE":
      return "بدون ترافیک";
    default:
      return status;
  }
}

export function planScopeFa(scope: string): string {
  switch (scope) {
    case "STUDENT":
      return "دانش‌آموز";
    case "TEACHER":
      return "معلم";
    case "SCHOOL":
      return "مدرسه";
    default:
      return scope;
  }
}

export function auditTargetTypeFa(t: string | null): string | null {
  if (!t) return null;
  const map: Record<string, string> = {
    user: "کاربر",
    tenant: "سازمان",
    exam: "آزمون",
    assignment: "تکلیف",
    exam_attempt: "کاربرگ آزمون",
    role_preview: "پیش‌نمایش نقش",
    feature_flag: "فلگ قابلیت",
    plan: "پلن",
    session: "نشست",
  };
  return map[t] ?? t;
}
