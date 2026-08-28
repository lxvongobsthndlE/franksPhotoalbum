import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { initStorage } from './utils/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// Routes
import authRoutes from './routes/auth.js';
import photosRoutes from './routes/photos.js';
import albumsRoutes from './routes/albums.js';
import commentsRoutes from './routes/comments.js';
import likesRoutes from './routes/likes.js';
import groupsRoutes from './routes/groups.js';
import adminRoutes from './routes/admin.js';
import notificationsRoutes from './routes/notifications.js';
import changelogRoutes from './routes/changelog.js';
import feedbackRoutes from './routes/feedback.js';
import invitesRoutes from './routes/invites.js';
import exportsRoutes from './routes/exports.js';
import tournamentsRoutes from './modules/tournament/index.js';
import groupFeedRoutes from './routes/group-feed.js';
import groupFeedCommentsRoutes from './routes/group-feed-comments.js';
import accountDeletionRoutes, {
  createActiveDeletionGuard,
  startAccountDeletionPurgeTask,
} from './routes/account-deletion.js';
import { recoverPendingUserExports, startUserExportCleanupTask } from './routes/exports.js';

dotenv.config({ path: '.env.local' });

// Logger-Konfiguration: Nur wichtige Events
const loggerConfig =
  process.env.NODE_ENV === 'development'
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            levelFirst: true,
            singleLine: true,
            ignore: 'pid,hostname',
          },
        },
      }
    : true;

const app = Fastify({ logger: loggerConfig });
let stopUserExportCleanupTask = null;
let stopAccountDeletionPurgeTask = null;

// Stelle sicher, dass JS/CSS mit korrektem MIME-Type geladen werden
app.addHook('onSend', (request, reply, payload, done) => {
  if (request.url.endsWith('.js')) {
    reply.header('Content-Type', 'text/javascript; charset=utf-8');
  } else if (request.url.endsWith('.css')) {
    reply.header('Content-Type', 'text/css; charset=utf-8');
  }
  done(null, payload);
});

// Service Worker mit korrekten Headers
app.get('/script/sw.js', async (request, reply) => {
  reply.header('Service-Worker-Allowed', '/');
  reply.header('Content-Type', 'text/javascript; charset=utf-8');
  return reply.sendFile('script/sw.js', path.join(__dirname, '../public'));
});

// Filter: Logge nur API-Requests, nicht statische Dateien
app.addHook('onResponse', (request, reply, done) => {
  const isStatic = request.url.match(/\.(js|css|png|jpg|ico|json|woff|woff2)$/);
  const isHealth = request.url === '/health';

  if (isStatic || isHealth) {
    done();
    return;
  }

  if (reply.statusCode >= 400) {
    app.log.warn({
      method: request.method,
      url: request.url,
      status: reply.statusCode,
    });
  }

  done();
});

// Plugins
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie, { secret: process.env.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });
await app.register(jwt, { secret: process.env.JWT_SECRET });
await app.register(rateLimit, { global: false });

// Prisma als Decorator verfügbar machen
app.decorate('prisma', prisma);

app.addHook('preHandler', createActiveDeletionGuard({ prisma, jwt: app.jwt }));

// Routes (vor Static!)
app.register(authRoutes, { prefix: '/api/auth' });
app.register(photosRoutes, { prefix: '/api/photos' });
app.register(albumsRoutes, { prefix: '/api/albums' });
app.register(commentsRoutes, { prefix: '/api/comments' });
app.register(likesRoutes, { prefix: '/api/likes' });
app.register(groupsRoutes, { prefix: '/api/groups' });
app.register(adminRoutes, { prefix: '/api/admin' });
app.register(notificationsRoutes, { prefix: '/api/notifications' });
app.register(changelogRoutes, { prefix: '/api/changelog' });
app.register(feedbackRoutes, { prefix: '/api/feedback' });
app.register(invitesRoutes, { prefix: '/api/invites' });
app.register(exportsRoutes, { prefix: '/api/exports' });
app.register(tournamentsRoutes, { prefix: '/api/tournaments' });

app.register(groupFeedRoutes, { prefix: '/api/group-feed' });
app.register(groupFeedCommentsRoutes, { prefix: '/api/group-feed' });
app.register(accountDeletionRoutes, { prefix: '/api/account-deletion' });

// OIDC Callback: Authentik redirectet auf /auth/callback → Frontend-SPA laden, die den Code verarbeitet
app.get('/auth/callback', async (request, reply) => {
  const qs = new URLSearchParams(request.query).toString();
  return reply.redirect(`/?${qs}`);
});

// Zuschauer-Link: /t/<adresse> liefert die öffentliche Turnier-Ansicht.
//
// `<adresse>` ist entweder der Zufalls-Token oder der selbst gewählte
// Name des Links (28.08.2026). Hier wird nicht unterschieden und nichts
// geprüft: Diese Route liefert ausschließlich eine statische Seite aus.
// Ob die Adresse gültig ist, entscheidet allein
// GET /api/tournaments/public/:ref — eine Prüfung an DIESER Stelle wäre
// eine zweite Wahrheit über denselben Zugang und würde beim nächsten
// Umbau auseinanderlaufen.
//
// Eine eigene, sehr kleine Seite — bewusst NICHT die SPA. Ein Zuschauer
// ohne Konto soll gar nicht erst den angemeldeten Client laden: kein
// Login-Zustand, keine mutierenden Knöpfe, kein Admin-Code im Speicher.
app.get('/t/:ref', async (request, reply) => {
  return reply.sendFile('live.html', path.join(__dirname, '../public'));
});

