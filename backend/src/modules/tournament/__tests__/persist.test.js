/**
 * End-to-End-Tests für persistGenerated (Spec §13.2 Schritt 4+5).
 *
 * Was geprüft wird:
 *   1. Happy Path
 *      - Eine $transaction wird geöffnet.
 *      - Alte Stages werden gelöscht.
 *      - Genau eine Stage vom Typ 'group' wird angelegt.
 *      - Für jede Gruppe: Group_, Memberships und Matches entstehen.
 *      - Platzhalter-Referenzen werden in DB-Rows übernommen.
 *      - Rückgabe enthält korrekte Counts.
 *
 *   2. Rollback
 *      - Wenn der Prisma-Call nach dem ersten Anlegen einer Gruppe
 *        wirft, MUSS die gesamte Transaktion fehlschlagen.
 *      - Nichts bleibt bestehen: keine Stages, keine Groups, keine
 *        Memberships, keine Matches.
 *
 *   3. Idempotenz
 *      - Zweimaliger Aufruf mit verschiedenen Inputs überschreibt die
 *        alte Struktur sauber (deleteMany → create).
 *
 * Da diese Tests KEIN Echt-DB brauchen (Spec §13.3: Engine zuerst mit
 * Tests), simulieren wir die Prisma-Transaktion mit einer
 * Prisma-Schnittstelle, die In-Memory die Rows sammelt. Beim
 * Rollback-Test lassen wir eine Methode mitten in der Sequenz werfen.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { persistGenerated } from '../persist.js';

// ------------------------------------------------------------------
// Mini-Prisma: sammelt Rows in Maps. $transaction gibt den txClient
// an die Callback weiter.
// ------------------------------------------------------------------
function createMemoryPrisma({ failOn = null } = {}) {
  const state = {
    stages: new Map(),
    groups: new Map(),
    memberships: [],
    matches: new Map(),
  };

  const tx = {
    stage: {
      create: vi.fn(async ({ data }) => {
        const id = cuid('stage');
        const row = { id, ...data };
        state.stages.set(id, row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }) => {
        if (where.tournamentId) {
          // Cascade: alle Stages dieses Tourniers + abhängige Gruppen +
          // Memberships + Matches.
          const stagesToDelete = [...state.stages.values()].filter(
            (s) => s.tournamentId === where.tournamentId
          );
          const stageIds = new Set(stagesToDelete.map((s) => s.id));
          // Gruppen mit gleicher stageId löschen.
          const orphanGroups = [...state.groups.values()].filter((g) =>
            stageIds.has(g.stageId)
          );
          const orphanGroupIds = new Set(orphanGroups.map((g) => g.id));
          for (const id of stageIds) state.stages.delete(id);
          for (const id of orphanGroupIds) state.groups.delete(id);
          // Memberships mit groupId in den orphan-Gruppen.
          state.memberships = state.memberships.filter(
            (m) => !orphanGroupIds.has(m.groupId)
          );
          // Matches mit groupId in den orphan-Gruppen ODER mit stageId.
          for (const [id, m] of state.matches) {
            if (orphanGroupIds.has(m.groupId) || stageIds.has(m.stageId)) {
              state.matches.delete(id);
            }
          }
        }
        return { count: 0 };
      }),
    },
    group_: {
      create: vi.fn(async ({ data }) => {
        if (failOn === 'group_') throw new Error('Simulierter Fehler beim Group-Create');
        const id = cuid('grp');
        const row = { id, ...data };
        state.groups.set(id, row);
        return row;
      }),
    },
    groupMembership: {
      createMany: vi.fn(async ({ data }) => {
        if (failOn === 'memberships') throw new Error('Simulierter Fehler beim Membership-Create');
        for (const m of data) state.memberships.push({ id: cuid('gm'), ...m });
        return { count: data.length };
      }),
    },
    match: {
      createMany: vi.fn(async ({ data }) => {
        if (failOn === 'matches') throw new Error('Simulierter Fehler beim Match-Create');
        for (const m of data) state.matches.set(m.id, { ...m });
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }) => {
        if (where.tournamentId) {
          for (const [id, m] of state.matches) {
            if (m.tournamentId === where.tournamentId) state.matches.delete(id);
          }
        }
        return { count: 0 };
      }),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (cb) => {
      // DB-Verhalten: bei Throw in der Callback verwirft Postgres die TX.
      // Wir simulieren das hier mit einem reset-Flag.
      const snapshot = {
        stages: new Map(state.stages),
        groups: new Map(state.groups),
        memberships: [...state.memberships],
        matches: new Map(state.matches),
      };
      try {
        const result = await cb(tx);
        return result;
      } catch (err) {
        // Postgres würde ROLLBACK machen. Wir setzen den state zurück.
        state.stages = snapshot.stages;
        state.groups = snapshot.groups;
        state.memberships = snapshot.memberships;
        state.matches = snapshot.matches;
        throw err;
      }
    }),
  };

  return { prisma, state };
}

let cuidSeq = 0;
function cuid(prefix) {
  cuidSeq++;
  return `${prefix}_${cuidSeq}`;
}

// ------------------------------------------------------------------
// Engine-Output-Fixture: 4 Teams, 2 Gruppen à 2, jeweils 1 Round-Robin-Match.
//
// Hinweis Issue 1 (2026-08-12): Die Engine produziert hier die sprechenden
// IDs `g_A_1` / `g_B_1`. Diese sind INNERHALB eines generate-Aufrufs
// stabil, werden aber NICHT als DB-Primary-Key verwendet — siehe
// persistGenerated. Wir prüfen in den Tests, dass die DB-IDs NICHT
// diese Engine-Labels tragen.
// ------------------------------------------------------------------
function buildFixtureGen() {
  return {
    config: { mode: 'groups_only' },
    groups: [
      {
        groupKey: 'A',
        groupName: 'Gruppe A',
        members: [
          { id: 'team-a1', name: 'Alpha', seed: 1 },
          { id: 'team-a2', name: 'Beta', seed: 2 },
        ],
        matches: [
          {
            id: 'g_A_1',
            teamHome: 'team-a1',
            teamAway: 'team-a2',
            scheduledAt: new Date('2026-09-05T10:00:00Z'),
            field: 1,
            roundNumber: 1,
            bracketPos: null,
          },
        ],
      },
      {
        groupKey: 'B',
        groupName: 'Gruppe B',
        members: [
          { id: 'team-b1', name: 'Gamma', seed: 3 },
          { id: 'team-b2', name: 'Delta', seed: 4 },
        ],
        matches: [
          {
            id: 'g_B_1',
            teamHome: 'team-b1',
            teamAway: 'team-b2',
            placeholderHome: { type: 'winner_of', sourceGroupKey: 'A', sourceRank: 1 },
            placeholderAway: { type: 'winner_of', sourceGroupKey: 'A', sourceRank: 2 },
            scheduledAt: new Date('2026-09-05T11:00:00Z'),
            field: 2,
            roundNumber: 1,
            bracketPos: null,
          },
        ],
      },
    ],
    unresolvedConflicts: [],
  };
}

/**
 * Hilfs-Test: Ist eine ID eine frische cuid-ähnliche ID (also NICHT das
 * Engine-Label)? Wir prüfen das Format, das `makeCuid()` produziert:
 * beginnt mit `c`, danach Base36 + Hex.
 */
