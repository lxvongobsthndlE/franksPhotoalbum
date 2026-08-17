# Etappe B — Spielplan-Tab auf Prototyp-Basis

> Vorbereitung: 3 Explore-Karten (Detail+API, DTO+Spec, Prototyp-Layout) sind durch.
> Vorlage: `C:/Users/Rezo/Downloads/files/turniermodul-prototyp.html` (Zeilen 434–467 HTML, 893–947 JS, 127–143 CSS).
> **Scope dieser Etappe: nur App-Shell + Spielplan (C2).** Übersicht, Gruppen, Baum, Teams, Drucken, Einstellungen bleiben für B.2–B.5.

---

## 0. Vorbedingung — Vier Inkonsistenzen fixen

Die Bestandsaufnahme hat vier Frontend-Bugs aufgedeckt, die das Bauen auf der alten Logik sofort unmöglich machen:

| # | Datei : Zeile | Bug | Fix |
|---|---|---|---|
| 1 | `main.js:2701, 2719, 2722` | `m.status === 'completed'` matched nie, weil Backend `'finished'` liefert | ersetzen durch `m.isFinished` (Boolean aus DTO) bzw. `m.status === 'finished'` |
| 2 | `main.js:2971` | `result.cascadeAffected?.length` zeigt immer 0, weil Backend `propagated` liefert | ersetzen durch `result.propagated?.length` |
| 3 | `main.js:2572, 2645, 2678` | `.t-tab.is-active` wird getoggelt, CSS hat nur `.t-tab.active` | wird mit App-Shell ohnehin obsolet — siehe Schritt 5 |
| 4 | `routes.js` | 4 Endpunkte fehlen (`GET/PATCH /matches/:matchId`, `PATCH /matches/:matchId/schedule`, `POST /matches/:matchId/photo-upload`) | **Bewertung pro Stück** (unten) |

**Bewertung Endpunkt-Lücken für den Spielplan-Tab:**

- `GET/PATCH /matches/:matchId` (für Notizen/Metadata/Audit) — **OUT OF SCOPE** für Spielplan-Tab → Liste (später)
- `PATCH /matches/:matchId/schedule` (für Zeitplan-DnD) — **OUT OF SCOPE** für Spielplan-Tab → Liste (Etappe C/D)
- `POST /matches/:matchId/photo-upload` — **OUT OF SCOPE** → Liste

**Für den Spielplan-Tab brauchen wir nur `POST /matches/:matchId/result` (existiert, routes.js:724).**

### Schritt 0 — Bugfix 1+2 als eigener Commit

**Datei:** `backend/public/script/main.js`
**Zeilen:** 2701, 2719, 2722, 2971

```
m.status === 'completed'   →  m.isFinished
result.cascadeAffected     →  result.propagated
```

**Verifikation:** manueller Browser-Test — Bracket-Tab zeigt beendete Spiele, Ergebnis-Dialog zeigt "X Folgespiele aktualisiert" bei KO-Sieg.

---

## 1. Reihenfolge der Arbeitsschritte

| # | Schritt | Lieferung | Verifikation |
|---|---|---|---|
| 0 | Bugfix 1+2 (completed/propagated) | kleiner Commit | Browser-Test: Bracket zeigt fertige Spiele, Toast zeigt Aufstieg |
| 1 | CSS aufräumen (tote Klassen raus) | `main.css` schlanker, eine Quelle der Wahrheit | `git grep -nE "\\.(t-schedule-grid-2|t-bracket-toolbar|t-bracket-grid)" main.css` = 0 |
| 2 | Renderer-Skeleton schreiben (App-Shell mit nur Spielplan-Inhalt) | `renderTournamentInstanceDetailV3` neu, ~250 Zeilen, eine Datei | Render im Browser zeigt `.t-mod` mit Header + Nav + Spielplan-View |
| 3 | Spielplan-Tab: Filter-Chips + Match-Liste + Aside | `renderSchedule()`, `renderAside()`, `bindSpielplanFilters()` | 12 Spiele sichtbar, Filter-Chips funktionieren, Aside zeigt "Als Nächstes" + "Plattenbelegung" |
| 4 | Ergebnis-Dialog (mit Match-Auswahl statt ID-Input) | `openResultEntryModal(tournamentId, presetMatchId=null)` | Modal öffnet, Match-Dropdown statt manueller ID-Eingabe, POST funktioniert |
| 5 | Navigation: Zurück zur Liste + Tab-Wechsel | `switchToTournamentInstances()`, `bindNavTabs()`, History-URL | Tab-Klick wechselt View, Browser-Back führt zur Turnierliste |
| 6 | Tests | `spielplan-render.test.js`, `spielplan-filter.test.js`, `spielplan-match-mapping.test.js` | vitest grün |
| 7 | Browser-Test 1920 + 390 | manuelle Abnahme | User nimmt ab |

