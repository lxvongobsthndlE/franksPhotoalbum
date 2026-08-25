/**
 * Schema-Drift-Audit (Bug 2026-08-17).
 *
 * Hintergrund:
 *   POST /:id/matches/:matchId/result schrieb früher winnerTeamId,
 *   isDraw, completedAt in prisma.match.update — drei Felder, die im
 *   schema.prisma NICHT existieren. Prisma lehnt das mit
 *   "Unknown argument" ab. Der Bug war über Wochen in Prod, weil die
 *   Tests Prisma mockten (mockResolvedValue returnt nur einen Wert,
 *   wirft nicht bei unbekannten Argumenten).
 *
 *   Forderung des Users:
 *     "Ein Test, der für jede prisma.*.update/create-Stelle die
 *      verwendeten Feldnamen gegen das Schema prüft, wäre die saubere
 *      Lösung. Ähnlich wie der Call-Site-Audit, nur für Datenbankfelder."
 *
 * Was dieser Test macht:
 *   1. Parse schema.prisma → Map<ModelName, Set<FieldName>>.
 *   2. Scan alle .js-Dateien unter src/modules/tournament/ nach
 *      `prisma.<Model>.update({...})`, `prisma.<Model>.create({...})`,
 *      `prisma.<Model>.upsert({...})`, `prisma.<Model>.updateMany({...})`.
 *   3. Extrahiere alle Feldnamen aus den `data:` / `create:` / `update:`
 *      Objekten (statisch per Regex — kein JS-AST nötig).
 *   4. Vergleiche jeden Feldnamen mit der Model-Feldmenge aus
 *      schema.prisma. Jeder Treffer ohne Match → Fehler.
 *
 * Was dieser Test NICHT macht:
 *   - Type-Check (number vs string). Dafür bräuchte man echte DB.
 *   - Relations-Validierung (Multi-Argumente wie `connect`). Wir
 *     prüfen nur Top-Level-Feldnamen.
 *   - Validierung von where-Clauses (die akzeptieren Prisma-Operatoren,
 *     die wir nicht 1:1 auflösen können).
 *
 * Strategie für Feld-Extraktion:
 *   Wir matchen jede `data: { foo: ..., bar: ... }` und
 *   `create: { foo: ... }` / `update: { foo: ... }` per Regex. Wir
 *   ignorieren verschachtelte Objekte (z. B. `placeholder: { foo }`)
 *   NICHT — Top-Level-Keys reichen für Schema-Drift-Erkennung.
 *
 * Trade-off: Ein verschachteltes Feld wie `placeholderHome: { foo }`
 * sieht im Code wie `placeholderHome:` aus, was ein gültiges Top-Level-
 * Feld sein könnte (es IST eines — Json?). Wir würden also
 * `placeholderHome` korrekt gegen das Schema prüfen. Verschachtelung
 * DARUNTER (z. B. `{ foo: 1 }` in einem Json-Feld) wird ignoriert.
 * Das ist akzeptabel: Json-Inhalte sind kein Drift-Risiko, weil
 * Prisma sie nicht gegen Spalten-Namen validiert.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// schema.prisma: backend/prisma/schema.prisma
const schemaPath = resolve(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma');
// Audit-Target: gesamter backend/src/ Backend-Code (Routen, Module, Utils).
// User-Forderung 2026-08-17: "die anderen Routen schreiben auch" — daher
// NICHT nur das Tournament-Modul scannen.
const moduleDir = resolve(__dirname, '..', '..', '..');

// ── 1. Schema parsen ──────────────────────────────────────────────
function parseSchema(src) {
  // Entferne Kommentarzeilen, damit `// Kommentar` nichts crasht.
  const lines = src.split('\n').filter((l) => !l.trim().startsWith('//'));
  const cleaned = lines.join('\n');

  const models = new Map();
  const modelRe = /\bmodel\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = modelRe.exec(cleaned)) !== null) {
    const modelName = m[1];
    // Wir normalisieren auf Kleinbuchstaben für den Lookup, weil Prisma
    // im Code prisma.match.update(...) mit kleingeschriebenem Model-Namen
    // aufgerufen wird, das Schema aber `Match` (PascalCase) heißt.
    const key = modelName.toLowerCase();
    const body = m[2];
    const fields = new Set();
    const fieldRe = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?\s/m;
    // Split body by newlines und parse jeden Token.
    // Wir nehmen alles vor einem Doppelpunkt-Fremdzeichen oder einer
    // Annotation @ als Feldname.
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('@@')) continue;
      if (trimmed.startsWith('@')) continue;
      // Feldname ist das erste Wort.
      const fieldMatch = /^(\w+)\s/.exec(trimmed);
      if (!fieldMatch) continue;
      const fname = fieldMatch[1];
      // skip Type-Namen wie "String", "Int" etc. (sind keine Felder).
      if (/^(String|Int|Float|Boolean|DateTime|Json|Bytes|Decimal|BigInt)$/.test(fname)) continue;
      fields.add(fname);
    }
    models.set(key, fields);
  }
  return models;
}

// ── 2. Code scannen ───────────────────────────────────────────────
function listJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === '__tests__') continue; // Tests selbst nicht scannen.
      if (entry === 'node_modules') continue;
      out.push(...listJs(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// Findet alle prisma.<model>.<op>({...})-Aufrufe und sammelt die
// Feldnamen aus data/create/update-Objekten.
function findDrift(schemaModels, filePath) {
  const src = readFileSync(filePath, 'utf8');
  const findings = [];
  // Match: prisma.match.update( … ), prisma.X.create( … ), etc.
  // Wir greifen den nächsten {...}-Block nach dem Aufruf.
  // LÜCKE GESCHLOSSEN 2026-08-25: Der Regex kannte nur `prisma.` — jeder
  // Schreibzugriff INNERHALB einer Transaktion läuft aber über den
  // Transaktions-Client (`tx.match.update(…)`) und war damit unsichtbar.
  // Genau dort sass der fill-ko-Bug: `tx.match.update` schrieb homeSeed,
  // awaySeed, homeGroup und awayGroup — vier Engine-Felder aus buildBracket,
  // die es als Spalten nie gab. Der Audit lief die ganze Zeit grün.
  const callRe = /\b(?:prisma|tx|client|db)\.(\w+)\.(update|create|upsert|updateMany|createMany)\s*\(/g;
  let c;
  while ((c = callRe.exec(src)) !== null) {
    const modelName = c[1];
    const op = c[2];
    const validFields = schemaModels.get(modelName);
    if (!validFields) continue; // kein Model → skip (kein Drift-Erkennungs-Ziel)

    // Wir suchen ab dem Aufruf die nächsten geschweiften Klammern,
    // die das Argumente-Objekt umfassen, und sammeln Top-Level-Keys
    // aus `data:`, `create:`, `update:`.
    const argStart = c.index + c[0].length;
    const argEnd = findMatchingClose(src, argStart);
    if (argEnd < 0) continue;
    const argBody = src.slice(argStart, argEnd);

    // Schlüssel-Phrasen: data:, create:, update:
    const keyRe = /\b(data|create|update)\s*:\s*\{/g;
    let k;
    while ((k = keyRe.exec(argBody)) !== null) {
      const openBrace = argBody.indexOf('{', k.index + k[0].length - 1);
      const closeBrace = findMatchingClose(argBody, openBrace);
      if (closeBrace < 0) continue;
      const objBody = argBody.slice(openBrace + 1, closeBrace);

      // Top-Level-Keys: jeder Eintrag der Form `key: ...` auf der
      // obersten Verschachtelungsebene (Komma-getrennt).
      const topKeys = extractTopLevelKeys(objBody);
      for (const key of topKeys) {
        // Schema-Drift: Key nicht im Model.
        if (!validFields.has(key)) {
          findings.push({
            file: filePath,
            line: lineOf(src, c.index),
            model: modelName,
            op,
            clause: k[1],
            field: key,
          });
        }
      }
    }
  }
  return findings;
}

function findMatchingClose(src, openIdx) {
  // openIdx muss auf `{` zeigen.
  if (src[openIdx] !== '{') return -1;
  let depth = 0;
  let inSingle = false, inDouble = false, inTemplate = false, inLineComment = false, inBlockComment = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inSingle) { if (ch === '\\') { i++; continue; } if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '\\') { i++; continue; } if (ch === '"') inDouble = false; continue; }
    if (inTemplate) { if (ch === '\\') { i++; continue; } if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractTopLevelKeys(objBody) {
  // Wir lesen Top-Level-Identifier-Folgen, gefolgt von `:`.
  // Wir respektieren verschachtelte Klammern/Strings, um Keys innerhalb
  // von nested objects NICHT zu sammeln.
  const keys = [];
  let i = 0;
  let depth = 0;
  while (i < objBody.length) {
    const ch = objBody[i];
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      // String überspringen
      const quote = ch;
      i++;
      while (i < objBody.length) {
        if (objBody[i] === '\\') { i += 2; continue; }
        if (objBody[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // Identifier?
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < objBody.length && /[\w$]/.test(objBody[i])) i++;
      const word = objBody.slice(start, i);
      // Skip whitespace
      while (i < objBody.length && /\s/.test(objBody[i])) i++;
      // Wenn direkt ein `:` folgt UND depth===0 → Top-Level-Key.
      if (depth === 0 && objBody[i] === ':' && word) {
        keys.push(word);
        i++; // über `:`
      }
      continue;
    }
    i++;
  }
  return keys;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

// ── 3. Audit laufen lassen ────────────────────────────────────────
const schemaSrc = readFileSync(schemaPath, 'utf8');
const models = parseSchema(schemaSrc);

describe('Schema-Drift-Audit: alle prisma.update/create/upsert-Felder existieren im Schema', () => {
  const files = listJs(moduleDir);
  // Selbst-Check: gibt es überhaupt zu scannende Dateien?
  it('Setup: Schema parsen + Tournament-Module scanbar', () => {
    expect(models.size).toBeGreaterThan(0);
    // Match-Modell muss erkannt sein (lowercase Lookup).
    expect(models.has('match')).toBe(true);
    // Mindestens die Standard-Felder müssen erkannt sein.
    expect(models.get('match').has('id')).toBe(true);
    expect(models.get('match').has('teamHome')).toBe(true);
    expect(models.get('match').has('scoreHome')).toBe(true);
    // KEINE Schema-Geister im Match-Modell.
    expect(models.get('match').has('winnerTeamId')).toBe(false);
    expect(models.get('match').has('isDraw')).toBe(false);
    expect(models.get('match').has('completedAt')).toBe(false);
  });

  // Positiv-Test: Wenn jemand `winnerTeamId` zurück in ein prisma.update
  // schreibt, MUSS er hier auffliegen. Wir füttern findDrift mit einem
  // Snippet, das genau den Bug von letzter Woche enthält, und prüfen,
  // dass das Audit einen Drift-Finding liefert.
  it('Audit-Smoke-Test: Schema-Geister werden erkannt', () => {
    const fakeSrc = [
      'const updated = await prisma.match.update({',
      '  where: { id: match.id },',
      '  data: {',
      '    scoreHome: 2,',
      '    scoreAway: 1,',
      "    winnerTeamId: 'team-x', // Schema-Geist",
      '    isDraw: false, // Schema-Geist',
      '    completedAt: new Date(), // Schema-Geist',
      "    status: 'finished',",
      '  },',
      '});',
    ].join('\n');
    const findings = findDriftInString(models, fakeSrc, '/fake/routes.js');
    const fields = findings.map((f) => f.field);
    expect(fields).toContain('winnerTeamId');
    expect(fields).toContain('isDraw');
    expect(fields).toContain('completedAt');
    // Auch: scoreHome/status sind Schema-konform und dürfen NICHT
    // im findings auftauchen.
    expect(fields).not.toContain('scoreHome');
    expect(fields).not.toContain('status');
  });

  // Negativ-Test: Ein gültiges Update (nur Schema-konforme Felder)
  // produziert KEINEN Drift.
  it('Audit-Smoke-Test: Schema-konformes Update → kein Drift', () => {
    const fakeSrc = `
        await prisma.match.update({
          where: { id: match.id },
          data: {
            scoreHome: 2, scoreAway: 1, status: 'finished',
          },
        });
      `;
    const findings = findDriftInString(models, fakeSrc, '/fake/routes.js');
    expect(findings).toEqual([]);
  });

  // ── Pro Datei ein Test ────────────────────────────────────────
  for (const file of files) {
    const findings = findDrift(models, file);
    const rel = file.replace(moduleDir + '\\', '').replace(moduleDir + '/', '');
    if (findings.length === 0) {
      it(`${rel}: keine Schema-Drifts`, () => {
        // Wenn dieser Test fehlschlägt, hat jemand den File-Scan erweitert
        // und Drifts gefunden. Die Fehlermeldung listet die Findings.
        expect(findings).toEqual([]);
      });
    } else {
      it(`${rel}: keine Schema-Drifts`, () => {
        const msg = findings
          .map((f) => `  ${f.model}.${f.op} (${f.clause}) → "${f.field}" nicht in schema.prisma model ${f.model} (Zeile ${f.line})`)
          .join('\n');
        throw new Error(`Schema-Drift in ${rel}:\n${msg}`);
      });
    }
  }
});

// Variante von findDrift, die einen String statt einer Datei nimmt —
// für die Positiv-Tests mit gefakten Snippets.
function findDriftInString(schemaModels, src, fakePath) {
  const findings = [];
  // LÜCKE GESCHLOSSEN 2026-08-25: Der Regex kannte nur `prisma.` — jeder
  // Schreibzugriff INNERHALB einer Transaktion läuft aber über den
  // Transaktions-Client (`tx.match.update(…)`) und war damit unsichtbar.
  // Genau dort sass der fill-ko-Bug: `tx.match.update` schrieb homeSeed,
  // awaySeed, homeGroup und awayGroup — vier Engine-Felder aus buildBracket,
  // die es als Spalten nie gab. Der Audit lief die ganze Zeit grün.
  const callRe = /\b(?:prisma|tx|client|db)\.(\w+)\.(update|create|upsert|updateMany|createMany)\s*\(/g;
  let c;
  while ((c = callRe.exec(src)) !== null) {
    const modelName = c[1];
    const op = c[2];
    const validFields = schemaModels.get(modelName);
    if (!validFields) continue;
    const argStart = c.index + c[0].length;
    const argEnd = findMatchingClose(src, argStart);
    if (argEnd < 0) continue;
    const argBody = src.slice(argStart, argEnd);
    const keyRe = /\b(data|create|update)\s*:\s*\{/g;
    let k;
    while ((k = keyRe.exec(argBody)) !== null) {
      const openBrace = argBody.indexOf('{', k.index + k[0].length - 1);
      const closeBrace = findMatchingClose(argBody, openBrace);
      if (closeBrace < 0) continue;
      const objBody = argBody.slice(openBrace + 1, closeBrace);
      const topKeys = extractTopLevelKeys(objBody);
      for (const key of topKeys) {
        if (!validFields.has(key)) {
          findings.push({
            file: fakePath,
            line: lineOf(src, c.index),
            model: modelName,
            op,
            clause: k[1],
            field: key,
          });
        }
      }
    }
  }
  return findings;
}