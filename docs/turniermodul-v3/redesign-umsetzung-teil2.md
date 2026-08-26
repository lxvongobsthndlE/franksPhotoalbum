# Redesign — Umsetzung Teil 2: Turnierkarte und Ergebnis-Dialog

> **Voraussetzung:** Teil 1 (Tokens, Match-Karte, Tabelle) ist abgenommen. Die Tokens `--board`, `--board-ink` und `--r-board` existieren.
>
> **Dieselben drei Regeln wie in Teil 1:** Klassennamen nicht umbenennen. Struktur nicht ergänzen und nicht kürzen. In der echten App prüfen.

---

## Der gemeinsame Befund

Beide Komponenten in diesem Teil nutzen **globale Klassen aus `main.css`** statt der scoped Klassen aus `tournament.css`:

| Komponente | nutzt heute | sollte nutzen |
|---|---|---|
| Turnierkarte | `.tournament-card`, `.tournament-status-badge` | `.t-list-card` und Geschwister |
| Ergebnis-Dialog | `.dlg-bg`, `.dlg`, `.btn-primary` | scoped Klassen mit Turnier-Tokens |

Bei der Turnierkarte ist das besonders ärgerlich: **`.t-list-card` existiert bereits vollständig** in `tournament.css` ab Zeile 735 — mit Logo, Name, Datum, Status-Badge, Kennzahlen und Fortschrittsbalken. Sie wird nur nicht verwendet.

Beim Dialog kommt hinzu, dass er per `document.body.appendChild()` außerhalb von `.t-mod` eingehängt wird. Die Turnier-Tokens erben dort nicht — deshalb wirkt er wie aus einer anderen App.

---

## A4 — Die Turnierkarte

### Was heute nicht stimmt

Der Turniername ist kleiner als die Phasen-Überschrift darüber. Der Status steht zweimal da — einmal als Abschnittsüberschrift, einmal als Badge. Die Kennzahlen brechen als Textblock um. Und es gibt einen „Öffnen"-Knopf, obwohl die ganze Karte anklickbar sein könnte.

### Die Zielstruktur

**Ersetze `main.js:2384-2395`** (den `return`-Block in der Phase-Grouping-Schleife) durch:

```js
const played = finishedCount ?? 0;
const total  = matchCount ?? 0;
const pct    = total > 0 ? Math.round((played / total) * 100) : 0;
const initial = (instance.name || 'T').trim().charAt(0).toUpperCase();

const logoHtml = instance.logoUrl
  ? `<span class="t-list-card-logo"><img src="${esc(instance.logoUrl)}" alt=""></span>`
  : `<span class="t-list-card-logo">${esc(initial)}</span>`;

const statusClass = {
  draft:       't-list-card-status--draft',
  generated:   't-list-card-status--ready',
  group_stage: 't-list-card-status--running',
  ko_stage:    't-list-card-status--running',
  finished:    't-list-card-status--finished',
}[instance.status] || 't-list-card-status--draft';

const dateStr = instance.startsAt
  ? new Date(instance.startsAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '';
const placeStr = instance.location || '';
const subLine = [dateStr, placeStr].filter(Boolean).join(' · ');

return `<article class="t-list-card" data-instance-id="${esc(instance.id)}" data-action="open-instance" tabindex="0" role="button">
  <div class="t-list-card-row">
    ${logoHtml}
    <div class="t-list-card-main">
      <h3 class="t-list-card-name">${esc(instance.name || 'Turnier')}</h3>
      ${subLine ? `<div class="t-list-card-date">${esc(subLine)}</div>` : ''}
    </div>
    <span class="t-list-card-status ${statusClass}">${esc(tournamentPhaseLabel(phase))}</span>
    ${canManageInstances ? `<button type="button" class="t-list-card-menu-btn" data-action="instance-menu" data-instance-id="${esc(instance.id)}" aria-label="Aktionen">⋯</button>` : ''}
  </div>
  <div class="t-list-card-info">${tournamentModeLabel(instance.mode)} · ${teamCount ?? '–'} Teams${groupCount ? ` · ${groupCount} Gruppen` : ''} · ${total} Spiele</div>
  ${total > 0 ? `<div class="t-list-card-progress">
    <div class="t-list-card-progress-bar"><span class="t-list-card-progress-fill" style="width:${pct}%"></span></div>
    <div class="t-list-card-progress-label">${played} von ${total} Spielen</div>
  </div>` : ''}