**Andere Views (Übersicht, Gruppen, Baum, Teams, Drucken, Einstellungen)** bekommen leere Platzhalter-Container mit Hinweistext "kommt in B.2/B.3/…" — damit die App-Shell vollständig steht und nicht bei jedem View-Refactor umgebaut werden muss.

---

## 2. Welche Dateien angefasst werden

| Datei | Zeilen / Bereich | Aktion |
|---|---|---|
| `backend/public/script/main.js` | 107–110 (Globaler State), 2443–2607 (Renderer), 2612–3109 (Sub-Renderer/Modals), 3922–2978 (Bugfix 1+2) | Renderer **komplett ersetzen**, Sub-Renderer wo nötig anpassen, globale State-Variablen für neue Shell anlegen |
| `backend/public/style/main.css` | 5639–5734 (`.tournament-detail-tabs`, `.t-tab*`), 6140–6360 (alter Wizard-Baum), 6689–6970 (zwei `.t-schedule-grid`-Versionen), 7090–7128 (Print-Stylesheet) | **entfernen** — werden durch `.t-mod*` aus `tournament.css` ersetzt |
| `backend/public/style/main.css` | 5520–5635 (`.tournament-detail-dlg*`) | **behalten** — Modal-Styles für Ergebnis-Eingabe |
| `backend/public/style/tournament.css` | 1–86 (Tokens), 129–268 (`.t-mod*` Shell), 332–339 (`.t-badge`), 608–720 (`.t-match`) | **unverändert lassen** — bereits Prototyp-konform, wird jetzt genutzt |
| `backend/public/script/__tests__/` | neue Dateien | **neu**: `spielplan-render.test.js`, `spielplan-filter.test.js`, `spielplan-match-mapping.test.js` |

**Nicht angefasst:**
- Backend (`routes.js`, `view.js`, `access/match.js`, `schema.prisma`) — DTO ist bereits vollständig
- `tournament.css` — die Prototyp-Klassen liegen dort bereits
- Wizard-Tests — Etappe A ist abgeschlossen

---

## 3. Was ersetzt wird, was behalten wird

### Ersetzt

| Alt | Neu | Warum |
|---|---|---|
| `renderTournamentInstanceDetailV3` mit Tab-Leiste + Emoji-Buttons | `renderTournamentInstanceDetailV3` mit `.t-mod`-Shell + `.t-mod-nav`-Buttons | Prototyp-Vorgabe §8.0, Spec §8.7 |
| 6 Tabs (overview/teams/groups/bracket/matches/rules) als `<button class="t-tab">` | 7 Views (uebersicht/spielplan/gruppen/baum/teams/drucken/einstellungen) als `<section class="view">`, Nav mit `<button data-view="…">` | Prototyp-Layout, semantisch korrekter |
| Inline-Buttons mit Emoji (📝, ⚽) + onClick-String | SVG-Icons (oder keine) + Event-Delegation auf Container | §8.0 keine Emojis, sauberere Bindings |
| `loadScheduleTab` (lazy via Tab-Click) | `renderSchedule()` direkt im View-Container, einmaliger Initial-Render | Spielplan ist Default-View, kein Lazy nötig |
| `loadStandingsTab` / `loadBracketTab` etc. | Platzhalter-Container mit Hinweistext "kommt in B.2/B.3" | Etappen-Scope |
| Ergebnis-Modal mit manueller Match-ID-Eingabe (Zeile 2541, 2922) | Modal mit Match-Dropdown (oder Direkt-Aufruf mit preset) | UX-Fix, kein ID-Raten mehr |
| `result.cascadeAffected` | `result.propagated` | Bugfix 2 |
| `m.status === 'completed'` | `m.isFinished` (Boolean aus DTO) | Bugfix 1 |
| `.tournament-detail-tabs` + `.t-tab*` CSS | `.t-mod-nav` + `.mod-nav button` aus tournament.css | eine Quelle, Konsistenz mit Prototyp |

