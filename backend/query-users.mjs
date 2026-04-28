import { config } from 'dotenv';
config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({
  select: { id: true, email: true, username: true, name: true, role: true, createdAt: true },
});
console.table(users);
await p.$disconnect();
