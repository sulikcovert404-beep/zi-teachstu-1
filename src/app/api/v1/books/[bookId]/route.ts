import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { getBook, deleteBook } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — book detail (summary, artifact statuses, my attempts).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  return Response.json(await getBook(ctx, bookId));
});

// DELETE — remove a book (creator / same-tenant admin / SUPER_ADMIN).
export const DELETE = handler(async (req: NextRequest, { params }: { params: Promise<{ bookId: string }> }) => {
  const { bookId } = await params;
  const ctx = await requireAuth(req);
  return Response.json(await deleteBook(ctx, bookId));
});
