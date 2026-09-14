import { NextRequest } from "next/server";
import { handler } from "@/server/core/respond";
import { requireAuth } from "@/server/auth/session";
import { createBook, listBooks } from "@/server/services/books";

export const dynamic = "force-dynamic";

// GET — library listing for the current user (visibility-scoped, spec §4 tenant isolation).
// Optional ?level= course-level filter (PRE_PRIMARY | PRIMARY | MIDDLE_1 | MIDDLE_2 | TECHNICAL).
export const GET = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const level = req.nextUrl.searchParams.get("level");
  return Response.json(await listBooks(ctx, level));
});

// POST — upload a book (permission-gated: SUPER_ADMIN always; SCHOOL_ADMIN/TEACHER
// only when the admin enabled the capability for their tenant — default OFF).
export const POST = handler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  const body = await req.json().catch(() => ({}));
  const book = await createBook(ctx, {
    title: String(body?.title ?? ""),
    text: String(body?.text ?? ""),
    subject: body?.subject ? String(body.subject) : undefined,
    level: body?.level ? String(body.level) : undefined,
    gradeLevel: body?.gradeLevel ? String(body.gradeLevel) : undefined,
    author: body?.author ? String(body.author) : undefined,
    description: body?.description ? String(body.description) : undefined,
    coverEmoji: body?.coverEmoji ? String(body.coverEmoji) : undefined,
    classroomId: body?.classroomId ? String(body.classroomId) : null,
  });
  return Response.json(book, { status: 201 });
});
