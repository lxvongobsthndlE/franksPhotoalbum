# Handoff — Team-Rückzug vor Turnierstart

**Stand:** 2026-09-01, pausiert auf Zuruf (Internet weg).
**Worktree:** `C:/tmp/fpa-wt/rueckzug` · Branch `feat/tourney-rueckzug` (aus `feat/tourney-alpha`)
**Commit:** `56b2f4f` — Arbeitsbaum ist **sauber**, nichts gepusht, nichts gemergt.
**node_modules:** hängt als Junction am Haupt-Tree. Falls sie fehlt:
`New-Item -ItemType Junction -Path C:\tmp\fpa-wt\rueckzug\backend\node_modules -Target C:\Users\Rezo\Documents\franksPhotoalbum\backend\node_modules`

## Was der Auftrag war

Jonas, sinngemäß: 15 Teams, Gruppen stehen, eine Stunde vorher sagt ein Team ab.
Das Team soll **ganz verschwinden** — aus der Gruppe, aus dem Spielplan, aus allen
Zählern. Kein 3:0-Wertungsspiel, weil das die Punkte-pro-Spiel-Werte der
Beste-Dritte-Tabelle verzerrt. Der Spielplan soll nachrücken, „sodass alle Felder
zu jeder Zeit besetzt sind".

Zwei Abgrenzungen von ihm, beide bindend:
- **Nur vor dem Start.** Wer mitten im Turnier aussteigt, verliert 0:3 — das trägt
  er **von Hand** ein. Kein Knopf dafür.
- Gruppen werden **nicht** neu ausgelost. Aus der 4er wird eine 3er-Gruppe.

## Fertig und belegt

- **Route** `POST /:id/teams/:teamId/withdraw` (`routes.js:804 ff.`) — vier Gates,
  Transaktion, Neu-Packen über `generateSchedule`. Antwort wie `/reschedule` plus
  `withdrawn: { teamId, name, deletedMatches }`.
- **Gate 1b** (`withdraw_results_present`) — kam aus einem Befund während der Arbeit:
  `startedAt === null` beweist **nicht**, dass nichts gespielt wurde, denn
  `POST /:id/matches/:matchId/result` hat kein Start-Gate. Ohne die Prüfung hätte der
  Rückzug beendete Spiele still gelöscht. Dasselbe Gate deckt den K.-o.-Baum ab, weil
  `fill-ko` alle Gruppenspiele beendet verlangt.
- **`locks.js` unangetastet** — die vorhandene Team-Sperre ist genau die richtige Grenze.
- **Frontend:** Knopf im Teams-Tab, Rückfrage mit Anzahl der betroffenen Spiele,
  danach `loadActiveTournamentView(true)`. Sperrgrund steht **über** der Liste, vor dem Klick.
- **CSS:** fünfte Grid-Spalte über `.t-teams-list.has-withdraw` (die Zeile deklarierte
  nur vier; der Knopf wäre in eine ungeprüfte implizite Spalte gefallen).
- **Zähler:** nichts zu tun. Im `Tournament`-Modell steht **kein** gespeicherter Zähler,
  alles wird aus `teams.length` / `matches.length` gerechnet (`view.js:129`, `main.js:3396`).
- **Tests:** `npx vitest run` → **2143 grün** (vorher 2108), `npx eslint src` → sauber.
  Davon 15 Route-Tests, 7 Renderer-Tests, 13 Engine-Tests für schiefe Gruppen.
- **Belegt ohne Planer-Änderung:** die W0-Regel vom 28.08. packt 4/4/4/3, 4/4/3, 5/4
  und 3/3 bereits dicht — kein Feld bleibt frei, das H1 nicht blockiert.

## Screenshot-Verify — erledigt (Nachtrag 2026-09-01)

```
cd C:/tmp/fpa-wt/rueckzug/backend && node scripts/pruefstand-rueckzug-shot.mjs
```
Statik-Server + msedge über Playwright, misst 375/430/900 px in hell und dunkel.
Bilder: `C:/Users/Rezo/AppData/Local/Temp/screen-a-shots/rueckzug-*.png`.
**Stand: 6/6 Läufe sauber.** Die beiden offenen Punkte sind aufgelöst:

1. **Überbreite +6 px war der Messaufbau, kein Codefehler.** Sie traf 16 von 16
   Zeilen, davon nur 5 mit Knopf. Ursache: `.t-team-row` holt sich per
   `margin-inline: calc(-1 * var(--s5))` bewusst die volle Blattbreite
   (`tournament.css` ~7943, dort begründet). Der Prüfstand-Host gab 14 px statt
   20 — korrigiert.
2. **Mobile-Namensspalte gelöst.** Unter 430 px steht der Knopf jetzt unter dem
   Namen. Weil in `has-withdraw` ohnehin der Setzplatz weicht, hat der Name mit
   Knopf **265 px** — mehr als die 221 px im Kontrolllauf ohne ihn.
3. **Dritter Befund, den nur das Bild zeigte:** `.t-btn--ghost` ist rahmen- und
   flächenlos und erscheint erst im Hover — auf dem Handy las sich
   „ZURÜCKZIEHEN" als Abschnittsbeschriftung. Jetzt gefüllte Grundform.

## Fallen, die schon Zeit gekostet haben

- `npx prettier --check` meldet **jede** Datei, auch unberührte — `endOfLine: lf` gegen
  CRLF-Checkout. Kein Formatfehler in unserem Code. **Nicht** massenreformatieren.
- Playwright braucht `pathToFileURL`, sonst `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
- Der Prüfstand-Rahmen muss `outline` sein, nicht `border` — sonst misst er sich selbst mit.
- Beim `git add` aus `backend/` heraus: Pfade ohne `backend/`-Präfix, oder vorher in die
  Worktree-Wurzel wechseln.

## Bewusst nicht gebaut

- **Kein 0:3-Knopf** für den Rückzug mitten im Turnier (Entscheid Jonas: von Hand).
- **`ko_only` / `double_elim`** werden mit `withdraw_not_supported_for_mode` abgelehnt —
  dort sitzt das Team direkt im Baum, ein Freilos-Umbau ist eine eigene Etappe.
  **Offene Frage an Jonas:** als Backlog-Punkt festhalten oder nicht?
- Nebenbefund, nicht angefasst: `DELETE /:id/teams/:teamId` ruft `canEdit(t, 0, 'teams')`
  mit hartkodierter 0 statt echtem `finishedCount` (`routes.js:783`). Heute folgenlos,
  weil `canEdit` den Zähler bei `teams` nicht auswertet — der Aufruf behauptet aber
  etwas, das er nicht weiß.

## Bei Jonas liegt

- GO für Merge nach `main` (steht noch aus, Branch ist ungepusht).
- Die Entscheidung zum `ko_only`-Backlog-Punkt.
- Browser-Abnahme am echten Turnier, sobald der Screenshot-Verify durch ist.

## Nachtrag 2026-09-01 (zweite Session): der Knopf war nie erreichbar

Befund beim Review gegen echten Code: `window.tournamentLocks` wurde nur in
`backend/src/modules/tournament/locks.js` gesetzt — und `backend/src` wird nicht
ausgeliefert (Static-Root ist `backend/public`, `app.js:171`). Kein Script-Tag,
kein Import in `main.js` zeigte darauf. `teamsWithdrawOptions()` gab damit im
Browser IMMER „kein Knopf, kein Grund" zurück; genauso fiel der Einstellungen-Tab
auf seinen Fallback (`canRevert = { allowed: false }` → „Zurück zu Entwurf" nie
sichtbar). 2143 grüne Tests und 6/6 Screenshot-Läufe haben das nicht gesehen,
weil beide dem Renderer `canWithdraw: true` direkt gereicht haben — geprüft
wurde „malt er den Knopf richtig", nie „bekommt er das Ja jemals".

Fix (Commit auf diesem Branch):
- `locks.js` liegt jetzt in `backend/public/script/`; `src/modules/tournament/locks.js`
  ist ein Re-Export (eine Wahrheit, keine Kopie mit Paritätsversprechen).
- `main.js` importiert `./locks.js` als Seiteneffekt.
- Test `public/script/__tests__/locks-im-browser.test.js` prüft die KETTE
  (Import in main.js → window.tournamentLocks gesetzt → Rückzugs-Gate sagt Ja →
  Server-Pfad ist dieselbe Datei). Negativprobe gemacht: ohne den Import fällt er.
- 2146/2146 grün, eslint sauber.

Nicht gemacht: Browser-Abnahme am laufenden Server (kein DB/MinIO-Stack in dieser
Session). Der Beweis „Knopf steht im echten Teams-Tab" ist damit ein Modultest der
Kette, kein Screenshot der App.