</article>`;
```

**Was sich ändert:**

- Kein „Öffnen"-Knopf mehr — die ganze Karte ist anklickbar. Der Klick-Handler muss auf `[data-action="open-instance"]` reagieren.
- Kein Löschen-Symbol direkt auf der Karte, sondern ein Kontextmenü. Das verhindert auch, dass man versehentlich löscht statt öffnet.
- Datum und Ort statt des wiederholten Status.
- Ein Fortschrittsbalken, sobald Spiele existieren.

**Wichtig:** Der Menü-Knopf darf den Karten-Klick nicht auslösen. Im Handler `event.stopPropagation()` aufrufen.

### Ergänzungen in `tournament.css`

Die meisten Klassen existieren schon. Es fehlen zwei:

```css
/* Der Textblock zwischen Logo und Status */
.t-list-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Die ganze Karte ist anklickbar */
.t-list-card[role="button"] { cursor: pointer; }
.t-list-card[role="button"]:hover { border-color: var(--accent); }
.t-list-card[role="button"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Und eine Korrektur an der bestehenden Regel — der Name soll das Größte auf der Karte sein:

```css
.t-list-card-name {
  font-size: 18px;   /* war 17 */
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### Leere Phasen

**In der Phase-Grouping-Schleife:** Phasen ohne Turniere werden nicht gerendert. Weder Überschrift noch „Keine Turniere in dieser Phase". Auf dem Handy scrollt man sonst an drei leeren Kästen vorbei.

Nur wenn **alle** Phasen leer sind, erscheint ein einzelner Leerzustand:

```js
if (instances.length === 0) {
  return `<div class="t-empty-state">
    <div class="t-empty-state-text">${canManageInstances ? 'Noch kein Turnier angelegt.' : 'In dieser Gruppe läuft gerade kein Turnier.'}</div>
    ${canManageInstances ? '<div class="t-empty-state-hint">Leg eins an, um loszulegen.</div>' : ''}
  </div>`;
}
```

---

## A5 — Der Ergebnis-Dialog

### Das Grundproblem

Der Dialog hängt an `document.body`, außerhalb von `.t-mod`. Die Turnier-Tokens erben dort nicht, deshalb sieht er aus wie aus einer anderen Anwendung — andere Farben, andere Radien, andere Knöpfe.

### Der Fix

**Zwei Möglichkeiten. Nimm die erste, sie ist sauberer:**

**Variante A — Tokens auf den Dialog vererben.** Gib dem äußeren Element zusätzlich die Klasse `t-mod`, dann greifen alle Tokens und scoped Regeln:

```js
dlg.className = 'dlg-bg t-mod t-dialog-host';
```

Dazu in `tournament.css`:

```css
/* Der Dialog liegt außerhalb des Moduls, braucht die Tokens aber.
   .t-mod bringt sie mit — die Layout-Eigenschaften von .t-mod
   (flex, container-type, width) werden hier zurückgesetzt. */
.t-dialog-host {
  container-type: normal;
  width: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Variante B** wäre, die Tokens im Dialog zu wiederholen. Das führt zu zwei Wahrheiten und wird auseinanderlaufen. Nicht nehmen.

### Die Zielstruktur

**Ersetze den `dlg.innerHTML`-Block in `main.js:4825-4872` durch:**

```js
dlg.innerHTML = `
  <div class="t-dialog" role="dialog" aria-modal="true" aria-labelledby="re-title">
    <div class="t-dialog-head">
      <h3 class="t-dialog-title" id="re-title">Ergebnis eintragen</h3>
      <button type="button" class="t-dialog-close" data-action="close" aria-label="Schließen">✕</button>
    </div>
    <form id="result-entry-form" class="t-dialog-body">
      ${initialMatch
        ? `<input type="hidden" id="re-match-id" value="${esc(initialMatch.id)}">`
        : (openSorted.length
            ? `<div class="t-field">
                 <label class="t-field-label" for="re-match-id">Welches Spiel?</label>
                 <select id="re-match-id" class="t-field-select" required>
                   <option value="">— offenes Spiel wählen —</option>
                   ${openSorted.map(({ id, m }) => `<option value="${esc(id)}">${esc(labelFor(m))}</option>`).join('')}
                 </select>
               </div>`
            : `<p class="t-hint">Keine offenen Spiele vorhanden.</p>`)}

      <div id="re-subline" class="t-dialog-subline" aria-live="polite"></div>

      <div class="t-score-entry">
        <div class="t-score-entry-row">
          <span class="t-score-entry-team">
            <i class="t-dot" id="re-home-dot"></i>
            <span class="name" id="re-home-name">–</span>
          </span>
          <input id="re-home" type="number" min="0" inputmode="numeric" required
                 class="t-score-entry-input" aria-label="Punkte Heimteam">
        </div>
        <div class="t-score-entry-row">
          <span class="t-score-entry-team">
            <i class="t-dot" id="re-away-dot"></i>
            <span class="name" id="re-away-name">–</span>
          </span>
          <input id="re-away" type="number" min="0" inputmode="numeric" required
                 class="t-score-entry-input" aria-label="Punkte Gastteam">
        </div>
      </div>
    </form>
    <div class="t-dialog-foot">
      <button type="button" class="t-btn" data-action="close">Abbrechen</button>
      <button type="submit" form="result-entry-form" class="t-btn t-btn--primary">Speichern</button>
    </div>
  </div>`;
```

**Vier Änderungen im Verhalten:**

- Die Eingabefelder starten **leer**, nicht mit `0`. Sonst muss man die Null erst wegtippen — und ein versehentlich gespeichertes 0:0 ist ärgerlich.
- Beim Öffnen liegt der Fokus im ersten Feld.
- Enter im zweiten Feld speichert.
- Die Knöpfe stehen in einem eigenen Fußbereich, nicht im Formular. Das trennt Eingabe und Aktion optisch.

### CSS

**Neu in `tournament.css`, am Ende:**

```css
/* ----------------------------------------------------------------
   DIALOG
   ----------------------------------------------------------------
   Liegt außerhalb von .t-mod, bekommt die Tokens über die zusätzliche
   Klasse t-mod am Host-Element (siehe .t-dialog-host).
   ---------------------------------------------------------------- */
.t-dialog {
  background: var(--surface);
  border-radius: var(--r-card);
  width: 100%;
  max-width: 420px;
  box-shadow: 0 12px 40px rgba(31, 27, 22, 0.22);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.t-dialog-head {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s4);
  border-bottom: 1px solid var(--line);
}
.t-dialog-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  flex: 1;
}
.t-dialog-close {
  width: 32px; height: 32px;
  border-radius: var(--r-btn);
  color: var(--ink-soft);
  display: grid; place-items: center;
  font-size: 16px;
  flex: none;
}
.t-dialog-close:hover { background: var(--surface-alt); color: var(--ink); }

