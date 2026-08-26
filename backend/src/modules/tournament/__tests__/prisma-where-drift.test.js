/**
 * Where-Klausel-Drift-Audit (Bug 2026-08-25).
 *
 * Hintergrund:
 *   `POST /:id/fill-ko` antwortete mit 500, der Knopf „K.-o.-Phase starten"
 *   war tot. Ursache in routes.js:
 *     tx.group_.findMany({ where: { tournamentId: tournament.id } })
 *   `Group_` hat aber kein `tournamentId` (schema.prisma:176-188) — nur
 *   `stageId` und die Relation `stage`. Prisma lehnt das ab:
 *     Unknown argument `tournamentId`. Available options are marked with ?.
 *
 *   Bei P3 (2026-08-24) wurde an dieser Stelle der MODELLNAME korrigiert
 *   (`group` -> `group_`), die where-Klausel aber nicht mitgezogen. Die drei
 *   anderen group_-Queries (routes.js:766, :992, view.js:78) filtern seit
 *   jeher korrekt über `stage: { tournamentId }`.
 *
 * Warum 1446 grüne Tests das nicht gefangen haben — zwei Gründe, beide gemessen:
 *   1. Die Tests mocken Prisma. `mockResolvedValue([])` nimmt JEDE where-Klausel
 *      an und wirft nie — genau die Falle, die schon `schema-drift-audit.test.js`
 *      für `data:`/`create:` beschreibt.
 *   2. In `fill-ko-route.test.js` steht `tournamentTeam.findMany` auf `[]`.
 *      Die Funktion bricht deshalb vorher mit `reason: 'no_teams'` ab und
 *      ERREICHT die Gruppen-Query gar nicht.
 *
 * Dieser Test ist die Ergänzung zu `schema-drift-audit.test.js`, der in seinem
 * eigenen Kopf notiert, dass er where-Klauseln bewusst auslässt („die
 * akzeptieren Prisma-Operatoren, die wir nicht 1:1 auflösen können"). Genau
 * dort sass dieser Bug. Wir lösen die Operatoren jetzt auf, statt aufzugeben.
 *
 * Regel: Jeder Schlüssel auf der OBERSTEN Ebene einer `where: { … }` muss
 *   - ein Feld des Modells sein, ODER
 *   - eine Relation des Modells (dann folgt ein verschachteltes Filterobjekt), ODER
 *   - ein Prisma-Logikoperator (AND / OR / NOT).
 *
 * FAIL-OPEN ist Pflicht (dieselbe Doktrin wie beim Selektor-Detektor): Was der
 * Audit nicht sicher beurteilen kann, lässt er durch. Lieber ein Loch als ein
 * falscher Alarm — ein Audit, der einmal grundlos rot wird, wird stillgelegt
 * und ist dann wertlos. Übersprungen wird deshalb:
 *   - `where: <variable>` (kein Objektliteral)
 *   - Spreads (`...filter`) und berechnete Schlüssel (`[x]: …`)
 *   - Modelle, die im Schema nicht gefunden werden (Tippfehler im Accessor
 *     fängt bereits der bestehende Audit)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = resolve(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma');
const scanRoot = resolve(__dirname, '..', '..', '..');

/** Prisma-Operatoren, die auf jeder Ebene erlaubt sind. */
const LOGIC_OPS = new Set(['AND', 'OR', 'NOT']);

/** Lesende Prisma-Methoden, deren `where` ein Modell-Filter ist. */
const READ_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
];

/**
 * schema.prisma → Map<accessorName, Set<erlaubteSchluessel>>.
 * Prisma leitet den Accessor aus dem Modellnamen ab, indem es den ersten
 * Buchstaben kleinschreibt: `Group_` -> `group_`, `TournamentTeam` -> `tournamentTeam`.
 */
function parseSchema() {
  const src = readFileSync(schemaPath, 'utf8');
  const models = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const keys = new Set();
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      // Verbundschlüssel: `@@unique([userId, groupId])` erzeugt in Prisma den
      // Filter-Schlüssel `userId_groupId`. Der steht nirgends als Feld und
      // hätte den Audit sonst mit Fehlalarmen geflutet (gemessen 25.08.:
      // 8 Treffer in likes.js/photos.js, alle gültig). `@@unique(name: "x", …)`
      // benennt ihn um — dann gilt der eigene Name.
      const compound = line.match(/^@@(?:unique|id)\s*\(([\s\S]*)\)\s*$/);
      if (compound) {
        const custom = compound[1].match(/name\s*:\s*['"](\w+)['"]/);
        const list = compound[1].match(/\[([^\]]*)\]/);
        if (custom) keys.add(custom[1]);
        else if (list)
          keys.add(
            list[1]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .join('_')
          );
        continue;
      }
      if (line.startsWith('@@')) continue;
      const field = line.match(/^(\w+)\s+\S/);
      if (field) keys.add(field[1]);
    }
    const accessor = name.charAt(0).toLowerCase() + name.slice(1);
    models.set(accessor, keys);
  }
  return models;
}

