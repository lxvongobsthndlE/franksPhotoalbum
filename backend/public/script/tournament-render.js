/**
 * Reines HTML-Renderer-Modul für die Tournament-Detail-View.
 *
 * P1 (2026-08-24, User-Liste): Mitglieder sollen die Detail-View im
 * Read-Only-Modus sehen — kein Löschen, kein Bearbeiten, kein Ergebnis
 * eintragen, kein Einstellungen-Tab. Die reinen HTML-Snippets hier
 * sind deshalb testbar (Vitest) und kapseln die isAdmin-Gates an
 * EINER Stelle.
 *
 * Vorher waren die Gates über das gesamte `renderTournamentInstanceDetailV3`-
 * Template verstreut (main.js:2851, 2852, 2876, plus die Sheet/Sidebar-
 * Komposition in main.js:2738). Das hier macht sie findbar und
 * automatisierbar prüfbar.
 *
 * Verwendung in main.js: Template-Literals weiter inline, aber die
 * Sub-Snippets (Spielplan/Regeln Section-Head, Einstellungen-Section,
 * Sidebar, Sheet-Items) durch diese Helper ersetzen.
 *
 * Bewusst KEINE DOM-Zugriffe, KEINE Modul-Globals, KEINE Side-Effects.
 * Eingabe: simple Options-Objekte. Ausgabe: HTML-String.
 */

// Mutierende data-action-Werte, die NUR für isAdmin=true gerendert
// werden dürfen. Wird vom Vitest-Test in read-only.test.js genutzt,
// um die HTML-Ausgabe zu prüfen.
//
// Quelle: User-Liste P1 (2026-08-24) + Audit aller data-action
// Emissionen im Tournament-Modul (siehe memory tournament-v3-p1-read-only).
export const MUTATING_DATA_ACTIONS = Object.freeze([
  'enter-result',
  'enter-result-pick',
  'edit-rules',
  'save-rules',
  'cancel-rules',
  'toggle-schedule-edit',
  'save-schedule-edits',
  'cancel-schedule-edits',
  'save-fields',
  'reset-fields',
  'save-groups',
  'pick-team-for-group',
  'redraw-seeding',
  'randomize-groups',
  'confirm-swap',
  'cancel-swap',
  'select-for-swap',
  'start-tournament',
  'revert-to-draft',
  'finish-tournament',
  'shift-open',
  'reschedule-auto',
  'reschedule',
  'reset-results',
  'delete-tournament',
  // P3 (2026-08-24): Fallback aus dem Baum-Tab für „K.-o.-Phase
  // starten". Wird per openConfirmDialog / direkter API-Call gehandhabt
  // und ist isAdmin-gegated (loadBracketTab prüft tournament.isAdmin
  // BEVOR der Button gerendert wird).
  'start-ko-phase',
]);

// Safe-Actions, die auch für isAdmin=false sichtbar bleiben dürfen.
export const SAFE_DATA_ACTIONS = Object.freeze([
  'back',
  'print',
  'close',
  'close-more',
  'open-more-menu',
  'toggle-section',
  'toggle-filter-dropdown',
]);

// ── Helpers ──────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Section-Renderer ────────────────────────────────────────────────

/**
 * Spielplan-Section-Head mit „Bearbeiten" (toggle-schedule-edit) und
 * „Ergebnis eintragen" (enter-result-pick). Beide Buttons sind Admin-only.
 */
export function renderSpielplanSectionHead({ isAdmin, t }) {
  const editBtn = isAdmin
    ? '<button type="button" class="t-btn t-btn--ghost" data-action="toggle-schedule-edit" title="Zeit und Platte pro Spiel ändern — Achtung: bei laufenden Spielen gesperrt">Bearbeiten</button>'
    : '';
  const resultBtn = isAdmin
    ? '<button type="button" class="t-btn t-btn--primary" data-action="enter-result-pick">Ergebnis eintragen</button>'
    : '';
  return `<div class="t-view-head">
                <div class="t-view-title">Spielplan</div>
                <div class="spacer"></div>
                ${editBtn}
                ${resultBtn}
              </div>
              <div class="t-toolbar" id="t-filters"></div>
              <div class="t-card"><div class="t-card-body" id="t-schedule-list"></div></div>`;
}

