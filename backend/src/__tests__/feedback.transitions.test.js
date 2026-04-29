import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

describe('feedback transition rules', () => {
  let feedbackRoutes;
  let fastify;
  let prisma;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    feedbackRoutes = (await import('../routes/feedback.js')).default;
    prisma = createMockPrismaClient();
    prisma.feedbackReport = {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    };
    prisma.feedbackMessage = {
      create: vi.fn(),
      findMany: vi.fn(),
    };
    prisma.$transaction = vi.fn(async (fn) => fn(prisma));

    fastify = createMockRouteFastify({ prisma });
    await feedbackRoutes(fastify);
  });

  it('creates new ticket with expected defaults and stores initial description as first message', async () => {
    const createdReport = {
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      subject: 'Bug',
      body: 'Beschreibung',
      status: 'open',
      waitingFor: 'support',
      unreadAdmin: true,
      unreadUser: false,
    };

    prisma.feedbackReport.create.mockResolvedValue(createdReport);
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-1' });
    prisma.user.findMany.mockResolvedValue([]);

    const { reply } = await callRoute('POST', '/', {
      user: { id: 'user-1' },
      body: {
        category: 'bug',
        subject: 'Bug',
        body: 'Beschreibung',
        anonymous: true,
      },
    });

    expect(prisma.feedbackReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'open',
          waitingFor: 'support',
          unreadAdmin: true,
          unreadUser: false,
        }),
      })
    );
    expect(prisma.feedbackMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: createdReport.id,
          authorId: 'user-1',
          body: 'Beschreibung',
        }),
      })
    );
    expect(reply.statusCode).toBe(201);
  });

  it('marks unreadAdmin=false when admin explicitly marks ticket as read', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      status: 'open',
      category: 'bug',
      waitingFor: 'support',
    });
    prisma.feedbackReport.update.mockResolvedValue({ id: 'rep-1', unreadAdmin: false });

    await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { markReadAdmin: true },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unreadAdmin: false }) })
    );
  });

  it('switches to waitingFor=user and unreadUser=true when admin replies', async () => {
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      subject: 'Bug',
      status: 'open',
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'admin', name: 'Admin', username: 'admin' });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-2', body: 'Antwort' });
    prisma.feedbackReport.update.mockResolvedValue({ id: 'rep-1' });

    await callRoute('POST', '/:id/messages', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { body: 'Antwort' },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          waitingFor: 'user',
          unreadUser: true,
          unreadAdmin: false,
          status: 'open',
        }),
      })
    );
  });

  it('marks unreadUser=false when reporter opens conversation', async () => {
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      anonymous: false,
      waitingFor: 'user',
      unreadAdmin: false,
      unreadUser: true,
      status: 'open',
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });
    prisma.feedbackReport.update.mockResolvedValue({ id: 'rep-1', unreadUser: false });
    prisma.feedbackMessage.findMany.mockResolvedValue([]);

    await callRoute('GET', '/:id/messages', {
      user: { id: 'user-1' },
      params: { id: 'rep-1' },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unreadUser: false },
      })
    );
  });

  it('requires close reason when admin closes while waitingFor=support and stores it as message', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      subject: 'Bug',
      status: 'open',
      waitingFor: 'support',
    });

    const missingReason = await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { status: 'closed' },
    });

    expect(missingReason.reply.statusCode).toBe(400);

    prisma.feedbackReport.update.mockResolvedValue({ id: 'rep-1', status: 'closed' });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-close' });

    await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { status: 'closed', closeReason: 'Nicht reproduzierbar' },
    });

    expect(prisma.feedbackMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: 'rep-1',
          body: 'Ticket geschlossen. Grund: Nicht reproduzierbar',
        }),
      })
    );
  });

  it('blocks user close endpoint for report_user tickets', async () => {
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'report_user',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id/close-by-user', {
      user: { id: 'user-1' },
      params: { id: 'rep-1' },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: 'Nutzer-Meldungen können nur durch Admin-Entscheidung geschlossen werden.',
    });
  });
});
