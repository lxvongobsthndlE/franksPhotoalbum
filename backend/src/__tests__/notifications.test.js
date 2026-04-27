/**
 * Tests für notifications.js mit echten SSE-Payloads, Mail-Routing und Schema-Defaults.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPrismaClient, createMockSseReply } from './mocks/index.js';
import { createMockNotification, createMockUser } from './fixtures/index.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
    })),
  },
}));

describe('notifications.js', () => {
  const originalEnv = { ...process.env };
  let notifications;
  let nodemailer;
  let prisma;

  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    notifications = await import('../utils/notifications.js');
    nodemailer = (await import('nodemailer')).default;
    prisma = createMockPrismaClient();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('pushes a real SSE notification payload to all connected clients', async () => {
    const replyA = createMockSseReply();
    const replyB = createMockSseReply();
    const notification = createMockNotification({
      id: 'notif-777',
      userId: 'user-123',
      createdAt: new Date('2025-01-01T10:00:00.000Z'),
    });

    prisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-123',
      inApp_photoCommented: true,
      email_photoCommented: false,
    });
    prisma.notification.create.mockResolvedValue(notification);

    notifications.addSseClient('user-123', replyA);
    notifications.addSseClient('user-123', replyB);

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'photoCommented',
      title: 'Kommentar',
      body: 'Neuer Kommentar',
      entityId: 'photo-1',
      entityType: 'photo',
    });

    for (const reply of [replyA, replyB]) {
      expect(reply.raw.write).toHaveBeenCalledTimes(1);
      const payload = reply.raw.write.mock.calls[0][0];
      expect(payload).toContain('event: notification');
      const dataLine = payload.split('\n').find((line) => line.startsWith('data: '));
      const parsed = JSON.parse(dataLine.slice(6));
      expect(parsed).toEqual(
        expect.objectContaining({
          id: 'notif-777',
          type: 'photoCommented',
          title: 'Kommentar',
          body: 'Neuer Kommentar',
          read: false,
        })
      );
    }
  });

  it('stops sending SSE payloads to removed clients', async () => {
    const staleReply = createMockSseReply();
    const activeReply = createMockSseReply();

    prisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-123',
      inApp_photoCommented: true,
      email_photoCommented: false,
    });
    prisma.notification.create.mockResolvedValue(createMockNotification({ userId: 'user-123' }));

    notifications.addSseClient('user-123', staleReply);
    notifications.addSseClient('user-123', activeReply);
    notifications.removeSseClient('user-123', staleReply);

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'photoCommented',
      title: 'Kommentar',
      body: 'Neuer Kommentar',
    });

    expect(staleReply.raw.write).not.toHaveBeenCalled();
    expect(activeReply.raw.write).toHaveBeenCalledTimes(1);
  });

  it('skips email sending in dev mode without a catch-all address', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_USER = 'mailer@test';

    prisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-123',
      inApp_contributorAdded: false,
      email_contributorAdded: true,
    });
    prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'user-123' }));

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'contributorAdded',
      title: 'Contributor',
      body: 'Du wurdest hinzugefügt.',
    });
    await flushAsyncWork();

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('routes dev emails through the catch-all mailbox and preserves X-Original-To', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_USER = 'mailer@test';
    process.env.DEV_MAIL_CATCHALL = '${local}@catchall.test';

    prisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-123',
      inApp_contributorAdded: false,
      email_contributorAdded: true,
    });
    prisma.user.findUnique.mockResolvedValue(
      createMockUser({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice',
      })
    );

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'contributorAdded',
      title: 'Contributor',
      body: 'Du wurdest hinzugefügt.',
      entityUrl: 'https://example.com/albums/1',
    });
    await flushAsyncWork();

    const transporter = nodemailer.createTransport.mock.results[0].value;
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@catchall.test',
        headers: { 'X-Original-To': 'alice@example.com' },
      })
    );
  });

  it('sends production emails to the real recipient without a redirect header', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_USER = 'mailer@test';

    prisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-123',
      inApp_deputyAdded: false,
      email_deputyAdded: true,
    });
    prisma.user.findUnique.mockResolvedValue(
      createMockUser({
        id: 'user-123',
        email: 'real.user@example.com',
      })
    );

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'deputyAdded',
      title: 'Deputy',
      body: 'Du bist jetzt Deputy.',
    });
    await flushAsyncWork();

    const transporter = nodemailer.createTransport.mock.results[0].value;
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'real.user@example.com',
        headers: {},
      })
    );
  });

  it('uses schema defaults when a new preference record is created for contributorAdded', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_USER = 'mailer@test';

    const schemaDefaults = {
      userId: 'user-123',
      inApp_deputyAdded: true,
      inApp_deputyRemoved: true,
      inApp_contributorAdded: true,
      inApp_contributorRemoved: true,
      inApp_groupMemberJoined: true,
      inApp_groupMemberLeft: true,
      inApp_groupDeleted: true,
      inApp_photoLiked: true,
      inApp_photoCommented: true,
      inApp_newPhoto: true,
      inApp_newAlbum: true,
      inApp_system: true,
      email_deputyAdded: true,
      email_deputyRemoved: false,
      email_contributorAdded: true,
      email_contributorRemoved: false,
      email_groupMemberJoined: false,
      email_groupMemberLeft: false,
      email_groupDeleted: true,
      email_photoLiked: false,
      email_photoCommented: false,
      email_newPhoto: false,
      email_newAlbum: false,
      email_system: false,
    };

    prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);
    prisma.notificationPreference.create.mockResolvedValue(schemaDefaults);
    prisma.notification.create.mockResolvedValue(
      createMockNotification({ userId: 'user-123', type: 'contributorAdded' })
    );
    prisma.user.findUnique.mockResolvedValue(
      createMockUser({ id: 'user-123', email: 'schema@example.com' })
    );

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'contributorAdded',
      title: 'Contributor',
      body: 'Schema default active.',
    });
    await flushAsyncWork();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const transporter = nodemailer.createTransport.mock.results[0].value;
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });

  it('honors schema defaults by not emailing photoCommented notifications', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_USER = 'mailer@test';

    prisma.notificationPreference.findUnique.mockResolvedValueOnce(null);
    prisma.notificationPreference.create.mockResolvedValue({
      userId: 'user-123',
      inApp_photoCommented: true,
      email_photoCommented: false,
    });
    prisma.notification.create.mockResolvedValue(
      createMockNotification({ userId: 'user-123', type: 'photoCommented' })
    );
    prisma.user.findUnique.mockResolvedValue(
      createMockUser({ id: 'user-123', email: 'schema@example.com' })
    );

    await notifications.createNotification(prisma, {
      userId: 'user-123',
      type: 'photoCommented',
      title: 'Kommentar',
      body: 'Kein Mail-Default.',
    });
    await flushAsyncWork();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
