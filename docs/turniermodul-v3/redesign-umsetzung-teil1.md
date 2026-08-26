# Redesign — Umsetzung Teil 1: Tokens, Match-Karte, Tabelle

> **An das implementierende Modell:** Dieses Dokument enthält fertige CSS-Blöcke und HTML-Strukturen. Sie sind gegen deinen tatsächlichen Code geschrieben — Klassennamen, Zeilennummern und Datenfelder stammen aus `tournament.css` (Stand 3155 Zeilen) und `render-funktionen.md` (Commit b3ae5f9).
>
> **Drei Regeln, die diesmal gelten:**
>
> 1. **Klassennamen werden nicht umbenannt.** Wenn eine Klasse in diesem Dokument anders heißt als bei dir, prüfe zuerst, ob du die richtige Stelle erwischt hast. Ändere im Zweifel deinen Code, nicht dieses Dokument.
> 2. **Die HTML-Struktur wird nicht ergänzt und nicht gekürzt.** Kein zusätzliches Wrapper-Element, keine weggelassene Zelle. Die CSS-Regeln setzen genau diese Struktur voraus.
> 3. **Geprüft wird in der echten App** auf `localhost:3000`, nicht in einer nachgebauten Umgebung. Das war zuletzt mehrfach die Fehlerquelle.
>
> **Umfang:** Dieser Teil deckt Tokens, Match-Karte und Gruppentabelle ab. Turnierkarte, Ergebnis-Dialog und Einstellungen folgen in Teil 2, nachdem Teil 1 abgenommen ist.

---

## A1 — Tokens

**Ersetze `tournament.css` Zeile 42–86** (den `.t-mod`-Block mit den Farbdefinitionen) durch:

```css
.t-mod {
  /* ---- Farben: Grundton, aus [kru:]nest übernommen ---- */
  --paper:        #FAF7F1;
  --surface:      #FFFFFF;
  --surface-alt:  #F5F1E9;
  --ink:          #1F1B16;
  --ink-soft:     #8A8077;
  --line:         #E7DFD2;
  --accent:       #8B6B4A;
  --accent-soft:  #F0E7DA;

  /* ---- Anzeigetafel: die eigene Handschrift des Moduls ----
     Überall dort, wo Ergebnisse oder Zeiten stehen, wird der Grund
     dunkel und die Ziffer hell. Das ist das Element, an dem man das
     Turniermodul erkennt. Bewusst wärmer als reines Schwarz, damit es
     zum Papier der App gehört statt darauf zu liegen. */
  --board:        #211C16;
  --board-ink:    #F7F2E8;
  --board-dim:    #6B6055;

  /* ---- Zustände ---- */
  --open:         #C08A2E;
  --qualified:    #4F7A4A;
  --out:          #A79E94;
  --danger:       #C0453A;

  /* ---- Radien ----
     4px für Score-Felder: bewusst kantiger als der Rest. Der kleine
     Bruch ist Absicht — er macht das Score-Feld zum Fremdkörper im
     guten Sinn. */
  --r-card:  12px;
  --r-btn:   10px;
  --r-board:  4px;

  /* ---- Spacing ---- */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s6: 24px;
  --s8: 32px;

  /* ---- Container-Vertrag (unverändert, nicht anfassen) ---- */
  container-type: inline-size;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
```

**Direkt darunter einfügen** — der Nachtmodus, der heute fehlt:

```css
/* ----------------------------------------------------------------
   NACHTMODUS
   ----------------------------------------------------------------
   Der Selektor muss zu dem passen, was [kru:]nest bereits verwendet.
   Prüfe in main.css, wie der Nachtmodus dort umgesetzt ist, und
   übernimm denselben Selektor. Die drei häufigsten Varianten sind
   unten aufgeführt — nimm die zutreffende, lösche die anderen.

   WICHTIG: Die Anzeigetafel dreht sich um. Auf hellem Grund ist sie
   dunkel, auf dunklem Grund hell. So bleibt sie in beiden Modi das
   auffälligste Element, statt mit dem Hintergrund zu verschmelzen.
   ---------------------------------------------------------------- */
body.dark .t-mod,
[data-theme="dark"] .t-mod,
.theme-dark .t-mod {
  --paper:        #1A1714;
  --surface:      #23201B;
  --surface-alt:  #2A2620;
  --ink:          #F2EDE4;
  --ink-soft:     #A69C90;
  --line:         #332E27;
  --accent:       #B8916A;
  --accent-soft:  #332A22;

  /* Anzeigetafel umgekehrt */
  --board:        #EDE6DA;
  --board-ink:    #1A1714;
  --board-dim:    #7A7166;

  --open:         #D9A445;
  --qualified:    #6B9A66;
  --out:          #6E665D;
  --danger:       #D66B60;
}
```

**Prüfpunkt:** Nach dieser Änderung muss das gesamte Modul im Nachtmodus dunkle Karten haben. Wenn irgendwo noch weiße Flächen stehen, ist dort eine Farbe fest verdrahtet statt über ein Token bezogen. Such nach `#FFF`, `#fff`, `white` innerhalb von `tournament.css` und ersetze sie durch `var(--surface)`.

---

## A2 — Die Match-Karte

Das ist die wichtigste Änderung. Die Karte wird von **horizontal auf vertikal** gedreht: Teams untereinander, Punkte rechts daneben in Anzeigetafel-Feldern.

### Warum

Heute stehen Heim, Ergebnis und Gast nebeneinander. Bei 250px Breite bleiben pro Name 60px — der Name wird zu „Te…". Untereinander bekommt jeder Name die volle Breite, die Ziffern fluchten senkrecht, und dieselbe Struktur funktioniert auf 360px wie auf 1920px.

Der Turnierbaum macht es bereits so. Damit ist die Karte danach überall gleich aufgebaut.

### Die Zielstruktur

```html
<div class="t-match" data-match-id="…">
  <div class="t-match-bar"></div>
  <div class="t-match-meta">
    <div class="t-match-meta-time">10:30</div>
    <div class="t-match-meta-field">PLATTE 3</div>
    <div class="t-match-meta-label">VF 1</div>
  </div>
  <div class="t-match-rows">
    <div class="t-match-row">
      <div class="t-match-team is-winner">
        <i class="t-dot" style="background:#C0453A"></i>
        <span class="name">Rakija Boys</span>
      </div>
      <div class="t-match-score">7</div>
    </div>
    <div class="t-match-row">
      <div class="t-match-team">
        <i class="t-dot" style="background:#4F7A4A"></i>
        <span class="name">Klopfer Kollektiv</span>
      </div>
      <div class="t-match-score">4</div>
    </div>
  </div>
  <div class="t-match-action">…</div>
</div>
```

**Was sich gegenüber heute ändert:**

| heute | neu |
|---|---|
| `.t-match-team` und `.t-match-team.right` als Geschwister | beide in `.t-match-rows`, jeweils in einer `.t-match-row` |
| ein `.t-match-score` mit `"7 : 4"` | zwei `.t-match-score`, je eine Zahl |
| `.t-match-meta` zweizeilig | dreizeilig: Zeit, Platte (Versalien), Runde |
| kein `.right`-Modifier mehr nötig | entfällt ersatzlos |

### CSS

**Ersetze Zeile 930–1092** (von `.t-match {` bis zum Ende des `@container (max-width: 767px)`-Blocks, der die Match-Karte betrifft) durch:

```css
/* ----------------------------------------------------------------
   MATCH-KARTE — eine Struktur, drei Größen
   ----------------------------------------------------------------
   Teams stehen UNTEREINANDER, die Punkte rechts daneben in
   Anzeigetafel-Feldern. Diese Anordnung ist der Standard jedes
   etablierten Turnierbaums und funktioniert auf jeder Bildschirm-
   breite unverändert — deshalb gibt es hier keinen Mobile-Umbruch
   mehr, nur kleinere Werte.
   ---------------------------------------------------------------- */
.t-match {
  display: grid;
  grid-template-columns: 3px 92px minmax(0, 1fr) auto;
  gap: var(--s3);
  align-items: start;
  padding: var(--s3) var(--s4);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.t-match:last-child { border-bottom: none; }

/* Statusstreifen links */
.t-match-bar {
  align-self: stretch;
  border-radius: 2px;
  background: var(--open);
}
.t-match--done .t-match-bar { background: var(--qualified); }

/* Meta-Spalte: Zeit, Platte, Runde */
.t-match-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 2px;
}
.t-match-meta-time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 15px;
  color: var(--ink);
  line-height: 1.2;
}
.t-match-meta-field {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-soft);
  line-height: 1.3;
}
.t-match-meta-label {
  font-size: 11px;
  color: var(--ink-soft);
  line-height: 1.3;
}

/* Die beiden Team-Zeilen */
.t-match-rows {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.t-match-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--s3);
  align-items: center;
}

.t-match-team {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
  font-weight: 400;
  color: var(--ink-soft);
  font-size: 15px;
}
.t-match-team .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.t-match-team.is-winner {
  font-weight: 700;
  color: var(--ink);
}
/* Solange kein Ergebnis eingetragen ist, stehen beide Teams gleich */
.t-match:not(.t-match--done) .t-match-team {
  font-weight: 500;
  color: var(--ink);
}
.t-match-team.is-placeholder .name {
  font-style: italic;
  color: var(--ink-soft);
}

/* Das Score-Feld — die Signatur des Moduls */
.t-match-score {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  background: var(--board);
  color: var(--board-ink);
  border-radius: var(--r-board);
  padding: 6px 0;
  min-width: 38px;
  text-align: center;
  flex: none;
}
/* Offenes Spiel: Umriss statt Füllung — der Platz ist sichtbar
   reserviert, aber nichts täuscht ein Ergebnis vor. */
.t-match-score.empty {
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  padding: 5px 0;
}

/* Aktionsspalte — nie leer */
.t-match-action {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-top: 2px;
}
.t-match-action-text {
  font-size: 12px;
  color: var(--ink-soft);
}

/* ---- Kompakt: Kontextspalte, Turnierbaum ---- */
.t-match.t-match--compact {
  grid-template-columns: 3px minmax(0, 1fr);
  gap: var(--s2);
  padding: var(--s2) var(--s3);
}
.t-match.t-match--compact .t-match-meta {
  flex-direction: row;
  gap: var(--s2);
  align-items: baseline;
  margin-bottom: var(--s1);
}
.t-match.t-match--compact .t-match-meta-time  { font-size: 13px; }
.t-match.t-match--compact .t-match-meta-field,
.t-match.t-match--compact .t-match-meta-label { font-size: 10px; }
.t-match.t-match--compact .t-match-team       { font-size: 14px; }
.t-match.t-match--compact .t-match-score {
  font-size: 14px;
  min-width: 30px;
  padding: 4px 0;
}
.t-match.t-match--compact .t-match-action { display: none; }

/* ---- Groß: Beamer, Detailpanel ---- */
.t-match.t-match--large {
  grid-template-columns: 4px 120px minmax(0, 1fr) auto;
  padding: var(--s4) var(--s6);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  margin-bottom: var(--s3);
  gap: var(--s4);
}
.t-match.t-match--large:last-child { margin-bottom: 0; }
.t-match.t-match--large .t-match-meta-time { font-size: 20px; }
.t-match.t-match--large .t-match-team      { font-size: 19px; }
.t-match.t-match--large .t-match-score {
  font-size: 28px;
  min-width: 60px;
  padding: 10px 0;
}

/* ---- Schmale Modulbreite ----
   Die Struktur bleibt gleich, nur die Meta-Spalte wandert nach oben
   und wird einzeilig. Kein Grid-Umbau, keine grid-template-areas. */
@container (max-width: 599px) {
  .t-match,
  .t-match.t-match--large {
    grid-template-columns: 3px minmax(0, 1fr) auto;
    grid-template-areas:
      "bar meta action"
      "bar rows rows";
    row-gap: var(--s2);
    column-gap: var(--s3);
    padding: var(--s3);
  }
  .t-match-bar    { grid-area: bar; }
  .t-match-meta   { grid-area: meta; flex-direction: row; gap: var(--s2); align-items: baseline; padding-top: 0; }
  .t-match-rows   { grid-area: rows; }
  .t-match-action { grid-area: action; padding-top: 0; }
  .t-match-meta-time  { font-size: 14px; }
  .t-match-meta-field,
  .t-match-meta-label { font-size: 10px; }
  .t-match.t-match--large .t-match-meta-time { font-size: 16px; }
  .t-match.t-match--large .t-match-team      { font-size: 16px; }
  .t-match.t-match--large .t-match-score     { font-size: 18px; min-width: 38px; padding: 6px 0; }
}

/* Der Farbpunkt vor dem Teamnamen */
.t-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
  display: inline-block;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.t-dot.t-dot--placeholder { opacity: 0.4; }
```

