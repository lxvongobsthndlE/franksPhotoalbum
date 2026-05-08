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

const createFeedbackGithubIssue = vi.fn();

vi.mock('../utils/github.js', () => ({
  createFeedbackGithubIssue,
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

  it('accepts bug tickets and persists GitHub issue reference when requested', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      subject: 'Bug',
      body: 'Beschreibung',
      status: 'open',
    });
    createFeedbackGithubIssue.mockResolvedValue({ number: 42, url: 'https://github.com/x/y/issues/42' });
    prisma.feedbackReport.update.mockResolvedValue({
      id: 'rep-1',
      status: 'accepted',
      githubIssueNumber: 42,
      githubIssueUrl: 'https://github.com/x/y/issues/42',
    });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-accept' });

    const { result } = await callRoute('PATCH', '/:id/accept', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { decisionNote: 'Wird umgesetzt', createGithubIssue: true },
    });

    expect(createFeedbackGithubIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'bug',
        subject: 'Bug',
        feedbackId: 'rep-1',
      })
    );
    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'accepted',
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/x/y/issues/42',
        }),
      })
    );
    expect(result.report.status).toBe('accepted');
  });

  it('rejects feature tickets with a required decision note', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'feature',
      subject: 'Feature',
      status: 'open',
    });
    prisma.feedbackReport.update.mockResolvedValue({ id: 'rep-1', status: 'rejected' });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-reject' });

    await callRoute('PATCH', '/:id/reject', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { decisionNote: 'Passt nicht zur Roadmap' },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          waitingFor: 'none',
        }),
      })
    );
  });

  it('returns a readable error when GitHub issue creation fails during accept', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      userId: 'user-1',
      category: 'bug',
      subject: 'Bug',
      body: 'Beschreibung',
      status: 'open',
    });
    createFeedbackGithubIssue.mockRejectedValue(
      new Error('GitHub-Issue konnte nicht erstellt werden: Validation Failed')
    );

    const { reply } = await callRoute('PATCH', '/:id/accept', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { decisionNote: 'Wird umgesetzt', createGithubIssue: true },
    });

    expect(reply.statusCode).toBe(502);
    expect(reply.payload).toEqual({
      error: 'GitHub-Issue konnte nicht erstellt werden: Validation Failed',
    });
  });

  it('recategorizes other tickets to report_user when a reported user is supplied', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'reported-1' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-1',
      category: 'other',
      status: 'open',
      resolution: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
    });
    prisma.feedbackReport.update.mockResolvedValue({
      id: 'rep-1',
      category: 'report_user',
      reportedUserId: 'reported-1',
    });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-recat' });

    await callRoute('PATCH', '/:id/recategorize', {
      user: { id: 'admin-1' },
      params: { id: 'rep-1' },
      body: { category: 'report_user', reportedUserId: 'reported-1' },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'report_user',
          reportedUserId: 'reported-1',
        }),
      })
    );
  });

  it('treats closed admin filter as closed plus accepted/rejected', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findMany.mockResolvedValue([]);
    prisma.feedbackReport.count.mockResolvedValue(0);

    await callRoute('GET', '/', {
      user: { id: 'admin-1' },
      query: { status: 'closed' },
    });

    expect(prisma.feedbackReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['closed', 'accepted', 'rejected'] },
        }),
      })
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

  it('allows user close endpoint for help tickets', async () => {
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-help-1',
      userId: 'user-1',
      category: 'help',
      status: 'open',
    });
    prisma.feedbackReport.update.mockResolvedValue({
      id: 'rep-help-1',
      status: 'closed',
      waitingFor: 'none',
    });

    const { reply, result } = await callRoute('PATCH', '/:id/close-by-user', {
      user: { id: 'user-1' },
      params: { id: 'rep-help-1' },
    });

    expect(reply.statusCode).toBe(200);
    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rep-help-1' },
        data: expect.objectContaining({
          status: 'closed',
          waitingFor: 'none',
        }),
      })
    );
    expect(result.report.status).toBe('closed');
  });

  it('rejects accept endpoint for non bug/feature categories', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-help-2',
      userId: 'user-1',
      category: 'help',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id/accept', {
      user: { id: 'admin-1' },
      params: { id: 'rep-help-2' },
      body: { decisionNote: 'Sollte nicht gehen' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Annehmen ist nur für Bug- und Feature-Tickets erlaubt.',
    });
  });

  it('requires decision note for reject endpoint', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-feature-1',
      userId: 'user-1',
      category: 'feature',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id/reject', {
      user: { id: 'admin-1' },
      params: { id: 'rep-feature-1' },
      body: { decisionNote: '' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Bitte gib eine Begründung für die Ablehnung an.',
    });
  });

  it('rejects recategorize without reported user when target is report_user', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-other-2',
      category: 'other',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id/recategorize', {
      user: { id: 'admin-1' },
      params: { id: 'rep-other-2' },
      body: { category: 'report_user' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Beim Wechsel zu Nutzer melden muss ein gemeldeter Nutzer ausgewählt werden.',
    });
  });

  it('rejects recategorize to same category', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-feature-2',
      category: 'feature',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id/recategorize', {
      user: { id: 'admin-1' },
      params: { id: 'rep-feature-2' },
      body: { category: 'feature' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Ticket ist bereits in dieser Kategorie.',
    });
  });

  it('maps accepted and rejected filters directly in admin listing', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findMany.mockResolvedValue([]);
    prisma.feedbackReport.count.mockResolvedValue(0);

    await callRoute('GET', '/', {
      user: { id: 'admin-1' },
      query: { status: 'accepted' },
    });
    expect(prisma.feedbackReport.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'accepted' }),
      })
    );

    await callRoute('GET', '/', {
      user: { id: 'admin-1' },
      query: { status: 'rejected' },
    });
    expect(prisma.feedbackReport.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'rejected' }),
      })
    );
  });

  it('applies report_user resolution action_taken and writes decision message', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-report-1',
      userId: 'user-1',
      category: 'report_user',
      subject: 'Meldung',
      status: 'open',
      waitingFor: 'support',
    });
    prisma.feedbackReport.update.mockResolvedValue({
      id: 'rep-report-1',
      status: 'closed',
      resolution: 'action_taken',
      waitingFor: 'none',
    });
    prisma.feedbackMessage.create.mockResolvedValue({ id: 'msg-resolution' });

    const { result } = await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-report-1' },
      body: { resolution: 'action_taken', resolutionReason: 'Regelverstoß bestätigt' },
    });

    expect(prisma.feedbackReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rep-report-1' },
        data: expect.objectContaining({
          resolution: 'action_taken',
          status: 'closed',
          waitingFor: 'none',
          unreadUser: true,
        }),
      })
    );
    expect(prisma.feedbackMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportId: 'rep-report-1',
          authorId: 'admin-1',
        }),
      })
    );
    expect(result.report.resolution).toBe('action_taken');
  });

  it('rejects resolution updates for non report_user categories', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-bug-3',
      userId: 'user-1',
      category: 'bug',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-bug-3' },
      body: { resolution: 'action_taken' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Resolution nur für Nutzer-Meldungen erlaubt.',
    });
  });

  it('rejects invalid resolution value for report_user tickets', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-report-2',
      userId: 'user-1',
      category: 'report_user',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-report-2' },
      body: { resolution: 'maybe' },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Ungültige Resolution.',
    });
  });

  it('rejects overly long resolution reason', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.feedbackReport.findUnique.mockResolvedValue({
      id: 'rep-report-3',
      userId: 'user-1',
      category: 'report_user',
      status: 'open',
    });

    const { reply } = await callRoute('PATCH', '/:id', {
      user: { id: 'admin-1' },
      params: { id: 'rep-report-3' },
      body: { resolution: 'no_action', resolutionReason: 'x'.repeat(2001) },
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.payload).toEqual({
      error: 'Begründung ist zu lang (max. 2000 Zeichen).',
    });
  });

  it('returns 403 for non-admin user on admin-only route', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });

    const { reply } = await callRoute('GET', '/', {
      user: { id: 'user-1' },
      query: { status: 'open' },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({
      error: 'Nur Admins dürfen diese Aktion ausführen.',
    });
  });

  it('returns 401 when auth token is missing or invalid', async () => {
    const { reply } = await callRoute('GET', '/mine', {
      jwtVerify: vi.fn().mockRejectedValue(new Error('Unauthorized')),
    });

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ error: 'Unauthorized' });
  });
});
