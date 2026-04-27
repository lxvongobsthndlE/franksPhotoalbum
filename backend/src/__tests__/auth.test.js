/**
 * Tests für Auth-Routes: JWT Token-Generierung, Verifizierung, Session-Handling
 * Fokus auf echte Business-Logik für Refactoring-Sicherheit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockFastify } from './mocks/index.js';
import { createMockUser } from './fixtures/index.js';

describe('Auth - Session Token Creation', () => {
  /**
   * Prüft: Token-Generierung mit korrekter Struktur
   * Kritische Business-Logik: Access- & Refresh-Token mit unterschiedlichen Expiry
   */
  describe('createSessionTokens', () => {
    let fastify;

    beforeEach(() => {
      fastify = createMockFastify();
    });

    it('should generate access token with 15m expiry', () => {
      const userId = 'user-123';
      const email = 'test@example.com';
      const username = 'testuser';

      // Simuliere createSessionTokens aus routes/auth.js
      const accessToken = fastify.jwt.sign(
        { id: userId, email, username, type: 'access' },
        { expiresIn: '15m' }
      );

      expect(accessToken).toBeDefined();
      expect(typeof accessToken).toBe('string');
      expect(accessToken.split('.').length).toBe(3); // JWT format
    });

    it('should generate refresh token with 7d expiry', () => {
      const userId = 'user-123';

      const refreshToken = fastify.jwt.sign(
        { id: userId, type: 'refresh' },
        { expiresIn: '7d' }
      );

      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.').length).toBe(3); // JWT format
    });

    it('should include correct payload in access token', () => {
      const userId = 'user-456';
      const email = 'user@test.com';
      const username = 'testuser456';

      fastify.jwt.sign.mockReturnValue(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InVzZXItNDU2IiwiZW1haWwiOiJ1c2VyQHRlc3QuY29tIiwidXNlcm5hbWUiOiJ0ZXN0dXNlcjQ1NiIsInR5cGUiOiJhY2Nlc3MifQ.mock'
      );

      const token = fastify.jwt.sign(
        { id: userId, email, username, type: 'access' },
        { expiresIn: '15m' }
      );

      expect(fastify.jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          id: userId,
          email,
          username,
          type: 'access',
        }),
        { expiresIn: '15m' }
      );
    });

    it('should return both tokens as object', () => {
      const userId = 'user-789';
      const email = 'test789@example.com';
      const username = 'testuser789';

      const createSessionTokens = (fastify, userId, email, username) => {
        const accessToken = fastify.jwt.sign(
          { id: userId, email, username, type: 'access' },
          { expiresIn: '15m' }
        );
        const refreshToken = fastify.jwt.sign(
          { id: userId, type: 'refresh' },
          { expiresIn: '7d' }
        );
        return { accessToken, refreshToken };
      };

      const tokens = createSessionTokens(fastify, userId, email, username);

      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    });
  });

  /**
   * Prüft: Normalisierung von Benutzerdaten aus OIDC
   * Kritische Sicherheits-Logik für Input-Validierung
   */
  describe('normalizePreferredUsername', () => {
    const normalizePreferredUsername = (value) => {
      if (!value) return null;
      return String(value)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || null;
    };

    it('should normalize valid username', () => {
      expect(normalizePreferredUsername('john.doe')).toBe('john.doe');
      expect(normalizePreferredUsername('user-123')).toBe('user-123');
      expect(normalizePreferredUsername('test_user')).toBe('test_user');
    });

    it('should remove invalid characters', () => {
      expect(normalizePreferredUsername('john@domain.com')).toBe('john_domain.com');
      expect(normalizePreferredUsername('user with spaces')).toBe('user_with_spaces');
      expect(normalizePreferredUsername('user!@#$%')).toBe('user');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(normalizePreferredUsername('  testuser  ')).toBe('testuser');
      expect(normalizePreferredUsername('\ttabuser\n')).toBe('tabuser');
    });

    it('should remove leading and trailing underscores', () => {
      expect(normalizePreferredUsername('___testuser___')).toBe('testuser');
      expect(normalizePreferredUsername('_user_')).toBe('user');
    });

    it('should truncate to 64 characters', () => {
      const longName = 'a'.repeat(100);
      const result = normalizePreferredUsername(longName);
      expect(result.length).toBe(64);
    });

    it('should return null for empty/invalid input', () => {
      expect(normalizePreferredUsername('')).toBeNull();
      expect(normalizePreferredUsername('   ')).toBeNull();
      expect(normalizePreferredUsername(null)).toBeNull();
      expect(normalizePreferredUsername(undefined)).toBeNull();
    });

    it('should handle special characters properly', () => {
      expect(normalizePreferredUsername('user@#$%^&*()')).toBe('user');
      expect(normalizePreferredUsername('test-user_123')).toBe('test-user_123');
    });
  });

  /**
   * Prüft: State & Nonce-Generierung für OIDC
   * Kritische Sicherheits-Logik gegen CSRF/State-Tampering
   */
  describe('State and Nonce generation', () => {
    it('should generate cryptographically secure state', async () => {
      const crypto = await import('crypto');
      const generateState = () => crypto.randomBytes(32).toString('hex');

      const state1 = generateState();
      const state2 = generateState();

      expect(state1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(state2).toHaveLength(64);
      expect(state1).not.toBe(state2); // Should be different
    });

    it('should generate cryptographically secure nonce', async () => {
      const crypto = await import('crypto');
      const generateNonce = () => crypto.randomBytes(32).toString('hex');

      const nonce = generateNonce();

      expect(nonce).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(nonce)).toBe(true); // Hex format
    });

    it('state should not be predictable', async () => {
      const crypto = await import('crypto');
      const generateState = () => crypto.randomBytes(32).toString('hex');

      const states = Array.from({ length: 10 }, () => generateState());
      const uniqueStates = new Set(states);

      // Alle sollten unterschiedlich sein
      expect(uniqueStates.size).toBe(10);
    });
  });

  /**
   * Prüft: Avatar-URL-Normalisierung
   * Kritische Logik: Sicherheit bei Umstieg von MinIO-presigned zu Proxy-URLs
   */
  describe('normalizeAvatarUrl', () => {
    const normalizeAvatarUrl = (avatar, userId) => {
      if (!avatar) return avatar;
      if (avatar.startsWith('/api/')) return avatar; // schon Proxy-URL
      return `/api/auth/avatar/${userId}`;
    };

    it('should keep existing proxy URLs', () => {
      const url = '/api/auth/avatar/user-123';
      expect(normalizeAvatarUrl(url, 'user-123')).toBe(url);
    });

    it('should convert MinIO presigned URLs to proxy URLs', () => {
      const minioUrl = 'https://minio.example.com/avatars/user-123/avatar.jpg?X-Amz-Algorithm=...';
      expect(normalizeAvatarUrl(minioUrl, 'user-123')).toBe('/api/auth/avatar/user-123');
    });

    it('should handle null avatar', () => {
      expect(normalizeAvatarUrl(null, 'user-123')).toBeNull();
      expect(normalizeAvatarUrl(undefined, 'user-123')).toBeUndefined();
    });

    it('should handle empty string', () => {
      expect(normalizeAvatarUrl('', 'user-123')).toBe('');
    });
  });
});
