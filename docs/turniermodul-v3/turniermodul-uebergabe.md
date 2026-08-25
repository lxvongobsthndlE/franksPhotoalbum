# Turniermodul [kru:]nest — Übergabe

> **Zweck dieses Dokuments:** Vollständiger Stand des Projekts, damit ein neues Team oder ein anderer Agent ohne Vorwissen weiterarbeiten kann. Enthält Setup, Spezifikation in Kurzform, aktuellen Stand, offene Fehler und alle noch ausstehenden Arbeiten.
>
> **Stand:** 25. August 2026
> **Turniertermin:** 5. September 2026 — danach ist das Modul im Echteinsatz

---

## 1. Was das Projekt ist

### 1.1 Die Anwendung

**[kru:]nest** ist eine selbst gehostete Gruppen-App. Nutzer treten geschlossenen Gruppen bei, jede Gruppe hat einen Feed und kann Module freigeschaltet bekommen: Fotomodul, Turniermodul, künftig weitere.

Das **Turniermodul** ist der Gegenstand dieses Dokuments. Es verwaltet Turniere innerhalb einer Gruppe: Teams anlegen, Spielplan generieren, Ergebnisse eintragen, Tabellen und K.-o.-Baum automatisch berechnen.

Der konkrete Anlass ist ein Bierpong-Turnier am 5. September 2026 mit 12–15 Teams. Das Modul muss zu diesem Termin funktionieren.

### 1.2 Technisches Setup

| | |
|---|---|
| Backend | Node.js, Fastify, Prisma, PostgreSQL |
| Frontend | Vanilla JavaScript, kein Framework |
| Datenbank | `photoalbum_dev` (Entwicklung), `photoalbum_test` (Tests) |
| Dateispeicher | MinIO (Logos, Fotos) |
| Anmeldung | OIDC über Authentik |
| Server | selbst gehostet |
| Entwicklung | `npm run dev` im Projektstamm, läuft auf `localhost:3000` |
| Tests | `npx vitest run` — aktuell rund 1350 Tests |

**Wichtige Pfade:**

```
backend/src/modules/tournament/        Backend-Modul
  engine/                              Turnierlogik, UI-frei, vollständig getestet
  routes.js                            alle Endpunkte
  persist.js                           Speicherung des Engine-Ergebnisses
  access/                              Rechteprüfung und Aufbereitungsschicht
  __tests__/                           Tests

backend/public/script/
  main.js                              ~15.000 Zeilen, App-weit
  tournament.js                        Wizard und Modul-Helfer
  spielplan-helpers.js                 reine Render-Funktionen
  __tests__/                           Frontend-Tests

backend/public/style/
  main.css                             App-weit
  tournament.css                       Turniermodul, alles unter .t-mod gescopet

docs/turniermodul-v3-spec.md           die verbindliche Spezifikation
docs/turniermodul-v3/                  Pläne, Screenshots, Zustandsnotizen
```

### 1.3 Arbeitsweise, die sich bewährt hat

Das Projekt wurde mit einem Coding-Agenten (MiniMax M3) gebaut. Folgende Regeln haben sich als notwendig erwiesen — sie sind aus konkreten Fehlern entstanden, die jeweils Stunden gekostet haben:

**Vor dem Bauen einen Plan vorlegen lassen.** Nicht „bau X", sondern „zeig mir, wie du X bauen würdest". Fehler im Plan zu finden ist billiger als im Code.

**In der echten App prüfen, nicht in nachgebauten Umgebungen.** Der Agent hat wochenlang in einer selbstgebauten Vorschau gemessen, der das App-Padding fehlte — und deshalb andere Werte gesehen als der Nutzer. Alle visuellen Abnahmen erfolgen auf `localhost:3000`.

**Messen statt vermuten.** Bei Layoutfehlern: `getBoundingClientRect()` in der Konsole, nicht Theorien über CSS. Mehrere Fehlersuchen liefen ins Leere, weil eine Ursache vermutet statt geprüft wurde.