### Die neue Render-Funktion

**Ersetze `renderMatchCard` in `spielplan-helpers.js:182-259` vollständig durch:**

```js
export function renderMatchCard(m, isAdmin, isEdit = false, fieldsConfig = null) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeColor = m?.home?.color || null;
  const awayColor = m?.away?.color || null;
  const homeIsPlaceholder = m?.home?.kind === 'placeholder';
  const awayIsPlaceholder = m?.away?.kind === 'placeholder';

  const homeHasScore = typeof m?.scoreHome === 'number';
  const awayHasScore = typeof m?.scoreAway === 'number';
  const bothScores = homeHasScore && awayHasScore;
  const homeIsWinner = !!m?.isFinished && bothScores && m.scoreHome > m.scoreAway;
  const awayIsWinner = !!m?.isFinished && bothScores && m.scoreAway > m.scoreHome;

  const timeStr  = m?.scheduledTime || '–';
  const fieldStr = m?.field != null ? resolveFieldName(m.field, fieldsConfig) : '';
  const labelStr = m?.label || '';

  // Edit-Modus: Zeit und Platte als Eingabefelder, sonst unverändert.
  const isKo = !!m?.isKo || m?.stageType === 'ko';
  const editDisabled = !!(isEdit && (isKo || !!m?.isFinished));
  let metaHtml;
  if (isEdit) {
    const hh = m?.scheduledTime && /^\d{2}:\d{2}$/.test(m.scheduledTime)
      ? m.scheduledTime
      : (m?.scheduledAt ? new Date(m.scheduledAt).toISOString().slice(11, 16) : '');
    const fieldVal = m?.field != null ? String(m.field) : '';
    metaHtml = `
      <div class="t-match-meta t-match-meta--edit">
        <input class="t-match-edit-time" type="time" value="${esc(hh)}" ${editDisabled ? 'disabled' : ''} data-role="edit-time">
        <input class="t-match-edit-field" type="number" min="1" max="12" value="${esc(fieldVal)}" ${editDisabled ? 'disabled' : ''} data-role="edit-field">
      </div>`;
  } else {
    metaHtml = `
      <div class="t-match-meta">
        <div class="t-match-meta-time">${esc(timeStr)}</div>
        ${fieldStr ? `<div class="t-match-meta-field">${esc(fieldStr)}</div>` : ''}
        ${labelStr ? `<div class="t-match-meta-label">${esc(labelStr)}</div>` : ''}
      </div>`;
  }

  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const teamRow = (name, color, isWinner, isPlaceholder, hasScore, score) => `
    <div class="t-match-row">
      <div class="t-match-team${isWinner ? ' is-winner' : ''}${isPlaceholder ? ' is-placeholder' : ''}">
        <i class="t-dot${isPlaceholder ? ' t-dot--placeholder' : ''}" style="${dotStyle(color)}" aria-hidden="true"></i>
        <span class="name">${esc(name)}</span>
      </div>
      <div class="t-match-score${hasScore ? '' : ' empty'}">${hasScore ? esc(String(score)) : '–'}</div>
    </div>`;

  // Aktionsspalte — nie leer.
  let actionHtml;
  if (isAdmin) {
    const btnLabel = m?.isFinished ? 'Ändern' : 'Eintragen';
    actionHtml = `<div class="t-match-action"><button type="button" class="t-btn t-btn--ghost t-btn--sm" data-action="enter-result" data-match-id="${esc(m?.id)}">${btnLabel}</button></div>`;
  } else if (m?.isFinished) {
    actionHtml = '<div class="t-match-action"><span class="t-match-action-text">Beendet</span></div>';
  } else {
    actionHtml = '<div class="t-match-action"><span class="t-match-action-text"></span></div>';
  }

  return `
    <div class="t-match${m?.isFinished ? ' t-match--done' : ''}" data-match-id="${esc(m?.id)}">
      <div class="t-match-bar"></div>
      ${metaHtml}
      <div class="t-match-rows">
        ${teamRow(homeName, homeColor, homeIsWinner, homeIsPlaceholder, homeHasScore, m?.scoreHome)}
        ${teamRow(awayName, awayColor, awayIsWinner, awayIsPlaceholder, awayHasScore, m?.scoreAway)}
      </div>
      ${actionHtml}
    </div>`;
}
```

