/**
 * Betriebsfestigkeit A1 (2026-08-25): Erfolg darf nicht als Fehler
 * gemeldet werden.
 *
 * Fehlerklasse
 * ------------
 *   `openTournamentInstance()` wirft absichtlich weiter (main.js, siehe
 *   Kommentar „Issue 6" — der Wizard-Teardown haengt an diesem Throw).
 *   Jeder Mutations-Handler rief sie INNERHALB seines eigenen `try`.
 *   Hakte nur das Nachladen — Netz weg, 500 auf GET /tournaments/:id —,
 *   sprang der Mutations-`catch` an. Der Nutzer sah nacheinander:
 *
 *       „Ergebnis gespeichert (3:2)"
 *       „Ergebnis konnte nicht gespeichert werden"
 *
 *   und trug es erneut ein. Beim Ergebnis-Speichern ist das teuer: der
 *   zweite Save mit anderem Score ueberschreibt den ersten kommentarlos
 *   (die Route hat keinen „schon eingetragen"-Check).
 *
 * Zwei Ebenen
 * -----------
 *   1. VERHALTEN: `refreshTournamentAfterMutation` wird aus dem echten
 *      Quelltext geschnitten und ausgefuehrt. Sie darf nie werfen und
 *      muss im Fehlerfall eine Ansichts-Meldung zeigen, keine
 *      Fehlschlag-Meldung.
 *   2. STRUKTUR: acorn-Scan ueber main.js — kein `openTournamentInstance`
 *      darf mehr in einem `try` stehen, das selbst eine Mutation
 *      absetzt (`apiCall` / `fetchWithAuth` / `uploadFile`).
 *
 * Der Struktur-Test ist die Ratsche: er faengt den naechsten Handler ab,
 * der die Regel wieder bricht. Regex reicht dafuer nicht — „liegt der
 * Aufruf in einem try, und setzt dieses try eine Mutation ab?" ist eine
 * Frage an den Syntaxbaum.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN = path.resolve(__dirname, '..', 'main.js');
const src = fs.readFileSync(MAIN, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });

// ── Mini-Walker ──────────────────────────────────────────────────────
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, next);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit, next);
    }
  }
}

function calleeName(node) {
  if (node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
}

// ── Ebene 1: Verhalten ───────────────────────────────────────────────
function ladeHelfer() {
  let fnNode = null;
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id?.name === 'refreshTournamentAfterMutation') fnNode = n;
  });
  if (!fnNode) throw new Error('refreshTournamentAfterMutation existiert nicht in main.js');
  const code = src.slice(fnNode.start, fnNode.end);
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'openTournamentInstance',
    'toast',
    'console',
    `${code}\nreturn refreshTournamentAfterMutation;`,
  );
  return { code, factory };
}

describe('refreshTournamentAfterMutation: Nachladen meldet nie einen Mutations-Fehlschlag', () => {
  const { code, factory } = ladeHelfer();

  it('gibt true zurueck, wenn das Nachladen klappt — und toastet nicht', async () => {
    const toasts = [];
    const fn = factory(async () => {}, (m, k) => toasts.push([m, k]), { warn() {} });
    await expect(fn('t1')).resolves.toBe(true);
    expect(toasts).toEqual([]);
  });

  it('wirft NICHT, wenn das Nachladen scheitert', async () => {
    const fn = factory(
      async () => { throw new Error('HTTP 500'); },
      () => {},
      { warn() {} },
    );
    await expect(fn('t1')).resolves.toBe(false);
  });

  it('meldet im Fehlerfall ein ANSICHTS-Problem, kein Speicher-Problem', async () => {
    const toasts = [];
    const fn = factory(
      async () => { throw new Error('HTTP 500'); },
      (m, k) => toasts.push([m, k]),
      { warn() {} },
    );
    await fn('t1');
    expect(toasts).toHaveLength(1);
    const [text, kind] = toasts[0];
    // Kein Fehler-Ton: der Nutzer soll nicht denken, das Speichern sei schiefgegangen.
    expect(kind).not.toBe('error');
    expect(text).toMatch(/[Gg]espeichert/);
    expect(text).toMatch(/Ansicht/);
    // Und ausdruecklich NICHT die alte Fehlschlag-Sprache.
    expect(text).not.toMatch(/fehlgeschlagen|konnte nicht gespeichert/i);
  });

  it('reicht die Turnier-ID unveraendert an openTournamentInstance durch', async () => {
    const gesehen = [];
    const fn = factory(async (id) => { gesehen.push(id); }, () => {}, { warn() {} });
    await fn('tid-42');
    expect(gesehen).toEqual(['tid-42']);
  });

  it('kapselt das Werfen selbst — der Quelltext hat try/catch um den Aufruf', () => {
    expect(code).toMatch(/try\s*\{[\s\S]*openTournamentInstance\(tournamentId\)[\s\S]*\}\s*catch/);
    // Kein Re-Throw im catch: sonst waere die Kapselung wertlos.
    const catchTeil = code.slice(code.indexOf('} catch'));
    expect(catchTeil).not.toMatch(/\bthrow\b/);
  });
});

// ── Ebene 2: Struktur ────────────────────────────────────────────────
const MUTATIONS_AUFRUFE = new Set(['apiCall', 'fetchWithAuth', 'uploadFile', 'uploadTournamentMatchPhoto']);

/**
 * Die Regel, ohne Ausnahmeliste:
 *
 *   Massgeblich ist das INNERSTE umschliessende `try` (bis zur
 *   naechsten Funktionsgrenze — ein `try` der Elternfunktion sieht
 *   einen Callback-Body nicht).
 *
 *     - gar kein `try`            → in Ordnung (reine Navigation)
 *     - innerstes `try` OHNE
 *       Mutationsaufruf           → in Ordnung: das ist ein eigenes
 *                                   Netz nur fuer das Nachladen
 *     - innerstes `try` MIT
 *       Mutationsaufruf           → VERSTOSS: dessen catch meldet dann
 *                                   den Mutations-Fehlschlag
 *
 * Deshalb braucht dieser Test keine gepflegte Allowlist, die
 * verrottet — die Struktur des Codes beantwortet die Frage selbst.
 */
