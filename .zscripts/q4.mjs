import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const books = await db.book.findMany({ select: { id: true, title: true, podcastStatus: true, status: true }, orderBy: { createdAt: 'desc' }, take: 10 });
console.log(JSON.stringify(books, null, 1));
await db.$disconnect();