**Ursache beheben, nicht Symptom verschönern.** Wenn eine Fehlermeldung erscheint, wird der Fehler behoben — nicht die Meldung freundlicher formuliert.

**Nach jeder Runde committen.** Lokal genügt. Ohne das gibt es keinen Rückweg.

**Der Nutzer klickt selbst durch.** Die meisten echten Fehler wurden dabei gefunden, nicht durch Tests.

---

## 2. Spezifikation in Kurzform

Die vollständige Fassung liegt in `docs/turniermodul-v3-spec.md`. Hier das Wesentliche.

### 2.1 Rollenmodell

**Nur zwei Rollen:**

| Rolle | Rechte |
|---|---|
| Gruppen-Owner/Admin | alles: anlegen, konfigurieren, Ergebnisse eintragen, löschen |
| Gruppenmitglied | nur lesen |

**Teams sind reine Datensätze, keine Nutzerkonten.** Es gibt keine Registrierung für Teams, keine Einladungen, keine Bestätigungsworkflows. Der Admin legt alles an.

Menüpunkte für Mitglieder: Spielplan, Gruppen, Turnierbaum, Drucken. Nicht sichtbar: Teams, Einstellungen.

Jede schreibende Route prüft die Admin-Rolle im Backend und antwortet Mitgliedern mit 403. Ein ausgeblendeter Knopf im Client ist keine Sicherheit.

### 2.2 Turniermodi

- `groups_ko` — Gruppenphase plus K.-o.-Runde (der Hauptfall)
- `groups_only` — nur Gruppen, Endstand ist die Tabelle
- `ko_only` — nur K.-o.
- `double_elim` — vorgesehen, nicht gebaut

### 2.3 Kernlogik

**Gruppenbildung:** Anzahl frei wählbar, Verteilung zufällig, per Setzliste oder manuell. Bei ungerader Teilung werden Reste von vorne aufgefüllt.

**Spielplan:** Round Robin nach Berger-Verfahren. Blockkonzept — innerhalb eines Blocks laufen Spiele parallel auf den Feldern, der nächste Block startet erst, wenn der vorige durch ist. Reihenfolge: Gruppenspieltage, dann Viertelfinale, Halbfinale, Spiel um Platz 3, Finale.

**Tabellenberechnung:** Immer live aus den Ergebnissen, nie gespeichert. Tiebreaker-Reihenfolge frei konfigurierbar. Bei mehreren punktgleichen Teams wird der direkte Vergleich rekursiv berechnet — löst sich ein Dreiergleichstand teilweise auf, wird für den Rest neu gerechnet.

**Qualifikation:** Wenn die Zahl der Qualifikanten keine Zweierpotenz ist, wird zuerst mit besten Dritten aufgefüllt, dann mit Play-offs, erst zuletzt mit Freilosen. Beste Dritte werden immer **pro Spiel** gewertet, damit ungleich große Gruppen fair verglichen werden.

**Bracket-Seeding:** Kreuzpaarungen, keine Gruppengegner in der ersten K.-o.-Runde. Konflikte werden durch Tausch innerhalb derselben Seed-Ebene aufgelöst, mit harter Obergrenze gegen Endlosschleifen.

**Referenzbeispiel** (Pflicht-Testfall): 12 Teams, 3 Gruppen à 4, Top 2 plus 2 beste Dritte ergibt genau diese Viertelfinals: A1–B3, A2–C2, C1–B2, B1–A3.

Die Engine muss generisch rechnen. Kein `if (teams === 12)`, keine hinterlegten Paarungstabellen je Turniergröße.

### 2.4 Ergebniseingabe

Es gibt **keinen Live-Ticker**. Ein Spiel ist entweder offen oder beendet. Ergebnisse werden nachträglich eingetragen, **jederzeit** — die geplante Uhrzeit ist eine Planung, keine Sperre. Turniere laufen schneller oder langsamer als gedacht.