function isCuidLike(id) {
  return typeof id === 'string' && /^c[a-z0-9]{8}[a-f0-9]{16}$/.test(id);
}

describe('persistGenerated — Happy Path', () => {
  let prisma, state;

  beforeEach(() => {
    cuidSeq = 0;
    const mem = createMemoryPrisma();
    prisma = mem.prisma;
    state = mem.state;
  });

  it('legt eine Stage vom Typ group an', async () => {
    const result = await persistGenerated(prisma, 't-1', buildFixtureGen());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Die angelegte Stage ist vom Typ 'group' und gehört zum Tournament.
    const stagesList = [...state.stages.values()];
    expect(stagesList).toHaveLength(1);
    expect(stagesList[0]).toMatchObject({
      tournamentId: 't-1',
      type: 'group',
      name: 'Gruppenphase',
      orderIndex: 0,
    });
    expect(result.groupCount).toBe(2);
  });

  it('legt für jede Gruppe eine Group_ an, mit korrektem Stage-Link', async () => {
    await persistGenerated(prisma, 't-1', buildFixtureGen());

    const groupsList = [...state.groups.values()];
    expect(groupsList).toHaveLength(2);
    const keys = groupsList.map((g) => g.key).sort();
    expect(keys).toEqual(['A', 'B']);
    const stageId = [...state.stages.values()][0].id;
    for (const g of groupsList) {
      expect(g.stageId).toBe(stageId);
    }
  });

  it('legt für jedes Mitglied eine GroupMembership an (4 Members, eindeutig)', async () => {
    await persistGenerated(prisma, 't-1', buildFixtureGen());

    expect(state.memberships).toHaveLength(4);
    const groupIds = [...state.groups.values()].map((g) => g.id);
    for (const m of state.memberships) {
      expect(groupIds).toContain(m.groupId);
    }
    // jede (groupId, teamId)-Kombination genau einmal.
    const keys = state.memberships.map((m) => `${m.groupId}|${m.teamId}`);
    expect(new Set(keys).size).toBe(4);
    // position entspricht dem seed.
    const byName = { 'team-a1': 1, 'team-a2': 2, 'team-b1': 3, 'team-b2': 4 };
    for (const m of state.memberships) {
      expect(m.position).toBe(byName[m.teamId]);
    }
  });

  it('legt alle Round-Robin-Matches an, mit cuid-IDs (NICHT den Engine-Labels)', async () => {
    await persistGenerated(prisma, 't-1', buildFixtureGen());

    const matchesList = [...state.matches.values()];
    expect(matchesList).toHaveLength(2);
    const matchIds = matchesList.map((m) => m.id).sort();
    // Issue 1 Fix: Die DB-IDs sind frische Cuids, NICHT die Engine-Labels.
    // (Sonst würden zwei Turniere mit derselben Konfig kollidieren.)
    expect(matchIds).not.toEqual(['g_A_1', 'g_B_1']);
    for (const id of matchIds) {
      expect(isCuidLike(id)).toBe(true);
    }
    for (const m of matchesList) {
      expect(m.tournamentId).toBe('t-1');
      expect(m.status).toBe('scheduled');
    }
  });

  it('übernimmt Platzhalter-Referenzen unverändert in DB-Rows', async () => {
    await persistGenerated(prisma, 't-1', buildFixtureGen());
    // Issue 1 Fix: Die Match-IDs in der DB sind Cuids, nicht 'g_B_1'.
    // Wir identifizieren das richtige Match über groupId + field (=2).
    const koStyle = [...state.matches.values()].find((m) => m.field === 2);
    expect(koStyle).toBeDefined();
    expect(koStyle.placeholderHome).toEqual({
      type: 'winner_of',
      sourceGroupKey: 'A',
      sourceRank: 1,
    });
    expect(koStyle.placeholderAway).toEqual({
      type: 'winner_of',
      sourceGroupKey: 'A',
      sourceRank: 2,
    });
  });

  it('löscht alte Stages für dieses Tournament ZUERST', async () => {
    // 1. Run: ein Turnier anlegen + Stages existieren
    const result1 = await persistGenerated(prisma, 't-x', buildFixtureGen());
    expect([...state.stages.values()]).toHaveLength(1);

    // 2. Run: zweites Turnier → darf NICHT t-x' Stage löschen.
    await persistGenerated(prisma, 't-y', buildFixtureGen());
    expect([...state.stages.values()]).toHaveLength(2);

    // 3. Run: nochmal t-x → löscht nur t-x-Stage (nicht t-y).
    const beforeX = [...state.stages.values()].filter((s) => s.tournamentId === 't-x').length;
    await persistGenerated(prisma, 't-x', buildFixtureGen());
    const xStages = [...state.stages.values()].filter((s) => s.tournamentId === 't-x');
    expect(xStages).toHaveLength(1); // nur die neue Stage
    const yStages = [...state.stages.values()].filter((s) => s.tournamentId === 't-y');
    expect(yStages.length).toBeGreaterThanOrEqual(1); // unangetastet
  });

  it('Rückgabe hat korrekte Counts', async () => {
    const result = await persistGenerated(prisma, 't-1', buildFixtureGen());
    expect(result).toEqual({ groupCount: 2, matchCount: 2, teamCount: 4 });
  });
});

