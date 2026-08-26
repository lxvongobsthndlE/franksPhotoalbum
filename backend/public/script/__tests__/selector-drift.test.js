/**
 * Drift-Detektor: Selektor gegen gerendertes Markup (2026-08-25).
 *
 * Fehlerklasse, die dieser Test abfängt
 * -------------------------------------
 *   Ein Handler sucht ein Element über ein data-Attribut, das kein
 *   Renderer je ausgibt. Der Knopf ist dann tot: `querySelector` liefert
 *   `null`, das `if (!el) return;` davor schluckt es, und niemand merkt
 *   etwas — weder im Browser (keine Exception) noch in der Testsuite.
 *
 *   Belegter Fall (Commit c922144, main.js:3305):
 *     section.querySelector('[data-tab-body="spielplan-mount"]')
 *   Der String `spielplan-mount` kam im GANZEN Repo genau einmal vor:
 *   in der suchenden Zeile. Gerendert wurde `#t-schedule-list`. Vier
 *   Knöpfe im Turniermodul waren so tot; die Suite war dabei grün.
 *
 * Die drei Regeln
 * ---------------
 *   R1  Jeder Wert in einem Selektor `[data-tab-body="X"]`, der in
 *       querySelector/querySelectorAll/closest/matches benutzt wird,
 *       muss in irgendeiner Datei unter public/script als Markup
 *       ausgegeben werden.
 *   R2  Dasselbe für `[data-role="X"]`.
 *   R3  Dasselbe für `[data-action="X"]` — und zusätzlich die
 *       Gegenrichtung: ein `data-action="X"`, das in Markup gerendert
 *       wird, braucht einen Handler-Zweig (Selektor ODER ein
 *       `dataset.action === 'X'` / `case 'X':`).
 *
 * Machart
 * -------
 *   Wie `call-sites-defined.test.js`: echter Parser (acorn), kein Regex
 *   über den Rohtext. Der Parser ist hier nicht Kür, sondern notwendig:
 *   sonst ist nicht unterscheidbar, ob ein `data-action="x"` in einem
 *   SELEKTOR steht (`[data-action="x"]` — der Suchende) oder in MARKUP
 *   (`<button data-action="x">` — der Ausgebende). Ein Regex über die
 *   Datei ließe jeden Selektor sich selbst bestätigen; der Detektor
 *   wäre dann garantiert grün und damit wertlos.
 *
 * FAIL-OPEN ist Pflicht
 * ---------------------
 *   Ein Detektor, der einmal grundlos rot wird, wird stillgelegt und ist
 *   ab dann wertlos. Deshalb: was nicht sicher beurteilbar ist, läuft
 *   durch. Nicht beurteilbar heißt hier konkret:
 *     - Selektor-Argument ist keine statische Zeichenkette (Variable,
 *       Konkatenation, Template-Literal mit ${…}) → Aufrufstelle wird
 *       übersprungen.
 *     - Selektor benutzt einen Teilstring-Operator (`^=`, `*=`, `~=`)
 *       → der gesuchte Wert steht dort nicht vollständig.
 *     - Markup baut den Attributwert dynamisch (`data-action="${x}"`)
 *       → die Regel für dieses Attribut wird abgeschaltet.
 *     - Ein Attribut wird per DOM-Property gesetzt (`el.dataset.action =
 *       'x'`) → zählt für die Hinrichtung, nicht für die Gegenrichtung.
 *   Diese Abschaltungen sind sichtbar: der letzte Test unten führt Buch
 *   über die übersprungenen Stellen und schlägt an, wenn eine ganze
 *   Regel stillgelegt wurde.
 *
 *   NICHT fail-open ist ein generischer Container-Dispatch
 *   (`closest('[data-action]')`, main.js:3133). Er muss anschließend
 *   trotzdem auf den Wert verzweigen, und diese Vergleiche zählen als
 *   Handler-Beleg. Würde eine einzige solche Stelle die Gegenrichtung
 *   abschalten, wäre sie wertlos — der tote „Abbrechen"-Knopf aus
 *   c922144 wäre dann erneut durchgerutscht.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

// Die drei Attribute, die dieser Detektor beurteilt. Bewusst kein
// generisches `data-*`: `data-team-id`, `data-match-id` & Co. tragen
// IDs, keine Namen — dort ist der Wert immer dynamisch und ein Abgleich
// gegen Markup wäre sinnlos.
const ATTRS = ['tab-body', 'role', 'action'];

// DOM-Methoden, deren erstes Argument ein CSS-Selektor ist.
const SELECTOR_METHODS = new Set([
  'querySelector',
  'querySelectorAll',
  'closest',
  'matches',
]);

// ── Allowlist: NICHT BEURTEILBAR ─────────────────────────────────────
// Nur für Fälle, die der Detektor prinzipiell nicht entscheiden kann.
// Format: `'<attr>:<wert>'` → ein Satz, der sagt, WARUM genau dieser
// Wert nicht beurteilbar ist. Kein „historisch", kein „TODO". Ein
// bekannter Bug gehört NICHT hierher, sondern in die Baseline darunter.
// Leer ist die beste Nachricht.
const ALLOW_SELECTOR_WITHOUT_MARKUP = new Map([
  // (leer — Stand 2026-08-25)
]);
const ALLOW_MARKUP_WITHOUT_HANDLER = new Map([
  // (leer — Stand 2026-08-25)
]);

// ── Baseline: BEKANNT TOT, Entscheid steht aus ───────────────────────
// Das hier ist kein Freibrief, sondern eine Ratsche. Diese Selektoren
// hat der Detektor bei seinem allerersten Lauf gefunden — sie sind
// dieselbe Fehlerklasse wie c922144, waren aber nicht Teil des
// Auftrags, der ihn gebaut hat. Sie stehen hier, damit
//   (a) die Suite grün ist und der Detektor NEUE Drift sofort meldet,
//   (b) der Bestand benannt und datiert ist statt still zu verschwinden.
// Der Test „Baseline ist noch aktuell" weiter unten wird ROT, sobald ein
// Eintrag repariert (oder der Selektor gelöscht) wurde — die Liste kann
// also nicht verrotten. Wer einen Punkt behebt, streicht seine Zeile.
// Am 2026-08-25 abgearbeitet und deshalb leer. Die drei Alteinträge
// waren alle Leichen, nicht fehlende Knöpfe — je einer mit einem
// belegten Ersatzweg, der die Funktion weiterhin erreichbar hält:
//
//   action:reschedule           → gelöscht. Neu terminieren läuft über
//                                 [data-action="reschedule-auto"]
//                                 (spielplan-helpers.js) und zusätzlich
//                                 über saveScheduleEdits, sobald sich
//                                 die Spieldauer ändert.
//   action:save-groups          → gelöscht. Gruppen ändert man seit
//                                 B.8.1 per Paar-Tausch
//                                 ([data-action="confirm-swap"] →
//                                 POST /:id/groups/swaps) oder per
//                                 „Zufällig verteilen". Die Funktion
//                                 saveGroupsAssignment bleibt (steht im
//                                 Export-Block).
//   action:pick-team-for-group  → Verdrahtung gelöscht. Der aktive Weg
//                                 ist select-for-swap. Das Modal selbst
//                                 bleibt stehen (ohne Aufrufer, siehe
//                                 Kommentar an openPickTeamForGroupModal):
//                                 sein Erfolgstoast verweist auf einen
//                                 „Speichern"-Knopf, den es seit B.8.1
//                                 nicht mehr gibt — ob der Touch-Picker
//                                 zurückkommt oder ganz weicht, ist ein
//                                 Bedien-Entscheid, kein Aufräumen.
//
// Die Liste bleibt bewusst stehen: sie ist die Ablage für den nächsten
// Fund, der ein Produktentscheid ist und nicht sofort entschieden wird.
const BASELINE_TOTE_SELEKTOREN = new Map([]);

// ── Dateien einsammeln ───────────────────────────────────────────────
// Nur die Frontend-Skripte selbst; `__tests__/` ist ein Unterverzeichnis
// und fällt schon durch das nicht-rekursive Listing heraus.
//
// Bewusst NICHT mitgescannt: `backend/public/*.html`. Gemessen am
// 2026-08-25: `index.html` enthält null Vorkommen der drei Attribute
// (die App baut ihr Turnier-Markup vollständig in JS), und die
// `preview-*.html` / `screen-*.html` sind Design-Mockups. Würden sie als
// „gerendert" zählen, bestätigten Mockup-Attribute Selektoren, die in
// der echten App ins Leere greifen — genau der Fehler, den dieser Test
// finden soll.
function sourceFiles() {
  return fs
    .readdirSync(FRONTEND_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => path.join(FRONTEND_DIR, d.name))
    .sort();
}

function parse(src) {
  return acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
  });
}

// ── Generischer Walk ─────────────────────────────────────────────────
// Wir brauchen keinen Scope-Tracker wie `call-sites-defined.test.js` —
// hier interessieren Knotenformen, nicht Sichtbarkeiten. Der Walk
// überspringt Positionsfelder, damit er nicht in `loc`/`range` läuft.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walk(item, visit);
        }
      }
    } else if (v && typeof v === 'object' && typeof v.type === 'string') {
      walk(v, visit);
    }
  }
}

/**
 * Statische Zeichenkette oder nicht? Nur ein String-Literal und ein
 * Template-Literal OHNE Interpolation sind sicher beurteilbar. Alles
 * andere (Variable, `a + b`, `` `…${x}…` ``) ist per Definition
 * unbekannt und wird übersprungen (Fail-open).
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (
    node.type === 'TemplateLiteral' &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

// ── Selektor-Werte aus einem Selektor-String ziehen ──────────────────
// Nur der exakte Gleichheits-Operator zählt. `[data-action^="x"]`,
// `[data-action*="x"]`, `[data-action~="x"]` sind Präfix-/Teilstring-
// Matcher — der gesuchte Wert steht dort nicht vollständig, ein Abgleich
// gegen Markup wäre geraten. Deshalb: nicht beurteilbar, überspringen.
const SELECTOR_ATTR_RE = new RegExp(
  '\\[\\s*data-(' +
    ATTRS.join('|') +
    ')\\s*(?:([~^$*|]?=)\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\]\\s"\']+)))?\\s*[iIsS]?\\s*\\]',
  'g',
);

function selectorAttrValues(selector) {
  const out = [];
  let m;
  SELECTOR_ATTR_RE.lastIndex = 0;
  while ((m = SELECTOR_ATTR_RE.exec(selector)) !== null) {
    const attr = m[1];
    const op = m[2];
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
    if (!op) {
      // `[data-action]` — Anwesenheits-Selektor, also generischer Dispatch.
      out.push({ attr, value: null, generic: true });
      continue;
    }
    if (op !== '=' || value === undefined) {
      // Präfix-/Teilstring-Matcher → nicht beurteilbar.
      out.push({ attr, value: null, fuzzy: true });
      continue;
    }
    out.push({ attr, value });
  }
  return out;
}

// ── Markup-Werte aus einer Zeichenkette ziehen ───────────────────────
// Ein `[` unmittelbar vor `data-` heißt: das ist ein SELEKTOR, kein
// Markup. Diese Unterscheidung ist der Kern des Detektors — ohne sie
// bestätigte jeder Selektor sich selbst.
const MARKUP_ATTR_RE = new RegExp(
  '(^|[^\\[\\w-])data-(' + ATTRS.join('|') + ')\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')',
  'g',
);

// Erkennt ein Markup-Attribut, dessen Wert interpoliert wird: das Quasi
// endet mit `data-action="` und der Wert kommt aus einem `${…}`.
const MARKUP_ATTR_DYNAMIC_RE = new RegExp(
  '(^|[^\\[\\w-])data-(' + ATTRS.join('|') + ')\\s*=\\s*["\']?$',
);

function markupAttrValues(text) {
  const out = [];
  let m;
  MARKUP_ATTR_RE.lastIndex = 0;
  while ((m = MARKUP_ATTR_RE.exec(text)) !== null) {
    const attr = m[2];
    const value = m[3] !== undefined ? m[3] : m[4];
    out.push({ attr, value });
  }
  return out;
}

// dataset-Property-Namen → Attributname
const DATASET_PROP_TO_ATTR = { tabBody: 'tab-body', role: 'role', action: 'action' };

// =====================================================================
// Analyse über alle Dateien
// =====================================================================
function analyzeAll() {
  const files = sourceFiles();

  /** Selektor-Nutzungen: { attr, value, file, line, col } */
  const selectorUses = [];
  /** In Markup-Strings ausgegeben: attr → Set<value> */
  const renderedMarkup = new Map(ATTRS.map((a) => [a, new Set()]));
  /** Per DOM-Property gesetzt (`el.dataset.x = …`): attr → Set<value> */
  const renderedDom = new Map(ATTRS.map((a) => [a, new Set()]));
  /** Attribute, für die Markup dynamisch gebaut wird → Regel aus */
  const dynamicMarkupAttrs = new Set();
  /** Attribute, deren Selektor dynamisch gebaut wird → Gegenrichtung aus */
  const dynamicSelectorAttrs = new Set();
  /** Stellen mit generischem `[data-attr]`-Dispatch (nur Diagnose) */
  const genericDispatchSites = [];
  /** String-Literale, die als Gleichheits-/case-Vergleich auftreten */
  const comparedLiterals = new Set();
  /** String-Literale, die als Objekt-/Index-Schlüssel auftreten */
  const keyLiterals = new Set();
  /** Diagnose über die Fail-open-Löcher */
  const skipped = { dynamicSelector: 0, fuzzySelector: 0, dynamicMarkup: 0 };

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const ast = parse(src);
    const rel = path.basename(file);

    // ── Durchgang 1: Selektor-Aufrufe ────────────────────────────────
    // Wir merken uns die Argument-Knoten, damit Durchgang 2 sie NICHT
    // als Markup zählt.
    const selectorArgNodes = new Set();
    walk(ast, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return;
      const prop = callee.computed ? null : callee.property?.name;
      if (!prop || !SELECTOR_METHODS.has(prop)) return;
      const arg = node.arguments?.[0];
      if (!arg) return;
      selectorArgNodes.add(arg);
      const sel = staticString(arg);
      if (sel === null) {
        // Variable / Konkatenation / Template mit ${…} → Fail-open.
        skipped.dynamicSelector++;
        // Enthält der dynamische Ausdruck irgendwo eines unserer
        // Attribute, kann er JEDEN Wert treffen — dann ist die
        // Gegenrichtung für dieses Attribut nicht mehr beurteilbar.
        const raw = src.slice(arg.start, arg.end);
        for (const attr of ATTRS) {
          if (raw.includes('data-' + attr)) dynamicSelectorAttrs.add(attr);
        }
        return;
      }
      for (const hit of selectorAttrValues(sel)) {
        if (hit.generic) {
          // `closest('[data-action]')` — Event-Delegation auf einen
          // Container. Das schaltet die Gegenrichtung BEWUSST NICHT ab:
          // ein solcher Dispatch muss anschließend trotzdem auf den Wert
          // verzweigen (`if (action === 'save-rules')`), und genau diese
          // Vergleiche zählen unten als Handler-Beleg. Würde ein
          // einziger Container-Dispatch die ganze Regel abschalten,
          // wäre die Gegenrichtung wertlos — main.js:3133 hat genau so
          // einen, und der tote „Abbrechen"-Knopf aus c922144 wäre
          // erneut durchgerutscht.
          genericDispatchSites.push(rel + ':' + (node.loc?.start?.line ?? -1));
          continue;
        }
        if (hit.fuzzy) {
          // `[data-action^="x"]` trifft eine ganze Wertefamilie — welche,
          // weiß nur die Laufzeit. Beide Richtungen sind hier blind.
          skipped.fuzzySelector++;
          dynamicSelectorAttrs.add(hit.attr);
          continue;
        }
        selectorUses.push({
          attr: hit.attr,
          value: hit.value,
          file: rel,
          line: node.loc?.start?.line ?? -1,
          col: node.loc?.start?.column ?? -1,
        });
      }
    });

    // ── Durchgang 2: Markup, Vergleiche, Schlüssel ───────────────────
    walk(ast, (node) => {
      // (a) Markup in String-Literalen
      if (node.type === 'Literal' && typeof node.value === 'string') {
        if (!selectorArgNodes.has(node)) {
          for (const hit of markupAttrValues(node.value)) {
            renderedMarkup.get(hit.attr)?.add(hit.value);
          }
        }
        return;
      }
      // (b) Markup in Template-Literalen (der Normalfall in main.js)
      if (node.type === 'TemplateLiteral') {
        if (selectorArgNodes.has(node)) return;
        for (const quasi of node.quasis) {
          const text = quasi.value.cooked ?? quasi.value.raw ?? '';
          for (const hit of markupAttrValues(text)) {
            renderedMarkup.get(hit.attr)?.add(hit.value);
          }
          // Attributwert wird interpoliert → Regel für dieses Attribut
          // abschalten, sonst alarmiert der Detektor gegen einen Wert,
          // den er gar nicht sehen kann.
          const dyn = MARKUP_ATTR_DYNAMIC_RE.exec(text);
          if (dyn) {
            dynamicMarkupAttrs.add(dyn[2]);
            skipped.dynamicMarkup++;
          }
        }
        return;
      }
      // (c) `el.dataset.role = 'team-name'` — Attribut per DOM-Property
      //     statt per Markup-String. Landet BEWUSST in einem eigenen
      //     Topf: für die Hinrichtung zählt es als „wird ausgegeben"
      //     (ein Selektor darauf ist berechtigt), für die Gegenrichtung
      //     NICHT. Grund: wer ein Element in JS baut, hängt den Handler
      //     fast immer direkt an die Referenz (`btn.addEventListener`)
      //     statt über einen Selektor — siehe `start-ko-phase`,
      //     main.js:3643/3667. Würde das als „gerendert" in die
      //     Gegenrichtung zählen, wäre der Alarm dort ein Fehlalarm.
      if (
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        !node.left.computed &&
        node.left.object?.type === 'MemberExpression' &&
        !node.left.object.computed &&
        node.left.object.property?.name === 'dataset'
      ) {
        const attr = DATASET_PROP_TO_ATTR[node.left.property?.name];
        const v = staticString(node.right);
        if (attr && v !== null) renderedDom.get(attr)?.add(v);
        return;
      }
      // (d) `el.setAttribute('data-role', 'team-name')`
      //     Der `data-`-Präfix ist Pflicht. Ohne diese Prüfung landete
      //     das ARIA-Attribut `setAttribute('role', 'dialog')`
      //     (main.js:4461, tournament.js:912/1211/1530) im selben Topf
      //     wie `data-role` — ein `[data-role="dialog"]`-Selektor wäre
      //     dann von einem ARIA-Attribut „belegt" worden und der Alarm
      //     ausgeblieben.
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.property?.name === 'setAttribute'
      ) {
        const name = staticString(node.arguments?.[0]);
        const v = staticString(node.arguments?.[1]);
        if (name && v !== null && name.startsWith('data-')) {
          const attr = name.slice('data-'.length);
          if (ATTRS.includes(attr)) renderedDom.get(attr)?.add(v);
        }
        return;
      }
      // (e) Handler-Beleg: `action === 'refill'`, `case 'keep':`
      if (
        node.type === 'BinaryExpression' &&
        ['===', '==', '!==', '!='].includes(node.operator)
      ) {
        for (const side of [node.left, node.right]) {
          const v = staticString(side);
          if (v !== null) comparedLiterals.add(v);
        }
        return;
      }
      if (node.type === 'SwitchCase' && node.test) {
        const v = staticString(node.test);
        if (v !== null) comparedLiterals.add(v);
        return;
      }
      // (f) Handler-Beleg: Dispatch-Tabelle `{ 'refill': fn }` oder
      //     `handlers['refill']`. Bewusst großzügig — lieber ein Loch
      //     als ein Fehlalarm gegen ein Dispatch-Muster, das jemand
      //     morgen einführt. Array-Elemente zählen NICHT: sonst würden
      //     die Policy-Listen MUTATING_DATA_ACTIONS / SAFE_DATA_ACTIONS
      //     aus tournament-render.js jeden Wert weißwaschen.
      if (node.type === 'Property' && node.key) {
        const v = staticString(node.key);
        if (v !== null) keyLiterals.add(v);
        return;
      }
      if (node.type === 'MemberExpression' && node.computed) {
        const v = staticString(node.property);
        if (v !== null) keyLiterals.add(v);
      }
    });
  }

  // Die Aktions-Literale der Bausteine gehoeren zu den GERENDERTEN
  // data-action-Werten — sie stehen nur an einer anderen Stelle im
  // Quelltext. Siehe sammleAktionsLiterale.
  let literaleGefunden = 0;
  for (const datei of files) {
    const menge = renderedMarkup.get('action');
    if (!menge) break;
    for (const wert of sammleAktionsLiterale(fs.readFileSync(datei, 'utf-8'))) {
      menge.add(wert);
      literaleGefunden++;
    }
  }
  // Und jetzt der Punkt: das Abschalt-Flag WIEDER WEGNEHMEN. Nur zu
  // sammeln haette nichts gebracht — die Pruefung unten steigt beim Flag
  // aus, bevor sie die gesammelten Werte ueberhaupt ansieht. Ein Fail-open,
  // das man mit Daten fuettert und stehen laesst, ist immer noch ein
  // Fail-open.
  if (literaleGefunden > 0) dynamicMarkupAttrs.delete('action');

  return {
    files,
    selectorUses,
    renderedMarkup,
    renderedDom,
    dynamicMarkupAttrs,
    dynamicSelectorAttrs,
    genericDispatchSites,
    comparedLiterals,
    keyLiterals,
    skipped,
  };
}