Nach dem Speichern werden Tabellen und Baum neu berechnet. Bei K.-o.-Spielen steigt der Sieger automatisch ins Folgespiel auf.

### 2.5 Turnierstatus

```
draft        Entwurf, alles änderbar
generated    Spielplan steht, für Mitglieder sichtbar, noch alles änderbar
group_stage  läuft, Struktur gesperrt, Zeiten änderbar
ko_stage     läuft
finished     beendet, nur lesen
```

Der Übergang zu `group_stage` erfolgt durch einen bewussten Klick auf „Turnier starten". Zurück zu `draft` ist möglich, solange keine Ergebnisse existieren — der Spielplan bleibt dabei erhalten.

---

## 3. Aktueller Stand

### 3.1 Fertig und im Einsatz

**Backend vollständig.** Engine mit Tests, Datenmodell, alle Routen, Rechteprüfung, Aufbereitungsschicht zwischen Datenbank und Oberfläche.

**Wizard** — Turnier anlegen in fünf Schritten: Grunddaten mit Logo-Upload, Teams (per Copy-Paste oder Anzahl festlegen), Modus, Qualifikation und Zeitplan, Zusammenfassung. Live-Vorschau mit Endzeit-Hochrechnung.

**Turnierliste** mit Phasen-Gruppierung.

**Detail-Ansicht** mit sieben Tabs: Spielplan, Gruppen, Turnierbaum, Teams, Regeln, Drucken, Einstellungen. Auf dem Handy eine Bodenleiste mit vier Einträgen plus „Mehr".

**Spielplan** — alle Spiele mit Uhrzeit, Feld, Runde, Teams, Ergebnis. Filter nach offen/beendet/Phase/Gruppe. Ergebniseingabe über Dialog.

**Gruppen** — Tabellen mit vollständiger Statistik, Wertung der Drittplatzierten.

**Turnierbaum** — Runden als Spalten, Karten untereinander, keine Verbindungslinien. Auf dem Handy eine Runde pro Bildschirm mit Einrastpunkten.

**Einstellungen** — fünf ausklappbare Abschnitte: Aktionen, Gruppen mit Paar-Tausch, Setzreihenfolge, Spielfelder, Gefahrenbereich.

### 3.2 Vier Prüf-Tests, die dauerhaft laufen

Diese sind aus wiederholten Ausfällen entstanden und sollten erhalten bleiben:

| Test | Findet |
|---|---|
| `exports-defined` | exportierte Namen ohne Definition |
| `call-sites-defined` | Funktionsaufrufe ohne Definition (AST-basiert) |
| `imports-exported` | Importe, die auf nicht exportierte Namen zeigen |
| `write-routes-403-audit` | schreibende Routen ohne Rechteprüfung |

Der erste Fall dieser Art hat die halbe App lahmgelegt und fünf Runden Fehlersuche gekostet.

---

## 4. Offene Fehler

Nach Dringlichkeit sortiert.

### 4.1 K.-o.-Baum füllt sich nicht — blockierend

**Symptom:** Alle Gruppenspiele sind eingetragen, der Turnierbaum bleibt leer. Die Teams steigen nicht ins Viertelfinale auf. Der Knopf „K.-o.-Phase starten" ist inzwischen gebaut, scheitert aber ebenfalls.

**Konkreter Fehler beim Klick auf den Knopf** (`POST /tournaments/:id/fill-ko`):

```
Invalid `prisma.group_.findMany()` invocation:
{
  where: {
    tournamentId: "cmt8rdvf200025bxaw12fo47e",
    ~~~~~~~~~~~~
  },
  include: { memberships: { include: { team: true } } }
}
Unknown argument `tournamentId`.
```

**Ursache:** Die Tabelle `group_` hat kein Feld `tournamentId`. Laut Schema hängt eine Gruppe an einer Stage (`stageId`), und die Stage wiederum am Turnier. Die Abfrage muss also über die Beziehung gehen:

```js
prisma.group_.findMany({
  where: { stage: { tournamentId } },
  include: { memberships: { include: { team: true } } },
})
```

Das ist dieselbe Fehlerklasse wie in Abschnitt 8 beschrieben: Code und Schema laufen auseinander, und ein Test mit nachgebildetem Prisma findet das nicht. **Für diese Route braucht es einen Test gegen eine echte Datenbank**, sonst wiederholt sich der Fehler bei der nächsten Änderung.

**Weiterhin offen, auch nach diesem Fix:**

Der automatische Weg. Es existiert eine Funktion `maybeFillKoFromGroupFinish()`, die beim letzten Gruppenergebnis auslösen soll. Sie greift nicht zuverlässig — vermutlich nicht bei Turnieren, deren Gruppenspiele vor dem Einbau der Funktion eingetragen wurden, und möglicherweise nicht beim nachträglichen Ändern eines Ergebnisses.

**Benötigt:**
- Die Prisma-Abfrage korrigieren, mit Test gegen echte Datenbank
- Der automatische Weg muss zuverlässig funktionieren
- Der manuelle Knopf bleibt als Rückfallebene bestehen — er ruft dieselbe Funktion wie der automatische Weg, damit es eine Wahrheit gibt
- Beim nachträglichen Ändern eines Gruppenergebnisses nach gefülltem Baum: Warnung anzeigen und anbieten, die K.-o.-Phase neu zu setzen. Nicht still überschreiben.

Ohne funktionierenden K.-o.-Übergang lässt sich kein Turnier zu Ende spielen. Das ist der wichtigste offene Punkt.

### 4.2 Anmeldung läuft ab, Speichern scheitert still

**Symptom:** Nach längerer Zeit mit geöffneter Seite antwortet die API mit 401. Das Eintragen eines Ergebnisses scheitert, ohne dass eine verständliche Meldung erscheint.

**Relevanz:** Am Turniertag liegt das Handy zwischendurch in der Tasche. Wenn danach nichts mehr gespeichert wird, ist das der ärgerlichste denkbare Ausfall.

**Benötigt:**
- Prüfen, ob `fetchWithAuth` den Token wirklich automatisch erneuert
- Falls die Erneuerung scheitert: verständliche Meldung statt stillem Fehlschlag
- Die eingegebenen Werte dürfen dabei nicht verlorengehen

### 4.3 Platz-Spalte in der Tabelle zu schmal

**Symptom:** Auf schmalen Breiten steht „1…", „2…" statt „1.", „2." — und in der Überschrift „P…" statt „Pl."

**Ursache:** Die Spalte hat 8 % Anteil, das sind unter 30px. Mit Innenabstand reicht das nicht.

**Lösung:** Anteile umverteilen auf `['14%', '36%', '20%', '15%', '15%']`. Und prüfen, ob `text-overflow: ellipsis` auf der Rangzelle überhaupt nötig ist — bei zwei Zeichen kann nichts umbrechen.

### 4.4 Dashboard-Eintrag in der Seitenleiste

**Symptom:** Unter „Turniere" in der App-Seitenleiste stehen zwei Einträge: „Dashboard" und „Turniere". Das Dashboard ist ein leeres Gerüst.

**Lösung:** Dashboard entfernen. Danach braucht „Turniere" kein Untermenü mehr — ein Klick führt direkt zum Turnier, wenn nur eines existiert, sonst zur Liste.

### 4.5 Automatischer Sprung ins einzige Turnier greift nicht

**Symptom:** Bei genau einem Turnier in der Gruppe öffnet der Klick auf „Turniere" trotzdem die Auswahlliste mit einem Eintrag.

**Bekannt:** Wurde als erledigt gemeldet, funktioniert aber nicht. Vermutlich hängt es am Weg über die App-Seitenleiste statt über die Modulnavigation.

### 4.6 Bodenleiste verdeckt Kartenrand

**Symptom:** Beim Scrollen ganz nach unten bleibt der untere Rand der letzten Karte unter der Leiste. Etwa 20 Pixel fehlen.

