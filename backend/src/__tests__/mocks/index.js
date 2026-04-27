/**
 * Mock Utilities für Tests — Prisma, Fastify, Nodemailer
 */

import { vi } from 'vitest';

/**
 * Erstellt einen Mock PrismaClient mit vordefinierten Responses
 */
export function createMockPrismaClient(overrides = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.user,
    },
    group: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.group,
    },
    album: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.album,
    },
    photo: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.photo,
    },
    notification: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.notification,
    },
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...overrides.notificationPreference,
    },
    groupMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      ...overrides.groupMember,
    },
    albumContributor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      ...overrides.albumContributor,
    },
    ...overrides,
  };
}

/**
 * Erstellt einen Mock Fastify-Request
 */
export function createMockRequest(overrides = {}) {
  return {
    user: null,
    jwtVerify: vi.fn(),
    headers: {
      authorization: null,
      ...overrides.headers,
    },
    cookies: {},
    body: null,
    params: {},
    query: {},
    ...overrides,
  };
}

/**
 * Erstellt einen Mock Fastify-Reply
 */
export function createMockReply(overrides = {}) {
  return {
    code: vi.fn(function() { return this; }),
    send: vi.fn(function() { return this; }),
    header: vi.fn(function() { return this; }),
    raw: {
      write: vi.fn(),
      setHeader: vi.fn(),
      statusCode: 200,
      ...overrides.raw,
    },
    statusCode: 200,
    ...overrides,
  };
}

/**
 * Erstellt einen Mock Fastify-Instanz mit JWT-Support
 */
export function createMockFastify(overrides = {}) {
  return {
    jwt: {
      sign: vi.fn((payload, options) => {
        // Simuliert echte JWT-Token-Struktur
        return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64')}.mock_signature`;
      }),
      verify: vi.fn(),
      ...overrides.jwt,
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      ...overrides.log,
    },
    ...overrides,
  };
}

/**
 * Erstellt einen Mock Nodemailer-Transporter
 */
export function createMockTransporter(overrides = {}) {
  return {
    sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
    ...overrides,
  };
}

/**
 * Mock-Funktion für SSE-Reply in Notifications
 */
export function createMockSseReply(overrides = {}) {
  const reply = createMockReply();
  return {
    ...reply,
    raw: {
      write: vi.fn(),
      statusCode: 200,
      ...overrides.raw,
    },
    header: vi.fn(function() { return this; }),
    send: vi.fn(function() { return this; }),
  };
}

/**
 * Hilfsfunktion: Dekodiere Mock-JWT-Token für Tests
 */
export function decodeMockJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch {
    return null;
  }
}
