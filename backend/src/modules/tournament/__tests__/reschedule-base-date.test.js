/**
 * Etappe B.8.1 — POST /:id/reschedule Bezugspunkt auf früheste scheduledAt.
 *
 * Bug 2026-08-20: User schiebt Matches um +10 Minuten (shift-open-matches),
 * ändert dann die Spieldauer → Reschedule überschreibt alle Zeiten ab
 * Tournament-Start → der +10-Minuten-Versatz ist futsch.
 *
 * Erwartung: Wenn der Body KEIN explizites `baseDate` hat UND es bereits
 * `scheduledAt`-Werte im Turnier gibt, soll der Reschedule die früheste
 * bestehende scheduledAt als Bezugspunkt nehmen.
 *
 * Drei Fälle:
 *  1. Body.baseDate gesetzt → das gewinnt (alt).
 *  2. Body.baseDate NICHT gesetzt, m.scheduledAt vorhanden → min(m.scheduledAt).
 *  3. Body.baseDate NICHT gesetzt, m.scheduledAt == null → fallback `new Date()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const generateScheduleMock = vi.fn();

// Mocken der Engine, BEVOR routes.js importiert wird.
vi.mock('../engine/index.js', async () => {
  const actual = await vi.importActual('../engine/index.js');
  return {
    ...actual,
    generateSchedule: generateScheduleMock,
  };
});

const tournamentsRoutes = (await import('../index.js')).default;

const u = { member: { id: 'u-member', role: 'user' }, admin: { id: 'u-admin', role: 'user' } };
const gId = 'g-1';
const tId = 't-draft';

function makeStub() {
  return {
    id: tId,
    groupId: gId,
    name: 'Mein Turnier',
    status: 'group_stage',
    startedAt: new Date().toISOString(),
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    logoUrl: null,
    config: { schedule: { matchDurationMinutes: 30, parallelFields: 2 } },
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
  };
}

function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn() },
    tournamentTeam: { findFirst: fn(), findMany: fn(), findUnique: fn(), update: fn(), delete: fn(), create: fn() },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn(), deleteMany: fn(), update: fn() },
    match: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), createMany: fn(), update: fn(), updateMany: fn(), count: fn(), groupBy: fn() },
    $transaction: vi.fn(async (cb) => (typeof cb === 'function' ? cb() : cb)),
  };
}

function baseStubs(prisma, matches) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === u.member.id) return { id: u.member.id, role: u.member.role };
    if (where.id === u.admin.id) return { id: u.admin.id, role: u.admin.role };
    return null;
  });
  prisma.group.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === gId) return { id: gId, createdBy: u.admin.id };
    return null;
  });
  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    const { userId, groupId } = where.userId_groupId ?? {};
    if (groupId !== gId) return null;
    if (userId === u.member.id) return { userId: u.member.id, groupId: gId };
    if (userId === u.admin.id) return { userId: u.admin.id, groupId: gId };
    return null;
  });
  prisma.tournament.findUnique.mockResolvedValue(makeStub());
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue(matches);
  prisma.match.count.mockResolvedValue(0);
  prisma.match.update.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    scheduledAt: data?.scheduledAt,
    field: data?.field,
  }));
}

async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => {
    request.jwtVerify = async () => {
      const uid = request.headers['x-test-user'];
      if (!uid) {
        const err = new Error('Missing JWT');
        err.statusCode = 401;
        throw err;
      }
      request.user = { id: String(uid) };
    };
  });
  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
  return app;
}

let prisma, app;
afterEach(async () => {
  await app.close();
  generateScheduleMock.mockReset();
  vi.restoreAllMocks();
});

describe('Etappe B.8.1 — POST /:id/reschedule Bezugspunkt', () => {
  beforeEach(() => {
    prisma = createLocalMockPrisma();
  });

  it('Fall 1: body.baseDate explizit → gewinnt (alt)', async () => {
    const explicitDate = new Date('2026-09-05T10:00:00Z');
    baseStubs(prisma, [
      { id: 'm-1', stageId: 's-1', stage: { type: 'ko' }, round: 'QF', bracketPos: 1, scheduledAt: explicitDate, field: 1 },
    ]);
    generateScheduleMock.mockReturnValue([
      { id: 'm-1', scheduledAt: explicitDate, field: 1 },
    ]);
    app = await buildApp(prisma);

    const customBase = new Date('2026-12-31T08:00:00Z').toISOString();
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/reschedule`,
      headers: { 'x-test-user': u.admin.id },
      payload: { baseDate: customBase },
    });
    expect(res.statusCode).toBe(200);
    // Body-baseDate hat Vorrang.
    const baseDateArg = generateScheduleMock.mock.calls[0][2];
    expect(new Date(baseDateArg).toISOString()).toBe(new Date(customBase).toISOString());
  });

  it('Fall 2: kein body.baseDate, m.scheduledAt vorhanden → früheste scheduledAt', async () => {
    const earliest = new Date('2026-09-05T10:00:00Z');
    const later = new Date('2026-09-05T12:00:00Z');
    baseStubs(prisma, [
      { id: 'm-1', stageId: 's-1', stage: { type: 'ko' }, round: 'QF', bracketPos: 1, scheduledAt: later, field: 1 },
      { id: 'm-2', stageId: 's-1', stage: { type: 'ko' }, round: 'QF', bracketPos: 2, scheduledAt: earliest, field: 2 },
    ]);
    generateScheduleMock.mockReturnValue([
      { id: 'm-1', scheduledAt: earliest, field: 1 },
      { id: 'm-2', scheduledAt: earliest, field: 2 },
    ]);
    app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/reschedule`,
      headers: { 'x-test-user': u.admin.id },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // Bezugspunkt ist die früheste scheduledAt, NICHT `new Date()`.
    const baseDateArg = generateScheduleMock.mock.calls[0][2];
    expect(new Date(baseDateArg).toISOString()).toBe(earliest.toISOString());
  });

  it('Fall 3: kein body.baseDate, kein m.scheduledAt → fallback new Date()', async () => {
    const before = Date.now();
    baseStubs(prisma, [
      { id: 'm-1', stageId: 's-1', stage: { type: 'ko' }, round: 'QF', bracketPos: 1, scheduledAt: null, field: null },
    ]);
    generateScheduleMock.mockReturnValue([
      { id: 'm-1', scheduledAt: new Date(before + 1000), field: 1 },
    ]);
    app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/reschedule`,
      headers: { 'x-test-user': u.admin.id },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // Bezugspunkt ist jetzt (innerhalb +/- 5s) — kein scheduledAt vorhanden.
    const baseDateArg = generateScheduleMock.mock.calls[0][2];
    const argTime = new Date(baseDateArg).getTime();
    expect(argTime).toBeGreaterThanOrEqual(before - 50);
    expect(argTime).toBeLessThanOrEqual(Date.now() + 50);
  });

  it('Etappe B.8.1 — Bug-Fix: Shift +10 min + Reschedule: Versatz überlebt', async () => {
    // User-Spec: User schiebt um +10 Min, ändert dann Dauer.
    // Erwartung: Verschobene Zeiten bleiben verschoben.
    // Konkret: Wir simulieren zwei Reschedules in Folge.
    //   - Reschedule #1: scheduledAt = 10:00 (Turnier-Start)
    //   - shift-open-matches +10: scheduledAt = 10:10
    //   - Reschedule #2: Bezugspunkt = 10:10 (NICHT 10:00!).
    const t1 = new Date('2026-09-05T10:00:00Z');
    const t1Shifted = new Date('2026-09-05T10:10:00Z');
    baseStubs(prisma, [
      { id: 'm-1', stageId: 's-1', stage: { type: 'ko' }, round: 'QF', bracketPos: 1, scheduledAt: t1Shifted, field: 1 },
    ]);
    generateScheduleMock.mockReturnValue([
      { id: 'm-1', scheduledAt: t1Shifted, field: 1 },
    ]);
    app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/reschedule`,
      headers: { 'x-test-user': u.admin.id },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const baseDateArg = generateScheduleMock.mock.calls[0][2];
    expect(new Date(baseDateArg).toISOString()).toBe(t1Shifted.toISOString());
  });
});
