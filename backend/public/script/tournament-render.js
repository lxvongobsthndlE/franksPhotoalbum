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
  'reset-results',
  'delete-tournament',
  // P3 (2026-08-24): Fallback aus dem Baum-Tab für „K.-o.-Phase
  // starten". Wird per openConfirmDialog / direkter API-Call gehandhabt
  // und ist isAdmin-gegated (loadBracketTab prüft tournament.isAdmin
  // BEVOR der Button gerendert wird).
  'start-ko-phase',
  // A4 (2026-08-25): Kontextmenü der Turnierkarte in der Liste.
  // 'instance-menu' ist selbst nicht mutierend, öffnet aber ausschließlich
  // mutierende Einträge — deshalb steht der Knopf unter demselben Gate.
  'instance-menu',
  'instance-delete',
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
  // A4: Die ganze Turnierkarte ist die Aktion — reines Öffnen, für
  // Mitglieder ausdrücklich erlaubt.
  'open-instance',
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

// ── Listen-Karte (A4) ───────────────────────────────────────────────

/**
 * A4 (2026-08-25, redesign-umsetzung-teil2.md): Datum für die Turnierkarte.
 *
 * Die DTO-Felder startsAtShort/startsAtDate lassen das Jahr weg — auf der
 * Listenkarte steht das Turnier aber ohne weiteren Kontext, deshalb hier
 * die volle Form "05.09.2026". Fehlende oder ungültige Daten liefern einen
 * leeren String, damit die Zeile dann ganz entfällt statt "Invalid Date"
 * anzuzeigen.
 */
export function formatTournamentCardDate(startsAt) {
  if (!startsAt) return '';
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * A4: Eine Turnierkarte in der Liste.
 *
 * Vorher: .tournament-card aus main.css — der Status stand zweimal da (als
 * Abschnittsüberschrift UND als Badge), der Turniername war kleiner als die
 * Überschrift darüber, die Kennzahlen brachen als Textblock um, und neben
 * dem "Öffnen"-Knopf saß ein Mülleimer.
 *
 * Jetzt: .t-list-card aus tournament.css — die Klasse existierte bereits
 * vollständig (Logo, Name, Datum, Badge, Kennzahlen, Fortschrittsbalken),
 * wurde nur nie benutzt.
 *
 * Die ganze Karte ist die Aktion (role="button" + tabindex). Löschen liegt
 * im Kontextmenü, damit man beim Öffnen nicht danebentrifft.
 *
 * Bewusst ohne Import von tournament.js: dieses Modul bleibt frei von
 * Browser-Abhängigkeiten, deshalb kommen Labels und Icons als Strings rein.
 *
 * @param {object}  o.instance   Turnier-DTO aus prepareTournamentList
 * @param {string}  o.phase      Phasen-Bucket (Datenattribut + Badge-Text)
 * @param {boolean} o.isAdmin    P1-Gate — Mitglieder sehen kein Kontextmenü
 * @param {string}  o.phaseLabel deutscher Phasenname für das Badge
 * @param {string}  o.modeLabel  deutscher Modusname für die Kennzahlen-Zeile
 * @param {{more?: string, trash?: string}} [o.icons] Inline-SVGs aus main.js
 */
export function renderTournamentListCard({
  instance,
  phase,
  isAdmin,
  phaseLabel = '',
  modeLabel = '',
  icons = {},
} = {}) {
  // Backend liefert die Stats bereits aggregiert (prepareTournamentView):
  // { teamCount, groupCount, matchCount, finishedCount }.
  const played = instance?.finishedCount ?? 0;
  const total = instance?.matchCount ?? 0;
  const teamCount = instance?.teamCount ?? null;
  const groupCount = instance?.groupCount ?? null;
  const pct = total > 0 ? Math.round((played / total) * 100) : 0;

  const name = instance?.name || 'Turnier';
  const initial = name.trim().charAt(0).toUpperCase() || 'T';
  const logoHtml = instance?.logoUrl
    ? `<span class="t-list-card-logo"><img src="${esc(instance.logoUrl)}" alt=""></span>`
    : `<span class="t-list-card-logo">${esc(initial)}</span>`;

  // Die Badge-Farbe folgt dem Status, nicht der Phase: "draft" und
  // "generated" liegen im selben Phasen-Bucket, sehen aber verschieden aus.
  const statusClass = {
    draft: 't-list-card-status--draft',
    generated: 't-list-card-status--ready',
    group_stage: 't-list-card-status--running',
    ko_stage: 't-list-card-status--running',
    finished: 't-list-card-status--finished',
  }[instance?.status] || 't-list-card-status--draft';

  // Datum und Ort statt des wiederholten Status.
  const subLine = [formatTournamentCardDate(instance?.startsAt), instance?.location || '']
    .filter(Boolean)
    .join(' · ');

  // Kennzahlen einzeilig. Gruppen nur, wenn es welche gibt — ko_only hat keine.
  const infoParts = [];
  if (modeLabel) infoParts.push(modeLabel);
  infoParts.push(`${teamCount ?? '–'} Teams`);
  if (groupCount) infoParts.push(`${groupCount} Gruppen`);
  infoParts.push(`${total} Spiele`);

  const menuHtml = isAdmin
    ? `<div class="t-list-card-menu-wrap">
        <button type="button" class="t-list-card-menu-btn" data-action="instance-menu"
                data-instance-id="${esc(instance?.id)}" aria-haspopup="true" aria-expanded="false"
                aria-label="Aktionen für ${esc(name)}">${icons.more || ''}</button>
        <div class="t-list-card-menu" hidden>
          <button type="button" class="t-list-card-menu-item danger" data-action="instance-delete"
                  data-instance-id="${esc(instance?.id)}" data-instance-name="${esc(name)}">${icons.trash || ''}<span>Löschen</span></button>
        </div>
      </div>`
    : '';

  return `<article class="t-list-card" data-instance-id="${esc(instance?.id)}" data-instance-phase="${esc(phase)}"
           data-action="open-instance" role="button" tabindex="0"
           aria-label="${esc(name)} öffnen">
    <div class="t-list-card-row">
      ${logoHtml}
      <div class="t-list-card-main">
        <h3 class="t-list-card-name">${esc(name)}</h3>
        ${subLine ? `<div class="t-list-card-date">${esc(subLine)}</div>` : ''}
      </div>
      <span class="t-list-card-status ${statusClass}">${esc(phaseLabel)}</span>
      ${menuHtml}
    </div>
    <div class="t-list-card-info">${esc(infoParts.join(' · '))}</div>
    ${total > 0 ? `<div class="t-list-card-progress">
      <div class="t-list-card-progress-bar"><span class="t-list-card-progress-fill" style="width:${pct}%"></span></div>
      <div class="t-list-card-progress-label">${played} von ${total} Spielen</div>
    </div>` : ''}
  </article>`;
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