const A = analyzeAll();

/**
 * Für die HINRICHTUNG zählt beides: was als Markup-String ausgegeben und
 * was per DOM-Property gesetzt wird. Beides landet am Ende im DOM, ein
 * Selektor darauf greift also ins Volle.
 */
function ausgegeben(attr) {
  return new Set([...A.renderedMarkup.get(attr), ...A.renderedDom.get(attr)]);
}

// =====================================================================
/**
 * Sammelt die `action:`-Literale ein, die der Zeilen-Baustein `lrow`
 * bekommt.
 *
 * Warum es das braucht (2026-08-26): Der Einstellungen-Tab wird seither
 * aus einem Baustein gebaut —
 * `lrow({ label: …, action: 'start-tournament' })`. Das gerenderte
 * `data-action` ist damit interpoliert und fuer den Markup-Scanner
 * unsichtbar. Der Detektor hat daraufhin die Regel fuer ALLE
 * data-action-Werte abgeschaltet: 40+ Aktionen ohne Waechter, still, an
 * einem Tag, an dem er vier tote Selektoren gefunden hatte.
 *
 * Eine Ausnahme einzutragen waere die bequeme Antwort gewesen. Die
 * richtige ist, ihm zu zeigen, wo die Werte JETZT stehen. Eine
 * Abstraktion darf Waechter nicht blind machen.
 *
 * WARUM NUR INNERHALB VON `lrow(`:
 * Der erste Entwurf hat jedes `action: '…'` der Datei genommen, mit der
 * Begruendung, Falsch-Positive machten den Detektor "nur nachsichtiger,
 * nie strenger". Der naechste Lauf hat das widerlegt: er fand
 * `action: 'edit'` aus einem AUDIT-Eintrag (main.js) und meldete
 * prompt einen "Knopf ohne Handler", den es nie gab. In der
 * GEGENRICHTUNG macht ein Falsch-Positiv den Detektor sehr wohl
 * strenger — er haelt einen Wert fuer gerendert und sucht dessen
 * Handler. Deshalb wird nur gelesen, was tatsaechlich zu einer Zeile
 * wird.
 *
 * 600 Zeichen Fenster: ein `lrow`-Aufruf ist in der Praxis unter 400
 * lang. Ist er laenger, faellt sein action-Wert durch — der Detektor
 * wird dann nachsichtiger, und das ist hier die harmlose Richtung.
 */
