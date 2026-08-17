/**
 * Regression-Test (Loading-Stuck-Bug, 2026-08-17):
 *
 *   Für jeden `import { X } from './Y.js'` in main.js und tournament.js
 *   muss `X` ein echtes ES-Export in Y.js sein. Ebenso umgekehrt für
 *   tournament.js → tournament-team-helpers.js / auth-oidc.js /
 *   normalize-confirm-name.js.
 *
 * Hintergrund:
 *   Dies ist der DRITTE Bug dieser Klasse nach:
 *     1. Fehlendes </script>-Tag (verhindert Modul-Parse → leere Seite)
 *     2. 8× undefined-funktionen in main.js (`exports-defined` und
 *        `call-sites-defined` haben das gefangen — der AST-basierte
 *        call-sites-Audit findet Aufrufstellen, die WEDER importiert
 *        NOCH im selben Modul definiert sind).
 *     3. **Dieser Bug**: `openConfirmDialog` wurde in tournament.js
 *        ohne `export` deklariert, main.js hat es aber importiert.
 *
 *        Symptom im Browser: ES-Modul-Failure beim Parsen → main.js
 *        wird stumm nicht ausgeführt → `window.addEventListener('load')`
 *        läuft nie → der `#loading`-Overlay bleibt sichtbar.
 *
 *        Warum die existierenden Tests das NICHT gefangen haben:
 *          - `exports-defined.test.js` prüft NUR Exports gegen
 *            `Object.assign(window, {…})` und gegen die Compile-Zeit-
 *            ES-Export-Statements. Er kennt keine Cross-File-Beziehung.
 *          - `call-sites-defined.test.js` prüft, ob jeder Aufruf im
 *            selben Modul aufgelöst werden kann. **Importierte Namen
 *            werden als „aufgelöst" gewertet** — auch wenn der Import
 *            selbst auf nichts zeigt. Genau diese Lücke hat der Bug
 *            ausgenutzt.
 *
 * Was dieser Test prüft:
 *   1. Parse jede import-statement in main.js und tournament.js mit
 *      acorn (SourceType: module).
 *   2. Parse jede ./Y.js Zieldatei und extrahiere alle Export-Namen
 *      (named exports + default).
 *   3. Für jeden imported Name: ist er in den Exports der Zieldatei?
 *   4. Wenn nicht → Fehler mit Datei + Zeile + Spalte + Import/Export.
 *
 * Was wir NICHT prüfen:
 *   - Dynamische Imports (`await import(...)`) — wir nehmen nur
 *     statische `ImportDeclaration`-Knoten.
 *   - Re-Exports (`export { x } from './Y.js'`) in der Zieldatei —
 *     diese können transitiv brechen, aber das war nicht der Bug.
 *   - Import-Specifiers, die NUR für Side-Effects geladen werden
 *     (`import './Y.js'`) — wir nehmen nur Specifier mit `imported`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

// ── Quelldateien, deren Imports wir prüfen ──
const CONSUMERS = ['main.js', 'tournament.js'];

// ── AST → Imports ──
// Liefert eine Liste { source, imported, local, line, col } pro
// ImportSpecifier-Knoten. Default-Imports und Bare-Imports werden
// übersprungen (Bare = keine Specifier).
function parseImports(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });
  const out = [];
  for (const node of ast.body || []) {
    if (node.type !== 'ImportDeclaration') continue;
    if (!node.source || typeof node.source.value !== 'string') continue;
    const source = node.source.value;
    for (const spec of node.specifiers || []) {
      // ImportSpecifier: { imported: { name }, local: { name } }
      // ImportDefaultSpecifier: { local: { name } }
      // ImportNamespaceSpecifier: { local: { name } }
      if (spec.type === 'ImportSpecifier') {
        out.push({
          source,
          imported: spec.imported?.name ?? null,
          local: spec.local?.name ?? null,
          line: spec.loc?.start?.line ?? -1,
          col: spec.loc?.start?.column ?? -1,
        });
      }
    }
  }
  return out;
}

// ── AST → Exports einer Zieldatei ──
// Liefert ein Set<string> mit allen named-export-Namen + der magische
// Eintrag 'default', falls ein Default-Export existiert.
function parseExports(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });
  const names = new Set();

  for (const node of ast.body || []) {
    switch (node.type) {
      case 'ExportNamedDeclaration': {
        // Fall 1: `export { a, b as c }` — node.declaration ist null,
        //         node.specifiers listet die zu exportierenden Namen.
        if (node.declaration === null && node.specifiers) {
          for (const s of node.specifiers) {
            // `export { foo as bar }` → exportierter Name ist `bar`.
            // Wir nutzen den EXPORTIERTEN Namen (s.exported.name),
            // nicht den lokalen (s.local.name).
            const exported = s.exported?.name ?? null;
            if (exported) names.add(exported);
          }
        }
        // Fall 2: `export function foo() {}` / `export const foo = …` /
        //         `export class Foo {}` — node.declaration ist die
        //         Function/Variable/Class-Definition, mit eigenem
        //         `id.name`.
        if (node.declaration) {
          collectExportNameFromDecl(node.declaration, names);
        }
        // Fall 3: `export { a, b } from './Y.js'` — wir ignorieren
        //         Re-Exports bewusst (siehe Test-Doc).
        if (node.source) {
          // absichtlich leer
        }
        break;
      }
      case 'ExportDefaultDeclaration': {
        names.add('default');
        break;
      }
      default:
        break;
    }
  }
  return names;
}

function collectExportNameFromDecl(decl, names) {
  if (!decl) return;
  switch (decl.type) {
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      if (decl.id?.name) names.add(decl.id.name);
      return;
    case 'VariableDeclaration':
      for (const d of decl.declarations || []) {
        if (d.id?.type === 'Identifier') names.add(d.id.name);
      }
      return;
  }
}

// ── Audit-Hauptfunktion ──
// Pro Consumer-Datei: sammle alle Imports, lade Zieldatei, prüfe.
function auditConsumer(fileName) {
  const filePath = path.join(FRONTEND_DIR, fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  const imports = parseImports(raw);
  const failures = [];

  for (const imp of imports) {
    // Wir prüfen NUR relative Imports ('./X.js'/'../X.js'). Absolute
    // Modulnamen (npm-Pakete) gehen am Browser-Modul-Loader nicht
    // über diese Stelle.
    if (!imp.imported) continue;
    if (!imp.source.startsWith('./') && !imp.source.startsWith('../')) continue;

    const targetPath = resolveTarget(filePath, imp.source);
    if (!targetPath || !fs.existsSync(targetPath)) {
      failures.push({
        ...imp,
        reason: `Zieldatei nicht gefunden: ${imp.source}`,
      });
      continue;
    }

    const targetSrc = fs.readFileSync(targetPath, 'utf8');
    const targetExports = parseExports(targetSrc);

    if (!targetExports.has(imp.imported)) {
      failures.push({
        ...imp,
        target: path.relative(FRONTEND_DIR, targetPath),
        reason:
          `„${imp.imported}" wird in ${fileName}:${imp.line}:${imp.col} ` +
          `importiert, ist aber KEIN Export in ${path.basename(targetPath)}. ` +
          `Vorhandene Exports: ${[...targetExports].sort().join(', ') || '(keine)'}`,
      });
    }
  }

  return failures;
}

// Relativer Pfad-Auflöser. Akzeptiert './X.js' und '../X.js'.
function resolveTarget(fromPath, relSource) {
  const dir = path.dirname(fromPath);
  const resolved = path.resolve(dir, relSource);
  // Wenn ohne Erweiterung — ggf. .js anhängen. acorn hat den
  // Original-String genommen, aber wir wollen den realen Dateinamen.
  if (fs.existsSync(resolved)) return resolved;
  if (fs.existsSync(resolved + '.js')) return resolved + '.js';
  return null;
}

// =================================================================
describe('Cross-File Import-Audit', () => {
  it.each(CONSUMERS)(
    '%s: jeder importierte Name ist ein Export der Zieldatei',
    (fileName) => {
      const failures = auditConsumer(fileName);
      if (failures.length) {
        const sample = failures
          .slice(0, 30)
          .map((f) => `  - ${f.reason}`)
          .join('\n');
        throw new Error(
          `${fileName}: ${failures.length} Import/Export-Mismatch(s):\n${sample}\n\n` +
            `Fix: in der Zieldatei „export" vor die Deklaration setzen ` +
            `(z. B. „export function openConfirmDialog(…) {…}") ` +
            `oder im Consumer stattdessen „window.X = X" nutzen.`,
        );
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(CONSUMERS)(
    '%s: hat überhaupt Imports (Sanity-Check, schützt vor leeren Tests)',
    (fileName) => {
      const filePath = path.join(FRONTEND_DIR, fileName);
      const raw = fs.readFileSync(filePath, 'utf8');
      const imports = parseImports(raw).filter(
        (i) =>
          i.imported &&
          (i.source.startsWith('./') || i.source.startsWith('../')),
      );
      expect(imports.length).toBeGreaterThan(0);
    },
  );
});
