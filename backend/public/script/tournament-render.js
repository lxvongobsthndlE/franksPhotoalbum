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
  // Zuschauer-Link (2026-08-26): Erteilen und Widerrufen ändern den
  // Zugriff auf das Turnier von außen — das ist die folgenreichste
  // Mutation im Modul, auch wenn sie keine Spieldaten anfasst.
  'create-public-link',
  'revoke-public-link',
  // Turnierlogo (26.08.2026): Beide Wege schreiben nach MinIO und in die
  // DB und hängen serverseitig an requireTournamentWrite.
  'upload-logo',
  'remove-logo',
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
  // Kopiert nur, was ohnehin schon im Feld steht.
  'copy-public-link',
  // Öffnet die Druckansicht des Zuschauer-Links in einem neuen Tab.
  'open-aushang',
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
  // OHNE LOGO KEIN PLATZHALTER — dieselbe Regel wie im Modulkopf
  // (Artefakt Abschnitt 01, renderModulKopf). Bis zum 26.08. stand hier
  // ein schwarzes Quadrat mit dem Anfangsbuchstaben; bei drei Turnieren
  // untereinander waren das drei Kaesten, die nichts sagten, was der
  // Name daneben nicht schon sagt. Die Mehrheit der Turniere hat kein
  // Logo — der Ersatzkasten war also der Normalfall, nicht die Ausnahme.
  const logoHtml = instance?.logoUrl
    ? `<span class="t-list-card-logo"><img src="${esc(instance.logoUrl)}" alt=""></span>`
    : '';

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

// ── Modulkopf ───────────────────────────────────────────────────────

/**
 * Der Kopf des Turniermoduls: Turnierlogo (falls vorhanden), Kicker,
 * Ansichtstitel und genau EINE Aktion.
 *
 * Artefakt „Turniermodul ohne Kaestchen", Abschnitt 01. Das Logo war
 * bisher hochladbar, aber in keiner einzigen Ansicht zu sehen — die
 * Bilanz des Artefakts fuehrt es als „0 → 3" (Modulkopf, Desktop-Kopf,
 * Druckbogen). Hier ist der erste der drei Orte.
 *
 * ZWEI Regeln, beide woertlich aus der Vorlage:
 *
 *  1. OHNE LOGO KEIN PLATZHALTER. Der Kopf bleibt dann ein schlichter
 *     Block; erst das Bild macht daraus ein zweispaltiges Raster. Kein
 *     grauer Ersatzkasten, kein Anfangsbuchstabe im Kreis — die Mehrheit
 *     der Turniere hat keins, und eine reservierte Leerstelle faellt
 *     staerker auf als gar nichts. Deshalb haengt die Raster-Klasse am
 *     Kopf, nicht am Bild.
 *  2. Das Logo steht neben BEIDEN Zeilen, nicht ueber oder unter einer.
 *     Dadurch liest der Kopf als ein Gegenstand und nicht als drei
 *     gestapelte Teile.
 *
 * Warum das hier steht und nicht als Template-Literal in main.js: der
 * Pruefstand baut denselben Kopf. Zwei Kopien desselben Markups sind
 * zwei Gelegenheiten, sie auseinanderlaufen zu lassen — und ein
 * Pruefstand mit nachgetipptem Markup hat in diesem Repo schon fuenfmal
 * einen intakten Zustand fuer kaputt erklaert.
 *
 * Der Cache-Buster am Bild ist derselbe wie im Einstellungen-Block: der
 * Dateiname am Server ist fuer alle Turniere gleich („logo"), ohne ihn
 * zeigt der Browser nach einem Austausch das alte Bild.
 */
export function renderModulKopf({ t, titel = 'Spielplan', cacheBust = null } = {}) {
  const logoUrl = (typeof t?.logoUrl === 'string' && t.logoUrl) ? t.logoUrl : null;
  const v = cacheBust == null ? '' : `${logoUrl && logoUrl.includes('?') ? '&' : '?'}v=${cacheBust}`;
  const logoHtml = logoUrl
    ? `<img class="t-mod-logo" src="${esc(logoUrl)}${v}" alt="" aria-hidden="true">`
    : '';
  return `
      <div class="t-mod-header-inner${logoUrl ? ' t-mod-header-inner--logo' : ''}">
        ${logoHtml}
        <div class="t-mod-kicker">
          <span class="t-mod-kicker-text"></span>
        </div>
        <div class="t-mod-titlerow">
          <h1 class="t-title" data-view-title>${esc(titel)}</h1>
          <button type="button" class="t-mod-action" data-view-action hidden></button>
        </div>
      </div>`;
}

// ── Section-Renderer ────────────────────────────────────────────────