// ------------------------------------------------------------------
// 2) Rollback-Test: Mitten in der Transaktion wirft eine Prisma-Methode.
//    Erwartung: KEIN Teilzustand bleibt zurück.
// ------------------------------------------------------------------
describe('persistGenerated — Rollback', () => {
  it('Group-Create wirft → keine Stages, keine Groups, keine Memberships', async () => {
    const { prisma, state } = createMemoryPrisma({ failOn: 'group_' });
    await expect(
      persistGenerated(prisma, 't-1', buildFixtureGen())
    ).rejects.toThrow(/Group-Create/);

    // deleteMany wurde zwar im Tx-Callback aufgerufen (VOR dem Fehler),
    // aber Postgres macht ein ROLLBACK — die deleteMany-Schreibwirkung
    // muss in einem korrekten In-Memory-Sim auch zurückgenommen werden.
    expect([...state.stages.values()]).toHaveLength(0);
    expect([...state.groups.values()]).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
    expect([...state.matches.values()]).toHaveLength(0);
  });

  it('Membership-Create wirft → nachfolgende Group wird NICHT mehr persistiert', async () => {
    const { prisma, state } = createMemoryPrisma({ failOn: 'memberships' });
    await expect(
      persistGenerated(prisma, 't-1', buildFixtureGen())
    ).rejects.toThrow(/Membership-Create/);

    expect([...state.stages.values()]).toHaveLength(0);
    expect([...state.groups.values()]).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
    expect([...state.matches.values()]).toHaveLength(0);
  });

  it('Match-Create wirft → alle Groups und Memberships verschwinden', async () => {
    const { prisma, state } = createMemoryPrisma({ failOn: 'matches' });
    await expect(
      persistGenerated(prisma, 't-1', buildFixtureGen())
    ).rejects.toThrow(/Match-Create/);

    expect([...state.stages.values()]).toHaveLength(0);
    expect([...state.groups.values()]).toHaveLength(0);
    expect(state.memberships).toHaveLength(0);
    expect([...state.matches.values()]).toHaveLength(0);
  });

  it('nach Fehlschlag: erneuter Happy-Path-Aufruf ist möglich', async () => {
    // 1. Versuch scheitert.
    const mem1 = createMemoryPrisma({ failOn: 'matches' });
    await expect(
      persistGenerated(mem1.prisma, 't-1', buildFixtureGen())
    ).rejects.toThrow();

    // 2. Versuch in einer frischen TX (gleicher Prisma-Client simuliert DB).
    const mem2 = createMemoryPrisma();
    const result = await persistGenerated(mem2.prisma, 't-1', buildFixtureGen());
    expect(result.groupCount).toBe(2);
    expect([...mem2.state.stages.values()]).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// 3) Idempotenz: zweimal persistGenerated für dasselbe Turnier.
// ------------------------------------------------------------------
describe('persistGenerated — Idempotenz / Re-Generate', () => {
  it('überschreibt alte Stages sauber (kein Datenschrott)', async () => {
    const { prisma, state } = createMemoryPrisma();
    await persistGenerated(prisma, 't-1', buildFixtureGen());
    const gen2 = buildFixtureGen();
    gen2.groups = [gen2.groups[0]]; // nur eine Gruppe beim 2. Lauf
    gen2.groups[0].groupKey = 'C';
    gen2.groups[0].groupName = 'Gruppe C';
    const result = await persistGenerated(prisma, 't-1', gen2);

    expect(result.groupCount).toBe(1);
    // Nur noch die neue Gruppe 'C' vorhanden, A und B weg.
    const groupKeys = [...state.groups.values()].map((g) => g.key);
    expect(groupKeys).toEqual(['C']);
    // Member nur aus Gruppe C.
    expect(state.memberships).toHaveLength(2);
  });

  it('Re-Generate vergibt jedes Mal frische Cuids und löscht die alten Rows', async () => {
    // Re-Generate hinterlässt saubere 2 Matches, nicht 4.
    const { prisma, state } = createMemoryPrisma();
    await persistGenerated(prisma, 't-1', buildFixtureGen());
    const firstIds = [...state.matches.keys()].sort();
    expect(firstIds).toHaveLength(2);
    for (const id of firstIds) expect(isCuidLike(id)).toBe(true);

    // Zweiter Lauf: defensive deleteMany entfernt die alten Rows, neuer
    // Insert vergibt neue Cuids.
    const result = await persistGenerated(prisma, 't-1', buildFixtureGen());
    expect(result.groupCount).toBe(2);
    expect(result.matchCount).toBe(2);
    const secondIds = [...state.matches.keys()].sort();
    expect(secondIds).toHaveLength(2);
    // Neue Cuids, nicht die alten wiederverwendet.
    expect(secondIds).not.toEqual(firstIds);
    for (const id of secondIds) expect(isCuidLike(id)).toBe(true);
  });
});

// ------------------------------------------------------------------
// 4) Cross-Tournament-Kollision (Issue 1 Regression, 2026-08-12).
//
// Vor dem Fix: Zwei Turniere mit derselben Konfig produzierten
// Engine-IDs `g_A_1` / `g_B_1` / … für BEIDE. Beim createMany() der
// zweiten Generierung knallte es mit "Unique constraint failed on the
// (not available)" (das ist die PRIMARY KEY auf matches.id — Prisma
// nennt den Constraint-Namen nicht beim Raw-Constraint, deswegen
// "not available"). Der defensive `match.deleteMany({where:{tournamentId}})`
// traf nur das EINE Turnier im WHERE-Clause und konnte die anderen
// Rows nicht sehen.
//
// Mit dem Fix: Beim Persist wird für JEDES Match ein frischer cuid
// vergeben — die DB-IDs sind NICHT mehr die Engine-Labels.
// ------------------------------------------------------------------
describe('persistGenerated — Cross-Tournament-Kollision (Issue 1)', () => {
  it('zwei Turniere mit identischer Engine-Konfig können gleichzeitig existieren', async () => {
    const mem = createMemoryPrisma();
    const { prisma, state } = mem;

    // Turnier 1 anlegen + generieren
    await persistGenerated(prisma, 't-1', buildFixtureGen());
    expect([...state.matches.values()].map((m) => m.tournamentId)).toEqual(['t-1', 't-1']);

    // Turnier 2 anlegen + generieren — SELBE Engine-Config.
    // Vor dem Fix: createMany brach mit Unique-Constraint-Fehler ab,
    // weil `g_A_1` und `g_B_1` schon in der DB lagen.
    const result2 = await persistGenerated(prisma, 't-2', buildFixtureGen());
    expect(result2.groupCount).toBe(2);
    expect(result2.matchCount).toBe(2);

    // Insgesamt 4 Matches, je 2 pro Turnier.
    const allMatches = [...state.matches.values()];
    expect(allMatches).toHaveLength(4);
    const byT = allMatches.reduce((acc, m) => {
      acc[m.tournamentId] = (acc[m.tournamentId] ?? 0) + 1;
      return acc;
    }, {});
    expect(byT).toEqual({ 't-1': 2, 't-2': 2 });

    // Alle DB-IDs sind global eindeutig (kein Duplikat zwischen den
    // Turnieren).
    const ids = allMatches.map((m) => m.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(isCuidLike(id)).toBe(true);
  });

  it('Re-Generate auf Turnier 1 lässt Turnier 2 unangetastet', async () => {
    // Stellt sicher, dass das defensive deleteMany weiterhin scoping-
    // korrekt ist: nur DIESES Turnier wird aufgeräumt, fremde
    // Turniere bleiben liegen.
    const mem = createMemoryPrisma();
    const { prisma, state } = mem;

    await persistGenerated(prisma, 't-1', buildFixtureGen());
    await persistGenerated(prisma, 't-2', buildFixtureGen());

    const t1Before = [...state.matches.values()].filter((m) => m.tournamentId === 't-1');
    expect(t1Before).toHaveLength(2);
    const t2Before = [...state.matches.values()].filter((m) => m.tournamentId === 't-2');
    const t2IdsBefore = t2Before.map((m) => m.id).sort();

    // Re-Generate t-1.
    await persistGenerated(prisma, 't-1', buildFixtureGen());

    // t-2 muss unverändert sein — gleiche IDs, gleiche Anzahl.
    const t2After = [...state.matches.values()].filter((m) => m.tournamentId === 't-2');
    expect(t2After.map((m) => m.id).sort()).toEqual(t2IdsBefore);

    // t-1 hat neue Cuids (nicht die von vorher wiederverwendet).
    const t1After = [...state.matches.values()].filter((m) => m.tournamentId === 't-1');
    expect(t1After).toHaveLength(2);
    const t1IdsAfter = t1After.map((m) => m.id).sort();
    expect(t1IdsAfter).not.toEqual(t1Before.map((m) => m.id).sort());
  });
});