**Zwei Änderungen im Verhalten**, die dabei mitkommen:

- Der Knopf heißt „Eintragen" statt „Ergebnis" und „Ändern" statt „Erneut". Beides beschreibt die Handlung genauer.
- Bei Mitgliedern und offenem Spiel steht in der Aktionsspalte nichts mehr statt der Rundenbezeichnung — die steht bereits in der Meta-Spalte.

### renderMatchCardCompact anpassen

**Ersetze `spielplan-helpers.js:328-349` durch:**

```js
export function renderMatchCardCompact(m) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeHasScore = typeof m?.scoreHome === 'number';
  const awayHasScore = typeof m?.scoreAway === 'number';
  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';

  const timeStr  = m?.scheduledTime || '';
  const fieldStr = m?.field != null ? `Platte ${m.field}` : '';

  const row = (name, color, hasScore, score) => `
    <div class="t-match-row">
      <div class="t-match-team">
        <i class="t-dot" style="${dotStyle(color)}" aria-hidden="true"></i>
        <span class="name">${esc(name)}</span>
      </div>
      <div class="t-match-score${hasScore ? '' : ' empty'}">${hasScore ? esc(String(score)) : '–'}</div>
    </div>`;

  return `
    <div class="t-match t-match--compact${m?.isFinished ? ' t-match--done' : ''}">
      <div class="t-match-bar"></div>
      <div class="t-match-rows">
        ${(timeStr || fieldStr) ? `<div class="t-match-meta">
          ${timeStr ? `<div class="t-match-meta-time">${esc(timeStr)}</div>` : ''}
          ${fieldStr ? `<div class="t-match-meta-field">${esc(fieldStr)}</div>` : ''}
        </div>` : ''}
        ${row(homeName, m?.home?.color, homeHasScore, m?.scoreHome)}
        ${row(awayName, m?.away?.color, awayHasScore, m?.scoreAway)}
      </div>
    </div>`;
}
```

### renderMatchCardBracket

Die Bracket-Karte ist bereits vertikal aufgebaut und braucht nur die neue Score-Optik. **Ändere in `spielplan-helpers.js:656-708` nichts an der Logik** — die CSS-Regeln oben greifen automatisch, sobald `--board` gesetzt ist.

Prüfe nur, ob die Bracket-eigenen Score-Regeln ab Zeile 1194 (`.t-match--bracket`) die neuen Werte überschreiben. Falls dort `background: var(--surface-alt)` steht, ersetze es durch `background: var(--board); color: var(--board-ink);`.

---

## A3 — Die Gruppentabelle

### Was sich ändert

**Ausrichtung.** Heute sind alle Zellen linksbündig, die Zahlen stehen also links unter einer linksbündigen Überschrift — sieht aus wie ausgerichtet, ist es aber nicht, sobald die Zahlen unterschiedlich lang sind. Neu: Zahlenspalten rechtsbündig, Überschrift ebenso.