/**
 * Kopfzeile INNERHALB einer Ansicht — nur noch fuer Aktionen.
 *
 * Nacharbeit 2026-08-26 (Beschwerde 6): Bis hierher trug jede Ansicht
 * ihren Namen ein zweites Mal. Die Markenuebernahme hatte den Modulkopf
 * auf die ANSICHT gedreht ("Spielplan" statt Turniername), die alten
 * View-Koepfe darunter aber stehen lassen — auf dem Schirm stand
 * "Spielplan" zweimal untereinander, einmal gross im Kopf, einmal klein
 * darunter. Additiv umgebaut, nicht ersetzt.
 *
 * Der Titel steht jetzt genau einmal, im Modulkopf. Bleiben keine
 * Aktionen uebrig (Mitglieder-Ansicht), entfaellt die Zeile GANZ —
 * sonst bliebe eine leere Zeile mit Abstand stehen, und ein leerer
 * Kasten ist kein besseres Ergebnis als ein doppelter Titel.
 */
function viewHead(...knoepfe) {
  const inhalt = knoepfe.filter(Boolean);
  if (!inhalt.length) return '';
  return `<div class="t-view-head"><div class="spacer"></div>${inhalt.join('')}</div>`;
}

/**
 * Spielplan-Section-Head mit „Bearbeiten" (toggle-schedule-edit) und
 * „Ergebnis eintragen" (enter-result-pick). Beide Buttons sind Admin-only.
 */
export function renderSpielplanSectionHead({ isAdmin, t }) {
  // Nacharbeit 2026-08-26, zweite Runde (Jonas):
  //   „bearbeiten kann auch weg das mach ich als admin ja in den
  //    einstellungen. ergebnis eintragen kann da bleiben, aber auch
  //    kleiner und nicht so platzeinnehmend."
  //
  // „Bearbeiten" (Zeit und Platte je Spiel) ist damit ersatzlos aus dem
  // Spielplan-Kopf entfallen — es gibt denselben Weg im Einstellungen-Tab,
  // und zwei Orte fuer eine Handlung sind einer zu viel. Der Edit-Modus
  // selbst bleibt vollstaendig erhalten, nur sein Einstieg wandert.
  //
  // „Ergebnis eintragen" bleibt, wird aber zum kleinen Knopf: es ist die
  // haeufigste Handlung am Spieltisch, aber es soll nicht ein Viertel des
  // Bildschirms fuellen, bevor man ueberhaupt ein Spiel sieht.
  const resultBtn = isAdmin
    ? '<button type="button" class="t-btn t-btn--primary t-btn--klein" data-action="enter-result-pick">Ergebnis eintragen</button>'
    : '';
  // Nacharbeit 2026-08-26, dritte Runde (Jonas):
  //   "der filter ist erneut ein kaestchen was zu nah am spielplan ist,
  //    ergebnis eintragen sieht da leider auch etwas fehl am platz aus."
  //
  // Beides war dasselbe Problem: zwei Zeilen uebereinander, in denen je
  // ein einzelnes Element schwebte — der Knopf rechts, das Filterfeld
  // links. Zwei halbe Zeilen sehen aus wie zwei Fehler.
  //
  // Jetzt EINE Zeile: Filter links, Aktion rechts, gemeinsame Grundlinie.
  // Der Filter ist damit kein alleinstehendes Kaestchen mehr, sondern die
  // linke Haelfte einer Leiste — und der Knopf hat einen Partner statt
  // einer leeren Zeile neben sich.
  return `<div class="t-spielplan-leiste">
                <div class="t-toolbar" id="t-filters"></div>
                ${resultBtn}
              </div>
              <!-- Jonas, 2026-08-26: "der spielplan sollen halt nicht wie
                   bislang kaestchen in einem grossen kasten sein. sondern nur
                   die kaestchen dass mans visuell besser unterscheiden kann."
                   Die aeussere Karte ist ersatzlos entfallen — sie umschloss
                   Spielkarten, die ihre Kante schon selbst haben, und machte
                   aus zwei Ebenen drei. -->
              <div id="t-schedule-list"></div>`;
}

/**
 * Regeln-Section-Head mit „Bearbeiten" (edit-rules). Admin-only.
 */
export function renderRegelnSectionHead({ isAdmin }) {
  // Nacharbeit 2026-08-26, zweite Runde (Jonas): „hier gibts zwei mal
  // bearbeiten, das muss weg."
  //
  // Der Modulkopf traegt seit der Markenuebernahme je Ansicht EINE Aktion,
  // und fuer das Regelwerk ist das „Bearbeiten" (T_VIEW_CHROME). Der alte
  // Knopf im View-Kopf war damit dieselbe Handlung ein zweites Mal, zwei
  // Zentimeter tiefer und in anderer Optik. Genau die Dopplung, die schon
  // beim Titel auffiel — der Kopf wurde ergaenzt, das Alte blieb stehen.
  //
  // isAdmin bleibt als Parameter erhalten: die Signatur wird an mehreren
  // Stellen bedient, und die Rollenfrage ist hier nicht verschwunden,
  // sondern in den Kopf gewandert (dort `wenn: (t) => t.isAdmin === true`).
  void isAdmin;
  return `<div data-tab-body="regeln-mount"></div>`;
}

/**
 * Einstellungen-Section — komplett ausgeblendet für !isAdmin.
 * Spezifikation: Mitglieder sehen kein Einstellungen-Tab (P1).
 */
export function renderEinstellungenSection({ isAdmin }) {
  if (!isAdmin) return '';
  return `<section class="t-view" data-view="einstellungen">
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