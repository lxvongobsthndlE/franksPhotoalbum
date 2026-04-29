import nodemailer from 'nodemailer';

const CATEGORY_LABELS = {
  bug: '🐛 Bug-Meldung',
  feature: '💡 Feature-Vorschlag',
  help: '❓ Hilfe & Frage',
  report_user: '⚠️ Nutzer melden',
  other: '💬 Sonstiges',
};

const VALID_CATEGORIES = Object.keys(CATEGORY_LABELS);
const VALID_STATUS = ['open', 'closed'];
const ALLOWED_STATUS_TRANSITIONS = {
  open: new Set(['closed']),
  closed: new Set(['open']),
};

function isSupportWaiting(report) {
  return report.waitingFor === 'support';
}

export default async function feedbackRoutes(fastify) {
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
      reply.code(403).send({ error: 'Nur Admins dürfen diese Aktion ausführen.' });
      return false;
    }
    return true;
  }

  // GET /api/feedback/eligible-users – alle User die der Caller sehen kann (alle Gruppen)
  fastify.get('/eligible-users', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const memberships = await fastify.prisma.groupMember.findMany({
      where: { userId: request.user.id },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return { users: [] };

    const members = await fastify.prisma.groupMember.findMany({
      where: {
        groupId: { in: groupIds },
        userId: { not: request.user.id },
      },
      select: {
        user: { select: { id: true, name: true, username: true, displayNameField: true } },
      },
      distinct: ['userId'],
    });

    return { users: members.map((m) => m.user) };
  });

  // POST /api/feedback – Feedback einreichen (jeder eingeloggte User)
  fastify.post(
    '/',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;

      const category = String(request.body?.category || '').trim();
      const subject = String(request.body?.subject || '').trim();
      const body = String(request.body?.body || '').trim();
      const anonymous = request.body?.anonymous === true || request.body?.anonymous === 'true';
      const reportedUserId = request.body?.reportedUserId
        ? String(request.body.reportedUserId).trim()
        : null;

      if (!VALID_CATEGORIES.includes(category)) {
        return reply.code(400).send({ error: 'Ungültige Kategorie.' });
      }
      if (!subject || subject.length > 140) {
        return reply
          .code(400)
          .send({ error: 'Betreff fehlt oder ist zu lang (max. 140 Zeichen).' });
      }
      if (!body || body.length > 4000) {
        return reply
          .code(400)
          .send({ error: 'Nachricht fehlt oder ist zu lang (max. 4000 Zeichen).' });
      }
      if (category === 'report_user' && !reportedUserId) {
        return reply.code(400).send({ error: 'Bitte wähle den zu meldenden Nutzer aus.' });
      }
      if (reportedUserId) {
        const exists = await fastify.prisma.user.findUnique({
          where: { id: reportedUserId },
          select: { id: true },
        });
        if (!exists) {
          return reply.code(404).send({ error: 'Gemeldeter Nutzer nicht gefunden.' });
        }
      }

      const report = await fastify.prisma.$transaction(async (tx) => {
        const createdReport = await tx.feedbackReport.create({
          data: {
            userId: request.user.id,
            category,
            subject,
            body,
            anonymous,
            reportedUserId: reportedUserId || null,
            status: 'open',
            waitingFor: 'support',
            unreadAdmin: true,
            unreadUser: false,
          },
        });

        // Initiale Beschreibung immer als erste Konversationsnachricht speichern.
        await tx.feedbackMessage.create({
          data: {
            reportId: createdReport.id,
            authorId: request.user.id,
            body,
          },
        });

        return createdReport;
      });

      // Alle Admins benachrichtigen
      const admins = await fastify.prisma.user.findMany({
        where: { role: 'admin' },
        select: { id: true, email: true },
      });

      const sender = anonymous
        ? null
        : await fastify.prisma.user.findUnique({
            where: { id: request.user.id },
            select: { name: true, username: true, email: true, displayNameField: true },
          });

      const senderLabel = anonymous
        ? 'Anonym'
        : sender?.displayNameField === 'username'
          ? sender?.username || sender?.name || sender?.email || 'Unbekannt'
          : sender?.name || sender?.username || sender?.email || 'Unbekannt';

      const categoryLabel = CATEGORY_LABELS[category] || category;

      const { createNotification } = await import('../utils/notifications.js');
      for (const admin of admins) {
        // In-App Notification
        await createNotification(fastify.prisma, {
          userId: admin.id,
          type: 'system',
          title: `Neues Feedback: ${categoryLabel}`,
          body: `Von: ${senderLabel} — ${subject}`,
          entityType: 'feedback',
          entityId: report.id,
        });
        // E-Mail direkt an Admin
        if (admin.email) {
          sendFeedbackEmail(admin.email, {
            categoryLabel,
            senderLabel,
            subject,
            body,
            anonymous,
          }).catch(() => {});
        }
      }

      return reply.code(201).send({ ok: true, id: report.id });
    }
  );

  // GET /api/feedback – Admin: alle Einträge
  fastify.get('/', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const status = request.query?.status || null;
    const category = request.query?.category || null;
    const limit = Math.min(Number(request.query?.limit || 50), 200);

    const where = {};
    if (status && VALID_STATUS.includes(status)) where.status = status;
    if (category && VALID_CATEGORIES.includes(category)) where.category = category;

    const reports = await fastify.prisma.feedbackReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            displayNameField: true,
          },
        },
        reportedUser: {
          select: { id: true, name: true, username: true, displayNameField: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            author: {
              select: { id: true, name: true, username: true, displayNameField: true, role: true },
            },
          },
        },
        _count: { select: { messages: true } },
      },
    });

    const statusOrder = { open: 1, closed: 2 };
    const waitingOrder = { support: 1, user: 2, none: 3 };
    reports.sort(
      (a, b) =>
        Number(Boolean(b.unreadAdmin)) - Number(Boolean(a.unreadAdmin)) ||
        (waitingOrder[a.waitingFor] ?? 9) - (waitingOrder[b.waitingFor] ?? 9) ||
        (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
        new Date(b.createdAt) - new Date(a.createdAt)
    );

    const openCount = await fastify.prisma.feedbackReport.count({
      where: { status: 'open' },
    });

    return { reports, openCount };
  });

  // GET /api/feedback/mine – eigene Meldungen des eingeloggten Users
  fastify.get('/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    // Status-Priorität: open=1, read=2, closed=3 → in JS sortiert nach Abfrage
    const reports = await fastify.prisma.feedbackReport.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        reportedUser: {
          select: { id: true, name: true, username: true, displayNameField: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            author: {
              select: { id: true, name: true, username: true, displayNameField: true, role: true },
            },
          },
        },
        _count: { select: { messages: true } },
      },
    });

    const statusOrder = { open: 1, closed: 2 };
    reports.sort(
      (a, b) =>
        Number(Boolean(b.unreadUser)) - Number(Boolean(a.unreadUser)) ||
        (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
        new Date(b.createdAt) - new Date(a.createdAt)
    );

    return { reports };
  });

  // GET /api/feedback/:id/messages – Konversationsverlauf (eigener Eintrag oder Admin)
  fastify.get('/:id/messages', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const id = String(request.params?.id || '');
    const report = await fastify.prisma.feedbackReport.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        category: true,
        anonymous: true,
        waitingFor: true,
        unreadAdmin: true,
        unreadUser: true,
        status: true,
      },
    });
    if (!report) return reply.code(404).send({ error: 'Feedback nicht gefunden.' });

    const caller = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true },
    });
    const isAdmin = caller?.role === 'admin';
    if (!isAdmin && report.userId !== request.user.id) {
      return reply.code(403).send({ error: 'Kein Zugriff.' });
    }

    // User öffnet Konversation: unreadUser=false
    if (!isAdmin && report.unreadUser) {
      await fastify.prisma.feedbackReport.update({
        where: { id },
        data: { unreadUser: false },
      });
      report.unreadUser = false;
    }

    const messages = await fastify.prisma.feedbackMessage.findMany({
      where: { reportId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: { id: true, name: true, username: true, displayNameField: true, role: true },
        },
      },
    });

    return {
      messages,
      anonymous: report.anonymous,
      reportOwnerId: report.userId,
      waitingFor: report.waitingFor,
      unreadAdmin: report.unreadAdmin,
      unreadUser: report.unreadUser,
      status: report.status,
    };
  });

  // POST /api/feedback/:id/messages – Nachricht zur Konversation hinzufügen
  fastify.post(
    '/:id/messages',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;

      const id = String(request.params?.id || '');
      const body = String(request.body?.body || '').trim();

      if (!body || body.length > 4000) {
        return reply
          .code(400)
          .send({ error: 'Nachricht fehlt oder ist zu lang (max. 4000 Zeichen).' });
      }

      const report = await fastify.prisma.feedbackReport.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, username: true, displayNameField: true } },
        },
      });
      if (!report) return reply.code(404).send({ error: 'Feedback nicht gefunden.' });

      const caller = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { role: true, name: true, username: true, displayNameField: true },
      });
      const isAdmin = caller?.role === 'admin';

      // report_user Konversationen sind nur für Admins erlaubt
      if (!isAdmin && report.userId !== request.user.id) {
        return reply.code(403).send({ error: 'Kein Zugriff.' });
      }
      if (!isAdmin && report.category === 'report_user') {
        return reply.code(403).send({ error: 'Diese Meldungsart unterstützt keine Antworten.' });
      }
      if (report.status === 'closed') {
        return reply.code(409).send({ error: 'Dieses Ticket ist geschlossen.' });
      }

      const message = await fastify.prisma.feedbackMessage.create({
        data: { reportId: id, authorId: request.user.id, body },
        include: {
          author: {
            select: { id: true, name: true, username: true, displayNameField: true, role: true },
          },
        },
      });

      // Transition-Regeln laut Ticket-Flow:
      // - Admin antwortet: waitingFor=user, unreadUser=true, unreadAdmin=false
      // - User antwortet: waitingFor=support, unreadAdmin=true, unreadUser=false
      if (isAdmin) {
        await fastify.prisma.feedbackReport.update({
          where: { id },
          data: {
            waitingFor: 'user',
            unreadUser: true,
            unreadAdmin: false,
            status: 'open',
          },
        });
      } else {
        await fastify.prisma.feedbackReport.update({
          where: { id },
          data: {
            waitingFor: 'support',
            unreadAdmin: true,
            unreadUser: false,
            status: 'open',
          },
        });
      }

      const { createNotification } = await import('../utils/notifications.js');
      const callerName =
        caller?.displayNameField === 'username'
          ? caller?.username || caller?.name || 'Unbekannt'
          : caller?.name || caller?.username || 'Unbekannt';

      if (isAdmin) {
        // Admin antwortet → User benachrichtigen
        await createNotification(fastify.prisma, {
          userId: report.userId,
          type: 'system',
          title: 'Admin hat geantwortet',
          body: `Zu deiner Meldung „${report.subject}": ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
          entityType: 'feedback',
          entityId: id,
        });
      } else {
        // User antwortet → alle Admins benachrichtigen
        const admins = await fastify.prisma.user.findMany({
          where: { role: 'admin' },
          select: { id: true },
        });
        for (const admin of admins) {
          await createNotification(fastify.prisma, {
            userId: admin.id,
            type: 'system',
            title: `Neue Antwort von ${callerName}`,
            body: `Zu Meldung „${report.subject}": ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
            entityType: 'feedback',
            entityId: id,
          });
        }
      }

      return reply.code(201).send({ message });
    }
  );

  // PATCH /api/feedback/:id – Admin: Status, Mark-Read oder Resolution setzen
  fastify.patch('/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const id = String(request.params?.id || '');
    const existing = await fastify.prisma.feedbackReport.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Feedback nicht gefunden.' });
    }

    const updateData = {};
    const closeReason = request.body?.closeReason ? String(request.body.closeReason).trim() : '';
    const resolutionReason = request.body?.resolutionReason
      ? String(request.body.resolutionReason).trim()
      : '';

    // Admin markiert Ticket als gelesen
    if (request.body?.markReadAdmin === true) {
      updateData.unreadAdmin = false;
    }

    // Status-Update (open/closed)
    if (request.body?.status !== undefined) {
      const status = String(request.body.status).trim();
      if (!VALID_STATUS.includes(status)) {
        return reply.code(400).send({ error: 'Ungültiger Status.' });
      }
      if (status !== existing.status) {
        const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] || new Set();
        if (!allowed.has(status)) {
          return reply
            .code(409)
            .send({ error: `Ungültiger Statuswechsel: ${existing.status} -> ${status}` });
        }
      }
      if (status === 'closed') {
        if (isSupportWaiting(existing) && !closeReason) {
          return reply.code(400).send({
            error: 'Beim Schließen während "Wartet auf Support" ist ein Grund erforderlich.',
          });
        }

        updateData.status = 'closed';
        updateData.waitingFor = 'none';
        updateData.unreadAdmin = false;
        updateData.unreadUser = true;
      } else {
        updateData.status = 'open';
        updateData.waitingFor = 'support';
        updateData.unreadAdmin = true;
        updateData.unreadUser = false;
      }
    }

    // Resolution-Update (nur für report_user)
    if (request.body?.resolution !== undefined) {
      if (existing.category !== 'report_user') {
        return reply.code(400).send({ error: 'Resolution nur für Nutzer-Meldungen erlaubt.' });
      }
      const resolution = String(request.body.resolution).trim();
      if (!['no_action', 'action_taken'].includes(resolution)) {
        return reply.code(400).send({ error: 'Ungültige Resolution.' });
      }
      if (resolutionReason.length > 2000) {
        return reply.code(400).send({ error: 'Begründung ist zu lang (max. 2000 Zeichen).' });
      }
      updateData.resolution = resolution;
      updateData.status = 'closed';
      updateData.waitingFor = 'none';
      updateData.unreadAdmin = false;
      updateData.unreadUser = true;

      // Reporter benachrichtigen
      const { createNotification } = await import('../utils/notifications.js');
      const resolutionLabel =
        resolution === 'action_taken' ? 'Maßnahme getroffen' : 'Keine Maßnahme';
      await createNotification(fastify.prisma, {
        userId: existing.userId,
        type: 'system',
        title: 'Entscheidung zu deiner Meldung',
        body: `Deine Nutzer-Meldung „${existing.subject}" wurde bearbeitet: ${resolutionLabel}${resolutionReason ? ' (mit Begründung)' : ''}`,
        entityType: 'feedback',
        entityId: id,
      });
    }

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'Nichts zu aktualisieren.' });
    }

    const updated = await fastify.prisma.feedbackReport.update({
      where: { id },
      data: updateData,
    });

    // Beim Schließen mit Grund während "Wartet auf Support" wird der Grund als letzte Nachricht gespeichert
    if (request.body?.status === 'closed' && isSupportWaiting(existing) && closeReason) {
      await fastify.prisma.feedbackMessage.create({
        data: {
          reportId: id,
          authorId: request.user.id,
          body: `Ticket geschlossen. Grund: ${closeReason}`,
        },
      });
    }

    // Entscheidungsnachricht an den User zustellen
    if (request.body?.resolution !== undefined) {
      const resolutionMessage =
        request.body.resolution === 'action_taken'
          ? `Vielen Dank für deine Meldung. Wir haben den gemeldeten Vorfall geprüft und stimmen deiner Einschätzung zu. Es wurden entsprechende Maßnahmen ergriffen.${resolutionReason ? ` Anmerkung vom Admin: ${resolutionReason}` : ''}`
          : `Vielen Dank für deine Meldung. Wir haben den gemeldeten Vorfall geprüft, konnten dabei jedoch keinen relevanten Verstoß feststellen. Es wurde daher keine Maßnahme ergriffen.${resolutionReason ? ` Die Begründung hierfür ist: ${resolutionReason}` : ''}`;

      await fastify.prisma.feedbackMessage.create({
        data: {
          reportId: id,
          authorId: request.user.id,
          body: resolutionMessage,
        },
      });
    }

    return { report: updated };
  });

  // PATCH /api/feedback/:id/close-by-user – User schließt eigenes Ticket
  fastify.patch('/:id/close-by-user', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const id = String(request.params?.id || '');
    const existing = await fastify.prisma.feedbackReport.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Feedback nicht gefunden.' });
    }
    if (existing.userId !== request.user.id) {
      return reply.code(403).send({ error: 'Kein Zugriff.' });
    }
    if (existing.category === 'report_user') {
      return reply.code(403).send({
        error: 'Nutzer-Meldungen können nur durch Admin-Entscheidung geschlossen werden.',
      });
    }

    const updated = await fastify.prisma.feedbackReport.update({
      where: { id },
      data: {
        status: 'closed',
        waitingFor: 'none',
        unreadAdmin: false,
        unreadUser: false,
      },
    });

    return { report: updated };
  });

  // DELETE /api/feedback/:id – Admin: löschen
  fastify.delete('/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;

    const id = String(request.params?.id || '');
    const existing = await fastify.prisma.feedbackReport.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Feedback nicht gefunden.' });
    }

    await fastify.prisma.feedbackReport.delete({ where: { id } });
    return { ok: true };
  });
}

async function sendFeedbackEmail(
  adminEmail,
  { categoryLabel, senderLabel, subject, body, anonymous }
) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const fromName = process.env.SMTP_FROM || 'Franks Fotoalbum';
  const fromEmail = process.env.SMTP_USER;
  const anonNote = anonymous ? ' <em style="color:#888">(anonym)</em>' : '';
  const safeBody = String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: adminEmail,
    subject: `[Feedback] ${categoryLabel}: ${subject}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8f5f1;border-radius:12px">
        <h2 style="margin:0 0 16px;font-size:16px;color:#1a1410">${categoryLabel}</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:6px 0;font-size:13px;color:#666;width:90px">Von:</td>
              <td style="padding:6px 0;font-size:13px;color:#1a1410">${senderLabel}${anonNote}</td></tr>
          <tr><td style="padding:6px 0;font-size:13px;color:#666">Betreff:</td>
              <td style="padding:6px 0;font-size:13px;color:#1a1410;font-weight:600">${subject}</td></tr>
        </table>
        <div style="background:#fff;border-radius:8px;padding:14px;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap">${safeBody}</div>
      </div>`,
  });
}
