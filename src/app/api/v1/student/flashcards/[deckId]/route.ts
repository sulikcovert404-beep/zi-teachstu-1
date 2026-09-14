import { NextRequest } from "next/server";
import { ok, handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { deleteDeck } from "@/server/services/ai";

export const dynamic = "force-dynamic";

export const DELETE = handler(
  async (req: NextRequest, { params }: { params: Promise<{ deckId: string }> }) => {
    const { deckId } = await params;
    const ctx = await requireAuth(req);
    return ok(await deleteDeck(ctx, deckId));
  }
);
