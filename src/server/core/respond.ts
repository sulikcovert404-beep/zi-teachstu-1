import { NextResponse } from "next/server";
import { ApiError } from "./errors";

// Standard JSON responses; errors always follow spec §33 format.
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    // Round 23 — optional deepLink (e.g. oversized Telegram-stored file → t.me link)
    const deepLink = (error as ApiError & { deepLink?: string }).deepLink;
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(deepLink ? { deepLink } : {}) } },
      { status: error.status }
    );
  }
  // Never leak stack traces / secrets (spec §6-role, §32)
  console.error("[api] unhandled error:", error instanceof Error ? error.message : error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "خطای داخلی سرور رخ داد." } },
    { status: 500 }
  );
}

// Wrap a route handler with uniform error handling.
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return fail(e);
    }
  };
}
// Round 16: content bump — force dev-server recompile of the API graph after the prisma client loader change (see src/lib/db.ts).
