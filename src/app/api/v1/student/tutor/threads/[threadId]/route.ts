import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getThreadMessages } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) => {
    const { threadId } = await params;
    const ctx = await requireAuth(req);
    return ok(await getThreadMessages(ctx, threadId));
  }
);
