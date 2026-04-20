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

dotenv.config({ path: '.env.local' });

// Logger-Konfiguration: Nur wichtige Events
const loggerConfig = process.env.NODE_ENV === 'development' ? {
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: true,
      singleLine: true,
      ignore: 'pid,hostname'
    }
  }
} : true;

const app = Fastify({ logger: loggerConfig });

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
      status: reply.statusCode
    });
  }
  
  done();
});

// Plugins
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie, { secret: process.env.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(jwt, { secret: process.env.JWT_SECRET });
await app.register(rateLimit, { global: false });

// Prisma als Decorator verfügbar machen
app.decorate('prisma', prisma);

// Routes (vor Static!)
app.register(authRoutes, { prefix: '/api/auth' });
app.register(photosRoutes, { prefix: '/api/photos' });
app.register(albumsRoutes, { prefix: '/api/albums' });
app.register(commentsRoutes, { prefix: '/api/comments' });
app.register(likesRoutes, { prefix: '/api/likes' });
app.register(groupsRoutes, { prefix: '/api/groups' });
app.register(adminRoutes, { prefix: '/api/admin' });
app.register(notificationsRoutes, { prefix: '/api/notifications' });

// OIDC Callback: Authentik redirectet auf /auth/callback → Frontend-SPA laden, die den Code verarbeitet
app.get('/auth/callback', async (request, reply) => {
  const qs = new URLSearchParams(request.query).toString();
  return reply.redirect(`/?${qs}`);
});

// Health Check
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Static Files & SPA (nach API Routes!)
await app.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/'
});

const start = async () => {
  try {
    await initStorage();
    await app.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });

    const port = process.env.PORT || 3000;
    const env  = process.env.NODE_ENV || 'development';
    const isProd = env === 'production';

    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
    const oidcConfigured = !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID);
    const catchAll       = process.env.DEV_MAIL_CATCHALL;

    const row  = (label, value) => `  ${label.padEnd(12)}: ${value}`;
    const values = [
      row('Umgebung', env),
      row('Port', String(port)),
      row('OIDC', oidcConfigured ? process.env.OIDC_ISSUER : '(nicht konfiguriert)'),
      smtpConfigured ? row('SMTP', process.env.SMTP_HOST) : null,
      smtpConfigured ? row('SMTP-User', process.env.SMTP_USER) : null,
      smtpConfigured && !isProd ? row('DEV-Mail', catchAll ? `-> ${catchAll}` : '(kein Versand - kein Catch-All)') : null,
      !smtpConfigured ? row('SMTP', '(nicht konfiguriert)') : null,
    ].filter(Boolean);
    const width = Math.max(28, ...values.map(v => v.length));
    const line  = '='.repeat(width);

    console.log('');
    console.log(line);
    console.log('  Franks Fotoalbum Backend');
    console.log(line);
    console.log(row('Umgebung', env));
    console.log(row('Port', String(port)));
    console.log(row('OIDC', oidcConfigured ? process.env.OIDC_ISSUER : '(nicht konfiguriert)'));
    console.log(line);
    if (smtpConfigured) {
      console.log(row('SMTP', process.env.SMTP_HOST));
      console.log(row('SMTP-User', process.env.SMTP_USER));
      if (!isProd) {
        const mailMode = catchAll ? `-> ${catchAll}` : '(kein Versand - kein Catch-All)';
        console.log(row('DEV-Mail', mailMode));
      }
    } else {
      console.log(row('SMTP', '(nicht konfiguriert)'));
    }
    console.log(line);
    console.log('');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
