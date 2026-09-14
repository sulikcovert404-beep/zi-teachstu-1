import { NextRequest } from "next/server";
import { handler, ok } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { reviewTelegramSignup } from "@/server/services/telegram-signup";
import { Errors } from "@/server/core/errors";

export const dynamic = "force-dynamic";

// POST — approve/reject a Telegram signup request. On approval the canonical user is
// created (passwordless, telegram-linked) inside the request's school tenant.
export const POST = handler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const ctx = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== "APPROVE" && action !== "REJECT") {
      throw Errors.validation("عملیات بررسی باید APPROVE یا REJECT باشد.");
    }
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    return ok(await reviewTelegramSignup(ctx, id, action, reason));
  }
);
