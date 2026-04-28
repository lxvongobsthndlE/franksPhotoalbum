import crypto from 'crypto';
import {
  getAuthorizationUrl,
  handleCallback,
  initializeOIDC,
  getEndSessionUrl,
} from '../utils/oidc.js';
import { uploadAvatar, getAvatarStream, getAvatarStat, deleteAvatar } from '../utils/storage.js';

// Session-Management (In Production: Redis verwenden)
const stateStore = new Map();

// Normalisiert alte presigned MinIO-Avatar-URLs auf Proxy-URLs
function normalizeAvatarUrl(avatar, userId) {
  if (!avatar) return avatar;
  if (avatar.startsWith('/api/')) return avatar; // schon Proxy-URL
  return `/api/auth/avatar/${userId}`;
}

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizePreferredUsername(value) {
  if (!value) return null;
  return (
    String(value)
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || null
  );
}

function createSessionTokens(fastify, userId, email, username) {
  // Access Token: 15 Minuten
  const accessToken = fastify.jwt.sign(
    { id: userId, email, username, type: 'access' },
    { expiresIn: '15m' }
  );

  // Refresh Token: 7 Tage
  const refreshToken = fastify.jwt.sign({ id: userId, type: 'refresh' }, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

async function syncUserFromOIDC(fastify, userInfo) {
  const { email, preferred_username, name } = userInfo;
  const normalizedPreferredUsername = normalizePreferredUsername(preferred_username);
  const authSourceClaim =
    typeof userInfo?.auth_source === 'string' && userInfo.auth_source.trim()
      ? userInfo.auth_source.trim().slice(0, 128)
      : null;
  // name: nur den echten name-Claim speichern, kein Fallback – null wenn nicht gesetzt
  const realName = name && name.trim() ? name.trim() : null;

  // 1) Primär nach E-Mail matchen
  let user = await fastify.prisma.user.findUnique({
    where: { email },
  });

  // 2) Falls nicht gefunden, anhand preferred_username matchen
  //    (wichtig für Supabase-Migration: Authentik preferred_username == alter Supabase username)
  if (!user && normalizedPreferredUsername) {
    user = await fastify.prisma.user.findUnique({
      where: { username: normalizedPreferredUsername },
    });
  }

  // 3) Falls weiterhin nicht gefunden, neuen User erstellen
  const targetUsername = normalizedPreferredUsername || email.split('@')[0];
  const displayNameFieldForCreate = realName ? 'name' : 'username';

  if (!user) {
    // Erstelle neuen User (immer mit role "user")
    user = await fastify.prisma.user.create({
      data: {
        email,
        username: targetUsername,
        name: realName,
        auth_source: authSourceClaim || 'authentik',
        displayNameField: displayNameFieldForCreate,
        color: `hsl(${Math.random() * 360}, 70%, 70%)`,
        lastLoginAt: new Date(),
      },
    });
  } else {
    // Update User mit neuen Daten von Authentik
    // username nur setzen, wenn frei oder bereits eigener Name
    let usernameForUpdate = user.username;
    if (normalizedPreferredUsername && normalizedPreferredUsername !== user.username) {
      const conflict = await fastify.prisma.user.findUnique({
        where: { username: normalizedPreferredUsername },
      });
      if (!conflict || conflict.id === user.id) {
        usernameForUpdate = normalizedPreferredUsername;
      }
    }

    // Wenn kein echter Name vorhanden ist und der User noch auf "name" steht,
    // auf "username" umstellen, damit UI nicht mit leerem Anzeigenamen rendert.
    const displayNameFieldForUpdate =
      !realName && (user.displayNameField || 'name') === 'name'
        ? 'username'
        : user.displayNameField;

    user = await fastify.prisma.user.update({
      where: { id: user.id },
      data: {
        name: realName,
        username: usernameForUpdate,
        displayNameField: displayNameFieldForUpdate,
        email,
        auth_source: authSourceClaim || user.auth_source || 'authentik',
        lastLoginAt: new Date(),
      },
    });
  }

  return user;
}

export default async function authRoutes(fastify) {
  // GET /api/auth/login - Leite zu Authentik weiter
  fastify.get('/login', async (request, reply) => {
    try {
      fastify.log.info('LOGIN: Initializing OIDC...');
      await initializeOIDC();
      fastify.log.info('LOGIN: OIDC initialized successfully');

      const state = generateState();
      const nonce = generateNonce();

      // Speichere state/nonce für Validation beim Callback
      stateStore.set(state, { nonce, createdAt: Date.now() });

      const authUrl = getAuthorizationUrl(state, nonce);
      fastify.log.info('LOGIN: Generated auth URL');

      return { loginUrl: authUrl };
    } catch (err) {
      fastify.log.error('LOGIN ERROR:', err);
      return reply.code(500).send({ error: 'Failed to initialize OIDC', details: err.message });
    }
  });

  // GET /api/auth/callback - OIDC Callback Handler
  fastify.get('/callback', async (request, reply) => {
    try {
      await initializeOIDC();

      const { code, state, error, error_description } = request.query;

      if (error) {
        return reply.code(400).send({
          error: error_description || 'OIDC error occurred',
        });
      }

      // Validiere state
      const storedState = stateStore.get(state);
      if (!storedState) {
        return reply.code(400).send({ error: 'Invalid or expired state' });
      }

      // Check state nicht älter als 10 Minuten
      if (Date.now() - storedState.createdAt > 10 * 60 * 1000) {
        stateStore.delete(state);
        return reply.code(400).send({ error: 'State expired' });
      }

      // Hole Token von Authentik
      const tokenSet = await handleCallback(code, state);
      const userInfo = tokenSet.claims();

      // TEMP DEBUG: zeigt den von Authentik gelieferten auth_source-Claim.
      fastify.log.info({ auth_source: userInfo?.auth_source ?? null }, 'OIDC auth_source claim');

      // Sync/create user in DB
      const user = await syncUserFromOIDC(fastify, userInfo);

      // Generiere Session Tokens
      const { accessToken, refreshToken } = createSessionTokens(
        fastify,
        user.id,
        user.email,
        user.username
      );

      // Setze Refresh Token als HttpOnly Cookie
      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Tage
      });

      // Speichere id_token für späteren OIDC-Logout
      if (tokenSet.id_token) {
        reply.setCookie('oidcIdToken', tokenSet.id_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }

      // Cleanup
      stateStore.delete(state);

      // Return Access Token & User Info
      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          auth_source: user.auth_source,
          role: user.role,
          color: user.color,
          avatar: normalizeAvatarUrl(user.avatar, user.id),
          displayNameField: user.displayNameField || 'name',
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Callback processing failed' });
    }
  });

  // POST /api/auth/refresh - Erneuere Access Token mit Refresh Token
  fastify.post('/refresh', async (request, reply) => {
    try {
      const refreshToken = request.cookies.refreshToken;

      if (!refreshToken) {
        return reply.code(401).send({ error: 'No refresh token' });
      }

      // Verifiziere Refresh Token
      const decoded = fastify.jwt.verify(refreshToken);

      if (decoded.type !== 'refresh') {
        return reply.code(401).send({ error: 'Invalid token type' });
      }

      // Hole User aus DB
      const user = await fastify.prisma.user.findUnique({
        where: { id: decoded.id },
      });

      if (!user) {
        return reply.code(401).send({ error: 'User not found' });
      }

      // Generiere neuen Access Token
      const accessToken = fastify.jwt.sign(
        { id: user.id, email: user.email, username: user.username, type: 'access' },
        { expiresIn: '15m' }
      );

      return { accessToken };
    } catch (err) {
      return reply.code(401).send({ error: 'Token refresh failed' });
    }
  });

  // GET /api/auth/me (protected) - Hole aktuellen User
  fastify.get('/me', async (request, reply) => {
    try {
      await request.jwtVerify();

      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        include: { groups: { include: { group: true } } },
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          auth_source: user.auth_source,
          role: user.role,
          color: user.color,
          avatar: normalizeAvatarUrl(user.avatar, user.id),
          displayNameField: user.displayNameField || 'name',
        },
        groups: user.groups.map((gm) => gm.group),
      };
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // POST /api/auth/avatar - Avatar-Upload (protected)
  fastify.post('/avatar', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;

      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'Keine Datei' });

      const buf = await data.toBuffer();
      await uploadAvatar(buf, data.mimetype || 'image/jpeg', userId);
      // Proxy-URL statt direkter MinIO-URL in DB speichern
      const avatarUrl = `/api/auth/avatar/${userId}`;

      await fastify.prisma.user.update({
        where: { id: userId },
        data: { avatar: avatarUrl },
      });

      return { avatarUrl };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Avatar-Upload fehlgeschlagen' });
    }
  });

  // DELETE /api/auth/avatar - Avatar löschen (protected)
  fastify.delete('/avatar', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      await deleteAvatar(userId);
      await fastify.prisma.user.update({
        where: { id: userId },
        data: { avatar: null },
      });
      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Avatar konnte nicht gelöscht werden' });
    }
  });

  // GET /api/auth/avatar/:userId - Avatar-Datei streamen (öffentlich, kein Auth nötig)
  fastify.get('/avatar/:userId', async (request, reply) => {
    try {
      const stat = await getAvatarStat(request.params.userId);
      const stream = await getAvatarStream(request.params.userId);
      reply
        .header('Content-Type', stat.metaData['content-type'] || 'image/jpeg')
        .header('Content-Length', stat.size)
        .header('Cache-Control', 'private, no-cache, no-store, must-revalidate')
        .header('Pragma', 'no-cache')
        .header('Expires', '0');
      return reply.send(stream);
    } catch (err) {
      return reply.code(404).send({ error: 'Avatar nicht gefunden' });
    }
  });

  // PATCH /api/auth/profile - Profil aktualisieren (Farbe, Anzeigename)
  fastify.patch('/profile', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { color, displayNameField } = request.body;
      const data = {};
      if (color !== undefined) {
        if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
          return reply.code(400).send({ error: 'Ungültige Farbe' });
        }
        data.color = color;
      }
      if (displayNameField !== undefined) {
        if (displayNameField !== 'name' && displayNameField !== 'username') {
          return reply.code(400).send({ error: 'Ungültiger Anzeigename-Modus' });
        }
        data.displayNameField = displayNameField;
      }
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Keine Änderungen angegeben' });
      }
      await fastify.prisma.user.update({ where: { id: userId }, data });
      return { ok: true, ...data };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Profil konnte nicht gespeichert werden' });
    }
  });

  // GET /api/auth/logout-url - Gibt die Authentik End-Session-URL zurück
  fastify.get('/logout-url', async (request, reply) => {
    const idToken = request.cookies.oidcIdToken || null;
    const redirectUri =
      process.env.NODE_ENV === 'production'
        ? process.env.OIDC_REDIRECT_URI_PROD
        : process.env.OIDC_REDIRECT_URI_DEV || 'http://localhost:3000/auth/callback';
    // Post-logout redirect zur App-Root (nicht zum Callback)
    const appBase = new URL(redirectUri).origin;
    const endSessionUrl = getEndSessionUrl(idToken, appBase);
    return { endSessionUrl };
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    // Cookies immer löschen, auch ohne gültigen Token
    reply.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    reply.clearCookie('oidcIdToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { status: 'logged_out' };
  });
}
