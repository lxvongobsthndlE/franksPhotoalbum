import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const groups = await prisma.group.findMany({
  where: { createdBy: null },
  orderBy: { createdAt: 'asc' },
});

for (const g of groups) {
  // Ältestes Mitglied = wahrscheinlicher Ersteller
  const firstMember = await prisma.groupMember.findFirst({
    where: { groupId: g.id },
    orderBy: {}, // kein createdAt auf GroupMember — nehmen wir einfach erstes
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  const u = firstMember?.user;
  console.log(
    `"${g.name}" (${g.id}) → ${u ? (u.name || u.username) + ' [' + u.id + ']' : 'kein Mitglied'}`
  );
}

await prisma.$disconnect();
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const groups = await prisma.group.findMany({ orderBy: { createdAt: 'asc' } });
const userIds = [...new Set(groups.map((g) => g.createdBy).filter(Boolean))];
const users = await prisma.user.findMany({
  where: { id: { in: userIds } },
  select: { id: true, name: true, username: true },
});
const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
for (const g of groups) {
  const owner = g.createdBy ? uMap[g.createdBy] : null;
  console.log(
    `${g.name} (Code: ${g.code}) → Owner: ${owner ? (owner.name || owner.username) + ' [' + owner.id + ']' : 'kein Owner'}`
  );
}
await prisma.$disconnect();
