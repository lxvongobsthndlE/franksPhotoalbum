/**
 * Integration-Tests: PATCH /api/tournaments/:id mit `rules`.
 *
 * User-Punkt 5: Menu-Item „Regeln" zwischen Teams und Drucken.
 * Plain-Text, admin-editierbar, members read-only, Paragraphs only.
 *
 * Was hier getestet wird:
 *   - Happy Path: admin darf speichern (gültiger Plain-Text).
 *   - Validation: kein number/bool/object, leerer String → null,
 *     > 10 KB → 400 rules_too_long.
 *   - Lock: anders als config.* ist rules NICHT nach Turnierstart
 *     gesperrt — Regelwerk darf nachjustiert werden.
 *   - Member-Route existiert nicht; das Feld kommt im GET /:id
 *     über den Tournament-DTO mit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

function createMockPrisma() {
  const fn = () => vi.fn();
  const prisma = {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: {
      findUnique: fn(),
      update: fn(),
    },
    tournamentTeam: { findMany: fn() },
    stage: { findMany: fn() },
    group_: { findMany: fn() },
    match: { count: fn(), findMany: fn(), groupBy: fn() },
  };
  return prisma;
}

async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => {
    request.jwtVerify = async () => {};
    const uid = request.headers['x-test-user'];
    if (uid) request.user = { id: String(uid) };
  });
  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
  return app;
}

const u = {
  admin: { id: 'u-admin', role: 'user' },
  member: { id: 'u-member', role: 'user' },
};
const gId = 'g-1';
const tId = 't-1';

function baseStubs(prisma, { status = 'draft', rules = null } = {}) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === u.admin.id) return { id: u.admin.id, role: u.admin.role };
    if (where.id === u.member.id) return { id: u.member.id, role: u.member.role };
    return null;
  });
  prisma.group.findUnique.mockResolvedValue({
    id: gId,
    createdBy: u.admin.id,
  });
  prisma.groupDeputy.findUnique.mockResolvedValue(null);
  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    const { userId, groupId } = where.userId_groupId ?? {};
    if (groupId === gId && (userId === u.admin.id || userId === u.member.id)) {
      return { userId, groupId };
    }
    return null;
  });
  prisma.tournament.findUnique.mockResolvedValue({
    id: tId,
    groupId: gId,
    name: 'Mein Turnier',
    mode: 'groups_ko',
    status,
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    config: null,
    rules,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
  });
  prisma.tournament.update.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    ...data,
  }));
  prisma.match.count.mockResolvedValue(0);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
}

afterEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────
// Happy Path
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/tournaments/:id mit gültigem rules-Text', () => {
  let app, prisma;
  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('admin speichert Plain-Text → 200, data.rules enthält den Text', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        rules: 'Absatz 1\n\nAbsatz 2 mit Becher 0,5l.\n\nAbsatz 3',
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toBe('Absatz 1\n\nAbsatz 2 mit Becher 0,5l.\n\nAbsatz 3');
  });

  it('admin leert das Regelwerk mit "" → rules wird null', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: '' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toBeNull();
  });

  it('admin leert mit nur Whitespace → rules wird null', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: '   \n\n  \t  ' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toBeNull();
  });

  it('admin setzt explizit null → 200, data.rules ist null', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: null },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/tournaments/:id mit ungültigem rules-Typ', () => {
  let app, prisma;
  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('rules als number → 400 invalid_rules', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: 42 },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_rules');
    expect(res.json().field).toBe('rules');
  });

  it('rules als object → 400 invalid_rules', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: { html: '<p>foo</p>' } },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_rules');
  });

  it('rules als Array → 400 invalid_rules', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: ['Absatz 1', 'Absatz 2'] },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_rules');
  });

  it('rules > 10 KB → 400 rules_too_long mit maxLength', async () => {
    const longText = 'a'.repeat(10001);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: longText },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('rules_too_long');
    expect(res.json().maxLength).toBe(10000);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('rules genau 10 KB → 200 (Grenzwert inklusiv)', async () => {
    const exactText = 'a'.repeat(10000);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: exactText },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toHaveLength(10000);
  });
});

// ─────────────────────────────────────────────────────────────────
// Lock-Verhalten: rules NICHT nach Turnierstart gesperrt
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/tournaments/:id rules — Lock-Verhalten', () => {
  it('turnier läuft, 12 beendete Spiele → PATCH rules trotzdem erlaubt', async () => {
    // Bewusst anders als config.*: Regelwerk darf nachjustiert werden,
    // weil Turnierleitung oft erst nach den ersten Spielen merkt, dass
    // eine Sonderregel fehlt.
    const prisma = createMockPrisma();
    baseStubs(prisma, { status: 'group_stage' });
    prisma.match.count.mockResolvedValue(12);
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { rules: 'Nachträglich präzisiert: 2.Becher zählt doppelt.' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.rules).toContain('Nachträglich');
  });
});

// ─────────────────────────────────────────────────────────────────
// Read-Pfad: rules kommt im DTO mit (für Member read-only)
// ─────────────────────────────────────────────────────────────────

describe('rules im Tournament-DTO', () => {
  it('rules ist im DTO enthalten, wenn gesetzt', async () => {
    const prisma = createMockPrisma();
    baseStubs(prisma, { rules: 'Absatz 1\n\nAbsatz 2' });
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tournament.rules).toBe('Absatz 1\n\nAbsatz 2');
  });

  it('rules ist null im DTO, wenn nicht gepflegt', async () => {
    const prisma = createMockPrisma();
    baseStubs(prisma, { rules: null });
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tournament.rules).toBeNull();
  });
});
