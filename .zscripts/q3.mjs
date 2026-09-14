import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const b = await db.book.findFirst({ where: { id: 'cmu1hkpix0043p6t18h7kymov' }, select: { title: true, status: true, summaryStatus: true, studyNotesStatus: true, quizStatus: true, figuresStatus: true, podcastStatus: true, quizCount: true, podcastDurationSec: true } });
console.log(JSON.stringify(b, null, 1));
await db.$disconnect();