.t-dialog-body {
  padding: var(--s4);
  overflow-y: auto;
  flex: 1;
}

.t-dialog-foot {
  display: flex;
  gap: var(--s2);
  justify-content: flex-end;
  padding: var(--s4);
  border-top: 1px solid var(--line);
}

/* Die graue Zeile mit Runde, Zeit und Platte */
.t-dialog-subline {
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: var(--s4);
  letter-spacing: 0.04em;
}
.t-dialog-subline:empty { display: none; }

/* Auswahlfeld, wenn kein Spiel vorgegeben ist */
.t-field { margin-bottom: var(--s4); }
.t-field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-soft);
  margin-bottom: var(--s2);
}
.t-field-select {
  width: 100%;
  padding: 10px var(--s3);
  border: 1px solid var(--line);
  border-radius: var(--r-btn);
  background: var(--surface);
  color: var(--ink);
  font-size: 14px;
}

/* ---- Die Eingabezeilen ----
   Teamname links, Eingabefeld rechts — in einer Zeile, damit klar ist,
   welche Zahl zu wem gehört. Die Felder greifen die Anzeigetafel-Optik
   auf: dunkel im Ruhezustand ist zu viel, aber der Radius und die
   Ziffernbehandlung sind dieselben. */
.t-score-entry {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}
.t-score-entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px;
  gap: var(--s3);
  align-items: center;
}
.t-score-entry-team {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--ink);
}
.t-score-entry-team .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-score-entry-input {
  width: 100%;
  height: 48px;
  border: 1px solid var(--line);
  border-radius: var(--r-board);
  background: var(--surface-alt);
  color: var(--ink);
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
  padding: 0;
}
.t-score-entry-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface);
}
/* Die Pfeilchen der Zahlenfelder stören hier nur */
.t-score-entry-input::-webkit-outer-spin-button,
.t-score-entry-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.t-score-entry-input { -moz-appearance: textfield; }

