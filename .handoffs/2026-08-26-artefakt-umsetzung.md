# Turniermodul: das Artefakt „ohne Kästchen" umsetzen

Stand 2026-08-26, abends. Der erste Anlauf lief als Hintergrund-Agent und ist
nach rund zehn Minuten ohne Fortschritt abgebrochen — mitten in der Arbeit an
der Spielkarte. Sein Stand ist gesichert, nichts ist verloren.

---

## 1. Der Auftrag in einem Satz

Setze das abgenommene Design-Artefakt im echten Code um — **mit einer
ausdrücklichen Ausnahme**: die Spielkarten im Spielplan bekommen die **harte**
Fassung (Fassung 1 aus Abschnitt „03 b"), genau so, wie sie dort gezeichnet ist.

## 2. Die Vorlage

**https://claude.ai/code/artifact/4ff98024-f66d-4444-b600-3a06de4e8af1**
— „Turniermodul ohne Kästchen"

Lies es zuerst VOLLSTÄNDIG mit dem Artifact-Werkzeug (`action: "read"`), jede
Zeile der Datei, die der Lesevorgang lokal ablegt. Es ist die Abnahme-Vorlage;
im Zweifel gewinnt sie gegen jedes Planungsdokument.

Jonas' Urteil dazu, wörtlich: „das sieht gut aus" — mit der einen Ausnahme oben:

> „nimm bei den spielen im spielplan fassung 1 (hart) aber genauso wie sie dort
> eben angezeigt wird."

Das Artefakt zeigt in Abschnitt „03 b" dieselbe Spielpaarung dreimal
nebeneinander: **hart** / aufgelöst / weich. Für den Spielplan gilt die harte.
Alles andere gilt wie abgebildet.

### Was das Artefakt an Werten mitbringt
- Blatt `#F1F0EB` auf Grund `#D7D6D0` (Kontrast 1,276 : 1, ΔL\* 9,19 — im
  Artefakt nachgerechnet, nicht geschätzt)
- Spielkarte `#FAF9F6`, ΔL\* 3,18 über dem Blatt
- Linien `--line` `#C6C5BE`, `--line-soft` `#DAD9D3`
- Zwei eigene Textfarben fürs Dokument (`--doc-muted`, `--doc-flare`) — die
  gehören zur Erklärseite, NICHT ins Produkt
- Turnierlogo: 44 px im Modulkopf links, **ohne Logo kein Platzhalter**;
  54 px auf allen drei Druckbögen, dort in Graustufen gezeigt

---

## 3. Wo der Vorgänger stehengeblieben ist

**Zweig `wip/artefakt-umsetzung`, Commit `d0f64ce`.**

Sein letzter Satz war „Now the rows padding and the action half." — er war also
bei den Listenzeilen und der Aktionsseite. 330 Zeilen über drei Dateien:

```
backend/public/script/spielplan-helpers.js    81 Zeilen
backend/public/style/tokens.css              130 Zeilen
backend/public/style/tournament.css          124 Zeilen
```

**Der Stand ist NICHT fertig und NICHT grün:** zwei Tests sind rot
(`renderMatchCard` in `spielplan-render.test.js` und `spielplan-edit-render.test.js`),
weil das Karten-Markup mitten in der Änderung steht.

### Wie du damit umgehst
Du hast zwei Möglichkeiten, und beide sind vertretbar:

1. **Darauf aufsetzen:** `git cherry-pick d0f64ce` auf `fix/tourney-marke`,
   dann die zwei roten Tests reparieren und weiterbauen. Spart die 330 Zeilen,
   verlangt aber, dass du seinen halben Gedanken zu Ende denkst.
2. **Neu anfangen und ihn als Steinbruch nehmen:** `git show d0f64ce` lesen,
   die guten Teile übernehmen. Sauberer, wenn du die Vorlage anders liest als er.

Entscheide das nach dem Lesen des Artefakts, nicht davor.

---

## 4. Arbeitsort und harte Regeln

- **`C:/Users/Rezo/Documents/fpa-css`, Branch `fix/tourney-marke`.**
  Bestehender Worktree — **keinen neuen anlegen**.
- **`npm install` / `npm ci` / `prisma generate` hier NIEMALS.** `node_modules`
  ist eine Verzeichnis-Junction auf den Haupt-Tree; ein Install zerlegt beide.
- Tests: `cd backend && npx vitest run`.
  **Basis sind 1702 grüne Tests, 5 übersprungen.** Diese Zahl darf nicht sinken.
- **Kein `git push`.** Das ist Jonas' Gate.
- Merge nach `main` ist erlaubt, damit er es auf localhost sieht — aber nur mit
  grünen Tests. `main` und `feat/tourney-alpha` (der Haupt-Tree, der den Server
  auf Port 3000 ausliefert) werden per `--ff-only` nachgezogen.

### Nicht anfassen
- **`backend/src/**` und `backend/prisma/**`.** Dort liegt frische, kritische
  Arbeit an der Gruppen-/K.-o.-Logik (siehe Abschnitt 7). Das ist Rechenlogik
  und gehört nicht in eine Design-Etappe.
- Die restliche App umfärben. Es gilt „nur das Turniermodul" — außer du musst
  App-Farben anfassen, damit das Modul stimmt; das hat Jonas ausdrücklich
  erlaubt und es ist an mehreren Stellen schon so gemacht.

---

## 5. Fallen, die in diesem Repo Zeit gekostet haben

Jede einzelne davon ist hier schon eingetreten.

1. **`main.css` und `tournament.css` führen dieselben Klassen.**
   `@media`/`@container` heben die Spezifität NICHT an. Bei Gleichstand gewinnt
   die später geladene Datei — und bei Gleichstand innerhalb einer Datei die
   spätere Zeile. **Acht** solcher Kollisionen sind dokumentiert; zwei davon
   habe ich heute selbst gebaut. Prüfe mit `getComputedStyle()` im Browser,
   nicht durch Quelltextlesen.

2. **Eine undefinierte Custom Property löscht die ganze Deklaration still.**
   Wer einen neuen Token benutzt, trägt ihn in `tokens.css` ein — und zwar
   **dreimal**: im Hell-Block und in BEIDEN Dunkel-Blöcken
   (`prefers-color-scheme` und `[data-theme]`). Die Datei warnt an der Stelle
   selbst davor, weil genau das heute passiert ist: der Rahmen um das Modul
   blieb im Nachtmodus hellgrau.

3. **Drei Themen-Zustände, nicht zwei:** ausdrücklich hell, ausdrücklich dunkel,
   und **gar kein `data-theme`-Attribut** — das ist der Normalfall auf den
   Zuschauerseiten, wo kein `main.js` läuft.

4. **Keine zweite Struktur für dieselbe Sache.** Existiert eine Klasse, benutze
   sie. Heute sind daran vier Bedienelemente gestorben: ein neuer Baustein hat
   `.t-grp` erzeugt, während der Handler `closest('.t-settings-section')` sucht —
   vier Abschnitte mit Kopfzeile, die auf Klick nichts taten.

5. **Prüfstände lügen.** Baue Prüfseiten NUR mit den echten Renderern
   (`import` aus `spielplan-helpers.js`) und lade dabei **`main.css` mit** — die
   Spalten-Ausblendung der Tabellen steht dort, nicht in `tournament.css`.
   Von Hand nachgetipptes Markup hat hier **fünfmal** einen intakten Zustand für
   kaputt erklärt. Wenn dein Prüfstand einen Fehler meldet, prüfe zuerst ihn.

6. **Der Selektor-Drift-Detektor ist scharf und hilft.**
   `selector-drift.test.js` findet tote `data-action`-Selektoren. Er hat heute
   zwei echte Löcher gefunden. Er meldet auch, wenn du ihn stumpf machst
   (interpoliertes `data-action`) — dann ist die Antwort nicht „Ausnahme
   eintragen", sondern ihm beibringen, wo die Werte jetzt stehen.

---

## 6. Bildschirm-Nachweis

Playwright ist ohne eigene Browser-Binaries nutzbar:

```js
import { chromium } from 'file:///C:/Users/Rezo/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ channel: 'msedge' });
```

Verifiziere **390 px und 1920 px, je hell und dunkel**, plus den dritten
Themen-Zustand. Kein waagerechter Überlauf. Fertige Prüfstände zum Abgucken
liegen im Scratchpad dieser Sitzung; zwei begonnene liegen als
`backend/public/pruefstand-marke.{html,js}` im Baum (untracked, vom Vorgänger).

---

## 7. Was heute sonst noch passiert ist (Kontext, nicht dein Auftrag)

Damit du nicht in etwas hineinläufst:

- **Der Spielplan hat keinen großen Kasten mehr** um die Spielkarten
  (`#t-schedule-list` ist ein nackter Flex-Container). Das war eine
  ausdrückliche Forderung — nicht zurückbauen.
- **Der Filter ist eine Chip-Reihe** mit genau vier Filtern (Alle · Offen ·
  Läuft · Fertig) und darf **nicht seitwärts scrollen**. Vierte Fassung an
  einem Tag; gemessen bei 390, 375 und 320 px.
- **Die Einstellungen sind eingeklappt** und aus Listenzeilen gebaut
  (`lrow`, `lst`, `stepper`, `gruppe` in `spielplan-helpers.js`).
- **Backend:** Gruppentabellen standen auf 0 Spielen, weil Mitgliederliste und
  Spielplan auseinandergelaufen waren. Behoben, und seit heute ziehen die Spiele
  beim Neuverteilen mit. Das ist frische Rechenlogik — **nicht anfassen**.

---

## 8. Definition of Done

1. Jeder Screen des Artefakts liegt neben dem Screenshot der Umsetzung, und man
   könnte beide verwechseln. **Belege ablegen**, nicht behaupten.
2. Die Spielkarten im Spielplan tragen die **harte** Fassung.
3. Alle drei Themen-Zustände geprüft, kein waagerechter Überlauf bei 390 px.
4. **Mindestens 1702 grüne Tests**, 5 übersprungen.
5. Committet in kleinen Etappen, deutsche Nachricht `@@ … @@`, chirurgisch per
   Pathspec gestaget (nie `-a`/`-A` — es arbeiten mehrere am selben Repo).
6. Ein Bericht als Tabelle: Screen | was geändert | Commit | Beleg — plus ein
   Abschnitt „Abweichungen" mit je einem Satz Begründung. **Die harte Spielkarte
   gehört dort als erste Zeile hinein.**

---

## 9. Bei Jonas liegt

- Der Blick auf das Ergebnis.
- Das GO für `git push` — das gibt er separat und nie vorab.