/**
 * Regeln-Section-Head mit „Bearbeiten" (edit-rules). Admin-only.
 */
export function renderRegelnSectionHead({ isAdmin }) {
  const editBtn = isAdmin
    ? '<button type="button" class="t-btn t-btn--ghost" data-action="edit-rules">Bearbeiten</button>'
    : '';
  return `<div class="t-view-head">
                <div class="t-view-title">Regeln</div>
                <div class="spacer"></div>
                ${editBtn}
              </div>
              <div data-tab-body="regeln-mount"></div>`;
}

/**
 * Einstellungen-Section — komplett ausgeblendet für !isAdmin.
 * Spezifikation: Mitglieder sehen kein Einstellungen-Tab (P1).
 */
export function renderEinstellungenSection({ isAdmin }) {
  if (!isAdmin) return '';
  return `<section class="t-view" data-view="einstellungen">
              <div class="t-view-head"><div class="t-view-title">Einstellungen</div></div>
              <div data-tab-body="einstellungen-mount"></div>
            </section>`;
}

/**
 * Sidebar-Nav — Einstellungen-Item nur für isAdmin.
 * Andere Items (Spielplan, Gruppen, Baum, Teams, Regeln, Drucken) sind
 * für alle sichtbar.
 */
export function renderDetailSidebar({ isAdmin }) {
  const einstellungenItem = isAdmin
    ? '<button type="button" data-view="einstellungen">Einstellungen</button>'
    : '';
  return `<nav class="t-mod-nav" id="t-nav" aria-label="Turnier-Ansichten">
            <button type="button" class="is-active" data-view="spielplan">Spielplan <span class="count" id="cnt-matches"></span></button>
            <button type="button" data-view="gruppen">Gruppen</button>
            <button type="button" data-view="baum">Turnierbaum</button>
            <button type="button" data-view="teams">Teams</button>
            <button type="button" data-view="regeln">Regeln</button>
            <button type="button" data-view="drucken">Drucken</button>
            ${einstellungenItem}
          </nav>`;
}

// ── Bottom-Sheet-Komposition ────────────────────────────────────────

/**
 * Filtert die View-Liste für die Bottom-Bar / das Sheet je nach
 * isAdmin. Member-Modis bekommen KEIN „Einstellungen"-Item.
 *
 * Pure-Funktion (keine DOM-Zugriffe). Bekommt `allViews` als Array
 * der verfügbaren Views und gibt die `sheetViews` zurück (= Views,
 * die NICHT in der Bottom-Bar sind, also im „Mehr"-Sheet landen).
 *
 * Bottom-Bar-Composition (3 primäre Views + Mehr) ist in main.js
 * implementiert (`barPrimary`), hier nur der Filter für „was darf
 * überhaupt in Bar/Sheet erscheinen".
 */
export function filterMemberViews({ allViews, isAdmin }) {
  if (isAdmin) return allViews.slice();
  return allViews.filter((v) => v !== 'einstellungen');
}

// ── Self-Test (optional, von Vitest-Tests importierbar) ──────────────

/**
 * Hilfsfunktion: Sucht in einem HTML-String nach allen vorkommenden
 * `data-action="…"`-Attributen. Gibt ein Set zurück.
 */
export function findDataActions(html) {
  const out = new Set();
  if (!html) return out;
  const re = /data-action="([a-z0-9-]+)"/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1]);
  return out;
}

/**
 * Hilfsfunktion: Prüft, ob ein HTML-String einen mutierenden
 * data-action enthält. Liefert den ersten gefundenen mutating action
 * oder null.
 */
export function findMutatingAction(html) {
  const found = findDataActions(html);
  for (const a of MUTATING_DATA_ACTIONS) {
    if (found.has(a)) return a;
  }
  return null;
}