**Symbole.** Heute markieren Stern, Platznummer und Häkchen dasselbe. Neu: die hinterlegte Zeile plus eine Linie an der Qualifikationsgrenze. Sonst nichts.

**Mobil.** Neun Spalten passen nicht auf 360px. Auf schmalen Modulbreiten werden Sp., S, U, N und die Becher-Spalte ausgeblendet — es bleiben Platz, Team, Diff und Punkte.

### CSS

**Ersetze Zeile 682–713** (von `.t-standings-group-title` bis zur `is-second`-Regel) durch:

```css
/* ----------------------------------------------------------------
   GRUPPENTABELLE
   ---------------------------------------------------------------- */
.t-standings-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-soft);
  letter-spacing: 0.10em;
  text-transform: uppercase;
  margin: 0 0 var(--s3);
}

.t-standings-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  table-layout: fixed;
}

.t-standings-table th,
.t-standings-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}

.t-standings-table th {
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-bottom: 6px;
}

/* Ausrichtung: Text links, Zahlen rechts — Überschrift wie Wert. */
.t-standings-table th.is-rank,
.t-standings-table th.is-team,
.t-standings-rank,
.t-standings-team { text-align: left; }

.t-standings-table th.is-num,
.t-standings-num { text-align: right; }

.t-standings-rank { color: var(--ink-soft); font-size: 12px; }
.t-standings-team {
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-standings-num.is-points { font-weight: 700; color: var(--ink); }
.t-standings-num.is-positive { color: var(--qualified); }
.t-standings-num.is-negative { color: var(--danger); }

/* Qualifikation — genau zwei Signale: Hinterlegung und Trennlinie.
   Kein Stern, kein Pfeil, kein Häkchen. */
.t-standings-row.is-qualified td { background: rgba(79, 122, 74, 0.07); }
.t-standings-row.is-pending   td { background: rgba(192, 138, 46, 0.07); }
.t-standings-row.is-cutoff  td { border-bottom: 2px solid var(--qualified); }

/* Schmale Modulbreite: Nebenspalten weg, es bleiben Pl., Team, Diff, Pkt. */
@container (max-width: 599px) {
  .t-standings-table th.is-played,
  .t-standings-table td.is-played,
  .t-standings-table th.is-won,
  .t-standings-table td.is-won,
  .t-standings-table th.is-drawn,
  .t-standings-table td.is-drawn,
  .t-standings-table th.is-lost,
  .t-standings-table td.is-lost,
  .t-standings-table th.is-goals,
  .t-standings-table td.is-goals { display: none; }
}
```

### Render-Anpassung

**In `renderStandingsGroups` (`spielplan-helpers.js:435-484`)** ändern sich drei Dinge:

1. Die Zeilenklassen: `is-first`/`is-second` werden durch `is-qualified`, `is-pending` und `is-cutoff` ersetzt. Welche Plätze qualifiziert sind, steht in der Turnier-Konfiguration (`advancePerGroup`) — reich sie als Parameter durch.
2. Die Zellen bekommen Kennzeichnungsklassen für das Ausblenden auf schmalen Breiten.
3. `renderColgroup` mit `STANDINGS_COL_WIDTHS` bleibt, aber die Breiten müssen zu `table-layout: fixed` passen.