### Behalten

- **`.t-mod`-Tokens** in `tournament.css:1–86` (Farben, Radien, Spacing) — Prototyp nutzt exakt diese
- **`.t-shell`-Grid** in `tournament.css:144–149` (3 Spalten 212px/minmax(0,1fr)/300px)
- **`.t-mod-nav` / `.t-mod-main` / `.t-mod-aside`** in `tournament.css:129–268`
- **`.t-match` Match-Komponente** in `tournament.css:608–720` (3 Größen compact/normal/large) — wird Hauptkandidat für §13.11 "eine Komponente, drei Varianten"
- **`.t-badge`, `.t-badge--phase`** in `tournament.css:332–339` für Status-Badges im Header
- **`.tournament-detail-dlg*`** in `main.css:5520–5635` — Modal-Look für Ergebnis-Eingabe
- **Match-DTO** aus `access/match.js:133–244` — alle Felder vorhanden, kein Backend-Refactor nötig
- **Existierende Helper**: `formatPlaceholder`, `tournamentStatusLabel`, `tournamentStatusPhase`, `tournamentPhaseLabel`, `tournamentModeLabel`, `closeTournamentDetailModalById`
- **Auth-Header** (Etappe A.5) zentral — bleibt

### Entfernt (toter Code)

| CSS-Klasse | Wo | Begründung |
|---|---|---|
| `.t-bracket-toolbar`, `.t-bracket-tabs`, `.t-bracket-tab` | `main.css:6140–6172` | alter Wizard-Baum, wird nicht mehr gerendert |
| `.t-bracket-grid`, `.t-bracket-matches`, `.t-bracket-team` | `main.css:6204–6360` | dito |
| `.t-schedule-grid` (zweite Version) | `main.css:6932–6970` | Duplikat, erste Version reicht — wird aber auch ersetzt |
| `.tournament-detail-tabs`, `.t-tab`, `.t-tab.active` | `main.css:5639–5734` | ersetzt durch `.t-mod-nav` |
| `.tournament-detail-tab-body` | `main.css:7101` | ersetzt durch `.view` + `.view.is-active` |
| Print-Stylesheet Detail-View | `main.css:7090–7128` | kommt in B.5 mit neuem Renderer wieder |

---

## 4. Renderer-Skeleton (DOM-Struktur)