/** Alle .js-Dateien unter backend/src, ohne Tests. */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Findet die schliessende Klammer zu der bei `open` geöffneten. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Schlüssel auf Tiefe 1 eines Objektliterals einsammeln.
 * Gibt `null` zurück, wenn etwas Unbeurteilbares vorkommt (Spread, berechneter
 * Schlüssel) — der Aufrufer überspringt die Stelle dann (fail-open).
 */
function topLevelKeys(objSrc) {
  const inner = objSrc.slice(1, -1);
  const keys = [];
  let depth = 0;
  let atKeyPos = true;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') {
      depth += 1;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (c === ',') {
      atKeyPos = true;
      continue;
    }
    if (/\s/.test(c)) continue;
    if (!atKeyPos) continue;
    if (inner.startsWith('...', i)) return null; // Spread → nicht beurteilbar
    if (c === '[') return null; // berechneter Schlüssel
    const rest = inner.slice(i);
    const key = rest.match(/^['"]?(\w+)['"]?\s*:/);
    if (!key) return null; // Shorthand o.ä.
    keys.push(key[1]);
    atKeyPos = false;
    i += key[0].length - 1;
  }
  return keys;
}

/** Alle beurteilbaren where-Stellen im Quelltext. */
function findWhereClauses(src, file) {
  const found = [];
  const call = new RegExp(
    `\\b(?:prisma|tx|client|db)\\.(\\w+)\\.(${READ_METHODS.join('|')})\\s*\\(`,
    'g'
  );
  let m;
  while ((m = call.exec(src)) !== null) {
    const [, accessor] = m;
    const argOpen = src.indexOf('{', m.index + m[0].length - 1);
    if (argOpen === -1) continue;
    const argClose = matchBrace(src, argOpen);
    if (argClose === -1) continue;
    const arg = src.slice(argOpen, argClose + 1);

    const wIdx = arg.search(/\bwhere\s*:/);
    if (wIdx === -1) continue;
    const wOpen = arg.indexOf('{', wIdx);
    if (wOpen === -1) continue;
    // `where:` ohne Objektliteral (Variable) → nicht beurteilbar
    if (arg.slice(wIdx + arg.slice(wIdx).indexOf(':') + 1, wOpen).trim() !== '') continue;
    const wClose = matchBrace(arg, wOpen);
    if (wClose === -1) continue;

    const keys = topLevelKeys(arg.slice(wOpen, wClose + 1));
    if (keys === null) continue; // fail-open
    found.push({
      accessor,
      keys,
      line: src.slice(0, m.index).split('\n').length,
      file,
    });
  }
  return found;
}

describe('Where-Drift-Audit: jeder where-Schlüssel existiert im Schema', () => {
  const models = parseSchema();
  const files = collectSources(scanRoot);

  it('Setup: Schema und Quellen sind lesbar', () => {
    expect(models.size).toBeGreaterThan(5);
    expect(models.has('group_')).toBe(true);
    expect(files.length).toBeGreaterThan(5);
  });

  it('Group_ hat kein tournamentId — die Prämisse des Bugs', () => {
    const g = models.get('group_');
    expect(g.has('stageId')).toBe(true);
    expect(g.has('stage')).toBe(true);
    expect(g.has('tournamentId')).toBe(false);
  });

  it('Selbsttest: ein erfundener where-Schlüssel wird erkannt', () => {
    const probe = `
      const x = await tx.group_.findMany({
        where: { tournamentId: t.id },
        include: { memberships: true },
      });`;
    const hits = findWhereClauses(probe, 'probe.js');
    expect(hits).toHaveLength(1);
    expect(hits[0].keys).toEqual(['tournamentId']);
    expect(models.get('group_').has('tournamentId')).toBe(false);
  });

  it('Selbsttest: der korrigierte Filter über die Relation ist sauber', () => {
    const probe = `
      const x = await tx.group_.findMany({
        where: { stage: { tournamentId: t.id } },
      });`;
    const hits = findWhereClauses(probe, 'probe.js');
    expect(hits[0].keys).toEqual(['stage']);
    expect(models.get('group_').has('stage')).toBe(true);
  });

  it('Fail-open: eine where-Variable wird übersprungen, nicht gemeldet', () => {
    const probe = 'const x = await prisma.group_.findMany({ where: filter });';
    expect(findWhereClauses(probe, 'probe.js')).toHaveLength(0);
  });

  it('Fail-open: ein Spread wird übersprungen, nicht gemeldet', () => {
    const probe = `
      const x = await prisma.group_.findMany({
        where: { ...baseFilter, key: 'A' },
      });`;
    expect(findWhereClauses(probe, 'probe.js')).toHaveLength(0);
  });

  it('backend/src: keine unbekannten where-Schlüssel', () => {
    const drifts = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const hit of findWhereClauses(src, file)) {
        const allowed = models.get(hit.accessor);
        if (!allowed) continue; // fail-open: unbekanntes Modell
        for (const key of hit.keys) {
          if (LOGIC_OPS.has(key) || allowed.has(key)) continue;
          drifts.push(
            `${hit.file.split(/[\\/]/).slice(-2).join('/')}:${hit.line} — ` +
              `${hit.accessor}.where.${key} existiert nicht im Modell`
          );
        }
      }
    }
    expect(drifts, `WHERE-DRIFT:\n  ${drifts.join('\n  ')}`).toEqual([]);
  });
});