```js
export function renderStandingsGroups(groups, scoreLabel, advancePerGroup = 2) {
  const fmtDiff = (n) => (n > 0 ? `+${n}` : `${n}`);
  return groups.map((g) => {
    const rows = (g.standings || []).map((s, i) => {
      const gf = s.goalsFor ?? 0;
      const ga = s.goalsAgainst ?? 0;
      const gd = s.goalDiff ?? (gf - ga);
      const pos = i + 1;
      const cls = [
        't-standings-row',
        pos <= advancePerGroup ? 'is-qualified' : '',
        pos === advancePerGroup ? 'is-cutoff' : '',
      ].filter(Boolean).join(' ');
      return `<tr class="${cls}">
        <td class="t-standings-rank">${pos}.</td>
        <td class="t-standings-team">${esc(s.name || '—')}</td>
        <td class="t-standings-num is-played">${s.played ?? 0}</td>
        <td class="t-standings-num is-won">${s.won ?? 0}</td>
        <td class="t-standings-num is-drawn">${s.drawn ?? 0}</td>
        <td class="t-standings-num is-lost">${s.lost ?? 0}</td>
        <td class="t-standings-num is-goals">${gf}:${ga}</td>
        <td class="t-standings-num${gd > 0 ? ' is-positive' : gd < 0 ? ' is-negative' : ''}">${fmtDiff(gd)}</td>
        <td class="t-standings-num is-points">${s.points ?? 0}</td>
      </tr>`;
    }).join('');

    return `<div class="t-card">
      <div class="t-card-body">
        <h3 class="t-standings-group-title">${esc(g.groupName || g.groupKey || 'Gruppe')}</h3>
        <table class="t-standings-table">
          ${renderColgroup(STANDINGS_COL_WIDTHS)}
          <thead>
            <tr>
              <th class="is-rank">Pl.</th>
              <th class="is-team">Team</th>
              <th class="is-num is-played">Sp.</th>
              <th class="is-num is-won">S</th>
              <th class="is-num is-drawn">U</th>
              <th class="is-num is-lost">N</th>
              <th class="is-num is-goals">${esc(scoreLabel)}</th>
              <th class="is-num">Diff</th>
              <th class="is-num">Pkt.</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}
```

**`advancePerGroup` durchreichen:** In `loadStandingsTab` steht die Turnier-Konfiguration bereits zur Verfügung. Falls der Standings-Endpunkt den Wert nicht mitliefert, ergänze ihn dort — er wird für die Markierung gebraucht.

---

## B — Prüfliste

Nach der Umsetzung im echten Browser prüfen, bei **360, 390, 430, 768, 1280 und 1920** Pixeln:

**Match-Karte**
- [ ] Teams stehen untereinander, jeder Name vollständig lesbar
- [ ] Die beiden Punktzahlen fluchten senkrecht
- [ ] Bei beendeten Spielen ist der Sieger fett, der Verlierer grau
- [ ] Bei offenen Spielen sind beide Namen gleich dargestellt, die Score-Felder stehen als Umriss
- [ ] Zweistellige Ergebnisse (10:8) passen ohne Umbruch
- [ ] Die Karte ist nie breiter als der sichtbare Bereich
- [ ] Bei 360px sieht man mindestens fünf Spiele gleichzeitig

**Tabelle**
- [ ] Überschriften und Werte fluchten in jeder Spalte
- [ ] Alle Gruppentabellen haben identische Spaltenbreiten
- [ ] Kein Stern, kein Pfeil, kein Häkchen — nur Hinterlegung und Trennlinie
- [ ] Bei 360px sind Pl., Team, Diff und Pkt. sichtbar, der Rest ausgeblendet
- [ ] Kein Text überlappt

**Nachtmodus**
- [ ] In jeder Ansicht sind Karten dunkel, keine weißen Flächen
- [ ] Die Score-Felder sind hell mit dunkler Ziffer
- [ ] Jeder Text hat mindestens 4,5:1 Kontrast, besonders im Kopfbereich

**Allgemein**
- [ ] Kein waagerechtes Scrollen, die Seite lässt sich nicht seitlich schieben
- [ ] Bei 1920px füllt der Inhalt die Breite
- [ ] Die bestehenden Tests laufen weiter

---

## C — Vorgehen

1. Tokens einsetzen, Nachtmodus-Selektor gegen `main.css` prüfen
2. Match-Karte: CSS ersetzen, dann die drei Render-Funktionen
3. Screenshot bei 390 und 1920, mir vorlegen
4. Erst nach Abnahme: Tabelle
5. Commit nach jedem der drei Blöcke

**Nicht weiterbauen, wenn etwas nicht passt.** Melden, was abweicht, und nachfragen. Die Struktur in diesem Dokument ist gegen deinen tatsächlichen Code geschrieben — wenn sie nicht passt, liegt entweder ein Missverständnis vor oder der Code hat sich geändert. Beides klärt sich schneller durch eine Frage als durch eine Anpassung.