// Der Aushang: ein Blatt mit großem QR-Code zum Ausdrucken und Aufhängen.
// Braucht keine eigene Berechtigung — wer die Adresse hat, hat ohnehin
// Zugang, und der Aushang zeigt nichts, was die Ansicht nicht zeigt.
//
// `aushang` steht deshalb auf der Sperrliste in public-slug.js: Ein
// Turnier, das sich selbst so nennt, ergäbe /t/aushang/aushang.
app.get('/t/:ref/aushang', async (request, reply) => {
  return reply.sendFile('aushang.html', path.join(__dirname, '../public'));
});

// Health Check
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Static Files & SPA (nach API Routes!)
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/',
  // Wir setzen KEINEN Long-Term-Cache für JS/CSS/HTML. Wenn der User
  // einen Tab offen lässt und wir ein File editieren, soll der nächste
  // Reload die neue Version sehen — ohne Hard-Reload (Strg+Shift+R).
  // Warum: dev-with-minio.mjs startet den Server mit `--watch`, aber
  // der Browser cached Frontend-Assets sehr aggressiv. Ein Hard-Reload
  // umgeht den Cache, ist aber UX-schlecht. In Production (NODE_ENV !==
  // 'development') bleibt das Verhalten unverändert.
  cacheControl: false,
});

// Dev-Mode: explizit `Cache-Control: no-store` auf JS/CSS/HTML-Responses,
// damit Browser-F5 (nicht Ctrl+F5) bereits die neue Version zieht.
// In Production (NODE_ENV=production) ist die Middleware inaktiv.
if ((process.env.NODE_ENV || 'development') === 'development') {
  app.addHook('onSend', async (request, reply, payload) => {
    const url = request.url || '';
    if (
      url.startsWith('/script/') ||
      url.startsWith('/style/') ||
      url === '/' ||
      url.endsWith('.html') ||
      url.endsWith('.js') ||
      url.endsWith('.css')
    ) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}

const start = async () => {
  try {
    await initStorage();
    const port = process.env.PORT || 3000;
    const env = process.env.NODE_ENV || 'development';
    await app.listen({ port, host: '0.0.0.0' });

    // Verwaiste Exporte (queued/running nach Neustart) wieder in die Queue aufnehmen
    try {
      const recovery = await recoverPendingUserExports(app);
      if (recovery.requeued > 0) {
        app.log.warn(
          {
            found: recovery.found,
            normalizedRunning: recovery.normalizedRunning,
            requeued: recovery.requeued,
          },
          'Verwaiste Exporte beim Start erneut eingeplant'
        );
      }
    } catch (err) {
      app.log.error(err, 'Export-Recovery beim Start fehlgeschlagen');
    }

    stopUserExportCleanupTask = startUserExportCleanupTask(app);
    stopAccountDeletionPurgeTask = startAccountDeletionPurgeTask(app);
    const isProd = env === 'production';

    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
    const oidcConfigured = !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID);
    const catchAll = process.env.DEV_MAIL_CATCHALL;
    const minioHost = process.env.MINIO_ENDPOINT || '(nicht konfiguriert)';
    const minioPort = process.env.MINIO_PORT || '9000';

    let dbName = process.env.POSTGRES_DB || '(nicht konfiguriert)';
    let dbUser = process.env.POSTGRES_USER || '(nicht konfiguriert)';
    if (
      (dbName === '(nicht konfiguriert)' || dbUser === '(nicht konfiguriert)') &&
      process.env.DATABASE_URL
    ) {
      try {
        const dbUrl = new URL(process.env.DATABASE_URL);
        if (dbName === '(nicht konfiguriert)') {
          dbName = dbUrl.pathname.replace(/^\//, '') || '(nicht konfiguriert)';
        }
        if (dbUser === '(nicht konfiguriert)') {
          dbUser = dbUrl.username || '(nicht konfiguriert)';
        }
      } catch {
        if (dbName === '(nicht konfiguriert)') dbName = '(unbekannt)';
        if (dbUser === '(nicht konfiguriert)') dbUser = '(unbekannt)';
      }
    }

    const row = (label, value) => `  ${label.padEnd(12)}: ${value}`;
    const lines = [
      row('Umgebung', env),
      row('Port', String(port)),
      row('DB-Name', dbName),
      row('DB-User', dbUser),
      row('MinIO', `${minioHost}:${minioPort}`),
      row('OIDC', oidcConfigured ? process.env.OIDC_ISSUER : '(nicht konfiguriert)'),
      smtpConfigured ? row('SMTP', process.env.SMTP_HOST) : row('SMTP', '(nicht konfiguriert)'),
      smtpConfigured ? row('SMTP-User', process.env.SMTP_USER) : null,
      smtpConfigured && !isProd
        ? row('DEV-Mail', catchAll ? `-> ${catchAll}` : '(kein Versand - kein Catch-All)')
        : null,
    ].filter(Boolean);
    const width = Math.max(28, ...lines.map((l) => l.length));
    const sep = '='.repeat(width);

    console.log('');
    console.log(sep);
    console.log('  [kru:]nest Backend');
    console.log(sep);
    lines.forEach((l) => console.log(l));
    console.log(sep);
    console.log('');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

process.on('SIGINT', () => {
  if (stopUserExportCleanupTask) stopUserExportCleanupTask();
  if (stopAccountDeletionPurgeTask) stopAccountDeletionPurgeTask();
});

process.on('SIGTERM', () => {
  if (stopUserExportCleanupTask) stopUserExportCleanupTask();
  if (stopAccountDeletionPurgeTask) stopAccountDeletionPurgeTask();
});
