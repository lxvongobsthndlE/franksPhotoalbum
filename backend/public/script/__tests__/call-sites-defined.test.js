/**
 * Regression-Test (Issue 6 Folgefehler, 2026-08-13):
 *   Jeder AUFGERUFENE Bezeichner in main.js und tournament.js muss
 *   eine Definition ODER einen Import ODER einen Window-Export haben.
 *
 * Hintergrund:
 *   Der bestehende `exports-defined.test.js` prüft nur die Exporte
 *   aus `Object.assign(window, {…})` und aus den ES-Export-Statements.
 *   Das hat einen blinden Fleck: Funktionen, die NUR intern aufgerufen
 *   werden (nicht exportiert). Beispiel:
 *     - Vorher: renderTournamentInstanceDetailV3 rief
 *       `tournamentInstancePhase(status)` und
 *       `tournamentInstancePhaseLabel(phase)` auf.
 *     - Diese Namen waren NIE exportiert — sie waren reine Helper,
 *       die ich beim Refactor (Issue 6) gelöscht hatte, ohne den
 *       Aufruf im Renderer mitzunehmen.
 *     - Folge: ReferenceError beim ersten Aufruf des Renderers.
 *     - `exports-defined.test.js` hat das nicht gefunden, weil die
 *       Namen nicht exportiert waren.
 *
 *   Dieser Test fängt internal-call-Drift ab. Wir nutzen einen echten
 *   JS-Parser (acorn — seit 2026-08-25 explizit in backend/package.json
 *   unter devDependencies; vorher stand hier „ist bereits als dev-dep
 *   da", was nicht stimmte: acorn kam nur transitiv über vitest/rollup
 *   herein. Ein Vitest-Major hätte diese Datei mit „Cannot find module"
 *   gerissen statt nur den Test), damit wir exakt
 *   bestimmen können, welche Namen in welcher Scope-Ebene definiert
 *   sind — inklusive Funktionsparameter, Arrow-Funktion-Parameter,
 *   Destructuring-Assignments, Catch-Clauses, etc.
 *
 * Was er prüft:
 *   1. Parse main.js und tournament.js mit acorn (SourceType: module).
 *   2. Für jeden CallExpression: ist das Callee-Name (a) ein Import,
 *      (b) im window-Export, (c) ein bekannter Global, (d) im selben
 *      Modul-Scope oder einem Eltern-Scope definiert?
 *   3. Wenn keines zutrifft → Fehler mit Datei + Zeile + Spalte.
 *
 * Edge-Cases, die wir korrekt behandeln:
 *   - Funktionsparameter (`function f(a, b)`, `(a, b) => …`, `x => …`)
 *   - Destructuring (`const { a, b: c } = …`)
 *   - Catch-Clauses (`try { … } catch (e) { … }`)
 *   - Verschachtelte Scopes (jeder Function/Block hat sein eigenes Scope)
 *
 * Was wir NICHT prüfen:
 *   - Method-Calls (`obj.foo(...)`) — wir nehmen nur Bare-Identifier.
 *   - Dynamische Calls (`foo[bar](...)`, `foo?.(...)`) — wir nehmen
 *     nur statische `Identifier(`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

const MAIN_JS = path.join(FRONTEND_DIR, 'main.js');
const TOURNAMENT_JS = path.join(FRONTEND_DIR, 'tournament.js');

// ── Globals (JS built-ins + DOM + Projekt-Shortcuts) ──
// Bewusst klein gehalten — lieber einen false-positive manuell whitelistet
// als einen echten Fehler durchlässt.
const GLOBALS = new Set([
  // JS built-ins
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Float32Array',
  'Float64Array',
  'Function',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
  'parseFloat',
  'parseInt',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'eval',
  'globalThis',
  'undefined',
  // Timer
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  // DOM
  'document',
  'window',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'fetch',
  'alert',
  'confirm',
  'prompt',
  'console',
  'event',
  'self',
  'frames',
  'parent',
  'top',
  'opener',
  'screen',
  'crypto',
  'performance',
  'URL',
  'URLSearchParams',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'Blob',
  'File',
  'FileReader',
  'FileList',
  'AbortController',
  'AbortSignal',
  'CustomEvent',
  'Event',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'Image',
  'Audio',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'HTMLAnchorElement',
  'HTMLOptionElement',
  'HTMLLabelElement',
  'Element',
  'Node',
  'NodeList',
  'Text',
  'DocumentFragment',
  'DOMParser',
  'XMLHttpRequest',
  'getComputedStyle',
  'matchMedia',
  'scrollTo',
  'scrollBy',
  'print',
  'stopPropagation',
  'preventDefault',
  'EventSource',
  // Spezielle Shortcuts, die das Projekt selbst definiert
  'sb',
  // Konstanten, die ohnehin injected werden
  'ICON_TRASH',
  'ICON_EDIT',
  'ICON_PLUS',
  // Acorn-Tolerant: globale Literale
  'BigInt',
  'global',
]);

// ── Scope-Tracker ──
// Wir bauen einen einfachen Parent-Pointer-Baum: jeder Scope kennt
// seine Variablen und seinen Parent-Scope. Beim Lookup laufen wir hoch.
class Scope {
  constructor(parent = null, kind = 'module') {
    this.parent = parent;
    this.kind = kind;
    this.vars = new Map(); // name → node (für Diagnose)
  }
  define(name, node) {
    this.vars.set(name, node);
  }
  lookup(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return s.vars.get(name);
      s = s.parent;
    }
    return null;
  }
}

// ── AST-Walk: Variablen + Calls sammeln ──
function analyze(ast) {
  const moduleScope = new Scope(null, 'module');
  const calls = []; // { name, line, col, scope }
  const stats = { functionDefs: 0, arrowDefs: 0, varDefs: 0 };

  // Wir machen einen rekursiven Walk, der:
  //   - in jeden Scope die lokalen Variablen einsammelt (params,
  //     function/var/let/const, catch, imports)
  //   - jeden CallExpression mit Bare-Identifier-Callee aufzeichnet
  function visit(node, scope) {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'ImportDeclaration': {
        for (const spec of node.specifiers) {
          if (spec.local) moduleScope.define(spec.local.name, spec);
        }
        return;
      }
      case 'FunctionDeclaration': {
        stats.functionDefs++;
        const fnScope = new Scope(scope, 'function');
        if (node.id) moduleScope.define(node.id.name, node.id);
        collectParams(fnScope, node.params);
        if (node.body) visitBlock(node.body, fnScope);
        return;
      }
      case 'VariableDeclaration': {
        for (const decl of node.declarations) {
          stats.varDefs++;
          visitVariableDeclarator(decl, scope, /*moduleLevel=*/ scope === moduleScope);
        }
        return;
      }
      case 'ClassDeclaration': {
        if (node.id) moduleScope.define(node.id.name, node.id);
        return;
      }
      case 'CallExpression':
      case 'NewExpression': {
        if (node.callee?.type === 'Identifier') {
          calls.push({
            name: node.callee.name,
            line: node.callee.loc?.start?.line ?? -1,
            col: node.callee.loc?.start?.column ?? -1,
            scope,
          });
        }
        // Auch Argumente können Calls enthalten → weiter walken
        for (const arg of node.arguments || []) visit(arg, scope);
        // callee kann selbst ein Member-Expression sein (obj.foo()) — dann
        // ist obj der Identifier und wir sollten NICHT visit(callee),
        // weil das den Member-Expression als Ganzes trifft.
        if (node.callee?.type !== 'Identifier') visit(node.callee, scope);
        return;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        stats.arrowDefs++;
        const fnScope = new Scope(scope, 'function');
        collectParams(fnScope, node.params);
        if (node.body) visitBlock(node.body, fnScope);
        return;
      }
      case 'TryStatement': {
        if (node.block) visitBlock(node.block, scope);
        if (node.handler?.param) {
          const catchScope = new Scope(scope, 'catch');
          catchScope.define(node.handler.param.name, node.handler.param);
          visitBlock(node.handler.body, catchScope);
        }
        if (node.finalizer) visitBlock(node.finalizer, scope);
        return;
      }
      case 'ExpressionStatement':
        visit(node.expression, scope);
        return;
      case 'BlockStatement':
        visitBlock(node, scope);
        return;
      case 'IfStatement': {
        visit(node.test, scope);
        if (node.consequent) visit(node.consequent, scope);
        if (node.alternate) visit(node.alternate, scope);
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const s = new Scope(scope, 'block');
        if (node.init) visit(node.init, s);
        if (node.test) visit(node.test, s);
        if (node.update) visit(node.update, s);
        if (node.left && node.type !== 'ForOfStatement' && node.type !== 'ForInStatement')
          visit(node.left, s);
        if (node.right) visit(node.right, s);
        if (node.body) visit(node.body, s);
        return;
      }
      case 'WhileStatement':
      case 'DoWhileStatement': {
        visit(node.test, scope);
        if (node.body) visit(node.body, scope);
        return;
      }
      case 'SwitchStatement': {
        visit(node.discriminant, scope);
        for (const c of node.cases || []) {
          if (c.test) visit(c.test, scope);
          for (const s of c.consequent || []) visit(s, scope);
        }
        return;
      }
      case 'ReturnStatement':
      case 'ThrowStatement':
      case 'YieldExpression':
      case 'AwaitExpression':
        if (node.argument) visit(node.argument, scope);
        return;
      case 'ConditionalExpression':
        visit(node.test, scope);
        visit(node.consequent, scope);
        visit(node.alternate, scope);
        return;
      case 'LogicalExpression':
      case 'BinaryExpression':
      case 'AssignmentExpression':
      case 'MemberExpression':
      case 'SequenceExpression':
      case 'TemplateLiteral':
      case 'TaggedTemplateExpression':
      case 'SpreadElement':
      case 'UnaryExpression':
      case 'UpdateExpression':
        // generischer Walk über alle Felder — wir besuchen nur Felder,
        // die Expression-Nodes sind. Das verhindert Endlosrekursion
        // bei z. B. loc/range-Feldern.
        for (const key of Object.keys(node)) {
          if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
          const v = node[key];
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item && typeof item === 'object' && typeof item.type === 'string') {
                visit(item, scope);
              }
            }
          } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            visit(v, scope);
          }
        }
        return;
      default:
        // Für alles andere (Literale, Identifier ohne Call, etc.) — wir
        // brauchen nichts zu definieren. Trotzdem rekursiv durchgehen,
        // damit Calls in verschachtelten Expressions gefunden werden.
        for (const key of Object.keys(node)) {
          if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
          const v = node[key];
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item && typeof item === 'object' && typeof item.type === 'string') {
                visit(item, scope);
              }
            }
          } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            visit(v, scope);
          }
        }
    }
  }

  function visitBlock(block, scope) {
    for (const stmt of block.body || []) visit(stmt, scope);
  }

  function collectParams(fnScope, params) {
    for (const p of params || []) {
      addPatternParam(fnScope, p);
    }
  }

  function addPatternParam(scope, pattern) {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        scope.define(pattern.name, pattern);
        return;
      case 'RestElement':
        addPatternParam(scope, pattern.argument);
        return;
      case 'AssignmentPattern':
        addPatternParam(scope, pattern.left);
        return;
      case 'ArrayPattern':
        for (const el of pattern.elements || []) {
          if (el) addPatternParam(scope, el);
        }
        return;
      case 'ObjectPattern':
        for (const prop of pattern.properties || []) {
          if (prop.type === 'Property') addPatternParam(scope, prop.value);
          else if (prop.type === 'RestElement') addPatternParam(scope, prop.argument);
        }
        return;
    }
  }

  function visitVariableDeclarator(decl, scope, moduleLevel) {
    addPatternParam(scope, decl.id);
    if (decl.init) {
      // Wenn die rechte Seite ein Function/Arrow ist, MUSS der
      // Funktionskörper mit dem aktuellen Scope arbeiten, nicht mit
      // dem eigenen — die Funktion lebt ja im Eltern-Scope. Das
      // übernimmt der visit()-Switch für Function/Arrow korrekt, weil
      // er `scope` (nicht fnScope) als Parent nimmt.
      visit(decl.init, scope);
    }
  }

  visit(ast, moduleScope);
  return { calls, moduleScope, stats };
}