**Lösung:** Innenabstand erhöhen auf `calc(56px + env(safe-area-inset-bottom) + 24px)`. Prüfkriterium ist der weiße Kartenrand, nicht der Text darin.

---

## 5. Redesign

### 5.1 Die gestalterische Haltung

Das Turniermodul soll eine eigene Handschrift haben — verwandt mit [kru:]nest, aber unterscheidbar. Es ist ein Werkzeug mit eigenem Gebrauchsmoment: benutzt an einem Nachmittag, im Stehen, unter Zeitdruck.

**Verwandt** über den Grundton: dasselbe warme Papier (`#FAF7F1`), dieselbe Schriftfamilie, dieselben weichen Kartenkanten.

**Eigenständig** über drei Dinge:

**Die Anzeigetafel.** Wo Ergebnisse stehen, wird der Grund dunkel und die Ziffer hell — die Sprache von Sporthallen. Tokens: `--board: #211C16`, `--board-ink: #F7F2E8`, Radius 4px statt 12. Im Nachtmodus dreht sie sich um (helles Feld, dunkle Ziffer), damit sie nicht mit dem Hintergrund verschmilzt.

**Kondensierte Versalien für Struktur.** Rundenbezeichnungen, Gruppennamen, Spaltenüberschriften in Großbuchstaben mit Laufweite `0.10em`. Nur für Gliederung, nie für Inhalte — ein Teamname steht nie in Versalien.

**Dichte statt Luft.** Zwölf Spiele auf einen Blick sind besser als vier mit Weißraum.

**Drei Prinzipien:**
- Eine Zeile ist ein Spiel — dieselbe Match-Komponente in Spielplan, Baum, Kontextspalte, nur in drei Größen
- Weniger Rahmen, mehr Abstand
- Ein Element, eine Aufgabe — kein Stern *und* Platznummer *und* Häkchen für dasselbe

### 5.2 Was bereits umgesetzt ist

**Tokens und Nachtmodus** — vollständig, inklusive Anzeigetafel-Farben.

**Match-Karte** — von horizontal auf vertikal gedreht. Teams untereinander, Punkte rechts daneben in Anzeigetafel-Feldern. Bei offenen Spielen bleiben die Felder als Umriss stehen.

**Bodenleiste auf dem Handy** — vier Einträge (Spiele, Gruppen, Baum, Mehr) statt sieben scrollbarer Tabs. Symbole aus Lucide.

**Tabellen** — Ausrichtung korrigiert, Spalten auf schmalen Breiten reduziert, feste Spaltenbreiten für einheitliches Fluchten.

**Scroll-Verhalten** — es gab zwei verschachtelte Scrollbereiche, sodass man nie ganz nach unten kam. Behoben, jetzt scrollt genau ein Element.

### 5.3 Was noch aussteht

**Turnierkarte in der Liste.** Das fertige Dokument dazu heißt `redesign-umsetzung-teil2.md`.

Wichtiger Befund: **`.t-list-card` existiert bereits vollständig** in `tournament.css` ab Zeile 735 — mit Logo, Name, Datum, Status-Badge, Kennzahlen und Fortschrittsbalken. Der Renderer benutzt sie nur nicht, sondern die alte `.tournament-card` aus `main.css`.

Zielbild: Turniername als Größtes auf der Karte, Status genau einmal als Badge, Kennzahlen einzeilig, Fortschrittsbalken, ganze Karte anklickbar statt „Öffnen"-Knopf, Löschen im Kontextmenü. Leere Phasen werden nicht angezeigt.

**Ergebnis-Dialog.** Ebenfalls in Teil 2.

Wichtiger Befund: Der Dialog hängt per `appendChild` an `document.body`, also **außerhalb von `.t-mod`**. Er erbt deshalb keine einzige Turnier-Farbe. Der Fix ist eine zusätzliche Klasse `t-mod` am Host-Element.