```html
<div class="t-mod" id="tournament-detail">
  <header class="t-mod-header">
    <img class="t-logo" src="${tournament.logoUrl || ''}">
    <div class="t-mod-header-text">
      <h1 class="t-title">${tournament.name}</h1>
      <div class="t-sub">${tournamentModeLabel(tournament.mode)} · ${teamCount} Teams</div>
    </div>
    <span class="t-badge t-badge--phase">${tournamentPhaseLabel(tournament.phase)}</span>
    <div class="t-mod-header-actions">
      <button class="t-btn t-btn--ghost" data-action="back">Zurück zur Liste</button>
      ${tournament.isPublic ? '<span class="t-badge">Öffentlich</span>' : ''}
      <button class="t-btn t-btn--ghost" data-action="print">Drucken</button>
    </div>
  </header>
  <div class="t-mod-body">
    <nav class="t-mod-nav" id="t-nav">
      <button data-view="spielplan" class="is-active">Spielplan <span class="count" id="cnt-matches">0</span></button>
      <button data-view="uebersicht">Übersicht</button>
      <button data-view="gruppen">Gruppen</button>
      <button data-view="baum">Turnierbaum</button>
      <button data-view="teams">Teams</button>
      <button data-view="drucken">Drucken</button>
      <button data-view="einstellungen">Einstellungen</button>
    </nav>
    <main class="t-mod-main">
      <!-- Spielplan (Default, aktiv) -->
      <section class="view is-active" data-view="spielplan">
        <div class="view-head">
          <div class="view-title">Spielplan</div>
          <div class="spacer"></div>
          ${tournament.isAdmin ? '<button class="t-btn t-btn--primary" data-action="enter-result">Ergebnis eintragen</button>' : ''}
        </div>
        <div class="t-toolbar" id="t-filters"><!-- dynamisch generiert --></div>
        <div class="t-card"><div class="t-card-body" id="t-schedule-list"><!-- Match-Karten --></div></div>
      </section>
      <!-- Andere Views als Platzhalter -->
      <section class="view" data-view="uebersicht">
        <div class="view-head"><div class="view-title">Übersicht</div></div>
        <div class="t-card"><div class="t-card-body t-hint">Übersicht kommt in Etappe B.2.</div></div>
      </section>
      <section class="view" data-view="gruppen"><!-- placeholder --></section>
      <section class="view" data-view="baum"><!-- placeholder --></section>
      <section class="view" data-view="teams"><!-- placeholder --></section>
      <section class="view" data-view="drucken"><!-- placeholder --></section>
      <section class="view" data-view="einstellungen"><!-- placeholder --></section>
    </main>
    <aside class="t-mod-aside">
      <div class="t-aside-block">
        <div class="t-section-label">Als Nächstes</div>
        <div id="t-aside-next"></div>
      </div>
      <div class="t-aside-block">
        <div class="t-section-label">Plattenbelegung</div>
        <div id="t-aside-tables"></div>
      </div>
      <div class="t-aside-block">
        <div class="t-section-label">Ablauf</div>
        <div class="t-hint" id="t-aside-schedule">${staticAblaufText(matches)}</div>
      </div>
    </aside>
  </div>
</div>
```

**Filter-Chips dynamisch aus DTO** (nicht hardcoded 11):
- Immer: `alle`, `offen`, `beendet`
- Pro vorhandene Stage-Type: `Gruppenphase`, `K.O.` (nur wenn KO-Matches vorhanden)
- Pro Spieltag (groupStage orderIndex): `1. Spieltag`, `2. Spieltag`, …
- Pro Gruppe: `Gruppe ${groupKey}`

---

## 5. Daten-Mapping DTO → Anzeige

| Anzeige | DTO-Feld | Fallback |
|---|---|---|
| Heim-Name | `home.name` (wenn `kind==='team'`) | `home.winnerLabel` (wenn placeholder) |
| Auswärts-Name | `away.name` | `away.winnerLabel` |
| Heim-Farbpunkt | `home.color` | `var(--ink-soft)` |
| Auswärts-Farbpunkt | `away.color` | `var(--ink-soft)` |
| Heim-Score | `scoreHome` | `null` → rendert `–` mit `.is-empty` |
| Auswärts-Score | `scoreAway` | dito |
| Sieger-Klasse Heim | `isFinished && scoreHome > scoreAway` | KO: auch `winnerTeamId === home.teamId` |
| Sieger-Klasse Auswärts | `isFinished && scoreAway > scoreHome` | KO: auch `winnerTeamId === away.teamId` |
| Status (offen/beendet) | `isFinished` (Boolean) | `isLive` für "läuft gerade" (selten) |
| Match-Bar-Farbe | `isFinished` → `var(--qualified)` | `isLive` → `var(--live)` |
| Zeit | `scheduledTime` (z.B. "14:20") | `–` |
| Tisch | `field` (Integer) | `Platte ${field}` |
| Phase-Filter | `stageType === 'group'` → `Gruppenphase` | `stageType === 'ko'` → `K.O.` |
| Spieltag-Filter | `stage.orderIndex` für Gruppenphasen-Matches | leer wenn `orderIndex` null |
| Gruppen-Filter | `groupKey` | leer wenn `groupId == null` |
| Sub-Anzeige (Member) | `${groupKey ? 'Gruppe ' + groupKey : ''} · ${stageName}` | leer wenn beides null |
| Runde-Anzeige (KO) | `roundLabel` ("Viertelfinale", "Halbfinale", " Finale") | leer |
| Match-ID für Modal | `id` | — |
| Admin-Status | `tournament.isAdmin` (vom Backend) | `false` |

