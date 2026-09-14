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

// ── Round 23 — «ذخیره‌سازی کامل در تلگرام» ──

// Rich status block served inside GET /platform/settings → settings.telegramStorage.
export interface TelegramStorageBlock {
  enabled: boolean;
  configured: boolean;
  storageChatId: string; // resolved chat id (explicit or auto from مدیر کل)
  explicitChatId: string; // raw saved value ("" = auto)
  assets: number;
  bytes: number;
  botUsername: string | null;
  uploadLimitMb: number;
  proxyLimitMb: number;
}

export interface MigratedAsset {
  kind: string;
  label: string;
  sizeBytes: number;
}

export interface SkippedAsset {
  kind: string;
  label: string;
  reason: string;
}

// POST /api/v1/books/{bookId}/migrate-storage response body.
export interface MigrateStorageResponse {
  ok: boolean;
  bookId: string;
  title: string;
  migrated: MigratedAsset[];
  skipped: SkippedAsset[];
  storage: { chatId: string; assets: number; bytes: number };
}

// ── Persian label helpers (UI display only) ──

// Converts western digits inside any string to Persian digits (۰۱۲۳۴۵۶۷۸۹).
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function faNumLocal(n: number): string {
  return new Intl.NumberFormat("fa-IR").format(n);
}

// Persian human-readable size: بایت / کیلوبایت / مگابایت / گیگابایت.
export function faSizeBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return "—";
  if (bytes < 1024) return `${faNumLocal(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${faNumLocal(Math.round(kb))} کیلوبایت`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    const shown = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${faNumLocal(shown)} مگابایت`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return `${faNumLocal(Math.round(gb * 10) / 10)} گیگابایت`;
}

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