Zielbild: Das Spiel steht einmal da als graue Zeile, Teamname und Eingabefeld nebeneinander in einer Zeile, Felder leer statt mit 0 vorbelegt, auf dem Handy als Blatt von unten.

**Kopfbereich.** Nimmt auf dem Handy weiterhin viel Platz — Logo, Name, Untertitel, Badge, Menü. Seit die Navigation nach unten gewandert ist, könnte das eine schlanke Zeile werden.

### 5.4 Prüfkriterien für alles Visuelle

Geprüft wird bei **360, 390, 430, 768, 1280 und 1920** Pixeln, in der echten App:

- Kein waagerechtes Scrollen, die Seite lässt sich nicht seitlich schieben
- Kein Element breiter als sein Container
- Alle Zahlen vollständig sichtbar, auch zweistellige Ergebnisse wie „12:10"
- Überschriften und Werte einer Tabellenspalte fluchten
- Bei 1920 füllt der Inhalt die Breite, kein ungenutzter Rand über 5 %
- Der Nachtmodus ist vollständig, überall Kontrast mindestens 4,5:1
- Kein technischer Wert und keine Datenbank-ID sichtbar
- Keine Emoji als Symbole
- Pro Ansicht genau eine gefüllte Hauptaktion
- Kein Bedienelement ohne Funktion

---

## 6. Fehlende Funktionen

### 6.1 Druckfunktion — existiert noch gar nicht

Der Tab ist vorhanden, aber leer. Benötigt werden drei Ausdrucke über ein `@media print`-Stylesheet, kein separates PDF-Werkzeug.

**Grundsätzlich:** Ein Ausdruck hängt an der Wand, wird mit Stift ausgefüllt, oft schwarz-weiß gedruckt. Deshalb: keine Farbe als einzige Information, große Ergebnisfelder zum Eintragen, auf jeder Seite ein Kopf mit **Turnierlogo**, Name, Datum, Ort und Seitenzahl.

Das Logo muss als echtes Bild eingebunden sein, nicht als CSS-Hintergrund — beim Drucken werden Hintergrundbilder standardmäßig weggelassen. Und es muss auch ohne Logo funktionieren, dann steht nur der Name da.

**Spielplan** — der wichtigste. Chronologisch, eine Zeile pro Spiel: Uhrzeit, Feld, Runde, Team A, Ergebnisfeld, Team B. Feine Linien zwischen Zeilen, deutlichere beim Wechsel des Zeitslots. A4 hochkant, etwa 30 Spiele pro Seite.

**Gruppen** — zwei Tabellen nebeneinander pro Seite. Die Qualifikationsgrenze braucht eine durchgezogene Linie, nicht nur Farbe.

**Turnierbaum** — Querformat, Runden als Spalten. Hier gehören Verbindungslinien tatsächlich hin, weil auf Papier nichts scrollt. Leere Felder für offene Partien.

Zwei Varianten: „Zum Ausfüllen" (Ergebnisse leer) und „Aktueller Stand".

### 6.2 Öffentliche Live-Seite

Vorbereitet, nicht gebaut. Die Felder `is_public` und `public_token` existieren im Schema.

Ein Turnier kann veröffentlicht werden und ist dann über einen nicht erratbaren Link ohne Anmeldung erreichbar. Zeigt Spielplan, Tabellen und Baum, aktualisiert sich selbst. Dazu ein QR-Code zum Ausdrucken.

Datenschutz: Nur Teamnamen und Ergebnisse, keine Klarnamen von Gruppenmitgliedern, keine Fotos. Veröffentlichung jederzeit widerrufbar, Token neu erzeugbar.

### 6.3 Ergebnis direkt in der Zeile eintragen

Auf dem Handy wäre es schneller, ein Ergebnis direkt in der Match-Zeile einzutippen statt über einen Dialog. Bei 26 Spielen spart das viele Klicks.

### 6.4 Zurückgestellt

