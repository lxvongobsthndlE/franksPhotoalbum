import { addSseClient, removeSseClient } from '../utils/notifications.js';

export default async function notificationsRoutes(fastify) {

  // ── GET /api/notifications/stream — SSE ──────────────────
  fastify.get('/stream', async (request, reply) => {
    // EventSource kann keine Custom-Header senden → Token aus Query-Parameter lesen
    const qToken = request.query.token;
    if (qToken) {
      request.headers.authorization = `Bearer ${qToken}`;
    }
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.id;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // nginx: Buffering deaktivieren
    reply.raw.flushHeaders();

    // Initiales Keep-Alive-Kommentar
    reply.raw.write(': connected\n\n');

    addSseClient(userId, reply);

    // Keep-Alive alle 25s damit Proxy/Browser die Verbindung nicht schließt
    const keepAlive = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
    }, 25000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      removeSseClient(userId, reply);
    });

    // Nie auflösen — Verbindung bleibt offen
    await new Promise(() => {});
  });

  // ── GET /api/notifications — Liste ───────────────────────
  fastify.get('/', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { cursor, limit = 30 } = request.query;
    const take = Math.min(Number(limit), 100);

    const where = { userId: request.user.id };
    const notifications = await fastify.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const unreadCount = await fastify.prisma.notification.count({ where: { userId: request.user.id, read: false } });

    return {
      notifications,
      unreadCount,
      nextCursor: notifications.length === take ? notifications[notifications.length - 1].id : null,
    };
  });

  // ── PATCH /api/notifications/:id/read ────────────────────
  fastify.patch('/:id/read', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { id } = request.params;
    const notif = await fastify.prisma.notification.findUnique({ where: { id } });
    if (!notif || notif.userId !== request.user.id) return reply.code(404).send({ error: 'Nicht gefunden' });
    await fastify.prisma.notification.update({ where: { id }, data: { read: true } });
    return { ok: true };
  });

  // ── PATCH /api/notifications/read-all ────────────────────
  fastify.patch('/read-all', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    await fastify.prisma.notification.updateMany({ where: { userId: request.user.id, read: false }, data: { read: true } });
    return { ok: true };
  });

  // ── DELETE /api/notifications (alle) ─────────────────────
  fastify.delete('/', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    await fastify.prisma.notification.deleteMany({ where: { userId: request.user.id } });
    return { ok: true };
  });

  // ── DELETE /api/notifications/:id ────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const { id } = request.params;
    const notif = await fastify.prisma.notification.findUnique({ where: { id } });
    if (!notif || notif.userId !== request.user.id) return reply.code(404).send({ error: 'Nicht gefunden' });
    await fastify.prisma.notification.delete({ where: { id } });
    return { ok: true };
  });

  // ── GET /api/notifications/preferences ───────────────────
  fastify.get('/preferences', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const userId = request.user.id;
    let prefs = await fastify.prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) {
      // Defaults materialisieren
      prefs = await fastify.prisma.notificationPreference.create({ data: { userId } });
    }
    return { preferences: prefs };
  });

  // ── PUT /api/notifications/preferences ───────────────────
  fastify.put('/preferences', async (request, reply) => {
    try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const userId = request.user.id;
    const data = request.body;

    // Nur bekannte Boolean-Felder erlauben
    const allowed = [
      'inApp_deputyAdded','inApp_deputyRemoved','inApp_contributorAdded','inApp_contributorRemoved',
      'inApp_groupMemberJoined','inApp_groupMemberLeft','inApp_groupDeleted',
      'inApp_photoLiked','inApp_photoCommented','inApp_newPhoto','inApp_newAlbum',
      'email_deputyAdded','email_deputyRemoved','email_contributorAdded','email_contributorRemoved',
      'email_groupMemberJoined','email_groupMemberLeft','email_groupDeleted',
      'email_photoLiked','email_photoCommented','email_newPhoto','email_newAlbum',
      'email_system',
    ];
    const filtered = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => allowed.includes(k) && typeof v === 'boolean')
    );

    const prefs = await fastify.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...filtered },
      update: filtered,
    });
    return { preferences: prefs };
  });
}
