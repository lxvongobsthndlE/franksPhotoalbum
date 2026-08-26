/**
 * Tests für den Zuschauer-Link (Spec §11, Stufe B).
 *
 * Diese Datei prüft die Sicherheitszusagen aus public-access.js einzeln,
 * weil jede davon eine eigene Art hat, still zu brechen:
 *
 *   1. Der Token ist die Adresse   → falscher/fehlender Token kommt nicht rein
 *   2. Entwürfe sind nie öffentlich → auch mit gültigem Token nicht
 *   3. Widerruf ist endgültig       → revoked und isPublic=false sperren
 *   4. Datensparsamkeit             → Nutzlast enthält keine Personendaten
 *
 * Zusage 4 wird bewusst REKURSIV über die fertige Nutzlast geprüft und
 * nicht Feld für Feld: Ein Test, der nur `payload.teams[0].players`
 * abfragt, übersieht dasselbe Feld eine Ebene tiefer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPublicToken,
  isWellFormedToken,
  tokensMatch,
  requirePublicTournament,
} from '../public-access.js';
import {
  buildPublicPayload,
  FORBIDDEN_PUBLIC_KEYS,
  FORBIDDEN_TOURNAMENT_KEYS,
} from '../public-view.js';
import { createMockPrismaClient } from '../../../__tests__/mocks/index.js';

const VALID = 'A'.repeat(32);

const fakePublicTournament = (overrides = {}) => ({
  id: 't1',
  groupId: 'g1',
  name: 'Sommerturnier',
  status: 'group_stage',
  isPublic: true,
  publicToken: VALID,
  publicRevokedAt: null,
  group: { id: 'g1', createdBy: 'u-owner', name: 'Verein' },
  ...overrides,
});

describe('createPublicToken', () => {
  it('liefert 32 base64url-Zeichen', () => {
    const t = createPublicToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('liefert bei jedem Aufruf einen anderen Wert', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(createPublicToken());
    expect(seen.size).toBe(200);
  });

  it('ist kein cuid — beginnt nicht mit "c" plus Zeitstempel-Muster', () => {
    // Absichtserklärung als Test: IDs dürfen hier nie wieder einziehen.
    const tokens = Array.from({ length: 50 }, () => createPublicToken());
    const cuidish = tokens.filter((t) => /^c[a-z0-9]{24}$/.test(t));
    expect(cuidish).toHaveLength(0);
  });
});

describe('isWellFormedToken', () => {
  it.each([
    ['gültig', VALID, true],
    ['zu kurz', 'abc', false],
    ['zu lang', 'A'.repeat(33), false],
    ['Sonderzeichen', 'A'.repeat(31) + '!', false],
    ['leer', '', false],
    ['null', null, false],
    ['Zahl', 12345, false],
    ['Objekt', {}, false],
  ])('%s → %s', (_name, input, expected) => {
    expect(isWellFormedToken(input)).toBe(expected);
  });
});

describe('tokensMatch', () => {
  it('gleiche Token → true', () => {
    expect(tokensMatch(VALID, VALID)).toBe(true);
  });
  it('unterschiedliche Token gleicher Länge → false', () => {
    expect(tokensMatch(VALID, 'B'.repeat(32))).toBe(false);
  });
  it('unterschiedliche Länge → false (ohne Ausnahme)', () => {
    expect(tokensMatch(VALID, 'B'.repeat(31))).toBe(false);
  });
  it('nicht-Strings → false', () => {
    expect(tokensMatch(null, VALID)).toBe(false);
    expect(tokensMatch(VALID, undefined)).toBe(false);
  });
});

describe('requirePublicTournament', () => {
  let prisma;
  beforeEach(() => {
    prisma = createMockPrismaClient();
  });

  it('gültiger Token → Turnier, ohne User und ohne Adminrechte', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakePublicTournament());
    const ctx = await requirePublicTournament(prisma, VALID);
    expect(ctx.public).toBe(true);
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.tournament.id).toBe('t1');
  });

  it('unbekannter Token → 404', async () => {
    prisma.tournament.findUnique.mockResolvedValue(null);
    await expect(requirePublicTournament(prisma, VALID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('missgestalteter Token fragt die Datenbank gar nicht erst', async () => {
    await expect(requirePublicTournament(prisma, 'kurz')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.tournament.findUnique).not.toHaveBeenCalled();
  });

  it('Entwurf → 404, auch mit gültigem Token (Zusage 2)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakePublicTournament({ status: 'draft' }));
    await expect(requirePublicTournament(prisma, VALID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('widerrufen → 404 (Zusage 3)', async () => {
    prisma.tournament.findUnique.mockResolvedValue(
      fakePublicTournament({ publicRevokedAt: new Date() })
    );
    await expect(requirePublicTournament(prisma, VALID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('isPublic=false → 404, selbst wenn der Token noch dasteht', async () => {
    prisma.tournament.findUnique.mockResolvedValue(fakePublicTournament({ isPublic: false }));
    await expect(requirePublicTournament(prisma, VALID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('abweichender Token in der Zeile → 404 (Zusage 1)', async () => {
    // Verteidigung gegen einen unsauberen Treffer: selbst wenn die Abfrage
    // etwas zurückgibt, muss der gespeicherte Token exakt passen.
    prisma.tournament.findUnique.mockResolvedValue(
      fakePublicTournament({ publicToken: 'B'.repeat(32) })
    );
    await expect(requirePublicTournament(prisma, VALID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('lehnt immer mit 404 ab, nie mit 403 — der Link verrät keine Existenz', async () => {
    const faelle = [
      null,
      fakePublicTournament({ status: 'draft' }),
      fakePublicTournament({ isPublic: false }),
      fakePublicTournament({ publicRevokedAt: new Date() }),
    ];
    for (const fall of faelle) {
      prisma.tournament.findUnique.mockResolvedValue(fall);
      const err = await requirePublicTournament(prisma, VALID).catch((e) => e);
      expect(err.statusCode).toBe(404);
    }
  });
});

describe('buildPublicPayload — Datensparsamkeit (Zusage 4)', () => {
  const vollerViewKontext = {
    tournament: {
      id: 't1',
      groupId: 'g1',
      name: 'Sommerturnier',
      status: 'group_stage',
      statusLabel: 'Gruppenphase',
      mode: 'groups_ko',
      modeLabel: 'Gruppen + K.-o.',
      logoUrl: '/logo.png',
      coverUrl: '/cover.png',
      location: 'Vereinsheim',
      sport: 'becher',
      scoreLabel: 'Becher',
      scoreShort: 'B',
      rules: 'Interner Regeltext',
      isPublic: true,
      publicToken: VALID,
      publicEnabledAt: new Date(),
      publicRevokedAt: null,
      createdById: 'u-owner',
      startedAt: new Date(),
      updatedAt: new Date(),
      teamCount: 8,
    },
    teams: [
      {
        id: 'team1',
        name: 'Die Adler',
        color: '#f00',
        logoUrl: null,
        seed: 1,
        players: 'Anna Schmidt, Bernd Meier',
        linkedUserIds: ['u1', 'u2'],
      },
    ],
    stages: [
      { id: 's1', type: 'group', typeLabel: 'Gruppenphase', name: 'Gruppenphase', orderIndex: 0 },
    ],
    // Feldnamen wie in prepareStandings (access/group.js): `name`, nicht
    // `teamName`; `goalsFor`/`goalDiff`, nicht `scoreFor`/`scoreDiff`.
    // Ein Fixture mit erfundenen Namen hätte hier alles durchgewinkt und
    // im Browser eine leere Tabelle ergeben.
    groups: [
      {
        id: 'g-a',
        key: 'A',
        name: 'Gruppe A',
        stageId: 's1',
        memberCount: 4,
        members: [{ teamId: 'team1', name: 'Die Adler', position: 1 }],
        standings: [
          {
            rank: 1,
            teamId: 'team1',
            name: 'Die Adler',
            played: 3,
            won: 2,
            drawn: 0,
            lost: 1,
            goalsFor: 12,
            goalsAgainst: 7,
            goalDiff: 5,
            points: 6,
            qualifies: true,
            unresolved: false,
            tiebreakerNote: null,
          },
        ],
      },
    ],
    matches: [
      {
        id: 'm1',
        tournamentId: 't1',
        stageId: 's1',
        stageType: 'group',
        stageName: 'Gruppenphase',
        groupId: 'g-a',
        groupKey: 'A',
        label: 'Die Adler – Die Falken',
        round: null,
        roundLabel: null,
        scoreHome: 3,
        scoreAway: 1,
        status: 'finished',
        statusLabel: 'Beendet',
        isFinished: true,
        isLive: false,
        isGroupMatch: true,
        isKoMatch: false,
        field: 2,
        scheduledTime: '14:30',
        scheduledLabel: '14:30',
        home: { kind: 'team', teamId: 'team1', name: 'Die Adler', color: '#f00', logoUrl: null },
        away: { kind: 'team', teamId: 'team2', name: 'Die Falken', color: '#00f', logoUrl: null },
      },
    ],
    // Der View-Kontext trägt interne Lookups mit ROHEN Prisma-Zeilen —
    // inklusive linkedUserIds und players. Sie dürfen die Allowlist
    // niemals passieren.
    _lookups: {
      teamsLookup: new Map([
        ['team1', { id: 'team1', players: 'Anna Schmidt', linkedUserIds: ['u1'] }],
      ]),
      groupsLookup: new Map(),
      stagesLookup: new Map(),
      matchesLookup: new Map(),
    },
    stats: { teamCount: 8, groupCount: 2, matchCount: 12, finishedCount: 5 },
  };

  /** Sammelt jeden Schlüsselnamen der Struktur, beliebig tief. */
  function alleSchluessel(wert, gesammelt = new Set()) {
    if (Array.isArray(wert)) {
      for (const eintrag of wert) alleSchluessel(eintrag, gesammelt);
    } else if (wert && typeof wert === 'object' && !(wert instanceof Date)) {
      for (const [k, v] of Object.entries(wert)) {
        gesammelt.add(k);
        alleSchluessel(v, gesammelt);
      }
    }
    return gesammelt;
  }

  it('enthält auf KEINER Ebene ein verbotenes Feld', () => {
    const payload = buildPublicPayload(vollerViewKontext);
    const vorhanden = alleSchluessel(payload);
    const verstoesse = FORBIDDEN_PUBLIC_KEYS.filter((k) => vorhanden.has(k));
    expect(verstoesse).toEqual([]);
  });

  it('streicht Spielernamen, auch tief in der Tabelle', () => {
    const payload = buildPublicPayload(vollerViewKontext);
    const alsText = JSON.stringify(payload);
    expect(alsText).not.toContain('Anna Schmidt');
    expect(alsText).not.toContain('Bernd Meier');
    expect(alsText).not.toContain('geheim');
  });

  it('spiegelt den Token nicht in die Antwort', () => {
    const payload = buildPublicPayload(vollerViewKontext);
    expect(JSON.stringify(payload)).not.toContain(VALID);
  });

  it('hält Innereien aus dem Turnier-Kopf heraus', () => {
    const payload = buildPublicPayload(vollerViewKontext);
    for (const k of FORBIDDEN_TOURNAMENT_KEYS) {
      expect(payload.tournament).not.toHaveProperty(k);
    }
  });

  it('reicht die internen Lookups nicht durch', () => {
    // _lookups enthält rohe Prisma-Zeilen. Ein `{...view}`-Durchreichen
    // an irgendeiner Stelle würde sie mitveröffentlichen.
    const payload = buildPublicPayload(vollerViewKontext);
    expect(payload).not.toHaveProperty('_lookups');
    expect(JSON.stringify(payload)).not.toContain('Anna Schmidt');
  });

  it('liefert trotzdem alles, was ein Zuschauer braucht', () => {
    const payload = buildPublicPayload(vollerViewKontext);
    expect(payload.tournament.name).toBe('Sommerturnier');
    expect(payload.tournament.location).toBe('Vereinsheim');
    expect(payload.tournament.scoreLabel).toBe('Becher');
    expect(payload.teams[0].name).toBe('Die Adler');
    expect(payload.readOnly).toBe(true);

    // Die Tabelle muss vollständig ankommen — mit den ECHTEN Feldnamen.
    const zeile = payload.groups[0].standings[0];
    expect(zeile.name).toBe('Die Adler');
    expect(zeile.rank).toBe(1);
    expect(zeile.played).toBe(3);
    expect(zeile.won).toBe(2);
    expect(zeile.goalsFor).toBe(12);
    expect(zeile.goalDiff).toBe(5);
    expect(zeile.points).toBe(6);

    // Und das Spiel mit allem, was auf der Karte steht.
    const spiel = payload.matches[0];
    expect(spiel.scoreHome).toBe(3);
    expect(spiel.scoreAway).toBe(1);
    expect(spiel.home.name).toBe('Die Adler');
    expect(spiel.away.name).toBe('Die Falken');
    expect(spiel.scheduledTime).toBe('14:30');
    expect(spiel.field).toBe(2);
    expect(spiel.statusLabel).toBe('Beendet');
  });

  it('keine Tabellenzeile kommt mit lauter undefined an', () => {
    // Der Fehler, den ein Fixture mit erfundenen Feldnamen durchgelassen
    // hätte: Die Allowlist greift auf Namen zu, die es nicht gibt, und
    // liefert eine formal korrekte, inhaltlich leere Tabelle.
    const zeile = buildPublicPayload(vollerViewKontext).groups[0].standings[0];
    const gesetzteWerte = Object.values(zeile).filter((v) => v !== undefined);
    expect(gesetzteWerte.length).toBe(Object.keys(zeile).length);
  });

  it('verträgt einen leeren Kontext, ohne zu werfen', () => {
    expect(() => buildPublicPayload({})).not.toThrow();
    expect(() => buildPublicPayload(null)).not.toThrow();
    const leer = buildPublicPayload(null);
    expect(leer.tournament).toBeNull();
    expect(leer.teams).toEqual([]);
  });

  // Der Test, der die Allowlist zur Allowlist macht: Ein neu erfundenes
  // Feld im internen DTO darf draußen NICHT auftauchen. Bräche jemand die
  // Schicht auf eine Blocklist herunter, fiele genau dieser Test.
  it('ein neues, unbekanntes Feld erreicht die Öffentlichkeit nicht', () => {
    const mitNeuemFeld = {
      ...vollerViewKontext,
      tournament: { ...vollerViewKontext.tournament, geheimeNotiz: 'nicht zeigen' },
      teams: [{ ...vollerViewKontext.teams[0], telefonnummer: '0170 1234567' }],
    };
    const alsText = JSON.stringify(buildPublicPayload(mitNeuemFeld));
    expect(alsText).not.toContain('nicht zeigen');
    expect(alsText).not.toContain('0170 1234567');
  });
});