/* ---- Auf dem Handy fährt der Dialog von unten ein ---- */
@media (max-width: 599px) {
  .t-dialog-host { align-items: flex-end; }
  .t-dialog {
    max-width: none;
    border-radius: var(--r-card) var(--r-card) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation: t-dialog-up 0.2s ease;
  }
  .t-score-entry-row { grid-template-columns: minmax(0, 1fr) 96px; }
  .t-score-entry-input { height: 56px; font-size: 26px; }
}
@keyframes t-dialog-up {
  from { transform: translateY(24px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .t-dialog { animation: none; }
}
```

---

## Prüfliste

**Turnierkarte**
- [ ] Der Turniername ist das Größte auf der Karte
- [ ] Der Status steht genau einmal, als Badge
- [ ] Die Kennzahlen stehen in einer Zeile, ohne Umbruch
- [ ] Ein Fortschrittsbalken erscheint, sobald Spiele existieren
- [ ] Die ganze Karte reagiert auf Klick und auf Enter bei Tastaturfokus
- [ ] Der Menü-Knopf löst den Karten-Klick nicht mit aus
- [ ] Leere Phasen erscheinen gar nicht
- [ ] Mitglieder sehen keinen Menü-Knopf

**Dialog**
- [ ] Er sieht aus wie der Rest des Moduls — Farben, Radien, Knöpfe
- [ ] Das Spiel steht genau einmal da, als graue Zeile
- [ ] Teamname und Eingabefeld stehen in einer Zeile
- [ ] Die Felder sind leer, nicht mit 0 vorbelegt
- [ ] Der Fokus liegt beim Öffnen im ersten Feld
- [ ] Enter speichert
- [ ] Auf dem Handy fährt er von unten ein und nimmt die volle Breite
- [ ] Im Nachtmodus stimmen alle Farben

**Beides**
- [ ] Bei 360, 390, 430, 768, 1280 und 1920 kein Überlauf
- [ ] Die bestehenden Tests laufen weiter

---

## Reihenfolge

1. Turnierkarte — CSS-Ergänzungen, dann der Renderer, dann die leeren Phasen
2. Commit, Screenshot bei 390 und 1920, vorlegen
3. Dialog — erst der Token-Fix über `.t-dialog-host`, dann Struktur und CSS
4. Commit, Screenshot, vorlegen

**Nicht beides in einem Zug.** Wenn danach etwas nicht stimmt, soll klar sein, woran es lag.