---

## 6. Ergebnis-Modal — Verhalten

**Aufruf 1**: Header-Button "Ergebnis eintragen" (nur sichtbar wenn `tournament.isAdmin`):
```
openResultEntryModal(tournamentId)
→ Modal mit Match-Dropdown (alle offenen Matches, sortiert nach scheduledAt)
→ Score-Inputs (Heim/Auswärts, min 0, Integer)
→ "Eintragen"-Button → POST /matches/:matchId/result
→ Toast: "Ergebnis eingetragen." + "X Folgespiele aktualisiert." wenn result.propagated.length > 0
→ await openTournamentInstance(tournamentId) für Full-Rerender
```

**Aufruf 2**: Per-Match-Button in der Match-Karte:
```
openResultEntryModal(tournamentId, match.id)
→ Modal mit Match-Dropdown vorausgewählt
→ Rest wie Aufruf 1
```

**Was verschwindet:** das `#re-match-id` Input-Feld (User musste manuell eine Match-ID eintippen — Bug).

---

## 7. Navigation & History

- Tab-Klick in `.t-mod-nav`: Event-Delegation auf Container, setzt `.is-active` am Button, `.is-active` an der zugehörigen `<section class="view">`, scrollt `.t-mod-main` nach oben
- Header-Button "Zurück zur Liste": ruft `switchToTournamentInstances()` (existiert bereits in main.js:1708)
- Browser-Back: `history.pushState` bei `openTournamentInstance`, `popstate`-Listener ruft `switchToTournamentInstances()` auf — wird mit Schritt 5 nachgerüstet, ist im Scope dieser Etappe

---

## 8. Test-Strategie

### Neue Tests (in `backend/public/script/__tests__/`)

| Datei | Testet | Anzahl |
|---|---|---|
| `spielplan-render.test.js` | Renderer emittiert `.t-mod`-Shell mit Header + Nav + Main + Aside + 7 View-Sections | 3 |
| `spielplan-filter.test.js` | Filter-Chip-Klick wechselt aktiven Filter, rendert gefilterte Liste | 4 |
| `spielplan-match-mapping.test.js` | DTO → Anzeige: Heim/Auswärts, Sieger-Klasse, leere Score-Anzeige, Phase-Filter | 6 |
| `spielplan-admin-gating.test.js` | Ergebnis-Button nur für Admin, Match-Action-Button nur für Admin, Aside-Score sichtbar für alle | 3 |

**Gesamt: ~16 Tests** als Regression gegen die 4 Bugfixes + Renderer-Struktur.

### Bestehende Tests (unverändert)

- `wizard-round-trip.test.js`, `wizard-progress-clickable.test.js`, `wizard-ui-language.test.js` — Wizard ist abgeschlossen, wird nicht angefasst

### Manuelle Browser-Abnahme (User macht das selbst nach Schritt 7)

