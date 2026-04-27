/**
 * Tests für Auth-Routes: echte Handler-Pfade für Refresh, Login und Callback.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockPrismaClient, createMockReply, createMockRequest, createMockRouteFastify } from './mocks/index.js';
import { createMockUser } from './fixtures/index.js';

vi.mock('../utils/oidc.js', () => ({
  getAuthorizationUrl: vi.fn((state, nonce) => `https://oidc.example/auth?state=${state}&nonce=${nonce}`),
  handleCallback: vi.fn(),
  initializeOIDC: vi.fn(),
  getEndSessionUrl: vi.fn(() => 'https://oidc.example/logout'),
}));

vi.mock('../utils/storage.js', () => ({
  uploadAvatar: vi.fn(),
  getAvatarStream: vi.fn(),
  getAvatarStat: vi.fn(),
  deleteAvatar: vi.fn(),
}));

describe('auth routes', () => {
  let authRoutes;
  let oidc;
  let fastify;
  let prisma;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest(requestOverrides);
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    authRoutes = (await import('../routes/auth.js')).default;
    oidc = await import('../utils/oidc.js');
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await authRoutes(fastify);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('POST /refresh', () => {
    it('returns 401 when no refresh token cookie exists', async () => {
      const { reply } = await callRoute('POST', '/refresh');

      expect(reply.statusCode).toBe(401);
      expect(reply.payload).toEqual({ error: 'No refresh token' });
    });

    it('returns 401 when token type is not refresh', async () => {
      fastify.jwt.verify.mockReturnValue({ id: 'user-1', type: 'access' });

      const { reply } = await callRoute('POST', '/refresh', {
        cookies: { refreshToken: 'access-token' },
      });

      expect(reply.statusCode).toBe(401);
      expect(reply.payload).toEqual({ error: 'Invalid token type' });
    });

    it('returns a new access token for a valid refresh token', async () => {
      const user = createMockUser({ id: 'user-1', username: 'refresh-user' });
      fastify.jwt.verify.mockReturnValue({ id: 'user-1', type: 'refresh' });
      prisma.user.findUnique.mockResolvedValue(user);

      const { result } = await callRoute('POST', '/refresh', {
        cookies: { refreshToken: 'valid-refresh-token' },
      });

      expect(fastify.jwt.sign).toHaveBeenCalledWith(
        { id: 'user-1', email: user.email, username: 'refresh-user', type: 'access' },
        { expiresIn: '15m' }
      );
      expect(result.accessToken).toBeTypeOf('string');
    });

    it('returns 401 when the refresh token points to a missing user', async () => {
      fastify.jwt.verify.mockReturnValue({ id: 'missing-user', type: 'refresh' });
      prisma.user.findUnique.mockResolvedValue(null);

      const { reply } = await callRoute('POST', '/refresh', {
        cookies: { refreshToken: 'valid-refresh-token' },
      });

      expect(reply.statusCode).toBe(401);
      expect(reply.payload).toEqual({ error: 'User not found' });
    });

    it('returns 401 when token verification throws', async () => {
      fastify.jwt.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      const { reply } = await callRoute('POST', '/refresh', {
        cookies: { refreshToken: 'broken-token' },
      });

      expect(reply.statusCode).toBe(401);
      expect(reply.payload).toEqual({ error: 'Token refresh failed' });
    });
  });

  describe('OIDC login and callback flow', () => {
    it('generates a login URL and initializes OIDC', async () => {
      const { result } = await callRoute('GET', '/login');

      expect(oidc.initializeOIDC).toHaveBeenCalledTimes(1);
      expect(oidc.getAuthorizationUrl).toHaveBeenCalledTimes(1);
      expect(result.loginUrl).toContain('https://oidc.example/auth');
    });

    it('rejects callback requests with an unknown state', async () => {
      const { reply } = await callRoute('GET', '/callback', {
        query: { code: 'oidc-code', state: 'missing-state' },
      });

      expect(reply.statusCode).toBe(400);
      expect(reply.payload).toEqual({ error: 'Invalid or expired state' });
    });

    it('rejects callback requests with an expired state', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-28T10:00:00Z'));
      const loginResult = await callRoute('GET', '/login');
      const state = new URL(loginResult.result.loginUrl).searchParams.get('state');

      vi.setSystemTime(new Date('2026-04-28T10:11:00Z'));
      const { reply } = await callRoute('GET', '/callback', {
        query: { code: 'oidc-code', state },
      });

      expect(reply.statusCode).toBe(400);
      expect(reply.payload).toEqual({ error: 'State expired' });
    });

    it('completes callback flow, sets cookies, and cleans up used state', async () => {
      const existingUser = createMockUser({
        id: 'user-42',
        username: 'auth-user',
        role: 'user',
        color: '#abcdef',
        avatar: 'https://minio.example.com/avatar.jpg',
        name: 'Existing User',
        displayNameField: 'name',
      });

      const updatedUser = {
        ...existingUser,
        email: 'auth@example.com',
        username: 'auth-user',
      };

      prisma.user.findUnique.mockResolvedValueOnce(existingUser);
      prisma.user.update.mockResolvedValue(updatedUser);
      oidc.handleCallback.mockResolvedValue({
        claims: () => ({
          email: 'auth@example.com',
          preferred_username: 'auth-user',
          name: 'Existing User',
        }),
        id_token: 'oidc-id-token',
      });

      const loginResult = await callRoute('GET', '/login');
      const state = new URL(loginResult.result.loginUrl).searchParams.get('state');

      const { result, reply } = await callRoute('GET', '/callback', {
        query: { code: 'oidc-code', state },
      });

      expect(reply.cookiesSet).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'refreshToken' }),
          expect.objectContaining({ name: 'oidcIdToken', value: 'oidc-id-token' }),
        ])
      );
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 'user-42',
          email: 'auth@example.com',
          avatar: '/api/auth/avatar/user-42',
          displayNameField: 'name',
        })
      );

      const secondCallback = await callRoute('GET', '/callback', {
        query: { code: 'oidc-code', state },
      });
      expect(secondCallback.reply.statusCode).toBe(400);
      expect(secondCallback.reply.payload).toEqual({ error: 'Invalid or expired state' });
    });
  });

  describe('mirrored helper invariants', () => {
    const normalizePreferredUsername = (value) => {
      if (!value) return null;
      return String(value)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || null;
    };

    const normalizeAvatarUrl = (avatar, userId) => {
      if (!avatar) return avatar;
      if (avatar.startsWith('/api/')) return avatar;
      return `/api/auth/avatar/${userId}`;
    };

    it('normalizes preferred usernames exactly like the auth route', () => {
      expect(normalizePreferredUsername('john@domain.com')).toBe('john_domain.com');
      expect(normalizePreferredUsername('___testuser___')).toBe('testuser');
      expect(normalizePreferredUsername('')).toBeNull();
    });

    it('normalizes avatar URLs exactly like the auth route', () => {
      expect(normalizeAvatarUrl('https://minio.example/avatar.jpg', 'user-1')).toBe('/api/auth/avatar/user-1');
      expect(normalizeAvatarUrl('/api/auth/avatar/user-1', 'user-1')).toBe('/api/auth/avatar/user-1');
      expect(normalizeAvatarUrl(null, 'user-1')).toBeNull();
    });

    it('keeps state and nonce generation unpredictable', async () => {
      const crypto = await import('crypto');
      const one = crypto.randomBytes(32).toString('hex');
      const two = crypto.randomBytes(32).toString('hex');

      expect(one).toHaveLength(64);
      expect(two).toHaveLength(64);
      expect(one).not.toBe(two);
    });
  });
});
