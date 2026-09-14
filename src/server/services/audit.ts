import { db } from "@/lib/db";
import { toJson } from "@/server/core/json";

// Spec §31 — audit events. Metadata must be sanitized: no tokens, passwords, raw initData, PII.
const ALLOWED_ACTIONS = new Set([
  "login",
  "logout",
  "role_changed",
  "subscription_changed",
  "preview_started",
  "preview_ended",
  "exam_started",
  "exam_submitted",
  "assignment_created",
  "exam_created",
  "tenant_changed",
  "admin_action",
  "feature_flag_changed",
  "question_generated",
  "knowledge_qa",
  "knowledge_source_created",
  "knowledge_source_deleted",
  "podcast_generated",
]);

export async function audit(input: {
  actorId?: string | null;
  tenantId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!ALLOWED_ACTIONS.has(input.action)) return;
  // Strip anything that looks sensitive from metadata
  const safeMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.metadata ?? {})) {
    if (/token|password|secret|initdata|phone/i.test(k)) continue;
    if (typeof v === "string" && v.length > 300) continue;
    safeMeta[k] = v;
  }
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      tenantId: input.tenantId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: Object.keys(safeMeta).length ? toJson(safeMeta) : null,
    },
  });
}