1. **1920px Breite**: 12 Spiele sichtbar, Aside "Als Nächstes" zeigt 4 nächste offene, Filter-Chips horizontal, Match-Karten-Vollansicht, kein Rand > 5%
2. **390px Breite**: Match-Karten werden zu Mobile-Grid (3 Spalten → Kartenlayout), Aside ist versteckt, Filter-Chips wrappen
3. **Filter**: Klick auf "Nur offene" reduziert von 12 auf X offene, Klick auf "Gruppenphase" zeigt nur Gruppenphase-Matches, Klick auf "Gruppe A" zeigt nur A-Matches
4. **Ergebnis eintragen**: Klick auf Header-Button → Modal öffnet → Match-Dropdown → Score → Eintragen → Toast mit "X Folgespiele aktualisiert" wenn KO-Spiel
5. **Bracket-Verhalten** (Bonus-Check wegen Bugfix 1): Bracket-Tab eines beendeten KO-Turniers zeigt jetzt Matches mit `.is-winner`-Klasse (vorher waren 0 sichtbar)

---

## 9. Was NICHT in dieser Etappe ist

| Feature | Begründung | Wann |
|---|---|---|
| Notizen am Match | Backend-Endpoint fehlt, nicht für Spielplan-Tab nötig | Liste für später |
| Foto-Upload am Match | dito | Liste für später |
| Audit-Log | dito | Liste für später |
| Drag&Drop im Zeitplan-Tab | Backend-Endpoint fehlt, eigener Tab | Etappe C/D |
| Weitere Views (Übersicht, Gruppen, Baum, Teams, Drucken, Einstellungen) | Etappen-Scope | Etappe B.2–B.5 |
| Beamer-View (`/tournament/:id/beamer`) | eigener Scope | Etappe B.6 |
| PDF-Export | eigener Scope | Etappe D |
| Public-Token-UI (Publish/Unpublish) | bleibt im alten Renderer, bis eigene Etappe | Etappe B.6 |

---

## 10. Abnahme-Kriterien (User nimmt selbst ab)

Nach Schritt 7 prüft der User:
- [ ] 12 Spiele sichtbar im Spielplan-Tab
- [ ] Ergebnis eintragen funktioniert (Modal + Toast)
- [ ] Filter verändern die Liste (alle 4+ Filter-Typen mindestens einmal geprüft)
- [ ] Bei 1920 Breite: kein Rand > 5%, Aside sichtbar, Match-Karten-Vollansicht
- [ ] Bei 390px: Kartenliste statt Tabelle, Aside versteckt, Filter wrappen
- [ ] Bugfix 1 verifiziert: Bracket-Tab zeigt jetzt beendete Spiele (vorher waren es 0)
- [ ] Bugfix 2 verifiziert: Toast bei KO-Sieg zeigt "X Folgespiele aktualisiert" (vorher "null Folgespiele")
- [ ] vitest grün (alle Tests, inkl. der 16 neuen)

---

## Kritische Dateien (kompakt)

| Datei | Eingriff |
|---|---|
| `backend/public/script/main.js` | 107–110 (State), 2443–2607 (Renderer komplett neu), 2701/2719/2722 (Bugfix 1), 2922–2978 (Modal neu), 2971 (Bugfix 2) |
| `backend/public/style/main.css` | 5639–5734 entfernen, 6140–6360 entfernen, 6689–6970 aufräumen, 7090–7128 entfernen (Print kommt in B.5 wieder) |
| `backend/public/style/tournament.css` | unverändert (Tokens + Shell + Match-Komponente liegen fertig da) |
| `backend/public/script/__tests__/spielplan-*.test.js` | 4 neue Test-Dateien, ~16 Tests |

**Wiederverwendet ohne Anfassen:**
- `tournament.css:1–86` Tokens, `:129–268` Shell, `:608–720` Match-Komponente
- `access/match.js:133–244` Match-DTO (alle Felder vorhanden)
- `routes.js:114` Detail-Endpoint, `:682` Schedule-Endpoint, `:724` Result-Endpoint
- `tournament-team-helpers.js` (Label-Helper)
