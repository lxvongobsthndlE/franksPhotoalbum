/**
 * Generischer DTO-Guard.
 *
 * Spec §12.3 + §13.0: "Kein Bildschirm greift direkt auf Datenbankzeilen zu."
 * Was dieser Test verhindert: dass in einem Anzeigeobjekt eine cuid- oder
 * uuid-artige Zeichenkette auftaucht (z.B. "cmsm7zaqv0002..."), oder ein
 * englischer Statuscode (draft, scheduled, finished, …) in einem Feld,
 * das eigentlich nur die deutsche Aufbereitung sehen sollte.
 *
 * Mechanismus (NICHT nur "existiert ein statusLabel?"):
 *   1. Antwort-JSON komplett serialisieren.
 *   2. Jedes Blatt besuchen; Pfad mitprotokollieren.
 *   3. Wenn der Wert wie cuid/uuid aussieht:
 *      - Pfad-Feldname MUSS in der ID-Whitelist landen (id, *Id,
 *        *Token, publicToken, groupMemberships-IDs, etc.).
 *   4. Wenn der Wert wie ein englischer Statuscode aussieht:
 *      - Pfad-Feldname MUSS zu den wenigen erlaubten Stellen gehören
 *        (status, mode, bracketType, round, isPublic, statusSub, …).
 *      - Anzeigefelder (statusLabel, modeLabel, roundLabel, name, label,
 *        winnerName, loserName, …) dürfen NUR deutsche Strings tragen.
 *
 *   5. Wenn etwas schiefläuft, wird der genaue Pfad mitgeteilt:
 *      "response.matches[3].winnerName enthielt cuid 'cmsm7zaqv0002...'"
 *
 * Das ist exakt der Test, der den letzten Fehler ("cmsm7zaqv0002...
 * in der Gruppentabelle") verhindert hätte.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Heuristik-Muster
// ------------------------------------------------------------------

// CUID: beginnt mit 'c' (oder seltener anderen Buchstaben), dann 24+
// base36-Zeichen. Beispiel: "cmsm7zaqv0002lx5jz4y9z5jk".
const CUID_RE = /^[a-z][a-z0-9]{20,}$/i;
// Standard-UUID (8-4-4-4-12).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Englische, vom Server stammende Codes, die in Display-Feldern NIE
// auftauchen dürfen. Diese Liste wird vom Spec vorgegeben.
const EN_TOURNAMENT_STATUS = new Set(['draft', 'generated', 'group_stage', 'ko_stage', 'finished']);
const EN_MATCH_STATUS = new Set(['scheduled', 'live', 'finished']);
const EN_TOURNAMENT_MODE = new Set(['groups_ko', 'groups_only', 'ko_only', 'double_elim']);
const EN_STAGE_TYPE = new Set(['group', 'ko', 'intermediate_group', 'losers']);
const EN_BRACKET_TYPE = new Set(['winner', 'loser', 'grand_final']);
const EN_ROUND = new Set(['R32', 'R16', 'QF', 'SF', 'F', '3RD']);

// Felder, deren Werte technisch IDs sein dürfen — entweder per
// Namens-Konvention (XxxId, publicToken) oder per Liste.
const ID_FIELDS_BY_NAME = new Set(['id', 'publicToken', 'token']);
const ID_FIELDS_PATTERN_SUFFIX = /Id$|^id$/; // teamId, xxxTeamId, id

function isIdFieldName(name) {
  if (name == null) return false;
  if (ID_FIELDS_BY_NAME.has(name)) return true;
  if (ID_FIELDS_PATTERN_SUFFIX.test(name)) return true;
  return false;
}

// Felder, deren Werte technische englische Codes tragen.
// Dies ist die Allow-Liste. ALLES, was nicht hier steht, MUSS ein
// deutsches Label oder ein Klartextname sein.
const TECHNICAL_FIELDS_BY_NAME = {
  status: 'match_or_tournament',
  mode: 'tournament',
  bracketType: 'bracket',
  round: 'bracket',
  type: 'stage',
  stageType: 'stage',
  isPublic: 'boolean',
  kind: 'match_slot', // 'team' | 'placeholder' — beides UI-Sprache, aber technisch
};
function isTechnicalFieldName(name) {
  return Object.prototype.hasOwnProperty.call(TECHNICAL_FIELDS_BY_NAME, name);
}

// ------------------------------------------------------------------
// Guard-Funktion: walk(value, path) → returns list of violations.
// ------------------------------------------------------------------
function checkNoDatalLeak(value, path, acc, rootSeen = new WeakSet()) {
  if (value == null) return;
  if (typeof value !== 'object') {
    checkLeaf(String(value), path, acc);
    return;
  }
  // Zyklusschutz.
  if (rootSeen.has(value)) return;
  rootSeen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkNoDatalLeak(value[i], `${path}[${i}]`, acc, rootSeen);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    checkNoDatalLeak(value[key], joinPath(path, key), acc, rootSeen);
  }
}

function joinPath(base, key) {
  if (!base) return key;
  return /^[a-zA-Z_$]/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function checkLeaf(str, path, acc) {
  if (str.length < 20) {
    // zu kurz, um cuid zu sein — und der Code-Length-Check schützt vor
    // false-positives auf kurzen deutschen Strings.
    if (looksLikeEnglishCode(str)) {
      // Erlaubte Positionen prüfen.
      const parent = parentFieldName(path);
      if (!isTechnicalFieldName(parent)) {
        acc.push({
          path,
          value: str,
          rule: 'english_status_in_display_field',
          parentField: parent,
        });
      }
    }
    return;
  }
  // Lange Strings: cuid/uuid-Heuristik anwenden.
  if (CUID_RE.test(str) || UUID_RE.test(str)) {
    const parent = parentFieldName(path);
    if (!isIdFieldName(parent)) {
      acc.push({
        path,
        value: str.length > 32 ? str.slice(0, 20) + '…' : str,
        rule: 'raw_db_id_in_display_field',
        parentField: parent,
      });
    }
  }
}

function looksLikeEnglishCode(str) {
  if (!str) return false;
  return (
    EN_TOURNAMENT_STATUS.has(str) ||
    EN_MATCH_STATUS.has(str) ||
    EN_TOURNAMENT_MODE.has(str) ||
    EN_STAGE_TYPE.has(str) ||
    EN_BRACKET_TYPE.has(str) ||
    EN_ROUND.has(str)
  );
}

function parentFieldName(path) {
  // letztes Segment nach . oder [
  const m = path.match(/[^.\[]+$/);
  return m ? m[0] : '';
}

function assertNoLeaks(payload, label) {
  const violations = [];
  checkNoDatalLeak(payload, '', violations);
  if (violations.length > 0) {
    const dump = violations
      .map(
        (v) => `  - ${v.rule}: ${label}.${v.path} = "${v.value}" (parent-field "${v.parentField}")`
      )
      .join('\n');
    throw new Error(`DTO-Guard hat ${violations.length} Roh-Daten-Leak(s) in ${label}:\n${dump}`);
  }
}

// ------------------------------------------------------------------
// Test-Lok-Prisma (kopiert die Routen-Integration-Test-Welt).
// ------------------------------------------------------------------
function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    tournamentTeam: {
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      delete: fn(),
    },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { createMany: fn(), findMany: fn() },
    match: {
      findMany: fn(),
      findFirst: fn(),
      findUnique: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      groupBy: fn(),
    },
    $transaction: vi.fn(async (cb) => (typeof cb === 'function' ? cb(prismaMock) : cb)),
  };
}

// ------------------------------------------------------------------
// Fixture: eine komplette Turnier-Welt mit cuids.
// ------------------------------------------------------------------
const TEAM_A_ID = 'clxyz1aaaaaaaaaaaaaaaaaaaa'; // echte cuid-Länge
const TEAM_B_ID = 'clxyz2bbbbbbbbbbbbbbbbbbbb';
const TEAM_C_ID = 'clxyz3cccccccccccccccccccc';
const TEAM_D_ID = 'clxyz4dddddddddddddddddddd';

function seedPrisma(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) =>
    where.id === 'u-1' ? { id: 'u-1', role: 'user' } : null
  );
  // match.groupBy wird für die List-Aggregation (Counts) gebraucht.
  // Default: leere Liste — Aggregate verarbeitet das korrekt.
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.group.findUnique.mockResolvedValue({
    id: 'g-1',
    createdBy: 'u-1',
    name: 'Testgruppe',
  });
  prisma.groupDeputy.findUnique.mockResolvedValue(null);
  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    if (where.userId_groupId?.userId === 'u-1' && where.userId_groupId?.groupId === 'g-1') {
      return { userId: 'u-1', groupId: 'g-1' };
    }
    return null;
  });
  prisma.tournament.findUnique.mockResolvedValue({
    id: 't-1',
    groupId: 'g-1',
    name: 'Sommer-Cup',
    mode: 'groups_ko',
    status: 'group_stage',
    isPublic: false,
    publicToken: 'pubtok' + 'a'.repeat(30),
    publicEnabledAt: null,
    publicRevokedAt: null,
    startsAt: new Date('2026-09-05T08:00:00Z'),
    endsAt: new Date('2026-09-05T18:00:00Z'),
    createdById: 'u-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    group: { id: 'g-1', createdBy: 'u-1', name: 'Testgruppe' },
  });
  prisma.tournamentTeam.findMany.mockResolvedValue([
    {
      id: TEAM_A_ID,
      name: 'Alpha',
      color: null,
      logoUrl: null,
      players: null,
      linkedUserIds: [],
      seed: 1,
    },
    {
      id: TEAM_B_ID,
      name: 'Bravo',
      color: null,
      logoUrl: null,
      players: null,
      linkedUserIds: [],
      seed: 2,
    },
    {
      id: TEAM_C_ID,
      name: 'Charlie',
      color: null,
      logoUrl: null,
      players: null,
      linkedUserIds: [],
      seed: 3,
    },
    {
      id: TEAM_D_ID,
      name: 'Delta',
      color: null,
      logoUrl: null,
      players: null,
      linkedUserIds: [],
      seed: 4,
    },
  ]);
  prisma.stage.findMany.mockResolvedValue([
    { id: 's-group', type: 'group', name: 'Gruppenphase', orderIndex: 0 },
  ]);
  prisma.group_.findMany.mockResolvedValue([
    {
      id: 'grp-a',
      stageId: 's-group',
      key: 'A',
      name: 'Gruppe A',
      memberships: [
        { teamId: TEAM_A_ID, position: 1 },
        { teamId: TEAM_B_ID, position: 2 },
      ],
      matches: [
        {
          id: 'g_A_1',
          tournamentId: 't-1',
          stageId: 's-group',
          groupId: 'grp-a',
          round: '1',
          bracketType: 'winner',
          bracketPos: null,
          teamHome: TEAM_A_ID,
          teamAway: TEAM_B_ID,
          placeholderHome: null,
          placeholderAway: null,
          scoreHome: 3,
          scoreAway: 1,
          status: 'finished',
          field: 1,
          scheduledAt: new Date('2026-09-05T10:00:00Z'),
          winnerAdvancesTo: null,
          loserAdvancesTo: null,
        },
        {
          id: 'g_A_2',
          tournamentId: 't-1',
          stageId: 's-group',
          groupId: 'grp-a',
          round: '1',
          bracketType: 'winner',
          bracketPos: null,
          teamHome: TEAM_B_ID,
          teamAway: TEAM_A_ID,
          placeholderHome: null,
          placeholderAway: null,
          scoreHome: null,
          scoreAway: null,
          status: 'scheduled',
          field: 1,
          scheduledAt: new Date('2026-09-05T11:00:00Z'),
          winnerAdvancesTo: null,
          loserAdvancesTo: null,
        },
      ],
    },
  ]);
  prisma.match.findMany.mockResolvedValue([
    {
      id: 'g_A_1',
      tournamentId: 't-1',
      stageId: 's-group',
      groupId: 'grp-a',
      round: '1',
      bracketType: 'winner',
      bracketPos: null,
      teamHome: TEAM_A_ID,
      teamAway: TEAM_B_ID,
      scoreHome: 3,
      scoreAway: 1,
      status: 'finished',
      field: 1,
      scheduledAt: new Date('2026-09-05T10:00:00Z'),
      winnerAdvancesTo: null,
      loserAdvancesTo: null,
    },
    {
      id: 'g_A_2',
      tournamentId: 't-1',
      stageId: 's-group',
      groupId: 'grp-a',
      round: '1',
      bracketType: 'winner',
      bracketPos: null,
      teamHome: TEAM_B_ID,
      teamAway: TEAM_A_ID,
      scoreHome: null,
      scoreAway: null,
      status: 'scheduled',
      field: 1,
      scheduledAt: new Date('2026-09-05T11:00:00Z'),
      winnerAdvancesTo: null,
      loserAdvancesTo: null,
    },
  ]);
}

let app, prisma;

beforeEach(async () => {
  prisma = createLocalMockPrisma();
  seedPrisma(prisma);
  app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => {
    request.jwtVerify = async () => {};
    const uid = request.headers['x-test-user'];
    if (uid) request.user = { id: String(uid) };
  });
  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// Helper: GET mit x-test-user=admin
// ------------------------------------------------------------------
async function getAs(url) {
  const res = await app.inject({
    method: 'GET',
    url,
    headers: { 'x-test-user': 'u-1' },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

// ------------------------------------------------------------------
// Tests: alle GET-Endpoints geben KEIN Roh-Material heraus.
// ------------------------------------------------------------------
describe('DTO-Guard: keine cuid/uuid in Anzeigefeldern, keine engl. Statuscodes in Display', () => {
  it('GET /api/tournaments/:id (Detail) hat keinen Leak', async () => {
    const body = await getAs('/api/tournaments/t-1');
    assertNoLeaks(body, 'detail');
  });

  it('GET /api/tournaments/group/:id (Liste) hat keinen Leak', async () => {
    prisma.tournament.findMany.mockResolvedValue([
      {
        id: 't-1',
        groupId: 'g-1',
        name: 'Sommer-Cup',
        mode: 'groups_ko',
        status: 'group_stage',
        createdAt: new Date('2024-01-01'),
      },
    ]);
    const body = await getAs('/api/tournaments/group/g-1');
    assertNoLeaks(body, 'list');
  });

  it('GET /api/tournaments/:id/schedule hat keinen Leak', async () => {
    const body = await getAs('/api/tournaments/t-1/schedule');
    assertNoLeaks(body, 'schedule');
  });

  it('GET /api/tournaments/:id/bracket hat keinen Leak', async () => {
    const body = await getAs('/api/tournaments/t-1/bracket');
    assertNoLeaks(body, 'bracket');
  });

  it('GET /api/tournaments/:id/standings hat keinen Leak', async () => {
    const body = await getAs('/api/tournaments/t-1/standings');
    assertNoLeaks(body, 'standings');
  });

  // Bonus: stellt sicher, dass die Anzeige-Discipline tatsächlich eingehalten
  // wird — der Test meldet den Pfad, an dem ein cuID-Leak platziert wurde.
  it('REGRESSION — wenn ein Anzeigefeld eine cuid trüge, schlägt der Guard fehl mit Pfad', () => {
    const fake = {
      tournament: {
        id: 'clxyzthisislegitimateok', // id-Feld — OK.
        name: 'cmsm7zaqv0002lx5jz4y9z5jk', // ← Leak: cuid im 'name'-Feld.
        statusLabel: 'Gruppenphase',
      },
    };
    let err = null;
    try {
      assertNoLeaks(fake, 'regression');
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.message).toMatch(/raw_db_id_in_display_field/);
    expect(err.message).toMatch(/tournament\.name/);
  });

  it('REGRESSION — wenn ein Display-Feld einen engl. Statuscode trüge, schlägt der Guard fehl', () => {
    const fake = {
      matches: [
        {
          id: 'm1',
          // statusLabel ist ein Display-Feld — wenn dort "finished"
          // statt "beendet" landet, ist das ein Leak.
          statusLabel: 'finished',
        },
      ],
    };
    expect(() => assertNoLeaks(fake, 'regression-status')).toThrowError(
      /english_status_in_display_field.*statusLabel/
    );
  });

  it('PUBLIC_TOKEN — publicToken lebt in seinem ID-Feld und ist deshalb OK', () => {
    const fake = {
      tournament: {
        id: 'clxyzlegitimatepublicid01',
        publicToken: 'pubtok' + 'x'.repeat(28),
        name: 'Sommer-Cup',
      },
    };
    expect(() => assertNoLeaks(fake, 'publicToken')).not.toThrow();
  });

  it('Match-Winner-IDs landen in winnerTeamId (Id-Feld), nicht in winnerName (Display)', () => {
    const fake = {
      match: {
        id: 'm1',
        winnerTeamId: TEAM_A_ID, // id-Feld → OK
        winnerName: 'Alpha', // display-Feld → OK, kein cuid
        loserTeamId: TEAM_B_ID,
        loserName: 'Bravo',
        statusLabel: 'beendet', // deutsch → OK
        status: 'finished', // technisches Feld → OK
      },
    };
    expect(() => assertNoLeaks(fake, 'winnerId-name')).not.toThrow();
  });

  it('Negativ-Test: winnerName mit cuid muss FAILEN', () => {
    const fake = {
      match: {
        winnerTeamId: TEAM_A_ID,
        winnerName: TEAM_A_ID, // ← Leak: cuid in Display-Feld
      },
    };
    expect(() => assertNoLeaks(fake, 'winnerName-bleed')).toThrowError(
      /raw_db_id_in_display_field.*winnerName/
    );
  });
});