function sammleAktionsLiterale(quelltext) {
  const treffer = new Set();
  const aufruf = /\blrow\s*\(/g;
  let m;
  while ((m = aufruf.exec(quelltext)) !== null) {
    const fenster = quelltext.slice(m.index, m.index + 600);
    const inner = /\baction\s*:\s*'([a-z0-9-]+)'/g;
    let a2;
    while ((a2 = inner.exec(fenster)) !== null) treffer.add(a2[1]);
  }
  return treffer;
}
describe('Selektor-Drift: gesuchte data-Attribute gegen gerendertes Markup', () => {
  it('findet überhaupt Selektoren und Markup (Sanity-Check)', () => {
    // Ohne diesen Test wäre ein kaputter Parser-Pfad („0 Selektoren
    // gefunden") ein grüner Lauf — der Detektor wäre still tot, genau
    // die Krankheit, die er heilen soll.
    expect(A.files.length).toBeGreaterThan(5);
    expect(A.selectorUses.length).toBeGreaterThan(40);
    expect(A.renderedMarkup.get('action').size).toBeGreaterThan(20);
    expect(A.renderedMarkup.get('tab-body').size).toBeGreaterThan(3);
    expect(A.renderedMarkup.get('role').size).toBeGreaterThan(3);
  });

  for (const attr of ATTRS) {
    it('jeder gesuchte [data-' + attr + '="…"] wird auch irgendwo ausgegeben', () => {
      if (A.dynamicMarkupAttrs.has(attr)) {
        // Fail-open: irgendwo wird der Wert interpoliert, die Menge der
        // ausgegebenen Werte ist damit nicht mehr bestimmbar.
        expect(A.dynamicMarkupAttrs.has(attr)).toBe(true);
        return;
      }
      const renderedSet = ausgegeben(attr);
      const dead = A.selectorUses.filter(
        (u) =>
          u.attr === attr &&
          !renderedSet.has(u.value) &&
          !ALLOW_SELECTOR_WITHOUT_MARKUP.has(attr + ':' + u.value) &&
          !BASELINE_TOTE_SELEKTOREN.has(attr + ':' + u.value),
      );
      if (dead.length) {
        const lines = dead
          .map((u) => '  - [data-' + u.attr + '="' + u.value + '"]  ' + u.file + ':' + u.line + ':' + u.col)
          .join('\n');
        throw new Error(
          'TOTER SELEKTOR: ' +
            dead.length +
            ' Stelle(n) suchen ein data-' +
            attr +
            ', das kein Renderer ausgibt:\n' +
            lines +
            '\n\nDer Aufruf liefert dort immer null bzw. eine leere NodeList — ' +
            'der Knopf ist tot, ohne dass irgendwo eine Exception fliegt.\n' +
            'Fix: Selektor auf das tatsächlich ausgegebene Attribut ziehen ODER ' +
            'das Attribut im Renderer ergänzen.\n' +
            'Ausgegeben werden aktuell: ' +
            ([...renderedSet].sort().join(', ') || '(nichts)'),
        );
      }
      expect(dead).toEqual([]);
    });
  }

  it('Baseline ist noch aktuell (kein Eintrag verrottet)', () => {
    // Verhindert, dass die Baseline zur Müllhalde wird: sobald ein
    // bekannt toter Selektor repariert ODER gelöscht wurde, wird dieser
    // Test rot und verlangt das Streichen der Zeile. Ohne ihn stünden
    // dort in einem Jahr fünf Einträge, von denen drei längst erledigt
    // sind — und niemand wüsste welche.
    const erledigt = [];
    for (const [key, grund] of BASELINE_TOTE_SELEKTOREN) {
      const [attr, ...rest] = key.split(':');
      const value = rest.join(':');
      const nochGesucht = A.selectorUses.some((u) => u.attr === attr && u.value === value);
      const inzwischenAusgegeben = ausgegeben(attr).has(value);
      if (!nochGesucht) {
        erledigt.push('  - ' + key + ' — Selektor existiert nicht mehr. Zeile streichen.');
      } else if (inzwischenAusgegeben) {
        erledigt.push('  - ' + key + ' — wird inzwischen ausgegeben, also repariert. Zeile streichen.');
      }
      expect(typeof grund).toBe('string');
    }
    if (erledigt.length) {
      throw new Error(
        'BASELINE VERALTET: ' +
          erledigt.length +
          ' Eintrag/Einträge in BASELINE_TOTE_SELEKTOREN sind erledigt:\n' +
          erledigt.join('\n') +
          '\n\nDas ist eine gute Nachricht — bitte die betreffende(n) Zeile(n) ' +
          'aus der Baseline entfernen, damit die Ratsche zuschnappt.',
      );
    }
    expect(erledigt).toEqual([]);
  });

  it('Gegenrichtung: jedes gerenderte data-action hat einen Handler-Zweig', () => {
    if (A.dynamicSelectorAttrs.has('action') || A.dynamicMarkupAttrs.has('action')) {
      // Fail-open: ein dynamisch gebauter Selektor (`[data-action="${x}"]`)
      // oder ein interpolierter Attributwert kann jeden Wert treffen.
      // Ein generischer `[data-action]`-Container-Dispatch zählt hier
      // bewusst NICHT als Grund — siehe Kopfkommentar.
      expect(true).toBe(true);
      return;
    }
    const handledBySelector = new Set(
      A.selectorUses.filter((u) => u.attr === 'action').map((u) => u.value),
    );
    // Bewusst nur `renderedMarkup`, nicht `renderedDom`: ein in JS
    // gebautes Element bekommt seinen Handler direkt an die Referenz.
    const orphans = [...A.renderedMarkup.get('action')]
      .filter(
        (v) =>
          !handledBySelector.has(v) &&
          !A.comparedLiterals.has(v) &&
          !A.keyLiterals.has(v) &&
          !ALLOW_MARKUP_WITHOUT_HANDLER.has('action:' + v),
      )
      .sort();
    if (orphans.length) {
      throw new Error(
        'KNOPF OHNE HANDLER: ' +
          orphans.length +
          ' data-action-Wert(e) werden gerendert, aber nirgends behandelt:\n' +
          orphans.map((v) => '  - data-action="' + v + '"').join('\n') +
          '\n\nDer Knopf steht im DOM und tut beim Klick nichts. Genau das war ' +
          '„Abbrechen" im Spielfelder-Editor (Commit c922144).\n' +
          'Fix: Handler ergänzen (Selektor, dataset.action-Vergleich oder ' +
          'case-Zweig) ODER den Knopf nicht rendern.',
      );
    }
    expect(orphans).toEqual([]);
  });

  it('macht seine Fail-open-Löcher sichtbar (kein stiller Blindflug)', () => {
    // Kein Grenzwert, nur Sichtbarkeit: wenn diese Zahlen wachsen,
    // schrumpft die Abdeckung des Detektors, ohne dass er je rot wird.
    // Deshalb stehen sie hier und nicht nur im Kopfkommentar.
    const report = {
      dateien: A.files.length,
      selektorStellen: A.selectorUses.length,
      uebersprungenDynamischerSelektor: A.skipped.dynamicSelector,
      uebersprungenFuzzySelektor: A.skipped.fuzzySelector,
      uebersprungenDynamischesMarkup: A.skipped.dynamicMarkup,
      regelAusWegenDynamischemMarkup: [...A.dynamicMarkupAttrs],
      gegenrichtungAusWegenDynamischemSelektor: [...A.dynamicSelectorAttrs],
      generischerContainerDispatch: A.genericDispatchSites,
      bekanntToteSelektoren: [...BASELINE_TOTE_SELEKTOREN.keys()],
    };
    // `DRIFT_DEBUG=1 npx vitest run …` druckt die Bilanz aus. Ohne den
    // Schalter bleibt der Lauf still, damit die Suite nicht zurauscht.
    if (process.env.DRIFT_DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[selector-drift]', JSON.stringify(report, null, 2));
    }
    expect(report.dateien).toBeGreaterThan(0);
    // Stand 2026-08-25 gemessen: KEINE Regel ist abgeschaltet. Diese
    // beiden Zusicherungen sind der eigentliche Wert dieses Tests: wird
    // morgen ein interpoliertes `data-action="${x}"` oder ein dynamisch
    // gebauter `[data-action="${x}"]`-Selektor eingeführt, schalten sich
    // oben ganze Regeln still ab. Dann soll hier auffallen, dass der
    // Detektor an Kraft verloren hat, statt dass er unbemerkt nur noch
    // grün nickt. Wer so etwas bewusst einführt, trägt das Attribut hier
    // aus — mit Begründung, wie bei der Allowlist.
    expect(report.regelAusWegenDynamischemMarkup).toEqual([]);
    expect(report.gegenrichtungAusWegenDynamischemSelektor).toEqual([]);
  });
});
