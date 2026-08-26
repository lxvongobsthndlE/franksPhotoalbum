/**
 * End-to-End-Test gegen ECHTE PostgreSQL-DB (Bug 5, 2026-08-17).
 *
 * Hintergrund:
 *   POST /:id/matches/:matchId/result hatte über Wochen einen
 *   Schema-Drift: prisma.match.update schrieb winnerTeamId/isDraw/
 *   completedAt in Spalten, die das Schema nicht hat. Prisma lehnt
 *   das mit "Unknown argument" ab.
 *
 *   Warum das nicht in den Mock-Tests aufgefallen ist: mockResolvedValue
 *   returnt einfach einen Wert — wirft nicht bei unbekannten Argumenten.
 *   Wir brauchen also MINDESTENS EINEN Test, der den ganzen Stack
 *   gegen eine echte DB fährt. Erst dann wird ein "Unknown argument"
 *   zum echten Failure.
 *
 * Strategie:
 *   - Eigene Test-DB `photoalbum_test` (postgres://localhost:5432).
 *     Einmalig via `npx prisma migrate deploy` aufgesetzt (siehe
 *     docs/tournament-real-db-tests.md).
 *   - Vor jedem Test: TRUNCATE auf alle Tournament-Tabellen
 *     (CASCADE, weil Foreign Keys) — damit keine State-Leaks zwischen
 *     Tests.
 *   - Seed: User + Group + GroupMember + Tournament + Stages +
 *     TournamentTeams + Matches (inkl. KO-Match mit winnerAdvancesTo).
 *   - Fastify-Instanz mit echtem prisma-Client + x-test-user-Header
 *     als Auth-Bypass (vergleichbar mit routes.integration.test.js,
 *     aber ohne Prisma-Mock).
 *
 * Wir testen hier NICHT die Auth-Logik selbst — die ist in
 * auth.test.js (Unit) und routes.integration.test.js (Mock-E2E)
 * ausführlich geprüft. Hier geht es um: "wenn ein Admin-Ergebnis
 * reinkommt, schreibt die Route in die echte DB und macht die
 * KO-Propagation korrekt".
 *
 * Voraussetzung für CI: DATABASE_URL_TEST muss auf eine postgres-DB
 * zeigen, in der die Prisma-Migrationen deployt sind.
 *   DATABASE_URL_TEST=postgresql://postgres:...@localhost:5432/photoalbum_test
 *
 * Wenn DATABASE_URL_TEST fehlt, wird der Suite SKIPPED (Vitest
 * describe.skip) — sonst bricht die ganze Test-Suite für Entwickler
 * ohne lokale Postgres-Instanz.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import tournamentsRoutes from '../index.js';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
const hasDb = !!TEST_DB_URL;

// Wenn keine Test-DB konfiguriert ist: Suite SKIPPEN.
// describe.skip würde Vitest-Fehler werfen, daher dynamisch
// describe aufrufen oder describe.skip mit Bedingung. Vitest hat
// kein "describe.if" — wir umgehen das mit einem Top-Level-Skip
// im Body jedes Tests.
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn('[routes.real-db-test] DATABASE_URL_TEST nicht gesetzt — Suite wird geskippt.');
}

let prisma;
let app;

suite('Real-DB: POST /api/tournaments/:id/matches/:matchId/result', () => {
  // Test-DB-Connection einmalig aufbauen + am Ende schließen.
  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    });
    // Sanity-Check: Verbindung steht?
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  // Vor jedem Test: TRUNCATE aller Tournament-Tabellen + State.
  // Wir nehmen die explizite Liste, weil `TRUNCATE ... CASCADE` mit
  // dynamischen Namen um String-Building erfordern würde. Die Reihen-
  // folge ist egal dank CASCADE.
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "matches",
        "group_memberships",
        "tournament_teams",
        "stages",
        "groups_",
        "tournaments",
        "GroupMember",
        "Group",
        "User"
      RESTART IDENTITY CASCADE
    `);
    app = await buildApp(prisma);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 1: KO-Sieg → Score persistiert + Propagation in echter DB
  // ─────────────────────────────────────────────────────────────────
  it('Bug 3b: KO-Sieg persistiert Score + propagiert Sieger in Folgematch (echte DB)', async () => {
    const ctx = await seedKoBracket(prisma);
    // ctx: { tournamentId, matchAId (KO-Semi), matchFinalId (F) }

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${ctx.tournamentId}/matches/${ctx.matchAId}/result`,
      headers: { 'x-test-user': ctx.adminId },
      payload: { scoreHome: 2, scoreAway: 1 },
    });
    expect(res.statusCode).toBe(200);

    // Score persistiert?
    const mA = await prisma.match.findUnique({ where: { id: ctx.matchAId } });
    expect(mA.scoreHome).toBe(2);
    expect(mA.scoreAway).toBe(1);
    expect(mA.status).toBe('finished');

    // Finale hat jetzt den Sieger als teamHome?
    const mFinal = await prisma.match.findUnique({
      where: { id: ctx.matchFinalId },
    });
    expect(mFinal.teamHome).toBe(ctx.teamIds[0]); // Sieger = Team 0
    expect(mFinal.teamAway).toBeNull();

    // Response enthält propagatedMatches als DTOs (Bug 3b-Fix)?
    const body = res.json();
    expect(body).toHaveProperty('match');
    expect(body).toHaveProperty('propagated');
    expect(body.propagated).toContain(ctx.matchFinalId);
    expect(Array.isArray(body.propagatedMatches)).toBe(true);
    expect(body.propagatedMatches).toHaveLength(1);
    expect(body.propagatedMatches[0].id).toBe(ctx.matchFinalId);
    expect(body.propagatedMatches[0].home).toMatchObject({
      name: expect.any(String),
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 2: KO-Unentschieden → 400 + KEIN DB-Write
  // ─────────────────────────────────────────────────────────────────
  it('Bug 3a: KO-Unentschieden wird mit 400 abgelehnt, KEINE DB-Änderung (echte DB)', async () => {
    const ctx = await seedKoBracket(prisma);

    // Snapshot: Match-Scores VOR dem Aufruf
    const beforeA = await prisma.match.findUnique({ where: { id: ctx.matchAId } });
    const beforeFinal = await prisma.match.findUnique({ where: { id: ctx.matchFinalId } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${ctx.tournamentId}/matches/${ctx.matchAId}/result`,
      headers: { 'x-test-user': ctx.adminId },
      payload: { scoreHome: 1, scoreAway: 1 },
    });
    expect(res.statusCode).toBe(400);

    const body = res.json();
    expect(body.error).toBe('no_draw_in_knockout');
    expect(body.field).toBe('scoreHome');

    // Snapshot NACH dem Aufruf: Scores unverändert?
    const afterA = await prisma.match.findUnique({ where: { id: ctx.matchAId } });
    const afterFinal = await prisma.match.findUnique({ where: { id: ctx.matchFinalId } });

    expect(afterA.scoreHome).toBe(beforeA.scoreHome);
    expect(afterA.scoreAway).toBe(beforeA.scoreAway);
    expect(afterA.status).toBe(beforeA.status);

    expect(afterFinal.teamHome).toBe(beforeFinal.teamHome);
    expect(afterFinal.teamAway).toBe(beforeFinal.teamAway);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 3: Schema-Geister werden von Prisma abgewiesen
  //
  // Hintergrund (Bug 1, 2026-08-17): Die alte Route schrieb
  // winnerTeamId/isDraw/completedAt in prisma.match.update. Das hat
  // in Mock-Tests nicht angeschlagen — aber Prisma wirft in der
  // Realität "Unknown argument". Dieser Test beweist das EXPLORIT.
  // ─────────────────────────────────────────────────────────────────
  it('Bug 1: prisma.match.update mit Schema-Geistern wird von echtem Prisma abgewiesen', async () => {
    // Wir machen hier KEINEN HTTP-Call, sondern einen direkten Prisma-
    // Aufruf. Das ist genau der Punkt, an dem die Mock-Tests blind
    // waren — der direkte Round-Trip gegen die DB.
    let threw = null;
    try {
      await prisma.match.update({
        where: { id: 'irrelevant-id' }, // würde 404 werfen — aber wir wollen den "Unknown argument"-Fehler davor
        data: {
          scoreHome: 2,
          winnerTeamId: 'team-x', // Schema-Geist!
          isDraw: false, // Schema-Geist!
          completedAt: new Date(), // Schema-Geist!
        },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeNull();
    // Prisma wirft PrismaClientKnownRequestError mit Code P2009 oder
    // eine PrismaClientValidationError. Wir prüfen nur, dass es ein
    // Fehler IST — nicht den exakten Code, weil der sich zwischen
    // Prisma-Versionen unterscheidet.
    const msg = String(threw?.message || threw);
    expect(msg.toLowerCase()).toMatch(
      /winnerteamid|isdraw|completedat|unknown argument|unknown field/
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 4: Normaler Score (kein KO) → nur Score-Update, keine Prop.
  // ─────────────────────────────────────────────────────────────────
  it('Real-DB: Gruppenphasen-Score persistiert, keine KO-Propagation', async () => {
    const ctx = await seedKoBracket(prisma);
    // Wir haben ein Group-Match mitgesetet (matchGroupId). Score eintragen.
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${ctx.tournamentId}/matches/${ctx.matchGroupId}/result`,
      headers: { 'x-test-user': ctx.adminId },
      payload: { scoreHome: 3, scoreAway: 0 },
    });
    expect(res.statusCode).toBe(200);

    const m = await prisma.match.findUnique({ where: { id: ctx.matchGroupId } });
    expect(m.scoreHome).toBe(3);
    expect(m.scoreAway).toBe(0);
    expect(m.status).toBe('finished');

    const body = res.json();
    expect(body.propagated).toEqual([]);
    expect(body.propagatedMatches).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 5: Bug 6 — Zwei Halbfinals eintragen, BEIDE Sieger im Finale.
  //
  // Vorher (Bug 2026-08-18): resetCascade hat das Finale beim zweiten
  // HF-Eintrag komplett geleert → nur der zweite Sieger stand im
  // Finale, der erste ging verloren. User-Bericht: "Team 2 nicht —
  // dort steht weiterhin der Platzhalter Sieger HF 2". Blockierte das
  // komplette Turnier — ohne funktionierende Kaskade ist der KO-Teil
  // unbrauchbar.
  // ─────────────────────────────────────────────────────────────────
  it('Bug 6: 2 HFs eintragen → BEIDE Sieger landen im Finale (echte DB)', async () => {
    const ctx = await seedKoBracket(prisma);

    // 1) SF1 (T0 vs T1) eintragen: T0 gewinnt 2:1.
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${ctx.tournamentId}/matches/${ctx.matchAId}/result`,
      headers: { 'x-test-user': ctx.adminId },
      payload: { scoreHome: 2, scoreAway: 1 },
    });
    expect(r1.statusCode).toBe(200);

    // Nach SF1: Finale hat T0 als Sieger in teamHome, teamAway noch null.
    let finalAfter1 = await prisma.match.findUnique({ where: { id: ctx.matchFinalId } });
    expect(finalAfter1.teamHome).toBe(ctx.teamIds[0]);
    expect(finalAfter1.teamAway).toBeNull();

    // 2) SF2 (T2 vs T3) eintragen: T3 gewinnt 1:2 (Auswärtssieg).
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${ctx.tournamentId}/matches/${ctx.matchBId}/result`,
      headers: { 'x-test-user': ctx.adminId },
      payload: { scoreHome: 1, scoreAway: 2 },
    });
    expect(r2.statusCode).toBe(200);

    // Nach SF2: Finale hat T0 in teamHome (von SF1, erhalten geblieben)
    // UND T3 in teamAway (von SF2, frisch eingetragen).
    // DAS WAR DER BUG: vorher stand nur T3 im Finale, T0 war weg.
    const finalAfter2 = await prisma.match.findUnique({ where: { id: ctx.matchFinalId } });
    expect(finalAfter2.teamHome).toBe(ctx.teamIds[0]); // T0 (von SF1)
    expect(finalAfter2.teamAway).toBe(ctx.teamIds[3]); // T3 (von SF2)

    // Response von SF2 muss das Finale als propagiertes Match melden.
    const body2 = r2.json();
    expect(body2.propagated).toContain(ctx.matchFinalId);
    expect(body2.propagatedMatches.map((m) => m.id)).toContain(ctx.matchFinalId);
  });
});

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Fastify-Instanz mit echtem prisma + x-test-user-Bypass.
 * KEIN Mock, KEIN JWT — request.jwtVerify wird als no-op
 * überschrieben, request.user wird aus dem Header gelesen.
 */
