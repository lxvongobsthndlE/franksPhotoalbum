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
      count: vi.fn(),
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
      count: vi.fn(),
      ...overrides.album,
    },
    photo: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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
    groupDeputy: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      ...overrides.groupDeputy,
    },
    albumContributor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      ...overrides.albumContributor,
    },
    photoAlbum: {
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      ...overrides.photoAlbum,
    },
    like: {
      findMany: vi.fn(),
      ...overrides.like,
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
    payload: undefined,
    headers: {},
    cookiesSet: [],
    cookiesCleared: [],
    code: vi.fn(function (statusCode) {
      this.statusCode = statusCode;
      return this;
    }),
    send: vi.fn(function (payload) {
      this.payload = payload;
      return this;
    }),
    header: vi.fn(function (name, value) {
      this.headers[name] = value;
      return this;
    }),
    setCookie: vi.fn(function (name, value, options) {
      this.cookiesSet.push({ name, value, options });
      return this;
    }),
    clearCookie: vi.fn(function (name, options) {
      this.cookiesCleared.push({ name, options });
      return this;
    }),
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
 * Erstellt eine Fastify-ähnliche Instanz, die registrierte Routen für Tests sammelt.
 */
export function createMockRouteFastify(overrides = {}) {
  const routes = {
    GET: new Map(),
    POST: new Map(),
    PATCH: new Map(),
    DELETE: new Map(),
  };

  const fastify = createMockFastify(overrides);
  fastify.prisma = overrides.prisma || createMockPrismaClient();
  fastify.routes = routes;
  fastify.get = vi.fn((path, optionsOrHandler, maybeHandler) => {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    routes.GET.set(path, handler);
  });
  fastify.post = vi.fn((path, optionsOrHandler, maybeHandler) => {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    routes.POST.set(path, handler);
  });
  fastify.patch = vi.fn((path, optionsOrHandler, maybeHandler) => {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    routes.PATCH.set(path, handler);
  });
  fastify.delete = vi.fn((path, optionsOrHandler, maybeHandler) => {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    routes.DELETE.set(path, handler);
  });

  return fastify;
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
    header: vi.fn(function () {
      return this;
    }),
    send: vi.fn(function () {
      return this;
    }),
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
