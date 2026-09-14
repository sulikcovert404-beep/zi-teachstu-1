import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireRole } from "@/server/auth/session";
import { ROLES } from "@/server/core/constants";
import { listStudentSources } from "@/server/services/rag";

export const dynamic = "force-dynamic";

// Student-facing knowledge base (spec §12 — RAG روی منابع مجاز):
// tenant-wide sources + sources scoped to the student's active classrooms.
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireRole(req, ROLES.STUDENT);
  return ok(await listStudentSources(ctx));
});
