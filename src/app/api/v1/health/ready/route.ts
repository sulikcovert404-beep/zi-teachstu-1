import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Spec §35 — /health/ready = DB reachable + critical deps ready
export const GET = handler(async (_req: NextRequest) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return ok({ status: "ready", db: "up", ts: new Date().toISOString() });
  } catch {
    return ok({ status: "not_ready", db: "down", ts: new Date().toISOString() }, { status: 503 });
  }
});
