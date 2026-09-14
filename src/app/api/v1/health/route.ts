import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Spec §34/§35 — /health = process alive
export const GET = handler(async (_req: NextRequest) => ok({ status: "ok", ts: new Date().toISOString() }));