- **Entwurf fortsetzen** — ein angefangener Wizard lässt sich nicht wieder aufnehmen
- **Freilose im reinen K.-o.-Modus** bei krummen Teamzahlen
- **Losentscheid im UI** bei echtem Gleichstand auf einem Qualifikationsplatz
- **Benachrichtigungen** wenn Teams mit Nutzern verknüpft sind
- **Doppel-K.-o.**, Schweizer System
- **Aufräumen:** `openPickTeamForGroupModal` ist ungenutzt, `openTournamentWizard`-Reste in `main.js`

---

## 7. Empfohlene Reihenfolge

Bis zum 5. September:

1. **K.-o.-Baum-Trigger** (4.1) — blockierend, ohne das ist kein Turnier durchführbar
2. **401-Fix** (4.2) — sonst fällt am Turniertag das Speichern aus
3. **Kleine Fehler** (4.3 bis 4.6) — jeweils überschaubar
4. **Redesign Teil 2** — Turnierkarte und Dialog, Dokument liegt vor
5. **Druckfunktion** (6.1)
6. **Öffentliche Live-Seite** (6.2), falls der Link an Gäste gehen soll

**Letzte Woche vor dem Turnier: keine neuen Funktionen.** Stattdessen zwei komplette Turniere durchspielen — zwölf Teams anlegen, alle 26 Ergebnisse eintragen, bis zum Finale. Einmal am Rechner, einmal nur mit dem Handy. Das findet mehr als jede weitere Baurunde.

---

## 8. Wiederkehrende Fehlerklassen

Diese Fehler sind mehrfach aufgetreten. Wer weiterarbeitet, sollte sie kennen.

**Fehlende Definitionen.** Eine Funktion wird exportiert oder aufgerufen, existiert aber nicht. Das Skript bricht beim Laden ab, und alles danach ist tot — auch in anderen Modulen. Dreimal passiert, einmal mit fünf Runden Suchzeit. Die vier Prüf-Tests fangen das inzwischen ab.

**Container ohne Breite.** `container-type: inline-size` ohne explizite `width` lässt ein Element auf 0 kollabieren. Zweimal passiert. Lösung: `width: 100%` als Vertrag.

**Bezugsgrößen außerhalb des Containers.** `100vw` und `100cqw` rechnen mit Fenster- oder Modulbreite, nicht mit dem sichtbaren Bereich. Wenn dazwischen Innenabstände liegen, läuft der Inhalt über. Lösung: `100%`.

**Schema und Code laufen auseinander.** Felder werden geschrieben oder abgefragt, die es in der Datenbank so nicht gibt. Beispiele: `winnerTeamId`, `isDraw` und `completedAt` wurden in `match.update` geschrieben, obwohl sie nicht im Schema stehen. Und `group_.findMany` filterte nach `tournamentId`, obwohl eine Gruppe über `stageId` am Turnier hängt (siehe 4.1). Tests mit nachgebildetem Prisma finden das nicht — sie prüfen den Aufruf, nicht das Schema. Es braucht mindestens einen Test gegen eine echte Datenbank pro schreibender Route.

**Veralteter Prisma-Client.** Nach Schema-Änderungen muss `npx prisma generate` laufen und der Server neu starten. Sonst wirken fehlende Spalten wie Datenbankfehler. Zweimal passiert, beim ersten Mal mit stundenlanger Suche.

**Tests, die nichts prüfen.** Ein Sortierungstest prüfte die Eingabereihenfolge statt der sortierten Ausgabe. Ein Round-Trip-Test prüfte einen Wert, der zufällig dem Standardwert entsprach — er wäre auch grün gewesen, wenn gar nichts übertragen wird. Beim Schreiben von Tests bewusst Werte wählen, die vom Standard abweichen.

**Werte, die im Speicher existieren, aber nicht in der Datenbank.** Die Engine setzt Felder, die beim Speichern verlorengehen und später gelesen werden. Zweimal passiert, einmal bei den Match-IDs, einmal bei den Slot-Zuordnungen im K.-o.-Baum.
