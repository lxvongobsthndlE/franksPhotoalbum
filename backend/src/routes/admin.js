export default async function adminRoutes(fastify) {

  // Hilfsfunktion: prüft ob der anfragende User Admin ist
  async function requireAdmin(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const caller = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true },
    });
    if (!caller || caller.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  }

  // GET /api/admin/users - Alle User auflisten
  fastify.get('/users', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const users = await fastify.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        avatar: true,
        color: true,
        createdAt: true,
      },
    });

    return {
      users: users.map(u => ({
        ...u,
        avatar: u.avatar && !u.avatar.startsWith('/api/')
          ? `/api/auth/avatar/${u.id}`
          : u.avatar,
      })),
    };
  });

  // PATCH /api/admin/users/:id/role - Rolle eines Users ändern
  fastify.patch('/users/:id/role', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const { role } = request.body;
    if (!['user', 'admin'].includes(role)) {
      return reply.code(400).send({ error: 'Ungültige Rolle. Erlaubt: user, admin' });
    }

    // Schutz: letzter Admin kann sich nicht selbst degradieren
    if (request.params.id === request.user.id && role !== 'admin') {
      const adminCount = await fastify.prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return reply.code(409).send({ error: 'Du bist der letzte Admin und kannst dich nicht selbst degradieren.' });
      }
    }

    const updated = await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: { role },
      select: { id: true, name: true, role: true },
    });

    return { ok: true, user: updated };
  });
}