function verstoesseIn(baum, datei) {
  const verstoesse = [];
  walk(baum, (node, parents) => {
    if (calleeName(node) !== 'openTournamentInstance') return;

    // Umgebende Funktion bestimmen (nur fuer die Fehlermeldung).
    let huelle = null;
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i];
      if (p.type === 'FunctionDeclaration' && p.id?.name) { huelle = p.id.name; break; }
      if ((p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression')) {
        const gp = parents[i - 1];
        if (gp?.type === 'VariableDeclarator' && gp.id?.type === 'Identifier') { huelle = gp.id.name; break; }
      }
    }

    // Innerstes umschliessendes try suchen.
    let innerstes = null;
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i];
      if (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression') break;
      // Nur der try-Block zaehlt, nicht der catch/finally.
      if (p.type === 'TryStatement' && parents[i + 1] === p.block) { innerstes = p; break; }
    }
    if (!innerstes) return;

    let setztMutationAb = false;
    walk(innerstes.block, (m) => {
      const name = calleeName(m);
      if (name && MUTATIONS_AUFRUFE.has(name)) setztMutationAb = true;
    });
    if (setztMutationAb) {
      verstoesse.push(`${datei}:${node.loc.start.line}` + (huelle ? ` (in ${huelle})` : ''));
    }
  });
  return verstoesse;
}

describe('Struktur: kein openTournamentInstance im try einer Mutation', () => {
  it('jede Aufrufstelle ist entweder gekapselt oder liegt ausserhalb des Mutations-try', () => {
    const verstoesse = verstoesseIn(ast, 'main.js');

    if (verstoesse.length) {
      throw new Error(
        'ERFOLG WIRD ALS FEHLER GEMELDET: ' + verstoesse.length + ' Aufruf(e) von ' +
          'openTournamentInstance stehen im try einer Mutation:\n' +
          verstoesse.map((v) => '  - ' + v).join('\n') +
          '\n\nHakt dort nur das Nachladen, laeuft der Mutations-catch an und der ' +
          'Nutzer bekommt „konnte nicht gespeichert werden" auf eine geglueckte ' +
          'Mutation.\nFix: refreshTournamentAfterMutation() benutzen und den Aufruf ' +
          'HINTER das try/catch der Mutation ziehen.',
      );
    }
    expect(verstoesse).toEqual([]);
  });

  // Ein Detektor, der nur gruen sein kann, beweist nichts. Die beiden
  // folgenden Proben zeigen, dass die Regel in BEIDE Richtungen greift.
  const parse = (code) => acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module', locations: true });

  it('Mutationsprobe: der alte Bauplan wird erkannt', () => {
    const boese = parse(`
      async function speichern(id) {
        try {
          await apiCall('/x', 'POST');
          toast('gespeichert', 'success');
          await openTournamentInstance(id);
        } catch (e) {
          toast('konnte nicht gespeichert werden', 'error');
        }
      }
    `);
    expect(verstoesseIn(boese, 'probe.js')).toHaveLength(1);
  });

  it('Mutationsprobe: der neue Bauplan laeuft durch', () => {
    const gut = parse(`
      async function speichern(id) {
        let saved = false;
        try {
          await apiCall('/x', 'POST');
          toast('gespeichert', 'success');
          saved = true;
        } catch (e) {
          toast('konnte nicht gespeichert werden', 'error');
        }
        if (saved) await refreshTournamentAfterMutation(id);
      }
      async function refreshTournamentAfterMutation(id) {
        try { await openTournamentInstance(id); } catch (e) { toast('Ansicht', 'info'); }
      }
    `);
    expect(verstoesseIn(gut, 'probe.js')).toEqual([]);
  });

  it('die Mutations-Handler benutzen den Helfer wirklich (Positivprobe)', () => {
    let n = 0;
    walk(ast, (node) => {
      if (calleeName(node) === 'refreshTournamentAfterMutation') n += 1;
    });
    // Gemessen am 2026-08-25: 23 Aufrufstellen. Untergrenze statt
    // Gleichheit, damit neue Handler den Test nicht rot machen — eine
    // SINKENDE Zahl waere dagegen ein Rueckbau und faellt hier auf.
    expect(n).toBeGreaterThanOrEqual(23);
  });
});
