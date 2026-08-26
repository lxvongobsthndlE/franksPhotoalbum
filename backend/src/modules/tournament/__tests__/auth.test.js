/**
 * Tests für Auth-Helper (Spec §13.2).
 *
 * Pflicht-Test-Cases aus dem Rollen-Update:
 *   1. Member POST /tournaments → 403  (isGroupAdmin)
 *   2. Admin POST /tournaments → 201   (isGroupAdmin)
 *   3. Member GET /tournaments/:id (draft) → 403  (canViewTournament)
 *   4. Admin GET /tournaments/:id (draft) → 200   (canViewTournament)
 *   5. Member GET /tournaments (list) → enthält kein draft
 *   6. Admin GET /tournaments (list) → enthält alle Status
 *   7. Member POST /matches/:id/result (generated) → 403
 *   8. Admin POST /matches/:id/result (generated) → 200
 *
 * Die hier getesteten Helper sind:
 *   - isGroupAdmin
 *   - canViewTournament
 *   - compareTournaments (Sortierung)
 *   - buildListWhereClause (Filter)
 *   - requireAuth / requireTournamentRead / requireTournamentWrite (Integration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isGroupAdmin,
  requireAuth,
  requireTournamentRead,
  requireTournamentWrite,
  buildListWhereClause,
} from '../auth.js';
import { canViewTournament, compareTournaments } from '../access/visibility.js';
import { createMockPrismaClient } from '../../../__tests__/mocks/index.js';

const fakeUser = (overrides = {}) => ({
  id: 'u1',
  role: 'user',
  ...overrides,
});

const fakeGroup = (overrides = {}) => ({
  id: 'g1',
  createdBy: 'u-owner',
  name: 'Test Group',
  ...overrides,
});

const fakeTournament = (overrides = {}) => ({
  id: 't1',
  groupId: 'g1',
  status: 'draft',
  isPublic: false,
  publicToken: null,
  publicRevokedAt: null,
  group: fakeGroup(),
  ...overrides,
});

describe('isGroupAdmin', () => {
  it('global admin (role="admin") → true', async () => {
    const prisma = createMockPrismaClient();
    const u = fakeUser({ id: 'u1', role: 'admin' });
    expect(await isGroupAdmin(prisma, 'g1', u)).toBe(true);
  });

  it('Group-Owner → true', async () => {
    const prisma = createMockPrismaClient();
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    const u = fakeUser({ id: 'u1', role: 'user' });
    expect(await isGroupAdmin(prisma, 'g1', u)).toBe(true);
  });

  it('GroupDeputy → true', async () => {
    const prisma = createMockPrismaClient();
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'g1', userId: 'u1' });
    const u = fakeUser({ id: 'u1', role: 'user' });
    expect(await isGroupAdmin(prisma, 'g1', u)).toBe(true);
  });

  it('normales Mitglied → false', async () => {
    const prisma = createMockPrismaClient();
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    const u = fakeUser({ id: 'u1', role: 'user' });
    expect(await isGroupAdmin(prisma, 'g1', u)).toBe(false);
  });

  it('null user → false', async () => {
    const prisma = createMockPrismaClient();
    expect(await isGroupAdmin(prisma, 'g1', null)).toBe(false);
  });
});

describe('canViewTournament', () => {
  const u = fakeUser({ id: 'u1' });
  it('draft + admin → true', () => {
    expect(canViewTournament(fakeTournament({ status: 'draft' }), u, true)).toBe(true);
  });
  it('draft + member → false (Pflicht-Test-Case 3)', () => {
    expect(canViewTournament(fakeTournament({ status: 'draft' }), u, false)).toBe(false);
  });
  it('generated + member → true', () => {
    expect(canViewTournament(fakeTournament({ status: 'generated' }), u, false)).toBe(true);
  });
  it('group_stage + member → true', () => {
    expect(canViewTournament(fakeTournament({ status: 'group_stage' }), u, false)).toBe(true);
  });
  it('finished + member → true (Archiv)', () => {
    expect(canViewTournament(fakeTournament({ status: 'finished' }), u, false)).toBe(true);
  });
  it('null tournament → false', () => {
    expect(canViewTournament(null, u, true)).toBe(false);
  });
});

describe('compareTournaments (Sortierung)', () => {
  const ts = (status, iso) => ({ status, createdAt: iso });
  it('laufende (group_stage) vor kommenden (generated)', () => {
    expect(
      compareTournaments(ts('group_stage', '2024-01-01'), ts('generated', '2024-01-02'))
    ).toBeLessThan(0);
  });
  it('generated vor finished', () => {
    expect(
      compareTournaments(ts('generated', '2024-01-01'), ts('finished', '2024-01-02'))
    ).toBeLessThan(0);
  });
  it('drafts ganz unten', () => {
    expect(
      compareTournaments(ts('finished', '2024-01-01'), ts('draft', '2024-01-02'))
    ).toBeLessThan(0);
  });
  it('innerhalb gleicher Klasse: createdAt desc', () => {
    expect(
      compareTournaments(ts('finished', '2024-01-02'), ts('finished', '2024-01-01'))
    ).toBeLessThan(0);
  });
});

describe('buildListWhereClause', () => {
  it('Admin sieht alle Status (Pflicht-Test-Case 6)', () => {
    const where = buildListWhereClause(null, 'g1', fakeUser(), true);
    expect(where).toEqual({ groupId: 'g1' });
  });
  it('Member sieht keine drafts (Pflicht-Test-Case 5)', () => {
    const where = buildListWhereClause(null, 'g1', fakeUser(), false);
    expect(where).toEqual({ groupId: 'g1', status: { not: 'draft' } });
  });
});

describe('requireAuth', () => {
  it('wirft 401 wenn User nicht mehr existiert', async () => {
    const prisma = createMockPrismaClient();
    prisma.user.findUnique.mockResolvedValue(null);
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'gone' },
    };
    await expect(requireAuth(request, prisma)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('liefert user bei gültigem JWT', async () => {
    const prisma = createMockPrismaClient();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    const ctx = await requireAuth(request, prisma);
    expect(ctx.user.id).toBe('u1');
  });
});

describe('requireTournamentRead', () => {
  let prisma;
  beforeEach(() => {
    prisma = createMockPrismaClient();
  });

  // Regression, 26.08.2026. Vorher stand hier der Gegentest: „Public-Bypass:
  // kein User nötig" — er erwartete, dass isPublic=true allein anonymen
  // Zugriff über die ID erlaubt. Genau das war das Loch, und der Testfall
  // hat es festgeschrieben: fakeTournament() hat status 'draft', der alte
  // Zweig stand vor der Draft-Prüfung. Ein Entwurf war also anonym lesbar,
  // sobald jemand isPublic setzen konnte.
  //
  // Die Freigabe macht ein Turnier heute unter seinem TOKEN lesbar
  // (public-access.js). Über die ID bleibt es zugriffsgeschützt.
  it('isPublic allein öffnet die ID-Route NICHT (Regression Zuschauer-Link)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(
      fakeTournament({
        status: 'generated',
        isPublic: true,
        publicToken: 'tok',
        publicRevokedAt: null,
      })
    );
    // Kein gültiger Login: jwtVerify wirft, wie es Fastify ohne Token tut.
    const request = {
      jwtVerify: vi.fn().mockRejectedValue(
        Object.assign(new Error('kein Token'), { statusCode: 401 })
      ),
    };
    await expect(requireTournamentRead(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('isPublic + draft öffnet erst recht nichts (Regression)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(
      fakeTournament({ status: 'draft', isPublic: true, publicToken: 'tok' })
    );
    const request = {
      jwtVerify: vi.fn().mockRejectedValue(
        Object.assign(new Error('kein Token'), { statusCode: 401 })
      ),
    };
    await expect(requireTournamentRead(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('404 wenn Turnier nicht existiert', async () => {
    prisma.tournament.findUnique.mockResolvedValue(null);
    const request = { jwtVerify: vi.fn() };
    await expect(requireTournamentRead(request, prisma, 'missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('Member + draft → 403 (Pflicht-Test-Case 3)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'draft' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'u1', groupId: 'g1' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    await expect(requireTournamentRead(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('Admin + draft → ok (Pflicht-Test-Case 4)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'draft' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'admin' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    const ctx = await requireTournamentRead(request, prisma, 't1');
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.public).toBe(false);
  });

  it('Member + generated → ok', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'generated' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'u1', groupId: 'g1' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    const ctx = await requireTournamentRead(request, prisma, 't1');
    expect(ctx.isAdmin).toBe(false);
  });

  it('Nicht-Mitglied + generated → 403', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'generated' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue(null);
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    await expect(requireTournamentRead(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('requireTournamentWrite', () => {
  let prisma;
  beforeEach(() => {
    prisma = createMockPrismaClient();
  });

  // Pflicht-Test-Case 1, seit 26.08.2026 in der schärferen Fassung:
  // Anonym schreiben scheitert nicht mehr erst an einer public-Prüfung im
  // Write-Helfer, sondern schon daran, dass es ohne Login keinen Lesepfad
  // über die ID gibt. Der Schutz sitzt damit eine Ebene tiefer.
  it('Freigegebenes Turnier: anonym schreiben scheitert an der Auth (Pflicht-Test-Case 1)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(
      fakeTournament({
        status: 'generated',
        isPublic: true,
        publicToken: 'tok',
        publicRevokedAt: null,
      })
    );
    const request = {
      jwtVerify: vi.fn().mockRejectedValue(
        Object.assign(new Error('kein Token'), { statusCode: 401 })
      ),
    };
    await expect(requireTournamentWrite(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('Freigegebenes Turnier: eingeloggtes Mitglied darf trotzdem nicht schreiben', async () => {
    prisma.tournament.findUnique.mockResolvedValue(
      fakeTournament({ status: 'generated', isPublic: true, publicToken: 'tok' })
    );
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'u1', groupId: 'g1' });
    const request = { jwtVerify: vi.fn(), user: { id: 'u1' } };
    await expect(requireTournamentWrite(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('Member → 403 (Pflicht-Test-Case 7)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'generated' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'u-owner' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'u1', groupId: 'g1' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    await expect(requireTournamentWrite(request, prisma, 't1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('Admin → ok (Pflicht-Test-Case 8)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakeTournament({ status: 'generated' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'admin' });
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'u1' },
    };
    const ctx = await requireTournamentWrite(request, prisma, 't1');
    expect(ctx.isAdmin).toBe(true);
  });
});
