import nodemailer from 'nodemailer';

// ── SSE-Client-Registry ─────────────────────────────────────
// Map<userId, Set<Reply>> — ein User kann mehrere Tabs offen haben
const sseClients = new Map();

export function addSseClient(userId, reply) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(reply);
}

export function removeSseClient(userId, reply) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(reply);
  if (set.size === 0) sseClients.delete(userId);
}

function pushSse(userId, event, data) {
  const set = sseClients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of set) {
    try {
      reply.raw.write(payload);
    } catch (_) {
      /* Tab geschlossen */
    }
  }
}

// ── E-Mail-Transport ────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
}

// Gibt die tatsächliche Empfängeradresse zurück.
// Im DEV-Modus ohne DEV_MAIL_CATCHALL wird null zurückgegeben → kein Versand.
// Alle DEV-Versandentscheidungen werden hier getroffen; sendNotificationEmail
// wertet nur noch den Rückgabewert aus.
function resolveEmailAddress(email) {
  if (process.env.NODE_ENV === 'production') return email;
  const catchAll = process.env.DEV_MAIL_CATCHALL; // z.B. "dev@example.de" oder "${local}@catchall.example.de"
  if (!catchAll) return null; // DEV ohne Catch-All → kein Versand
  const localPart = email.split('@')[0];
  return catchAll.includes('${local}') ? catchAll.replace('${local}', localPart) : catchAll;
}

async function sendNotificationEmail(user, { title, body, entityUrl }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return; // SMTP nicht konfiguriert
  const isProd = process.env.NODE_ENV === 'production';
  const to = resolveEmailAddress(user.email);
  if (!to) return; // DEV ohne Catch-All → kein Versand
  const isRedirected = !isProd && to !== user.email;
  const fromEmail = process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM || 'Franks Fotoalbum';
  const from = `"${fromName}" <${fromEmail}>`;
  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f5f1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5f1;padding:36px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(100,70,40,.10)">

        <!-- Header -->
        <tr><td style="background:#8a6a4a;padding:22px 28px">
          <span style="color:#fff;font-size:19px;font-weight:700;letter-spacing:-.2px">📷 Franks Fotoalbum</span>
          ${!isProd ? '<span style="margin-left:12px;background:rgba(255,255,255,.18);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600">DEV</span>' : ''}
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:30px 28px 24px">
          <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:#1a1410;line-height:1.4">${title}</h2>
          <p style="margin:0 0 26px;font-size:15px;color:#4a3f35;line-height:1.65">${body}</p>
          ${entityUrl ? `<a href="${entityUrl}" style="display:inline-block;background:#8a6a4a;color:#ffffff;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:.1px">Jetzt ansehen →</a>` : ''}
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 28px"><div style="height:1px;background:#ede8e0"></div></td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 28px 22px">
          <p style="margin:0 0 4px;font-size:12px;color:#9e8e7e;line-height:1.6">
            Du erhältst diese E-Mail, weil du in deinem Profil unter
            <strong style="color:#8a6a4a">Benachrichtigungen</strong>
            die entsprechende Option aktiviert hast.
            Du kannst diese Einstellung jederzeit in deinem
            <strong style="color:#8a6a4a">Profil → Benachrichtigungen</strong> anpassen.
          </p>
          ${isRedirected ? `<p style="margin:8px 0 0;font-size:11px;color:#b8a898;font-style:italic">DEV-Modus — eigentlicher Empfänger: ${user.email}</p>` : ''}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await getTransporter().sendMail({
      from,
      to,
      subject: title,
      html,
      headers: isRedirected ? { 'X-Original-To': user.email } : {},
    });
  } catch (err) {
    console.error('[notifications] E-Mail-Fehler:', err.message);
  }
}

// ── Haupt-Funktion ──────────────────────────────────────────
/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ userId: string, type: string, title: string, body: string, entityId?: string, entityType?: string, entityUrl?: string, imageUrl?: string }} params
 */
export async function createNotification(
  prisma,
  { userId, type, title, body, entityId, entityType, entityUrl, imageUrl }
) {
  // Präferenzen laden — falls noch kein Eintrag existiert, jetzt anlegen damit
  // die Prisma-Schema-Defaults (z.B. email_photoCommented=true) greifen.
  let prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!prefs) {
    try {
      prefs = await prisma.notificationPreference.create({ data: { userId } });
    } catch {
      // Race condition (parallele Requests) — nochmal laden
      prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    }
  }

  const inAppKey = `inApp_${type}`;
  const emailKey = `email_${type}`;

  // Falls der Typ unbekannt ist (key nicht im Modell), sicherer Fallback
  // System-Benachrichtigungen sind immer in-app aktiv (nicht deaktivierbar)
  const doInApp = type === 'system' ? true : (prefs?.[inAppKey] ?? true);
  const doEmail = prefs?.[emailKey] ?? false;

  let notification = null;

  if (doInApp) {
    notification = await prisma.notification.create({
      data: { userId, type, title, body, entityId, entityType, imageUrl, entityUrl },
    });
    // SSE-Push an alle offenen Tabs des Users
    pushSse(userId, 'notification', {
      id: notification.id,
      type,
      title,
      body,
      entityId,
      entityType,
      imageUrl,
      entityUrl,
      read: false,
      createdAt: notification.createdAt,
    });
  }

  if (doEmail) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, username: true },
    });
    if (user) {
      // fire-and-forget
      sendNotificationEmail(user, { title, body, entityUrl }).catch(() => {});
    }
  }

  return notification;
}
