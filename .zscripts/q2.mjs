import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const b = await db.book.findFirst({ where: { title: { contains: 'کتاب تست لینک دانلود' } }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, level: true, gradeLevel: true, subject: true, originalPdfPath: true, originalPdfName: true, summaryStatus: true, status: true } });
console.log(JSON.stringify(b, null, 1));
await db.$disconnect();