// ── main.js: window-Export-Namen ──
function windowAssignNames(src) {
  const start = src.indexOf('Object.assign(window, {');
  if (start < 0) return new Set();
  const end = src.indexOf('});', start);
  if (end < 0) return new Set();
  const block = src.substring(start, end);
  const names = new Set();
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('Object.assign')) continue;
    const m = line.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*,?(?:\s*\/\/.*)?$/);
    if (m) names.add(m[1]);
  }
  return names;
}

// ── Audit-Funktion pro File ──
function audit(filePath, label, opts) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const ast = acorn.parse(raw, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
  });
  const { calls, moduleScope, stats } = analyze(ast);
  const windowNames = opts.windowNames || new Set();

  const unresolved = [];
  for (const call of calls) {
    if (GLOBALS.has(call.name)) continue;
    if (windowNames.has(call.name)) continue;
    if (call.scope.lookup(call.name)) continue;
    unresolved.push(call);
  }

  return {
    unresolved,
    totalCalls: calls.length,
    stats,
  };
}

// =================================================================
describe('Call-Site-Audit: jeder aufgerufene Name ist definiert/importiert/exportiert', () => {
  describe('main.js', () => {
    const raw = fs.readFileSync(MAIN_JS, 'utf8');
    const { unresolved, totalCalls, stats } = audit(MAIN_JS, 'main.js', {
      windowNames: windowAssignNames(raw),
    });

    it('findet überhaupt Aufrufe (Sanity-Check)', () => {
      expect(totalCalls).toBeGreaterThan(50);
      expect(stats.functionDefs + stats.arrowDefs).toBeGreaterThan(20);
    });

    it('keine unaufgelösten Aufrufstellen', () => {
      if (unresolved.length) {
        const sample = unresolved
          .slice(0, 30)
          .map((u) => `  - ${u.name}  (Zeile ${u.line}, Spalte ${u.col})`)
          .join('\n');
        throw new Error(
          `main.js: ${unresolved.length} unaufgelöste(r) Aufruf-Namen:\n${sample}\n\n` +
            `Fix: Definition ergänzen, Import hinzufügen, Eintrag in ` +
            `Object.assign(window, {…}) aufnehmen, oder (wenn Browser-API) ` +
            `in GLOBALS-Whitelist eintragen.`
        );
      }
      expect(unresolved).toEqual([]);
    });
  });

  describe('tournament.js', () => {
    const { unresolved, totalCalls, stats } = audit(TOURNAMENT_JS, 'tournament.js', {});

    it('findet überhaupt Aufrufe (Sanity-Check)', () => {
      expect(totalCalls).toBeGreaterThan(20);
      expect(stats.functionDefs + stats.arrowDefs).toBeGreaterThan(10);
    });

    it('keine unaufgelösten Aufrufstellen', () => {
      if (unresolved.length) {
        const sample = unresolved
          .slice(0, 30)
          .map((u) => `  - ${u.name}  (Zeile ${u.line}, Spalte ${u.col})`)
          .join('\n');
        throw new Error(
          `tournament.js: ${unresolved.length} unaufgelöste(r) Aufruf-Namen:\n${sample}\n\n` +
            `Fix: Definition ergänzen, Import hinzufügen, oder (wenn ` +
            `Browser-API) in GLOBALS-Whitelist eintragen.`
        );
      }
      expect(unresolved).toEqual([]);
    });
  });
});
