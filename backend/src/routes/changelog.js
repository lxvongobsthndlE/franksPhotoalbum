import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '../../package.json');

let cachedAppVersion = process.env.APP_VERSION || '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (pkg?.version) cachedAppVersion = pkg.version;
} catch {
  // Fallback stays from env/default
}

export default async function changelogRoutes(fastify) {
  async function requireAuth(request, reply) {
    try {
      await request.jwtVerify();
      return true;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
  }

  async function requireAdmin(request, reply) {
    const caller = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true },
    });
    if (!caller || caller.role !== 'admin') {
      reply.code(403).send({ error: 'Nur Admins dürfen Changelog-Einträge erstellen.' });
      return false;
    }
    return true;
  }

  function validateEntryInput(version, title, body, reply) {
    if (!version || version.length > 32) {
      reply.code(400).send({ error: 'Version fehlt oder ist zu lang (max. 32 Zeichen).' });
      return false;
    }
    if (!title || title.length > 140) {
      reply.code(400).send({ error: 'Titel fehlt oder ist zu lang (max. 140 Zeichen).' });
      return false;
    }
    if (body.length > 4000) {
      reply.code(400).send({ error: 'Text ist zu lang (max. 4000 Zeichen).' });
      return false;
    }
    return true;
  }

  // GET /api/changelog/meta - App-Version für Sidebar
  fastify.get('/meta', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    return { appVersion: cachedAppVersion };
  });

  // GET /api/changelog - Changelog-Liste
  fastify.get('/', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const parsedLimit = Number(request.query?.limit ?? 25);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
      : 25;

    const entries = await fastify.prisma.changelogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      appVersion: cachedAppVersion,
      entries,
    };
  });

  // POST /api/changelog - Neuer Changelog-Eintrag (nur Admin)
  fastify.post('/', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const version = String(request.body?.version || '').trim();
    const title = String(request.body?.title || '').trim();
    const body = String(request.body?.body || '').trim();
    if (!validateEntryInput(version, title, body, reply)) return;

    const creator = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, name: true, username: true },
    });

    const entry = await fastify.prisma.changelogEntry.create({
      data: {
        version,
        title,
        body: body || null,
        createdById: creator?.id || request.user.id,
        createdByName: creator?.name || creator?.username || null,
      },
    });

    return { entry };
  });

  // PATCH /api/changelog/:id - Changelog-Eintrag bearbeiten (nur Admin)
  fastify.patch('/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const id = String(request.params?.id || '');
    const version = String(request.body?.version || '').trim();
    const title = String(request.body?.title || '').trim();
    const body = String(request.body?.body || '').trim();
    if (!validateEntryInput(version, title, body, reply)) return;

    const existing = await fastify.prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Changelog-Eintrag nicht gefunden.' });
    }

    const entry = await fastify.prisma.changelogEntry.update({
      where: { id },
      data: {
        version,
        title,
        body: body || null,
      },
    });

    return { entry };
  });

  // DELETE /api/changelog/:id - Changelog-Eintrag löschen (nur Admin)
  fastify.delete('/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const id = String(request.params?.id || '');
    const existing = await fastify.prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Changelog-Eintrag nicht gefunden.' });
    }

    await fastify.prisma.changelogEntry.delete({ where: { id } });
    return { ok: true };
  });
}