async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => {
    // Bypass JWT — wir vertrauen dem Header im Test.
    request.jwtVerify = async () => {};
    const uid = request.headers['x-test-user'];
    if (uid) request.user = { id: String(uid) };
  });
  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
  return app;
}

/**
 * Seedet ein Mini-Turnier: 1 Gruppe, 1 Tournament (groups_ko), 1 Group-
 * Stage, 1 KO-Stage, 4 Teams, 1 Gruppen-Match + 2 Halbfinals + 1 Finale.
 *
 * Returns:
 *   {
 *     adminId,            // User-Id
 *     tournamentId,
 *     teamIds,           // 4 Teams: [t0, t1, t2, t3]
 *     matchGroupId,      // Gruppen-Match
 *     matchAId,          // SF1 (T0 vs T1)
 *     matchBId,          // SF2 (T2 vs T3)
 *     matchFinalId,      // F (leer, propagiert)
 *   }
 */
async function seedKoBracket(prisma) {
  // 1) Admin-User
  const admin = await prisma.user.create({
    data: {
      id: 'u-admin-1',
      email: 'admin@test.local',
      username: 'admin-test',
      role: 'user',
      name: 'Test Admin',
    },
  });

  // 2) Group (Berechtigungs-Gruppe, NICHT die Spielgruppe)
  const group = await prisma.group.create({
    data: {
      id: 'g-1',
      name: 'Test Group',
      code: 'TEST-GRP-' + Date.now(),
      createdBy: admin.id,
    },
  });

  // 3) GroupMember (User ist Mitglied)
  await prisma.groupMember.create({
    data: { userId: admin.id, groupId: group.id },
  });

  // 4) Tournament
  const t1 = await prisma.tournament.create({
    data: {
      id: 't-1',
      groupId: group.id,
      name: 'Test-Turnier ' + Date.now(),
      mode: 'groups_ko',
      status: 'group_stage',
      createdById: admin.id,
    },
  });

  // 5) Stages
  const groupStage = await prisma.stage.create({
    data: {
      id: 'stg-group',
      tournamentId: t1.id,
      type: 'group',
      name: 'Gruppenphase',
      orderIndex: 1,
    },
  });
  const koStage = await prisma.stage.create({
    data: {
      id: 'stg-ko',
      tournamentId: t1.id,
      type: 'ko',
      name: 'K.O.',
      orderIndex: 2,
    },
  });

  // 6) Spielgruppe innerhalb des Turniers
  const grp = await prisma.group_.create({
    data: {
      id: 'grp-1',
      stageId: groupStage.id,
      key: 'A',
      name: 'Gruppe A',
    },
  });

  // 7) 4 Teams
  const teams = [];
  for (let i = 0; i < 4; i++) {
    const t = await prisma.tournamentTeam.create({
      data: {
        id: `team-${i}`,
        tournamentId: t1.id,
        name: `Team ${i}`,
        color: '#000000',
        seed: i + 1,
      },
    });
    teams.push(t);
  }

  // 8) Matches:
  //   - 1 Gruppen-Match (T0 vs T1)
  //   - 2 Halbfinals (T0 vs T1, T2 vs T3) → beide winnerAdvancesTo=F
  //   - 1 Finale (leer)
  const matchGroup = await prisma.match.create({
    data: {
      id: 'm-group',
      tournamentId: t1.id,
      stageId: groupStage.id,
      groupId: grp.id,
      teamHome: teams[0].id,
      teamAway: teams[1].id,
      round: 'R1',
      status: 'scheduled',
    },
  });

  const matchFinal = await prisma.match.create({
    data: {
      id: 'm-final',
      tournamentId: t1.id,
      stageId: koStage.id,
      teamHome: null,
      teamAway: null,
      round: 'F',
      status: 'scheduled',
    },
  });

  const matchA = await prisma.match.create({
    data: {
      id: 'm-sf-1',
      tournamentId: t1.id,
      stageId: koStage.id,
      teamHome: teams[0].id,
      teamAway: teams[1].id,
      round: 'SF',
      bracketPos: 1,
      winnerAdvancesTo: matchFinal.id,
      status: 'scheduled',
    },
  });

  const matchB = await prisma.match.create({
    data: {
      id: 'm-sf-2',
      tournamentId: t1.id,
      stageId: koStage.id,
      teamHome: teams[2].id,
      teamAway: teams[3].id,
      round: 'SF',
      bracketPos: 2,
      winnerAdvancesTo: matchFinal.id,
      status: 'scheduled',
    },
  });

  return {
    adminId: admin.id,
    tournamentId: t1.id,
    teamIds: teams.map((t) => t.id),
    matchGroupId: matchGroup.id,
    matchAId: matchA.id,
    matchBId: matchB.id,
    matchFinalId: matchFinal.id,
  };
}
