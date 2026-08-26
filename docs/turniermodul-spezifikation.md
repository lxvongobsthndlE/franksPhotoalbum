# Turniermodul – Vollständige Spezifikation (Rewrite)

> **An das implementierende Modell:** Dieses Dokument ist die verbindliche Spezifikation für das **Turnier-Modul** der selbst gehosteten Anwendung **[kru:]nest** (eigene relationale DB, Postgres oder MySQL). Die Spezifikation ist stack-neutral: Die gesamte Turnierlogik gehört in eine eigenständige, UI- und framework-freie Engine. Das bestehende Modul hat zwei Kernprobleme: (1) Die Gruppenphase erstellt nur EINE Gruppe mit allen Teams statt konfigurierbarer Gruppen. (2) Das Layout ist auf Desktop verzerrt und füllt den Bildschirm nicht sauber. Beides wird hier komplett neu spezifiziert. Implementiere exakt nach dieser Logik. Wenn etwas unklar ist: Die hier definierten Regeln haben Vorrang vor bestehendem Code. Bestehenden fehlerhaften Gruppenphasen-Code ersetzen, nicht patchen.

---

> **⚠️ DREI GLEICHRANGIGE AUFTRÄGE — alle sind Pflicht:**
>
> **(0) KOMPLETTER NEUBAU.** Der bestehende Turniermodul-Code wird **vollständig verworfen**, nicht repariert. Nichts davon wird übernommen: keine Komponenten, kein CSS, keine Datenzugriffe, keine Hilfsfunktionen. Der vorherige Versuch hatte zu viele Fehler, um darauf aufzubauen. Beginne mit einem leeren Verzeichnis für das Modul. Alte Datenbanktabellen des Turniermoduls werden migriert oder gelöscht, nicht weiterverwendet. **Wenn du dich dabei ertappst, bestehenden Turniercode zu lesen, um ihn anzupassen: nicht tun. Neu schreiben.**
>
> **(1) Die Logik muss korrekt sein.** Konfigurierbare Gruppen, Tiebreaker, Bracket-Seeding, Terminierung. Siehe §5, §6.
>
> **(2) Das Design und die Navigation müssen komplett anders sein als bisher.** Das aktuelle Turniermodul ist eine hochskalierte Handy-Ansicht: schmale Spalte in der Bildschirmmitte, riesige leere Flächen links und rechts, verzogene Elemente, wirkt auf dem Desktop wie ein Fehler. **Das ist kein kosmetisches Detail, sondern ein Hauptgrund für diesen Rewrite.** Details in §8 und in der ausführlichen Screen-Spezifikation §13. Beide Kapitel sind genauso verbindlich wie die Logik-Kapitel.
>
> **Qualitätsanspruch:** Der vorherige Durchlauf hatte zu viele Fehler. Lieber weniger Funktionen, die vollständig und fehlerfrei sind, als viele halbfertige. Jeder Schritt aus §12 wird abgeschlossen und geprüft, bevor der nächste beginnt. Keine Platzhalter-Funktionen, keine `TODO`-Kommentare in ausgeliefertem Code, keine Buttons ohne Funktion.

## 0. Neubau-Auftrag — zuerst lesen

Das bestehende Turniermodul wird **nicht** weiterentwickelt. Es wird gelöscht und von Grund auf neu gebaut. Begründung: Die Fehler sind nicht oberflächlich, sondern strukturell. Ein Blick auf den aktuellen Stand zeigt, dass in den Gruppentabellen **Datenbank-IDs statt Teamnamen** stehen (`cmsm7zaqv0002qnvpjcmiw1h0`). Das ist kein Darstellungsfehler, sondern der Beweis, dass die Oberfläche rohe Datenbankzeilen ausgibt, ohne sie in verständliche Inhalte zu übersetzen. Wer darauf aufbaut, baut auf einem falschen Fundament.

**Verbindliches Vorgehen:**

1. **Alle Dateien des bisherigen Turniermoduls löschen** — Komponenten, Stylesheets, Hilfsfunktionen, Datenzugriffe, Routen. Nichts wird übernommen, nichts kopiert, nichts angepasst.
2. **Die bisherigen Turniertabellen der Datenbank verwerfen** und nach §4 vollständig neu anlegen. Bestehende Testturniere gehen verloren; das ist beabsichtigt und ausdrücklich in Ordnung.
3. **Ein neues, leeres Modulverzeichnis** anlegen und dort nach dieser Spezifikation aufbauen.
4. **Den alten Code nicht als Vorlage lesen.** Weder für Struktur noch für Namen noch für Logik. Wenn eine Frage offen ist, gilt diese Spezifikation; steht die Antwort nicht darin, nachfragen statt raten.
5. **Der Auftrag betrifft AUSSCHLIESSLICH das Turniermodul.** Alles andere in [kru:]nest bleibt unangetastet — Feed, Fotomodul, Gruppenverwaltung, Anmeldung, Benutzerkonten, Seitenleiste, globales Stylesheet, Routing außerhalb des Modulpfads, Build-Konfiguration, Abhängigkeiten und alle Datenbanktabellen außerhalb des Turnierbereichs. **Keine Aufräumarbeiten, keine Umbenennungen, keine „Verbesserungen" und keine Refaktorierungen außerhalb des Moduls, auch wenn sie sinnvoll erscheinen.**

   Konkret erlaubt ist genau dies:
   - Dateien innerhalb des Modulverzeichnisses anlegen, ändern, löschen
   - Turnierbezogene Datenbanktabellen anlegen und migrieren
   - **Genau eine** Zeile im Routing, die den Modulpfad einbindet
   - Bestehende Design-Tokens und Komponenten der Kernanwendung **lesen und verwenden**, aber nicht verändern

   Wird darüber hinaus eine Änderung außerhalb des Moduls nötig, wird sie **nicht** vorgenommen, sondern gemeldet: welche Datei, welche Zeile, warum. Ich entscheide dann. Ein Turniermodul, das funktioniert, aber nebenbei den Feed kaputtmacht, ist schlechter als gar keines.

**Der Anspruch:** Am Ende steht ein vollständiges, funktionierendes Turniermodul, das gut aussieht — nicht eine reparierte Fassung des alten. Lieber ein kleinerer Funktionsumfang, der vollständig stimmt, als der volle Umfang mit denselben Fehlern.

---

## 1. Zielbild & Einbettung

### 1.1 Einbettung in [kru:]nest — Modul-Architektur

[kru:]nest ist eine Plattform mit **Gruppen** (geschlossene Nutzerkreise). Jede Gruppe hat einen Feed und kann darüber hinaus **Module** freigeschaltet bekommen: Fotomodul, Turniermodul, künftig weitere. Das Turniermodul ist also ein **Plugin im Gruppenkontext**, keine eigenständige App.

**Ist-Zustand und verbindliche Vorgabe:** Es gibt aktuell **keine Modul-Freischaltung**. Jeder Nutzer von [kru:]nest sieht das Turniermodul. **Das bleibt vorerst so — baue kein Freischaltungs-System.** Jede zusätzliche Rechteebene ist eine zusätzliche Fehlerquelle, und Fehler sind genau das Problem, das dieser Rewrite lösen soll.

**Verbindliche Konsequenzen für die Implementierung:**

- **Kein Modul-Gating.** Keine `group_modules`-Tabelle, keine Freischaltungsprüfung, kein Konfigurationsmenü dafür. Sichtbarkeit ist keine Frage, die dieses Modul beantwortet.
- Jedes Turnier gehört zu **genau einer [kru:]nest-Gruppe** (`tournaments.group_id`). Es gibt keine gruppenübergreifenden Turniere. Das ist eine reine Zuordnung zur Organisation der Inhalte, keine Rechteprüfung.
- Das Modul bringt **keine eigene Nutzerverwaltung, Registrierung oder Einladung** mit. Es nutzt ausschließlich die vorhandene Anmeldung von [kru:]nest.
- Innerhalb einer Gruppe können mehrere Turniere existieren (Übersichtsliste + Detailansicht), auch wenn der Regelfall eines pro Gruppe ist (z. B. Gruppe „Bierpongturnier 2.0 2026").
- Modulgrenzen sauber halten: Das Turniermodul greift nicht direkt in Feed- oder Fototabellen. Wenn ein Turnierereignis im Feed erscheinen soll, geschieht das über eine definierte Schnittstelle der Kernanwendung.
- **Für später offen halten, aber nicht bauen:** Sollte irgendwann eine Freischaltung pro Gruppe kommen, muss sie an genau einer Stelle im Routing ergänzbar sein. Also: eine einzige Einstiegsstelle ins Modul, keine verstreuten Zugriffspunkte.

### 1.2 Rollenmodell — bewusst schlank

**Das ist der wichtigste Unterschied zu kommerziellen Turniertools: Teams sind reine Datensätze, keine Nutzerkonten.**

| Rolle | Rechte |
|---|---|
| **Gruppen-Owner / Admin** | Turnier anlegen, konfigurieren, Teams eintragen, Spielplan generieren, Zeiten/Tische ändern, **Ergebnisse eintragen und korrigieren**, Turnier abschließen |
| **Gruppenmitglied** | Alles **lesen**: Spielplan mit Uhrzeit und Tisch, Gruppentabellen, Turnierbaum, Ergebnisse, Regelwerk. Keine Schreibrechte. |
| **Nicht-Mitglied** | Kein Zugriff (Ausnahme: öffentliche Live-Seite, §11 Stufe B) |

**⚠️ Turniere anlegen darf ausschließlich der Gruppen-Owner/Admin.** Für Mitglieder gibt es keinen „+ Neues Turnier"-Button, keinen Zugang zum Wizard und keinen Weg über die URL — ein direkter Aufruf der Wizard-Route führt zurück zur Turnierliste, und der Erstellungs-Endpunkt weist Nicht-Admins serverseitig mit 403 ab.

**Mitglieder sehen nur veröffentlichte Turniere.** Ein Turnier im Status `draft` ist ausschließlich für den Admin sichtbar — solange er Teams eintippt und den Modus wählt, soll niemand ein halbfertiges Turnier in der Gruppe sehen. Ab Status `generated` (Spielplan erzeugt) erscheint es für alle Mitglieder. Turniere im Status `group_stage`, `ko_stage` und `finished` sind ebenfalls für alle sichtbar; abgeschlossene Turniere bleiben als Archiv erhalten und werden in der Liste unter den laufenden einsortiert.

| Turnierstatus | Admin | Mitglied |
|---|---|---|
| `draft` — in Vorbereitung | ✓ | — |
| `generated` — Spielplan steht | ✓ | ✓ |
| `group_stage` / `ko_stage` — läuft | ✓ | ✓ |
| `finished` — beendet | ✓ | ✓ |

**⚠️ Ergebnisse darf ausschließlich der Gruppen-Owner/Admin eintragen und ändern.** Das ist eine harte Regel ohne Ausnahme:

- Kein Gruppenmitglied kann ein Ergebnis speichern — auch nicht für „sein eigenes" Team, auch nicht mit Bestätigung durch den Gegner, auch nicht über einen Freigabe-Workflow.
- Es gibt keinen Modus, keine Einstellung und keinen Schalter, der das aufweicht.
- Die Prüfung erfolgt **im Backend bei jeder schreibenden Anfrage**. Ein ausgeblendeter Button im Client ist keine Sicherheit: Wer den API-Endpunkt kennt, muss dort abgewiesen werden. Jede Route, die `matches` verändert (Ergebnis, Uhrzeit, Feld, Status), prüft zuerst die Admin-Rolle und antwortet sonst mit 403.
- Das gilt gleichermaßen für Ergebniseingabe, Ergebniskorrektur, Zeitplanänderungen, Auslosung und alle Aktionen im Gefahrenbereich.

**Sichtbarkeit der Menüpunkte — verbindlich:** Mitglieder bekommen eine bewusst schlanke Ansicht. Menüpunkte, die sie ohnehin nicht bedienen können, werden **ausgeblendet**, nicht ausgegraut. Ein gesperrter Menüpunkt ist eine Einladung zum Herumklicken und wirkt wie ein Fehler.

| Menüpunkt | Admin | Mitglied | Begründung |
|---|---|---|---|
| Übersicht | ✓ | ✓ | |
| Spielplan | ✓ | ✓ | Ergebnis-Buttons erscheinen nur für Admins |
| Gruppen | ✓ | ✓ | |
| Turnierbaum | ✓ | ✓ | Die für Zuschauer interessanteste Ansicht — wer trifft im Halbfinale auf wen |
| Teams | ✓ | — | Die Zuordnung steht bereits in den Gruppentabellen |
| Drucken / PDF | ✓ | ✓ | Read-only-Export, für Mitglieder nützlich und unschädlich |
| Einstellungen | ✓ | — | Enthält auch Zeiten, Felder und Auslosung |

Mitglieder sehen also **fünf** Menüpunkte: Übersicht · Spielplan · Gruppen · Turnierbaum · Drucken.

Innerhalb der sichtbaren Ansichten entfallen für Mitglieder zusätzlich alle schreibenden Bedienelemente: „Ergebnis eintragen", „Ändern", Losentscheid-Button, Kontextmenü im Header. Die Kontextspalte zeigt ihnen die nächsten Spiele und die Feldbelegung, aber keine Schnelleingabe.

**Serverseitig gilt weiterhin:** Die Sichtbarkeit im Client ist nur Bequemlichkeit. Jede schreibende Anfrage wird im Backend gegen die Admin-Rolle geprüft, unabhängig davon, was der Client anzeigt (§4).

Daraus folgt zwingend:

- **Teams werden vom Admin angelegt** — als einfache Datensätze mit Name, optional Farbe/Logo und optionaler Spielerliste als Freitext. Niemand muss sich „für das Turnier anmelden", es gibt keine Team-Registrierung und keine Einladungsflows.
- **Ergebniseingabe ausschließlich durch Admin/Owner.** Kein Bestätigungs-Workflow zwischen Teams, keine Freigabelogik. Ein Ergebnis wird eingetragen und gilt.
- **Optionale spätere Erweiterung (jetzt nur vorbereiten, nicht bauen):** Ein Team kann nachträglich mit einem oder mehreren Gruppenmitgliedern verknüpft werden (`tournament_teams.linked_user_ids`), damit diese Push-/In-App-Benachrichtigungen erhalten („Ihr spielt in 10 Minuten auf Platte 3"). Das Feld im Schema vorsehen, die Benachrichtigungslogik aber noch nicht implementieren. Diese Verknüpfung gibt **keine** Schreibrechte.

Die Engine und das Datenmodell müssen so gebaut sein, dass diese Erweiterung später ohne Umbau möglich ist.

### 1.3 Funktionales Zielbild

Das Modul soll sich anfühlen wie meinturnierplan.de / kicker-Turnierplaner: Der Veranstalter konfiguriert ein Turnier in wenigen Schritten, das System generiert automatisch den kompletten Spielplan (Gruppenphase + KO-Baum), Ergebnisse werden eingetragen, Tabellen und Bracket aktualisieren sich live, Teams steigen automatisch in die nächste Runde auf.

**Kernprinzip: Volle Flexibilität.** Jede Kombination aus Teamanzahl, Gruppenanzahl, Aufsteigern pro Gruppe und KO-Struktur muss funktionieren – nicht nur hardcodierte Standardfälle.

Referenzbeispiele, die alle out-of-the-box funktionieren müssen:

| Beispiel | Konfiguration |
|---|---|
| 12 Teams, Viertelfinale | 3 Gruppen à 4 Teams → Top 2 + 2 beste Dritte → VF (8) **oder** 4 Gruppen à 3 Teams → Top 2 → VF (8) |
| Fußball-WM klassisch | 32 Teams, 8 Gruppen à 4, Top 2 → Achtelfinale (16) |
| EM-Modus | 24 Teams, 6 Gruppen à 4, Top 2 + 4 beste Dritte → Achtelfinale (16) |
| Kleines Turnier | 8 Teams, 2 Gruppen à 4, Top 2 → Halbfinale (4) + Spiel um Platz 3 |
| Nur KO | 16 Teams, direkt Achtelfinale, optional Setzliste |
| Nur Liga | 10 Teams, jeder gegen jeden, optional Hin- & Rückrunde, keine KO-Phase |
| Krumme Zahl | 10 Teams, 2 Gruppen à 5, Top 2 → Halbfinale |

---

## 2. Turniermodi

Das Modul unterstützt vier Modi (`tournament.mode`):

1. **`groups_ko`** – Gruppenphase + KO-Phase (Standard, WM-Stil)
2. **`groups_only`** – Nur Gruppenphase(n), Endstand = Tabelle (Liga-Modus)
3. **`ko_only`** – Nur KO-Baum (Single Elimination), optional mit Spiel um Platz 3
4. **`double_elimination`** – Doppel-KO (Winners + Losers Bracket) — *optional, Phase 2; Architektur muss es aber vorsehen (Phasen-Konzept, siehe §4)*

---

## 3. Konfigurations-Wizard

Die Turniererstellung läuft als Wizard in klar getrennten Schritten. Jeder Schritt validiert live und zeigt eine Vorschau ("X Spiele werden generiert, Dauer ca. Y bei Z Feldern").

### Schritt 1: Grunddaten
- Turniername, Datum, optional Ort
- **Turnier-Logo** (Upload pro Turnier, eigenständig vom Gruppenbild) und optional Titelbild. Das Logo erscheint im Header der Turnieransicht und im PDF-/Druckexport.
- Sportart/Disziplin (frei, beeinflusst nur Labels: "Tore"/"Punkte"/"Becher")
- **Spielfelder/Tische:** Anzahl (Standard 1) UND frei benennbar ("Tisch 1", "Platte A", "Center Court"). Jeder Tisch ist eine eigene Ressource fürs Scheduling.
- **Zeitraster:** Turnier-Startzeit, Standard-Spieldauer, Pausenzeit zwischen Spielen am selben Tisch, optional Mindestpause pro Team zwischen zwei eigenen Spielen. Alles später pro Spiel überschreibbar (§5.3).

### Schritt 2: Teams
Teams werden **ausschließlich vom Admin** angelegt (siehe §1.2), es gibt keine Selbstregistrierung.
- **Massen-Eingabe per Copy-Paste:** Ein großes Textfeld, ein Teamname pro Zeile — aus WhatsApp-Liste oder Excel direkt einfügen, das System legt alle Teams auf einmal an. Das ist der schnellste und wichtigste Eingabeweg.
- Einzeln hinzufügen/bearbeiten/löschen, Reihenfolge per Drag & Drop (= Setzliste)
- Pro Team: Name, optional Farbe, optional Logo/Icon, optional Spielernamen als Freitext
- Duplikatprüfung bei Namen
- Mindestanzahl abhängig vom Modus (siehe Validierung §9)

### Schritt 3: Modus & Gruppenkonfiguration
Bei `groups_ko` oder `groups_only`:

- **Anzahl Gruppen** wählbar (1 bis ⌊Teams/2⌋). UI zeigt sofort die resultierende Verteilung: "3 Gruppen → 4 / 4 / 4" oder bei krummen Zahlen "3 Gruppen → 4 / 4 / 3".
- **Verteilungsmethode:**
  - `random` – Zufällige Auslosung (mit Animation optional)
  - `manual` – Drag & Drop der Teams in Gruppen
  - `seeded` – Setzliste: Teams werden nach Rang im Schlangenmuster verteilt (Snake Seeding: Gruppe A bekommt Seed 1, B Seed 2, C Seed 3, dann rückwärts C Seed 4, B Seed 5, A Seed 6, …), damit die Gruppen ausgeglichen sind
- **Hin- und Rückrunde** (Checkbox): Jede Paarung wird zweimal gespielt
- **Punkteregel konfigurierbar:** Sieg / Unentschieden / Niederlage (Standard 3/1/0, änderbar z. B. 2/1/0)
- **Tabellen-Darstellung konfigurierbar:** Spalten ein-/ausblenden, umbenennen (z. B. "Tore" → "Becher", "Sp." → "Spiele") und in der Reihenfolge ändern. Farben der Qualifikationsplätze frei wählbar. Optional Startwerte/Bonus- oder Strafpunkte pro Team vorgeben (z. B. −3 Punkte wegen Regelverstoß).
  - **Wichtige Einschränkung:** Umbenennen ändert **ausschließlich das Anzeige-Label**, niemals die Datenstruktur oder die Berechnungslogik. In der DB heißt das Feld weiterhin `goals_for`, egal ob im UI „Tore", „Becher" oder „Punkte" steht. Die Labels liegen als reine Anzeigekonfiguration in `config.table_labels`. So bleiben Auswertungen, Exporte und spätere Statistiken über alle Turniere hinweg vergleichbar.
- **Unentschieden erlaubt?** (Ja/Nein). Bei Nein: Spiel kann nicht mit Gleichstand gespeichert werden.
- **Tiebreaker-Reihenfolge frei konfigurierbar** — der Veranstalter bestimmt selbst, was zuerst entscheidet. Alle Kriterien sind gegeneinander verschiebbar, auch „Punkte" und „Direkter Vergleich". Verfügbare Kriterien:
  1. Punkte
  2. Direkter Vergleich (Punkte, dann Differenz, dann erzielte Tore aus den Spielen der punktgleichen Teams untereinander)
  3. Tordifferenz gesamt
  4. Erzielte Tore gesamt
  5. Wenigste Gegentore
  6. Losentscheid / manuelle Entscheidung

  Standardreihenfolge ist 1 → 2 → 3 → 4 → 5 → 6, aber jede andere muss möglich sein: Wer lieber die Tordifferenz vor den direkten Vergleich stellt, kann das tun. Die Reihenfolge wird als Liste in `config.tiebreakers` gespeichert und von der Tabellenberechnung strikt abgearbeitet — **keine fest verdrahtete Sortierung im Code.** Eine Änderung wirkt sich sofort auf alle Gruppentabellen, die Wertung der Dritten und damit auf die Qualifikation aus.

**⚠️ Drag & Drop muss tatsächlich funktionieren.** Im bisherigen Stand ließen sich sortierbare Listen nicht per Drag & Drop bedienen. Das ist im Neubau nicht akzeptabel. Verbindlich sind **drei gleichwertige Bedienwege** für jede sortierbare Liste (Tiebreaker-Reihenfolge, Setzliste, Teamreihenfolge, Spielverschiebung im Zeitraster):

1. **Maus:** HTML5 Drag & Drop mit `dragstart`, `dragover` (inklusive `preventDefault()` — ohne das feuert `drop` nie), `drop` und sichtbarer Einfügemarkierung am Zielelement.
2. **Touch:** **HTML5-Drag-and-Drop löst auf Touchgeräten nicht aus.** Deshalb zwingend zusätzlich Pointer-Events (`pointerdown`/`pointermove`/`pointerup`) mit `document.elementFromPoint()` zur Zielbestimmung, oder eine erprobte Bibliothek. Ein Prototyp, der nur am Desktop funktioniert, gilt als nicht erfüllt.
3. **Tastatur und Barrierefreiheit:** Pfeil-Buttons an jedem Element sowie Bedienung mit den Pfeiltasten bei fokussiertem Element. Diese Buttons sind kein Notbehelf, sondern gleichberechtigt — auf dem Handy sind sie oft der schnellere Weg.

Jede Umsortierung speichert sofort und berechnet die betroffenen Ansichten neu. Der Zustand während des Ziehens ist sichtbar (gezogenes Element gedimmt, Ziel hervorgehoben).

### Schritt 4: Qualifikation & KO-Phase (nur bei `groups_ko`)
- **Aufsteiger pro Gruppe** (N): Wie viele Teams pro Gruppe kommen direkt weiter (1, 2, 3, …)
- **Beste Drittplatzierte / Lucky Loser** (Checkbox + Anzahl M): Zusätzlich kommen die M besten Teams auf Rang N+1 gruppenübergreifend weiter (EM-Logik). Ranking der "besten Dritten" nach denselben Tiebreakern, aber **ohne** direkten Vergleich (sie haben nicht gegeneinander gespielt); bei unterschiedlich großen Gruppen: Vergleich pro Spiel gemittelt oder Streichen der Ergebnisse gegen den Gruppenletzten, damit größere Gruppen keinen Vorteil haben (einfachste robuste Variante: Schnitt pro Spiel — Punkte/Spiel, Tordiff/Spiel, Tore/Spiel).
- Das System berechnet automatisch: `Qualifikanten = Gruppen × N + M` und zeigt an, welche KO-Runde daraus entsteht. Die Zahl der Qualifikanten muss **nicht** eine Zweierpotenz sein → Freilos-Logik (§6.3).
- **Spiel um Platz 3** (Checkbox)
- **Optional: Platzierungsspiele** für Ausgeschiedene (z. B. Gruppendritte spielen Plätze aus) — Phase 2, Architektur vorsehen.
- **Unentschieden-Auflösung im KO:** Auswahl aus `overtime`, `penalty`/`sudden_death`, `replay` — rein informativ als Label; technisch gilt: KO-Spiele brauchen zwingend einen Sieger (Eingabe-Validierung).

### Schritt 5: Zusammenfassung & Generierung
- Übersicht aller Einstellungen
- Button "Turnier generieren" → erzeugt alle Gruppen, alle Gruppenspiele und das komplette KO-Gerüst (mit Platzhaltern wie "Sieger Gruppe A", "Zweiter Gruppe B", "Bester Dritter", "Sieger VF1") in einer Transaktion.

---

## 4. Datenmodell (relationale DB)

Das folgende Schema ist in Postgres-Syntax notiert, lässt sich aber 1:1 auf MySQL übertragen (uuid → CHAR(36)/BINARY(16), jsonb → JSON, timestamptz → DATETIME). Konzeptuell in **Phasen** denken, damit alle Modi mit derselben Engine laufen:

```sql
tournaments (
  id uuid pk,
  group_id fk,            -- [kru:]nest-Gruppe, zu der das Turnier gehört (Pflicht)
  name text,
  logo_url text null,     -- Turnier-Logo
  cover_url text null,
  mode text,              -- 'groups_ko' | 'groups_only' | 'ko_only' | 'double_elim'
  status text,            -- 'draft'      = angelegt, Teams/Config editierbar, kein Spielplan
                          -- 'generated'  = Spielplan erzeugt, noch nicht veröffentlicht,
                          --                komplette Neugenerierung noch gefahrlos möglich
                          -- 'group_stage'= läuft, Ergebnisse werden eingetragen
                          -- 'ko_stage'   = Gruppenphase abgeschlossen, KO läuft
                          -- 'finished'   = beendet, read-only (Korrektur nur mit Warnung)
  is_public boolean default false,   -- Stufe B: öffentliche Live-Seite
  public_token text null unique,     -- Stufe B: nicht erratbarer Link-Token
  public_enabled_at timestamptz null,
  public_revoked_at timestamptz null,  -- Widerruf nachvollziehbar; bei Widerruf Token neu erzeugen
  config jsonb,           -- gesamte Wizard-Konfiguration (Punkteregel, Tiebreaker-Order,
                          -- num_groups, advance_per_group, best_thirds_count,
  -- third_place_match, draws_allowed, double_round_robin, fields, timing …)
  created_at, created_by
)

tournament_teams (
  id uuid pk, tournament_id fk,
  name text,              -- Teams sind reine Datensätze, KEINE Nutzerkonten
  color text null, logo_url text null,
  players text null,      -- Freitext-Spielerliste
  linked_user_ids jsonb null,  -- Stufe B: optionale Verknüpfung zu Gruppenmitgliedern
                               -- NUR für Benachrichtigungen, gibt KEINE Schreibrechte
  seed int null           -- Setzlistenrang (Reihenfolge in der Teamliste)
  -- KEIN group_key hier! Die Gruppenzuordnung erfolgt über group_memberships (siehe unten),
  -- damit ein Team in mehreren Phasen unterschiedlichen Gruppen angehören kann.
)

stages (
  id uuid pk, tournament_id fk,
  type text,              -- 'group' | 'ko'  (später auch 'intermediate_group', 'losers')
  name text,              -- 'Vorrunde', 'Zwischenrunde', 'Endrunde'
  order_index int
)

groups_ (                 -- Turniergruppen (Achtung: nicht mit [kru:]nest-Gruppen verwechseln!)
  id uuid pk, stage_id fk,
  key text,               -- 'A', 'B', 'C' …
  name text               -- 'Gruppe A'
)

group_memberships (       -- Zuordnung Team ↔ Turniergruppe, N:M über Phasen hinweg
  id uuid pk,
  group_id fk,            -- → groups_.id
  team_id fk,             -- → tournament_teams.id
  position int null,      -- optionale feste Reihenfolge innerhalb der Gruppe
  unique (group_id, team_id)
)

matches (
  id uuid pk, tournament_id fk, stage_id fk,
  group_id fk null,       -- gesetzt bei Gruppenspielen
  round text null,        -- 'R32' | 'R16' | 'QF' | 'SF' | 'F' | '3RD' bei KO
  bracket_type text null, -- 'winner' | 'loser' | 'grand_final' — jetzt schon vorsehen,
                          -- damit Double Elimination später ohne Migration nachrüstbar ist.
                          -- Bei Single Elimination immer 'winner'.
  bracket_pos int null,   -- Position im Baum (für Rendering + Verknüpfung)
  team_home uuid null,    -- null solange Platzhalter
  team_away uuid null,
  placeholder_home jsonb null,  -- z. B. {"type":"group_rank","group":"A","rank":1}
  placeholder_away jsonb null,  --      {"type":"match_winner","match":<uuid>}
                                --      {"type":"best_third","index":1}
  score_home int null, score_away int null,
  status text,            -- 'scheduled' | 'live' | 'finished'
  field int null, scheduled_at timestamptz null,
  winner_advances_to uuid null,  -- match-id des Folgespiels
  loser_advances_to uuid null    -- für Spiel um Platz 3 / Losers Bracket
)
```

**Wichtig:** Tabellenstände (Punkte, Tordifferenz …) werden **nicht** persistiert, sondern immer live aus `matches` berechnet (Single Source of Truth = Ergebnisse). Das verhindert Inkonsistenzen bei Korrekturen.

**Autorisierung — bewusst minimal:** Es gibt genau **eine** Prüfung, und die passiert im Backend bei jeder schreibenden Operation: *Ist der Nutzer Owner/Admin der Gruppe, zu der das Turnier gehört?* Wenn ja, darf er alles. Wenn nein, darf er nur lesen. Kein Modul-Gating, keine Rollenmatrix, keine Sonderfälle (§1.1/§1.2). Der Client blendet Bedienelemente zusätzlich aus — verbindlich ist aber allein die Prüfung im Backend, denn ein ausgeblendeter Button ist keine Sicherheit.

**Integrität:** Foreign Keys mit `ON DELETE CASCADE` vom Turnier abwärts. Ergebnisänderungen laufen in Transaktionen (Ergebnis + Aufstieg des Siegers in Folgespiel = eine Transaktion), damit der Baum nie halb aktualisiert ist. Indizes mindestens auf `matches(tournament_id, stage_id)`, `matches(scheduled_at)`, `matches(field, scheduled_at)`.

---

## 5. Gruppenphasen-Logik

### 5.1 Gruppenbildung — der aktuelle Bug
Der bisherige Fehler: Bei Auswahl "Gruppenphase" wird genau eine Gruppe mit allen Teams erstellt. **Korrekt:** Es werden exakt `config.num_groups` Gruppen erzeugt (`A`, `B`, `C`, …) und die Teams gemäß Verteilungsmethode auf diese verteilt. Bei nicht glatter Teilung werden die Reste von vorne aufgefüllt (12 Teams / 5 Gruppen → 3,3,2,2,2). Die UI muss die Verteilung VOR der Generierung anzeigen und manuelles Umverteilen erlauben.

### 5.2 Spielplan pro Gruppe: Round Robin (Berger-Verfahren)
Jede Gruppe spielt jeder gegen jeden. Algorithmus (Circle Method):

1. Teams der Gruppe nummerieren `1..n`. Bei ungeradem `n` ein Dummy-Team "FREI" hinzufügen (Spiele gegen FREI = spielfrei, werden nicht als Match angelegt).
2. Runden = `n-1` (bzw. `n` bei ungeradem Original-n). Pro Runde: Team 1 bleibt fix, alle anderen rotieren im Uhrzeigersinn. Paarungen: Position i gegen Position (n+1−i).
3. Heim/Auswärts pro Team über die Runden ausbalancieren.
4. Bei Hin- & Rückrunde: kompletten Plan spiegeln (Heimrecht getauscht) und anhängen.

### 5.3 Terminierung & Tischzuweisung (Scheduling-Engine)

Die Terminierung ist ein Kernfeature, kein Nebenprodukt. Jedes Spiel bekommt **Uhrzeit + Tisch** und beides ist voll manuell übersteuerbar (Niveau meinspielplan.de / meinturnierplan.de).

**Automatische Generierung:**
1. Die Runden aller Gruppen werden verzahnt (Runde 1 aller Gruppen, dann Runde 2, …).
2. Spiele werden in **Zeitslots** auf die verfügbaren Tische verteilt. Slot-Länge = Spieldauer + Pausenzeit (aus Config). Bei T Tischen laufen bis zu T Spiele parallel.
3. Startzeit jedes Spiels = Turnierstart + Slot-Index × Slot-Länge. Jedes Match speichert `scheduled_at` + `field` (Tisch).
4. **Harte Constraints:** Ein Team spielt nie zwei Spiele im selben Slot. Ein Tisch hat nie zwei Spiele im selben Slot.
5. **Weiche Constraints (bestmöglich erfüllen):** Mindestpause pro Team zwischen eigenen Spielen; Spiele fair über Tische rotieren; Gruppen möglichst parallel fertig werden lassen (damit die KO-Phase pünktlich starten kann).
6. KO-Spiele werden mit geplanten Zeiten ans Ende der Gruppenphase gehängt (VF-Slots, dann SF, Platz 3, Finale). Parallelität in frühen KO-Runden erlaubt (2 VF gleichzeitig auf 2 Tischen), Finale standardmäßig allein.

**Rechenbeispiel (Bierpong, Francs Setup):** 16 Teams, 4 Gruppen à 4, **4 Tischtennisplatten**, Spieldauer 15 min, Pause 5 min, Start 14:00 → 24 Gruppenspiele / 4 parallele Tische = 6 Slots à 20 min. Slot 1: 14:00 (Platte 1–4 je ein Spiel), Slot 2: 14:20, … Gruppenphase fertig 16:00. Danach VF um 16:00 + 16:20 (je 2 parallel), HF 16:40 (parallel), Spiel um Platz 3 17:00, Finale 17:20. Die UI zeigt diese Hochrechnung **live im Wizard** an ("Turnierende ca. 17:40"), bevor generiert wird.

**Algorithmus mit verbindlicher Prioritätenordnung.** Der Planer arbeitet slotweise und greedy. Für jeden Slot wird aus den noch ungeplanten Spielen so lange eines gewählt, bis alle Tische belegt sind oder kein zulässiges Spiel mehr übrig ist. Die Regeln in dieser Reihenfolge — höhere Priorität schlägt niedrigere immer:

1. **Hart, nie verletzbar:** Ein Team spielt nie zwei Spiele im selben Slot. Ein Tisch hat nie zwei Spiele im selben Slot. Ein KO-Spiel wird nie vor den Spielen geplant, aus denen seine Teilnehmer hervorgehen.
2. **Hart:** Rundenreihenfolge innerhalb einer Gruppe bleibt erhalten (Runde 2 nie vor Runde 1 derselben Gruppe).
3. **Weich, wird zuerst geopfert wenn nötig:** Mindestpause pro Team (Standard: 1 Slot). Findet sich für einen Slot kein Spiel, das die Mindestpause einhält, wird sie für dieses eine Spiel verletzt statt einen Tisch leer zu lassen — das Spiel wird in der UI markiert („kurze Pause für Team X") und der Veranstalter kann per Drag & Drop eingreifen.
4. **Weich:** Gruppen sollen möglichst gleichzeitig fertig werden (verzahnte Rundenplanung), damit die KO-Phase pünktlich starten kann.
5. **Weich, niedrigste Priorität:** Faire Tischrotation — kein Team spielt alle Spiele am selben Tisch.

**Konkretes Beispiel zur Auflösung:** 8 Teams, 2 Tische. Team A spielt in Slot 1. Mit Mindestpause 1 dürfte A frühestens in Slot 3 wieder ran. Sind in Slot 2 aber nur noch Spiele mit A verfügbar, greift Regel 3: A spielt in Slot 2, wird markiert, kein Tisch bleibt leer. Der Planer lässt niemals einen Tisch ungenutzt, solange ein Spiel ohne Verletzung einer **harten** Regel möglich ist.

**Determinismus:** Bei gleichwertigen Kandidaten entscheidet eine feste Reihenfolge (Gruppen-Key, dann Rundennummer, dann Match-ID) — keine Zufallsauswahl. Zweimaliges Generieren mit identischer Konfiguration muss denselben Plan ergeben, sonst sind Fehler nicht reproduzierbar.

**Manuelle Kontrolle (Pflicht):**
- **Spielplan-Ansicht als Zeitraster:** Spalten = Tische, Zeilen = Zeitslots. Spiele per **Drag & Drop** zwischen Slots und Tischen verschiebbar. Bei Verschiebung: Constraints live prüfen und Konflikte anzeigen (rot: "Team X spielt um 14:20 bereits auf Platte 2"), aber nicht hart blockieren — Veranstalter darf Konflikte bewusst überstimmen (mit Warnhinweis).
- **Pro Spiel einzeln editierbar:** Uhrzeit (freie Eingabe, nicht nur Raster), Tisch, abweichende Spieldauer.
- **Globale Verschiebung:** "Alle Spiele ab jetzt um +15 min verschieben" (Verzögerungs-Button für den Realfall, dass das Turnier hinterherhinkt). Optional pro Phase ("nur KO-Phase verschieben").
- **Pausenblöcke:** Veranstalter kann Pausen einfügen (z. B. 30 min Burek-Pause um 16:00), alle nachfolgenden Spiele rücken automatisch nach hinten.
- **Neu durchplanen:** Button "Zeitplan neu berechnen ab Spiel X" — behält gespielte Spiele, plant den Rest frisch.
- Änderungen an Zeiten/Tischen ändern **nie** die sportliche Logik (Paarungen, Aufstieg) — Scheduling und Turnierlogik sind strikt getrennte Schichten.

**Anzeige:** Jede Spielkarte zeigt Uhrzeit + Tisch prominent ("14:20 · Platte 3"). Zusätzlich Filteransichten: pro Tisch ("Was läuft auf Platte 2?"), pro Team ("Wann spielt Team Rakija wieder?") und chronologisch gesamt. 

### 5.4 Tabellenberechnung
Pro Gruppe wird die Tabelle live aus allen `finished`-Spielen berechnet:

- Spiele, Siege, Unentschieden, Niederlagen, Tore, Gegentore, Differenz, Punkte
- Sortierung strikt nach der konfigurierten Tiebreaker-Reihenfolge aus `config.tiebreakers` (§3, Schritt 3). Die Berechnung arbeitet diese Liste der Reihe nach ab und kennt **keine** fest verdrahtete Rangfolge. Ändert der Veranstalter die Reihenfolge, ändern sich die Tabellen sofort.

**Direkter Vergleich bei mehreren punktgleichen Teams — expliziter Algorithmus.** Dieser Fall ist die häufigste Fehlerquelle und wird deshalb Schritt für Schritt vorgegeben. Sind zwei **oder mehr** Teams punktgleich, bilde eine Sub-Tabelle ausschließlich aus den Spielen dieser Teams **untereinander** und wende darauf der Reihe nach an: Punkte, Tordifferenz, erzielte Tore.

Entscheidend ist die **Rekursion**: Trennt die Sub-Tabelle die Gruppe nur teilweise, wird sie für jede verbleibende Teilgruppe **neu berechnet**, nicht einfach das nächste Kriterium der Gesamttabelle genommen.

Beispiel: A, B und C haben je 6 Punkte. Die Sub-Tabelle aus den Spielen A–B, B–C, A–C ergibt: C liegt vorn, A und B bleiben gleich. Dann wird C auf Platz 1 der drei gesetzt und für A und B eine **neue** Sub-Tabelle nur aus dem Spiel A–B gebildet. Wer dieses Spiel gewonnen hat, steht vor dem anderen. Es wäre falsch, an dieser Stelle die Dreier-Sub-Tabelle weiterzuverwenden, denn das Ergebnis gegen C verfälscht den Vergleich zwischen A und B.

Pseudocode:

```
rangfolge(teams, kriterien):
  gruppiere teams nach punkten
  für jede punktgleiche gruppe mit >1 team:
      wende direkten vergleich an  → sub-rangfolge
      falls sub-rangfolge weiter teilt:
          für jede noch gleiche teilgruppe: rangfolge(teilgruppe) rekursiv
      falls sub-rangfolge gar nicht teilt:
          weiter mit nächstem gesamt-kriterium (tordifferenz, tore, …)
  abbruch: wenn kein kriterium mehr trennt → losentscheid
```

Rekursionstiefe begrenzen (maximal so viele Durchläufe wie Teams in der Gruppe), damit keine Endlosschleife entsteht.
- Bleibt am Ende Gleichstand auf einem qualifikationsrelevanten Platz: Status "Entscheidung nötig" anzeigen, Veranstalter entscheidet per Los-Button (Zufall, protokolliert) oder manuell.
- UI markiert Qualifikationsplätze farblich (z. B. grüne Linie unter Platz N, gelbe Zone für mögliche beste Dritte).

---

## 6. KO-Phasen-Logik

### 6.1 Qualifikanten bestimmen
Nach Abschluss ALLER Gruppenspiele (oder per Button "Gruppenphase abschließen" mit Bestätigung):

1. Direktqualifikanten: Ränge 1..N jeder Gruppe.
2. Falls konfiguriert: gruppenübergreifendes Ranking der Teams auf Rang N+1 (Regeln §3 Schritt 4), Top M steigen auf.
3. Gesamtseeding für den Baum: erst alle Gruppensieger (untereinander nach Gruppenperformance sortiert), dann alle Zweiten, dann beste Dritte usw.

### 6.2 Bracket-Erzeugung & Seeding
- Bracketgröße = kleinste Zweierpotenz ≥ Qualifikantenzahl (12 Qualifikanten → 16er-Baum mit 4 Freilosen).
- **Standard-Seeding-Regeln (WM-Logik):**
  - Gruppensieger und Gruppenzweite **über Kreuz**: Sieger A vs. Zweiter B, Sieger B vs. Zweiter A, Sieger C vs. Zweiter D usw.
  - Teams aus derselben Gruppe dürfen frühestens im Halbfinale (bei 2 Gruppen: erst im Finale) wieder aufeinandertreffen. Beim Platzieren im Baum: Same-Group-Konflikte durch Slot-Tausch innerhalb derselben Seed-Ebene auflösen.
  - Beste Dritte werden gegen Gruppensieger gelost/gemappt, nie gegen andere Dritte, und nie gegen den Sieger der eigenen Gruppe. Implementierung: deterministisches Mapping mit Konfliktauflösung (kein 495-Zeilen-Lookup nötig — greedy zuweisen: stärkster Sieger bekommt schwächsten zulässigen Dritten, bei Konflikt tauschen).
  - Alternative Option in der Config: `reseed_random` — KO-Paarungen werden neu gelost (nur Constraint: nicht gegen eigenes Gruppen-Team in Runde 1).
- **Bei `ko_only`:** klassisches Seeding 1 vs. n, 2 vs. n−1, Seeds 1 und 2 in gegenüberliegende Baumhälften; ohne Setzliste zufällige Auslosung.

### 6.3 Wenn die Qualifikantenzahl keine Zweierpotenz ist

**Freilose sind die letzte Notlösung, nicht der Normalfall.** Ergibt `Gruppen × N` keine Zweierpotenz, prüft das System in dieser Reihenfolge und schlägt im Wizard aktiv vor:

**Priorität 1 — Mit besten Drittplatzierten auffüllen (Standardweg).**
Fehlende Plätze werden mit den besten Teams auf Rang N+1 gefüllt. Beispiel: 3 Gruppen × 2 = 6 Qualifikanten, 8er-Baum → 2 beste Dritte ergänzen. Vorteil: Alle Teams spielen gleich viele Spiele, kein Team wird ohne Leistung durchgereicht, mehr Spannung in der Gruppenphase bis zum letzten Spiel. **Das ist die Empfehlung, die die UI aktiv anzeigt:** „6 Qualifikanten ergeben keinen sauberen Baum. Empfehlung: 2 beste Dritte ergänzen → Viertelfinale mit 8 Teams."

**Priorität 2 — Vorrunde/Play-off.**
Wenn Auffüllen nicht passt (z. B. 10 Qualifikanten bei 5 Gruppen): Die besten 6 sind direkt im Viertelfinale, Seeds 7–10 spielen zwei Play-off-Spiele um die letzten beiden Plätze. Besser als 6 Freilose in einem 16er-Baum.

**Priorität 3 — Freilose.**
Nur wenn der Veranstalter es ausdrücklich wählt oder keine andere Variante passt. Dann erhalten die **besten** Seeds das Freilos (Belohnung für die Gruppenleistung). Ein Freilos-Spiel wird nicht als Match angelegt, das Team wird direkt in die nächste Runde gesetzt; der Slot im Bracket wird als „Freilos" gerendert.

Alle drei Wege müssen implementiert und im Wizard wählbar sein — Priorität 1 ist vorausgewählt.

### 6.3.1 Ranking der besten Drittplatzierten

Die Dritten haben **nie gegeneinander gespielt** — der direkte Vergleich entfällt hier zwingend. Es wird eine separate, gruppenübergreifende Rangliste nur aus den Teams auf Rang N+1 gebildet:

1. **Punkte**
2. **Tordifferenz** (Sportart-Label beachten: Tore / Punkte / Becher)
3. **Erzielte Tore**
4. **Wenigste Gegentore**
5. **Losentscheid** (Zufall, im Audit-Log protokolliert) — alternativ Fair-Play-Wertung, falls Strafen erfasst werden

**Normalisierung bei ungleich großen Gruppen — genau EINE verbindliche Methode:** Alle Werte werden **pro Spiel** gerechnet (Punkte/Spiel, Tordifferenz/Spiel, Tore/Spiel, Gegentore/Spiel). Sind alle Gruppen gleich groß, ist der Divisor identisch und die Reihenfolge damit deckungsgleich mit dem Rohwertvergleich — es braucht also keine Fallunterscheidung im Code: **immer pro Spiel rechnen.** Das gilt auch für Größenunterschiede von mehr als einem Team (4 vs. 6) und ist damit robuster als das Streichen der Ergebnisse gegen den Gruppenletzten. Diese Alternative wird bewusst **nicht** implementiert und ist auch nicht konfigurierbar — mehrere Methoden erzeugen nur Diskussionen am Turniertag.

Rechnung mit ausreichender Genauigkeit (Dezimal/Rational, nicht auf ganze Zahlen runden), sonst entstehen künstliche Gleichstände.

Die UI zeigt die Rangliste der Dritten während der Gruppenphase live als eigene Tabelle („Wertung der Gruppendritten") mit farbiger Markierung, wer aktuell auf einem Qualifikationsplatz steht.

### 6.3.2 Durchgerechnetes Referenzbeispiel (Pflicht-Testfall)

> **Wichtig zur Einordnung:** Das folgende Beispiel ist **ein Testfall, keine Spezialbehandlung.** Es ist ausgewählt, weil es die Konfliktauflösung besonders gut zeigt — nicht weil 12 Teams eine bevorzugte Größe wären. Die Engine muss **generisch** arbeiten und jede Konstellation beherrschen: 8, 12, 16, 24, 32, 48 Teams, 2 bis 8 Gruppen, gleich oder ungleich große Gruppen, 1 bis 3 Aufsteiger pro Gruppe, mit oder ohne beste Dritte. **Schreibe keinen Code, der auf bestimmte Zahlen prüft** — keine Sonderpfade für „3 Gruppen", keine hinterlegten Paarungstabellen für einzelne Turniergrößen. Die Regeln aus §6.2 und §6.3 gelten für alle Größen gleichermaßen; das Beispiel unten ist lediglich der Fall, an dem du deine Implementierung überprüfst.

**Konfiguration:** 12 Teams, 3 Gruppen à 4, Top 2 + 2 beste Dritte → Viertelfinale.

Endstände:

| Platz | Gruppe A | Gruppe B | Gruppe C |
|---|---|---|---|
| 1. | A1 – 9 Pkt | B1 – 7 Pkt | C1 – 6 Pkt |
| 2. | A2 – 6 Pkt | B2 – 4 Pkt | C2 – 5 Pkt |
| 3. | A3 – 3 Pkt, TD +1 | B3 – 4 Pkt, TD 0 | C3 – 2 Pkt, TD −2 |
| 4. | A4 – 0 Pkt | B4 – 1 Pkt | C4 – 2 Pkt |

**Schritt 1 — Beste Dritte:** B3 (4 Pkt) und A3 (3 Pkt) qualifiziert, C3 (2 Pkt) ausgeschieden. Gleich große Gruppen, also Rohwertvergleich.

**Schritt 2 — Gesamtsetzliste** (erst alle Sieger untereinander nach Gruppenleistung, dann alle Zweiten, dann die Dritten):

| Seed | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Team | A1 | B1 | C1 | A2 | C2 | B2 | B3 | A3 |

**Schritt 3 — Standardpaarungen im 8er-Baum** (1–8, 4–5, 3–6, 2–7; Seeds 1 und 2 landen dadurch in gegenüberliegenden Hälften):

- VF1: A1 – A3 → ⚠️ Konflikt (beide Gruppe A)
- VF2: A2 – C2 → ok
- VF3: C1 – B2 → ok
- VF4: B1 – B3 → ⚠️ Konflikt (beide Gruppe B)

**Schritt 4 — Konfliktauflösung:** Tausch innerhalb derselben Seed-Ebene. Seeds 7 und 8 tauschen die Plätze, beide Konflikte sind damit aufgelöst:

| Spiel | Paarung |
|---|---|
| VF1 | **A1 – B3** |
| VF2 | **A2 – C2** |
| VF3 | **C1 – B2** |
| VF4 | **B1 – A3** |

Halbfinale: Sieger VF1 vs. Sieger VF2 | Sieger VF3 vs. Sieger VF4.

**Bewusste Einschränkung:** A1 und A2 können sich im Halbfinale treffen. Bei nur 3 Gruppen und 8 Qualifikanten ist das mathematisch nicht vermeidbar. Regel bleibt: Gruppengegner **nie im Viertelfinale**, ab Halbfinale zulässig (identisch zur WM-Praxis).

**Algorithmus der Konfliktauflösung (allgemein):** Standardpaarungen bilden → jedes Spiel auf gleiche Gruppenherkunft prüfen → bei Konflikt Tauschpartner in derselben Seed-Ebene suchen, der keinen neuen Konflikt erzeugt → tauschen → erneut prüfen. Findet sich in der Ebene kein Partner, in die nächsthöhere Ebene ausweichen. Nach maximal so vielen Durchläufen wie Seeds abbrechen und dem Veranstalter die verbleibenden Konflikte zur manuellen Entscheidung anzeigen — niemals in eine Endlosschleife laufen.

### 6.4 Automatisches Aufsteigen
Jedes KO-Match kennt `winner_advances_to` (und ggf. `loser_advances_to` für Platz 3 / Doppel-KO). Beim Speichern eines Ergebnisses:

1. Sieger ermitteln (Gleichstand im KO ist ungültig → Eingabe blockieren mit Hinweis auf konfigurierten Auflösungsmodus).
2. Sieger in den entsprechenden Slot des Folgespiels schreiben (Platzhalter ersetzen).
3. Verlierer ggf. ins Spiel um Platz 3 schreiben.
4. Bei **Ergebniskorrektur** eines bereits abgeschlossenen Spiels: Kaskade prüfen — wenn der Sieger wechselt und Folgespiele schon Ergebnisse haben, Warnung anzeigen und Folgespiele auf Wunsch zurücksetzen. Niemals stillschweigend inkonsistente Zustände zulassen.

### 6.5 Rundenbenennung
Automatisch nach Bracketgröße: 32 → Sechzehntelfinale, 16 → Achtelfinale, 8 → Viertelfinale, 4 → Halbfinale, 2 → Finale, plus "Spiel um Platz 3".

---

## 7. Ergebniseingabe & Aktualisierung

**Grundsatz: Es gibt keinen Live-Ticker.** Ergebnisse werden **ausschließlich vom Gruppen-Owner/Admin** nachträglich eingetragen, wenn ein Spiel fertig ist (§1.2). Ein Spiel hat deshalb nur zwei Zustände: **offen** (Ergebnis fehlt) und **beendet**. Ein Zwischenzustand „läuft" ist optional und darf nirgends Voraussetzung sein.

**Die geplante Uhrzeit ist eine Planung, keine Sperre.** Ein Ergebnis lässt sich **jederzeit** eintragen — vor der geplanten Zeit, lange danach, oder in beliebiger Reihenfolge. Turniere laufen in der Praxis schneller oder langsamer als geplant. Es darf **keine** Regel geben, die eine Eingabe an eine Uhrzeit, einen Status oder eine Reihenfolge knüpft. Einzige Ausnahme: Ein K.-o.-Spiel kann erst eingetragen werden, wenn seine Teilnehmer feststehen.

- Eingabe an zwei Stellen: direkt am Spiel in der Liste („Eintragen" / „Ändern") und über eine Hauptaktion „Ergebnis eintragen", die zuerst eine Auswahl der offenen Spiele zeigt.
- Bereits eingetragene Ergebnisse sind jederzeit korrigierbar (mit Kaskadenprüfung, §6.4).
- Nach dem Speichern werden Tabellen, Baum und Übersicht sofort neu berechnet.
- Mehrgeräte-Betrieb: Aktualisierung über WebSocket, Server-Sent Events oder Polling im 5–10-Sekunden-Takt. Für die Ergebniseingabe selbst ist das nicht kritisch, da nur der Admin schreibt.
- Undo: Das zuletzt gespeicherte Ergebnis ist mit einem Tap korrigierbar.

**„Als Nächstes" statt „Jetzt live".** Das prominente Element auf der Übersicht zeigt die nächsten anstehenden Spiele mit Uhrzeit und Tisch. Bei einem eintägigen Turnier nur die Uhrzeit („16:24 Uhr"), bei mehrtägigen zusätzlich das Datum („Sa, 05.09. · 16:24 Uhr"). Jedes dieser Spiele hat direkt daneben die Schaltfläche zum Eintragen des Ergebnisses.

---

## 8. UI / UX — das Design ist ein Hauptauftrag, kein Beiwerk

### 8.0 Was aktuell falsch ist

Der bestehende Zustand ist im Detail dokumentiert. Diese Fehler sind alle im aktuellen Build sichtbar und dürfen im Neubau **keiner** mehr auftreten:

1. **Der gesamte Turnierinhalt steckt in einer schmalen Spalte** von etwa 450px am linken Rand. Rechts daneben bleiben auf einem 1900px-Bildschirm über 1300px komplett leer. Das ist der schwerwiegendste Fehler.
2. **Die Karte hat eine feste Breite**, dadurch wird der Inhalt abgeschnitten und erzeugt Scrollbalken innerhalb der Karte.
3. **Die Modul-Navigation (Übersicht · Teams · Gruppen · Bracket · Spiele · Regelwerk) steckt in einem winzigen, horizontal scrollbaren Streifen** mit sichtbaren Scrollpfeilen und Scrollbalken. Sie ist dadurch praktisch unbenutzbar. Auf dem Desktop gehört eine Navigation nie in einen Scrollcontainer.
4. **Zahlen in Klammern rutschen unter die Beschriftungen** („Teams" / „(12)" in getrennten Zeilen), weil kein Platz da ist.
5. **Buttons stapeln sich unstrukturiert** in zwei- und dreispaltigen Restanordnungen mit unterschiedlichen Breiten. Es gibt keine erkennbare Hierarchie: „Auto-Planen", „Ergebnis eintragen" und „Neues Turnier" sehen alle gleich wichtig aus.
6. **Zu viele gleichrangige Aktionen auf einmal** — Registrierung, Starten, Beenden, Löschen, Live-Tabelle, Spielplan, Public, Drucken/PDF, PDF-Export, Beamer, Löschen. Darunter Dopplungen („Drucken / PDF" und „PDF-Export" sind dasselbe) und ein zweites „Löschen".
7. **Emoji werden als Symbole verwendet** (📊 🏆 📅 ⚽ 🔓 🖨️ 📺 🗑️). Sie sehen auf jedem Betriebssystem anders aus, passen nicht zum ruhigen Linien-Icon-Stil der übrigen App und wirken unfertig.
8. **Technische Werte stehen in der Oberfläche**: „group_stage", „groups_ko". Der Nutzer sieht Datenbankwerte statt lesbarer Bezeichnungen („Gruppenphase", „Gruppen + K.-o.").
9. **Der Status wird doppelt angezeigt** — einmal als Badge „Entwurf", einmal als Feld „Status group_stage". Beide widersprechen sich sogar.
10. **Statuskacheln als Buttons gestaltet**, obwohl sie nichts auslösen (Teams 12, Gruppen 4, Spiele 12). Was aussieht wie ein Button, muss klickbar sein.
11. **Leerzustand ohne Führung** — „Noch kein Zeitplan" mit einem Button, der dasselbe tut wie der große Button direkt darüber.
12. **In den Gruppentabellen stehen Datenbank-IDs statt Teamnamen** (`cmsm7zaqv0002qnvpjcmiw1h0`). Der schwerwiegendste Fehler überhaupt — die Tabelle ist dadurch vollständig unbrauchbar.
13. **Gruppentabellen liegen alle untereinander** in derselben schmalen Spalte, obwohl vier Gruppen bei verfügbarer Breite nebeneinander stehen müssten.
14. **Spaltenüberschriften sind nicht erklärt** (P · S · U · N · TD) und es fehlen Spalten, die dazugehören (Spiele, Tore, Gegentore).
15. **Die Gruppenzahl in der Navigation stimmt nicht mit dem Inhalt überein** — angezeigt werden vier Gruppen, die Navigation nennt eine andere Zahl.

**Regel, die sich aus Fehler 12 ableitet und für das gesamte Modul gilt:** Die Oberfläche zeigt **niemals** Rohwerte aus der Datenbank. Zwischen Datenschicht und Darstellung liegt eine Aufbereitungsschicht, die IDs in Namen, Statuscodes in deutsche Bezeichnungen und Zeitstempel in lesbare Uhrzeiten übersetzt. Kein Bildschirm greift direkt auf Datenbankzeilen zu. Wenn irgendwo eine ID, ein `null` oder ein englischer Statuscode sichtbar wird, gilt das als Fehler.

**Zielzustand:** Auf dem Desktop soll sich das Modul wie eine eigenständige Anwendung anfühlen, die den verfügbaren Platz nutzt — nicht wie eine vergrößerte Handy-App in einer Ecke. Auf dem Handy bleibt es voll bedienbar. Beide sind eigenständige Layouts, nicht dieselbe Ansicht in zwei Größen.

**Prüfkriterium:** Bei 1920×1080 im Vollbild darf kein ungenutzter Rand von mehr als 5 % der Bildschirmbreite entstehen, und die drei Kernelemente (Gruppentabellen, Spielplan, Turnierbaum) müssen ohne Scrollen zwischen ihnen erreichbar sein.

### 8.1 Responsive-Strategie — zwei eigenständige Layouts

- **Container:** Kein `max-width` in Mobile-Größe. Erlaubt ist ein großzügiges Maximum (z. B. 1600–1800px) zur Vermeidung überlanger Zeilen auf sehr breiten Monitoren — aber der Inhalt muss diesen Rahmen auch **füllen**, statt in einer 500px-Spalte darin zu stehen.
- Breakpoints:
  - `< 768px` — **Mobile:** einspaltig, Tabs für Gruppen / Spielplan / Baum, große Touch-Targets (min. 44px), Ergebniseingabe mit Zahlenfeld.
  - `768–1200px` — **Tablet:** zwei Spalten, Gruppen links, Spielplan rechts.
  - `> 1200px` — **Desktop:** dreispaltiges Arbeitslayout. Links schmale Navigation (Turnierphasen, Gruppen, Runden), Mitte der Hauptinhalt in voller Breite, rechts eine Kontextspalte (nächste Spiele, Tischbelegung, Live-Stand). Gruppentabellen als Karten-Grid mit 2–4 Karten nebeneinander (`repeat(auto-fit, minmax(320px, 1fr))`).
- Keine absoluten Pixelbreiten für Kernelemente. Grid und Flex mit `minmax()`, `fr` und `auto-fit`. **Kein horizontaler Überlauf auf Mobil:** `overflow-x:hidden` auf `body`, `min-width:0` auf allen Grid- und Flex-Kindern, und `minmax(min(100%, 300px), 1fr)` statt `minmax(300px, 1fr)`. Die Seite darf sich auf dem Handy **nicht** seitlich verschieben lassen. Breite Inhalte wie der Turnierbaum bekommen einen **eigenen** Scrollcontainer, der die Seite nicht mitschiebt.
- **Die mobile Tab-Leiste hat eine feste Höhe, die sich bei keinem aktiven Tab ändert.** Verbindlich: feste `height` auf der Leiste selbst (nicht nur `min-height`), `align-items:center`, und auf jedem Tab `flex:0 0 auto`, feste `height`, `line-height:1` und `white-space:nowrap`. Ohne diese Kombination wächst die Leiste, sobald ein Tab mit längerem Namen aktiv wird — genau das passiert im aktuellen Stand bei „Einstellungen".
- **Typografie und Abstände getrennt skalieren:** Desktop bekommt kleinere Schrift und engere Zeilenhöhen als Mobile, nicht dieselben Werte hochgerechnet. `clamp()` für flüssige Skalierung, einheitliches Spacing-Raster (4/8/12/16/24/32px).
- Tabellen auf dem Desktop als echte Tabellen mit ausgerichteten Spalten; auf Mobile als kompakte Kartenliste. Nicht dieselbe Tabelle horizontal scrollbar machen.
- Dichte-Umschalter optional („kompakt" / „komfortabel") für Nutzer, die viele Spiele gleichzeitig sehen wollen.

### 8.2 Bracket-Rendering
- KO-Baum als CSS-Grid oder SVG: Spalten = Runden, Verbindungslinien zwischen den Spielen (Sieger-Pfade).
- **Auf Desktop muss ein 8er- und 16er-Baum vollständig ohne Scrollen sichtbar sein** — das ist der sichtbarste Beweis, dass die Desktop-Ansicht kein vergrößertes Handy-Layout mehr ist. Bei 32er-Baum horizontal scroll- und zoombar.
- Auf Mobile: horizontal scrollbar mit Snap pro Runde, Mini-Map oder Runden-Tabs.
- Platzhaltertexte im Baum ("Sieger Gruppe A", "Sieger VF2") bis Teams feststehen; feststehende Teams mit Farbe/Logo. Sieger fett/farbig, Verlierer ausgegraut. Abgeschlossene Pfade dezent animiert hervorheben.

### 8.3 Match-Detail-Ansicht (eigenes Panel/Modal)
Jedes Spiel öffnet sich per Klick in einem eigenen Panel — Kontext bleibt erhalten, kein Seitenwechsel. Enthält:
- Ergebnis (inkl. optionaler Zwischenstände/Sätze, siehe unten), Status, Uhrzeit, Tisch
- Notizfeld (z. B. "Becher-Nachwurf strittig"), optional Foto
- Optional Spielerstatistiken pro Match (Tore/Punkte/Becher pro Spieler, Karten/Strafen) → daraus wird automatisch eine **Torschützen-/Bestenliste** berechnet
- Historie: Wer hat wann welches Ergebnis eingetragen (Audit-Log)
- **Mehrere Teilergebnisse pro Match konfigurierbar:** Für Sportarten mit Sätzen/Legs/Runden (Dart, Tischtennis, Bierpong "Best of 3") kann pro Match eine Serie erfasst werden. Config: `results_per_match` (1–n) + Auswertungsregel (Sätze zählen oder Summe).

### 8.4 Branding & Darstellung des Turniers
- Turnier-Logo und Titelbild hochladen, Highlight-/Akzentfarbe frei wählbar, Hell-/Dunkel-Theme
- Teamlogos oder Icon-/Farbauswahl pro Team (Farbe reicht als Minimum — visuelle Unterscheidbarkeit ist wichtiger als das Logo)
- Freie Info-Seiten/Blöcke im Turnier: Regelwerk, Anfahrt, Getränke/Essen, Strafenkatalog, Sponsoren (Text + Bild + Link). Für Bierpong konkret: Regelwerk-Tab direkt neben Spielplan.
### 8.5 Druck- & PDF-Export (Kernfeature, nicht optional)

Der Plan muss zum Aushängen taugen. Eigene Druckansicht mit `@media print`-Stylesheet, Ausgabe als **A4-PDF**.

**Auswählbare Blöcke** (Checkboxen vor dem Export):
1. **Spielplan chronologisch** — der wichtigste Block. Alle Spiele **untereinander** als Liste, pro Zeile: `Uhrzeit | Tisch | Gruppe/Runde | Team A – Team B | Ergebnisfeld`. Bei noch nicht feststehenden KO-Teams der Platzhaltertext („Sieger VF2"). Ergebnisfeld bleibt leer und ist breit genug zum Eintragen mit Stift.
2. **Gruppen mit Tabellen** — pro Gruppe die Teamliste und eine leere bzw. aktuelle Tabelle mit allen Spalten.
3. **Turnierbaum** — Bracket im Querformat, notfalls über zwei Seiten.
4. **Zeitplan pro Tisch** — eine Seite je Tisch, nur dessen Spiele. Zum Aufhängen direkt an der Platte.
5. **Regelwerk / Info-Seiten** (§8.4)

**Layout-Anforderungen:**
- Turnier-Logo und Turniername im Kopf jeder Seite, Seitenzahlen im Fuß
- Schwarz-weiß-tauglich: keine Information ausschließlich über Farbe transportieren (Qualifikationsplätze zusätzlich durch Linie oder Symbol markieren)
- Keine abgeschnittenen Tabellen, sauberer Seitenumbruch zwischen Blöcken (`break-inside: avoid` für Gruppen-Karten und Match-Zeilen)
- Zwei Ausgabevarianten: **„Zum Ausfüllen"** (Ergebnisse leer) und **„Aktueller Stand"** (Ergebnisse eingedruckt)
- Später (§11 Stufe B): QR-Code auf jeder Seite, der auf die öffentliche Live-Seite verweist
### 8.6 Konkrete Designvorgabe — verbindliche Werte

Diese Werte sind keine Anregung. Übernimm sie als CSS-Variablen und leite jede Farbe und Schriftgröße daraus ab.

**Grundsatz: Das Turniermodul fügt sich in [kru:]nest ein.** Die Kernanwendung hat eine warme, ruhige Gestaltung — cremefarbener Hintergrund, weiße Karten, gedeckter brauner Akzent, weiche Rundungen, feine Linien-Symbole, freundliche Groteskschrift. **Das bleibt so.** Das Turniermodul erfindet keine eigene Farbwelt und keine eigene Schrift. Es ist derselbe Raum, nur mit dichterem, datenlastigerem Inhalt.

**Der Unterschied zum Foto- und Feed-Modul liegt nicht in der Farbe, sondern in der Struktur:** Turnierdaten brauchen ausgerichtete Spalten, tabellarische Ziffern, engere Zeilenabstände und klare Statusfarben. Ruhig wie der Rest der App, aber deutlich informationsdichter.

**Farbpalette (hell) — aus der bestehenden Anwendung übernommen:**

```css
--paper:      #FAF7F1;  /* Seitenhintergrund, warmes Creme wie in [kru:]nest */
--surface:    #FFFFFF;  /* Karten, Tabellen */
--surface-alt:#F5F1E9;  /* Zebra-Zeilen, hinterlegte Bereiche */
--ink:        #1F1B16;  /* Text, warmes Schwarz */
--ink-soft:   #8A8077;  /* Sekundärtext, Beschriftungen */
--line:       #E7DFD2;  /* feine Linien und Rahmen */
--accent:     #8B6B4A;  /* Hauptaktionen, aktive Navigation — das Braun der App */
--accent-soft:#F0E7DA;  /* Hintergrund aktiver Navigationspunkte */
--live:       #C0453A;  /* laufendes Spiel, gedecktes Rot passend zur Palette */
--qualified:  #4F7A4A;  /* Aufstiegsplatz, gedecktes Grün */
--pending:    #C08A2E;  /* mögliche beste Dritte, warnendes Ocker */
--out:        #A79E94;  /* ausgeschieden */
--highlight:  #DDE86B;  /* das Limegrün der App, sehr sparsam für Sieger */
```

Die Statusfarben sind bewusst gedeckt gewählt, damit sie neben dem warmen Creme nicht grell wirken. Signalfarben aus einem typischen Dashboard (#FF0000, #00FF00) sind ausdrücklich unzulässig.

**Farbpalette (dunkel), passend zum vorhandenen Nachtmodus:** `--paper: #1A1714`, `--surface: #23201B`, `--surface-alt: #2A2620`, `--ink: #F2EDE4`, `--ink-soft: #A69C90`, `--line: #332E27`. Akzent- und Statusfarben um etwa 12 % aufhellen.

**Schriften:** Die Schriftfamilie der Kernanwendung wird unverändert übernommen — keine zusätzliche Display-Schrift, keine Google-Fonts-Einbindung. Unterschieden wird ausschließlich über Schriftstärke, Größe und Laufweite:

- **Teamnamen und Rundenbezeichnungen:** Schriftstärke 600, Laufweite `0.01em`. Keine Versalien für Teamnamen (Namen wie „Rakija Boys" wirken in Großbuchstaben aggressiv), aber Versalien für kurze Bezeichnungen wie „VIERTELFINALE" und „GRUPPE A", in kleiner Größe mit Laufweite `0.08em`.
- **Zahlen immer** mit `font-variant-numeric: tabular-nums`, sonst springen die Tabellenspalten.

**Größen (Desktop / Mobile):** Hilfstext 12/13 · Standard 14/15 · Betonung 16/17 · Kartenüberschrift 20/20 · Seitentitel 28/24 · Spielstand in der Match-Zeile 22/20.

**Formen und Kanten:** Die weichen Rundungen der App beibehalten — 12px für Karten, 10px für Buttons und Eingabefelder, 999px für Badges. Tabellenzeilen ohne Rundung. Trennung über 1px-Linien in `--line`, nicht über Schatten. Schatten ausschließlich bei modalen Dialogen.

**Symbole:** Derselbe Linien-Icon-Satz wie im Rest von [kru:]nest, gleiche Strichstärke, gleiche Größe (20px in der Navigation, 16px inline). **Keine Emoji als Symbole** — weder in Navigation noch in Buttons oder Statusanzeigen. Das ist einer der auffälligsten Mängel des aktuellen Stands.

**Signaturelement — das „Als Nächstes"-Band:** Ganz oben in der Übersicht (C1) steht ein Band über die volle Breite mit den nächsten anstehenden Spielen. Grund in `--ink`, Uhrzeit groß und tabellarisch, Teamnamen in Weiß, je Spiel direkt daneben die Schaltfläche zum Eintragen des Ergebnisses (nur Admin). Das ist das eine Element, das auffallen darf — ein Stück Sporthalle in einer sonst ruhigen App. Alles andere bleibt zurückhaltend.

**Match-Zeile (die meistgenutzte Komponente):** Links ein 3px-Statusstreifen (`--line` = geplant, `--live` = läuft, `--qualified` = beendet). Dann Uhrzeit und Tischnummer klein in `--ink-soft`. Dann die beiden Teamnamen, jeweils mit 8px-Farbpunkt des Teams davor. Rechts der Spielstand in einem abgesetzten Block mit tabellarischen Ziffern. Der Sieger wird durch Schriftstärke 700 markiert, nicht durch eine Hintergrundfarbe.

**Schaltflächen-Hierarchie — pro Ansicht genau eine Hauptaktion.** Gefüllt in `--accent` ist nur der eine wichtigste Button („Turnier generieren", „Ergebnis speichern"). Alles andere ist entweder ein Umriss-Button oder ein reiner Textlink. Zerstörende Aktionen (Löschen, Zurücksetzen) stehen nicht zwischen den normalen Aktionen, sondern in einem eigenen, abgesetzten Bereich am Ende der Einstellungen. **Nie mehr als sechs Schaltflächen gleichzeitig sichtbar** — was darüber hinausgeht, gehört in ein Kontextmenü.

**Sprache in der Oberfläche:** Deutsch, du-Form, normale Groß-/Kleinschreibung. **Niemals technische Werte anzeigen** — nicht `group_stage`, sondern „Gruppenphase"; nicht `groups_ko`, sondern „Gruppen + K.-o.-Runde". Buttons benennen die Handlung: „Ergebnis speichern" statt „Absenden". Jeder Zustand wird genau einmal angezeigt, nicht doppelt an verschiedenen Stellen. Fehlermeldungen sagen, was passiert ist und was zu tun ist. Leere Ansichten führen zur nächsten Handlung — und wiederholen dabei nicht einen Button, der direkt darüber schon steht.

**Bewegung:** Nur zwei Animationen im gesamten Modul — das Aufblenden einer aktualisierten Tabellenzeile (150 ms) und der Übergang beim Öffnen eines Dialogs (200 ms). Sonst keine. `prefers-reduced-motion` schaltet beide ab.

### 8.7 Allgemeine visuelle Qualität

Das Modul soll sich hochwertig anfühlen, nicht nach Prototyp. Verbindlich:

- **Designsystem der bestehenden App übernehmen** (Farben, Radien, Schatten, Schriftfamilie), damit das Turniermodul nicht wie ein Fremdkörper neben Feed und Fotomodul wirkt. Hell- und Dunkelmodus unterstützen, falls vorhanden.
- **Klare visuelle Hierarchie:** Auf einen Blick erkennbar, was gerade wichtig ist — laufende Spiele hervorgehoben, kommende Spiele normal, beendete zurückgenommen. Nicht alles gleich laut.
- **Gruppen-Tabellen:** Zebra-Zeilen, rechtsbündige Zahlenspalten mit tabellarischen Ziffern (`font-variant-numeric: tabular-nums`), farblich markierte Qualifikationszonen (grün = weiter, gelb = mögliche beste Dritte, neutral = raus).
- **Zustände sauber gestalten:** Leerzustände mit Erklärung und nächstem Schritt („Noch keine Ergebnisse — Spielplan ansehen"), Ladezustände als Skeleton statt Spinner, damit das Layout nicht springt.
- **Micro-Feedback:** sichtbare Speicherbestätigung, sanfte Übergänge beim Aktualisieren von Tabellen und Baum. Animationen kurz (150–250 ms) und dezent — sie sollen Veränderung verständlich machen, nicht auffallen. `prefers-reduced-motion` respektieren.
- **Konsistenz:** Ein Match sieht überall gleich aus (Spielplan, Gruppe, Baum, Kontextspalte) — eine Match-Komponente, nicht vier verschiedene.
- Barrierefreiheit als Mindeststandard: Kontrastverhältnis mindestens 4,5:1, Fokus-Ringe sichtbar, alles per Tastatur bedienbar, Statusinformation nie ausschließlich über Farbe.

---

## 9. Validierung & Edge Cases

Die Engine muss folgende Fälle korrekt behandeln (als Testfälle implementieren):

1. `num_groups` so, dass Gruppen mit nur 1 Team entstünden → blockieren (min. 2 Teams/Gruppe; mit KO-Phase: min. so viele Teams, dass die gewählte KO-Runde erreichbar ist).
2. Ungerade Teamzahl in einer Gruppe → Round Robin mit Spielfrei korrekt.
3. Qualifikanten keine Zweierpotenz (z. B. 3 Gruppen × 2 = 6) → 8er-Baum mit 2 Freilosen ODER Vorschlag "2 beste Dritte hinzunehmen → sauberes Viertelfinale". Beide Wege anbieten.
4. Punktgleichheit auf Quali-Platz inkl. identischem direkten Vergleich → Losentscheid-Flow.
5. Ergebniskorrektur nach Gruppenabschluss, die die Quali-Reihenfolge ändert → Warnung + Option, KO-Phase neu zu seeden (nur wenn KO noch nicht gestartet; sonst nur mit explizitem "KO zurücksetzen").
6. Team zieht zurück: vor Turnierstart → aus Verteilung entfernen, Plan neu generieren; während Gruppenphase → alle Spiele des Teams als 0:X-Wertung oder Streichung (Config-Entscheidung, Standard: Restspiele 0:2-Wertung, bereits gespielte bleiben); im KO → Gegner Freilos.
7. `groups_only` mit 1 Gruppe = Ligamodus — DAS ist der einzige Fall, in dem eine einzige Gruppe mit allen Teams korrekt ist.
8. Doppelte Teamnamen verhindern, Turnier ohne Teams nicht generierbar.

---

## 10. Akzeptanzkriterien (Definition of Done)

- [ ] 12 Teams → "4 Gruppen à 3, Top 2 → Viertelfinale" erzeugt: 4 Gruppen, 12 Gruppenspiele (3 pro Gruppe), 8er-KO-Baum mit korrekten Kreuz-Paarungen, kein Same-Group-Duell im VF.
- [ ] 12 Teams → "3 Gruppen à 4, Top 2 + 2 beste Dritte → Viertelfinale" erzeugt 18 Gruppenspiele und liefert exakt die Paarungen aus §6.3.2 (A1–B3, A2–C2, C1–B2, B1–A3), inkl. korrekt aufgelöster Gruppenkonflikte.
- [ ] Bei 6 Qualifikanten schlägt der Wizard aktiv "2 beste Dritte ergänzen" vor, statt stillschweigend Freilose zu erzeugen.
- [ ] Beste-Dritte-Ranking bei ungleich großen Gruppen rechnet pro Spiel (Testfall: 2 Gruppen à 4 + 1 Gruppe à 3).
- [ ] 32 Teams WM-Modus vollständig durchspielbar bis Finale + Spiel um Platz 3, alle Aufstiege automatisch.
- [ ] 10 Teams `groups_only` (1 Gruppe, Hin-/Rückrunde) → 90 Spiele, korrekte Tabelle.
- [ ] Tiebreaker inkl. direktem Vergleich nachweislich korrekt (Unit-Tests mit konstruierten Gleichstands-Szenarien), **inklusive Dreier-Gleichstand, der sich nach der Sub-Tabelle in einen Zweier-Gleichstand auflöst** — dann muss die Sub-Tabelle für die verbleibenden zwei Teams neu berechnet werden.
- [ ] Beste-Dritte-Ranking rechnet immer pro Spiel; Testfall mit 4er- und 6er-Gruppe im selben Turnier liefert eine faire Reihenfolge.
- [ ] **Weitere Größen laufen mit derselben Engine, ohne Sonderfälle im Code:** 8 Teams / 2 Gruppen / Top 2 → Halbfinale · 16 Teams / 4 Gruppen / Top 2 → Viertelfinale · 24 Teams / 6 Gruppen / Top 2 + 4 beste Dritte → Achtelfinale (EM-Modus) · 32 Teams / 8 Gruppen / Top 2 → Achtelfinale (WM-Modus) · 10 Teams / 2 Gruppen à 5 / Top 2 → Halbfinale · 16 Teams reines K.-o. · 10 Teams reine Liga mit Hin- und Rückrunde.
- [ ] **Kein Code prüft auf konkrete Turniergrößen.** Keine `if (teams === 12)`-Zweige, keine hinterlegten Paarungstabellen je Größe, keine Sonderpfade für einzelne Gruppenanzahlen.
- [ ] Zweimaliges Generieren mit identischer Konfiguration erzeugt einen identischen Spielplan (Determinismus).
- [ ] Ein Team kann über zwei Phasen hinweg unterschiedlichen Gruppen zugeordnet sein (Testfall Zwischenrunde), ohne dass die Gruppenphase-1-Tabelle kaputtgeht.
- [ ] Ergebniskorrektur kaskadiert sauber, keine verwaisten Teams im Baum.
- [ ] **Desktop 1920×1080:** Layout füllt die Breite, kein ungenutzter Rand über 5 % je Seite. Gruppen als Karten-Grid nebeneinander, nicht untereinander in einer schmalen Spalte.
- [ ] **Desktop:** 8er- und 16er-Turnierbaum vollständig ohne Scrollen sichtbar.
- [ ] **Sichtprüfung:** Ein Screenshot der Desktop-Ansicht darf nicht als vergrößerte Handy-Ansicht erkennbar sein — unterschiedliche Spaltenzahl, unterschiedliche Schriftgrößen, unterschiedliche Informationsdichte gegenüber Mobile.
- [ ] Kein horizontales Scrollen auf irgendeiner Breite zwischen 320px und 2560px (Ausnahme: der Turnierbaum in seinem eigenen Scrollcontainer, der die Seite nicht mitschiebt).
- [ ] Auf dem Handy lässt sich die Seite nicht seitlich verschieben — auch nicht mit dem Finger über den Bildschirmrand hinaus.
- [ ] Die mobile Tab-Leiste behält bei jedem aktiven Tab dieselbe Höhe.
- [ ] Ein Ergebnis lässt sich zu jedem Zeitpunkt eintragen, unabhängig von der geplanten Uhrzeit und in beliebiger Reihenfolge; bereits eingetragene Ergebnisse sind änderbar.
- [ ] Die Filter im Spielplan funktionieren tatsächlich und verändern die angezeigte Liste.
- [ ] **Die Tiebreaker-Reihenfolge ist frei sortierbar** und wirkt sich sofort aus: Ein konstruierter Testfall mit zwei punktgleichen Teams, bei denen direkter Vergleich und Tordifferenz zu unterschiedlichen Ergebnissen führen, muss je nach Reihenfolge eine andere Platzierung liefern.
- [ ] **Drag & Drop funktioniert mit der Maus UND auf dem Touchscreen** — geprüft auf einem echten Handy, nicht nur im Desktop-Browser mit schmalem Fenster. Zusätzlich sind Pfeil-Buttons und Pfeiltasten bedienbar.
- [ ] Mobile bleibt vollständig bedienbar, Touch-Targets mindestens 44px.
- [ ] Ein Match sieht in Spielplan, Gruppenansicht und Baum identisch aus (eine gemeinsame Komponente).
- [ ] Realtime: Ergebnis auf Gerät A erscheint ohne Reload auf Gerät B.
- [ ] Scheduling: 16 Teams / 4 Gruppen / 4 Tische / 15+5 min → automatisch 6 Gruppen-Slots mit korrekten Uhrzeiten, kein Team doppelt in einem Slot, kein Tisch doppelt belegt.
- [ ] Spiel per Drag & Drop auf anderen Tisch/Slot verschieben funktioniert, Konflikt wird angezeigt, Turnierlogik bleibt unberührt.
- [ ] "+15 min ab jetzt"-Verschiebung und eingefügter Pausenblock verschieben alle Folgespiele korrekt.
- [ ] Uhrzeit und Tisch jedes Spiels einzeln frei editierbar.
- [ ] **Außerhalb des Modulverzeichnisses wurde nichts geändert** — außer einer einzigen Routing-Zeile und den turnierbezogenen Migrationen. Feed, Fotomodul, Anmeldung, Gruppenverwaltung und das globale Stylesheet funktionieren unverändert wie vorher.
- [ ] Alle Screens und Menüpunkte aus §13 existieren, keiner mehr und keiner weniger; kein Button ohne Funktion.
- [ ] Keiner der in §8.0 aufgeführten Fehler tritt noch auf. Insbesondere: keine horizontal scrollbare Navigation, keine Emoji als Symbole, keine technischen Werte wie `group_stage` in der Oberfläche, kein doppelt angezeigter Status, keine doppelten Aktionen.
- [ ] **In keiner Ansicht ist jemals eine Datenbank-ID sichtbar.** Teams erscheinen immer mit Namen, Status immer als deutsche Bezeichnung, Zeiten immer als Uhrzeit.
- [ ] Vier Gruppentabellen stehen auf einem breiten Bildschirm nebeneinander, nicht untereinander.
- [ ] Alle Tabellenspalten sind entweder selbsterklärend beschriftet oder haben einen Tooltip mit der ausgeschriebenen Bedeutung.
- [ ] Pro Ansicht ist genau eine Schaltfläche als Hauptaktion gefüllt dargestellt; nie mehr als sechs Schaltflächen gleichzeitig sichtbar.
- [ ] Das Modul verwendet dieselben Farben, Schriften und Symbole wie Feed und Fotomodul — nebeneinander gestellt darf es nicht wie eine fremde Anwendung wirken.
- [ ] **Nur Admins können Turniere anlegen.** Mitglieder sehen keinen „+ Neues Turnier"-Button; der direkte Aufruf der Wizard-URL leitet zurück, und der Erstellungs-Endpunkt antwortet Nicht-Admins mit 403.
- [ ] **Turniere im Status `draft` sind für Mitglieder unsichtbar** — weder in der Liste noch über die direkte URL des Turniers. Ab `generated` sehen sie es.
- [ ] **Nur Admins können Ergebnisse speichern.** Ein Gruppenmitglied sieht alles, hat aber keinen Eingabe-Button — und ein direkter API-Aufruf an den Speicher-Endpunkt wird serverseitig mit 403 abgewiesen. Dasselbe gilt für Zeitplan, Auslosung und Gefahrenbereich.
- [ ] 16 Teamnamen per Copy-Paste (eine Zeile je Team) einfügen legt 16 Teams an.
- [ ] PDF-Export erzeugt eine A4-Liste aller Spiele untereinander mit Uhrzeit, Tisch und Paarung sowie die Gruppentabellen — schwarz-weiß lesbar, ohne abgeschnittene Inhalte.

---

## 11. Feature-Parität (Benchmark meinspielplan.de) — gestaffelt

Diese Features machen den Unterschied zwischen "funktioniert" und "fühlt sich professionell an". Priorisiert:

### Stufe A — gehört zum Kern (mit MVP ausliefern)
- Automatische Paarungsgenerierung + **manuelles Nachbearbeiten jeder Paarung** (Teams eines Spiels tauschen/ersetzen, ohne den restlichen Plan zu zerschießen)
- Teams per Copy-Paste-Massenimport anlegen (§3 Schritt 2)
- Zeitplanung mit Uhrzeit und Tisch, inkl. Drag & Drop (§5.3)
- Frei konfigurierbare Tabelle (§3 Schritt 3)
- Match-Detail-Panel (§8.3)
- Turnier-Logo, Teamfarben, Branding (§8.4)
- **Druck-/PDF-Export** (§8.5) — für Franco ein Muss, kein Extra
- Mobile + Desktop gleichwertig nutzbar (§8.1)

### Stufe B — geplante Erweiterungen (Architektur jetzt schon offen halten)
- **Öffentliche Live-Seite ohne Login:** Ein Turnier kann per Schalter veröffentlicht werden und ist dann über einen nicht erratbaren Token-Link (`/live/<token>`) read-only erreichbar — ohne Account und ohne Gruppenmitgliedschaft. Zeigt Spielplan, Tabellen, Bracket, aktualisiert sich automatisch. Dazu **QR-Code-Generierung**, der auf diesen Link zeigt, zum Ausdrucken und Aushängen (auch im PDF-Export, §8.5).
  - Datenschutz beachten: Auf der öffentlichen Seite nur Teamnamen und Ergebnisse, **keine** Klarnamen von Gruppenmitgliedern, keine Fotos, keine Kommentare. Veröffentlichung jederzeit widerrufbar, Token neu generierbar.
  - Vorbereitung jetzt: Felder `is_public`, `public_token` im Schema anlegen; alle Leseabfragen so bauen, dass sie ohne Nutzerkontext funktionieren können.
- **Benachrichtigungen:** Wenn Teams nachträglich mit Gruppenmitgliedern verknüpft sind (§1.2), Push/In-App-Hinweis „Euer Spiel startet in 10 Minuten auf Platte 3". Auslöser aus `scheduled_at`.
- **Platzierungsspiele & Zwischenrunde:** Ausgeschiedene Teams spielen weitere Platzierungen aus; optional eine Zwischenrunde zwischen Gruppen- und KO-Phase (Gruppen werden neu gebildet). Das Phasen-Konzept aus §4 macht das ohne Umbau möglich.
- **Spielerstatistiken/Bestenliste** aus den Match-Daten
- Zusätzliche Spielleiter-Rolle innerhalb der Gruppe (Ergebnisse eintragen ohne volle Admin-Rechte)

### Stufe C — nice to have / später
- Doppel-KO (Winners/Losers Bracket)
- Schweizer System für große Teilnehmerfelder
- Vorlagen: "WM-Modus 32", "EM-Modus 24", "Bierpong 16 Teams / 4 Tische" als Ein-Klick-Presets
- Ligamodus über mehrere Spieltage/Wochen
- Ergebniseintragung durch Team-Verantwortliche mit Bestätigung durch den Gegner — **bewusst zurückgestellt**, da es dem schlanken Rollenmodell aus §1.2 widerspricht. Nur bauen, wenn es explizit gefordert wird.

## 12. Implementierungsreihenfolge (Empfehlung)

1. Altes Turniermodul vollständig löschen (§0), leeres Modulverzeichnis anlegen, eine einzige Einstiegsroute ins Modul definieren
2. Datenmodell + Migrationen (inkl. Foreign Keys, Indizes)
3. **Aufbereitungsschicht** zwischen Datenbank und Oberfläche: liefert fertige Anzeigeobjekte mit aufgelösten Teamnamen, deutschen Statusbezeichnungen und formatierten Zeiten. Kein Bildschirm greift direkt auf Datenbankzeilen zu. Diese Schicht verhindert die gesamte Fehlerklasse aus §8.0 Punkt 12.
4. Reine Logik-Engine als separates, UI-freies Modul (`tournament-engine.js`): Gruppenverteilung, Round Robin, Tabellenberechnung, Quali-Ermittlung inkl. beste Dritte, Bracket-Erzeugung mit Konfliktauflösung, Advance-Logik — **mit Unit-Tests für alle Fälle aus §6.3.2, §9 und §10**
5. Gestaltungsgrundlage: CSS-Variablen aus §8.6, Grundraster, die eine gemeinsame Match-Komponente
6. Wizard-UI inkl. Copy-Paste-Teamimport
7. Gruppen-/Spielplan-Ansichten + Ergebniseingabe
8. Bracket-Rendering
9. Zeitplanung mit Tischen und Drag & Drop
10. Desktop-Layout-Feinschliff
11. Druck-/PDF-Export
13. Danach erst Stufe B (öffentliche Live-Seite, QR, Benachrichtigungen)

Die Trennung Engine ↔ UI ist Pflicht: Die gesamte Turnierlogik muss ohne DOM testbar sein.

---

## 13. Detaillierte Screen- & Navigationsspezifikation

Dieses Kapitel beschreibt **jeden Bildschirm, jeden Menüpunkt und jede Aktion**. Es ist verbindlich. Erfinde keine zusätzlichen Screens und lasse keinen weg. Wo „Admin" steht, ist der Owner/Admin der [kru:]nest-Gruppe gemeint; „Betrachter" ist jeder andere Nutzer.

### 13.1 Navigationsbaum (Gesamtübersicht)

```
[kru:]nest → Gruppe → Turniere                       ← Screen A: Turnierliste
                        ├── + Neues Turnier          ← Screen B: Wizard (nur Admin)
                        └── Turnier öffnen           ← Screen C: Turnier-Arbeitsbereich
                              ├── Übersicht          ← C1 (Startansicht)      alle
                              ├── Spielplan          ← C2                     alle
                              ├── Gruppen            ← C3                     alle
                              ├── Turnierbaum        ← C4                     alle
                              ├── Teams              ← C5   NUR ADMIN
                              ├── Drucken/PDF        ← C6                     alle
                              └── Einstellungen      ← C7   NUR ADMIN
```

**Es gibt keinen eigenen Menüpunkt „Zeitplan".** Die Terminierung ist Teil der Einstellungen (C7), weil sie zur Turnierkonfiguration gehört und nicht zum laufenden Betrieb — die Zeiten selbst stehen für alle im Spielplan. Für Mitglieder werden die beiden Admin-Punkte **ausgeblendet**, nicht gesperrt (§1.2). Ihre Navigation hat also fünf Einträge statt sieben.

Mehr Screens gibt es nicht. Modale Dialoge (§13.10) sind keine eigenen Screens.

### 13.2 Screen A — Turnierliste

**Zweck:** Einstieg. Zeigt die Turniere dieser Gruppe — für Admins alle, für Mitglieder nur die veröffentlichten (§1.2).

**Aufbau Desktop:** Seitentitel „Turniere" links oben, rechts oben Button **„+ Neues Turnier"** — **nur für Admins sichtbar**. Darunter ein Karten-Grid, `repeat(auto-fill, minmax(340px, 1fr))`. Sortierung: laufende Turniere zuerst, dann kommende, dann beendete.

**Jede Turnierkarte enthält:**
- Turnier-Logo (falls vorhanden) oder farbiger Platzhalter mit Initialen
- Turniername (groß), Datum darunter
- Status-Badge: `Entwurf` (grau) · `Bereit` (blau) · `Läuft` (grün, pulsierend) · `Beendet` (neutral)
- Kurzinfo: „16 Teams · 4 Gruppen · 12 von 24 Spielen gespielt"
- Fortschrittsbalken der gespielten Spiele
- Bei laufendem Turnier zusätzlich: „Jetzt: Team A vs. Team B, Tisch 2"

**Aktionen:** Klick auf Karte → Screen C. Kontextmenü (⋯, nur Admin): Umbenennen · Duplizieren · Löschen (mit Sicherheitsabfrage, in die der Turniername eingetippt werden muss).

**Leerzustand:** Für Admins eine zentrierte Illustration mit „Noch kein Turnier angelegt" und dem Button „+ Neues Turnier". Für Mitglieder: „In dieser Gruppe läuft gerade kein Turnier." — **ohne** Button und ohne Hinweis darauf, dass eventuell ein Entwurf existiert.

**Mobile:** Karten einspaltig untereinander, Button „+ Neues Turnier" als schwebender Aktionsbutton unten rechts.

### 13.3 Screen B — Wizard „Neues Turnier"

**Aufbau:** Fünf Schritte, oben eine Fortschrittsanzeige mit klickbaren, bereits abgeschlossenen Schritten. Unten rechts immer **„Weiter"**, unten links **„Zurück"**. Der Wizard ist auf dem Desktop ein zentrierter Bereich mit maximal 900px Breite — **das ist die einzige Ansicht im ganzen Modul, die absichtlich schmal ist**, weil Formulare mit langen Zeilen unlesbar sind. Alle anderen Ansichten nutzen die volle Breite.

Rechts neben dem Formular (ab 1200px) steht eine **Live-Vorschau-Karte**, die sich bei jeder Eingabe aktualisiert: Anzahl Gruppen, resultierende Gruppengrößen, Anzahl Spiele, geschätzte Dauer, erwartetes Turnierende.

**Schritt 1 — Grunddaten:** Felder Turniername (Pflicht), Datum, Ort, Logo-Upload (Drag-and-Drop-Feld), Sportart-Auswahl mit Auswirkung auf Bezeichnungen („Tore" / „Punkte" / „Becher").

**Schritt 2 — Teams:** Großes Textfeld „Ein Team pro Zeile" mit Button **„Teams übernehmen"**. Darunter die entstandene Teamliste, jede Zeile mit Farbwähler, Bearbeiten- und Löschen-Symbol, per Drag & Drop sortierbar (= Setzliste). Zähler „16 Teams". Warnung bei doppelten Namen.

**Schritt 3 — Modus:** Vier große, anklickbare Karten (Gruppen + KO · Nur Gruppen · Nur KO · Doppel-KO, letztere ausgegraut mit „später"). Nach der Auswahl erscheinen die passenden Optionen: Anzahl Gruppen als Schieberegler oder Auswahl mit sofortiger Anzeige der Verteilung („3 Gruppen → 4 / 4 / 4"), Verteilungsmethode (Zufall · Manuell · Setzliste), Hin- und Rückrunde, Punkteregel, Tiebreaker-Reihenfolge als sortierbare Liste.

**Schritt 4 — Qualifikation & Zeitplan:** Aufsteiger pro Gruppe, beste Dritte mit Anzahl, Spiel um Platz 3. Darunter: Anzahl und Namen der Tische, Startzeit, Spieldauer, Pause. Die Vorschau zeigt live „24 Spiele · 4 Tische · 6 Runden · Ende ca. 17:40".

**Schritt 5 — Zusammenfassung:** Alle Einstellungen als übersichtliche Liste mit „Ändern"-Links zurück zum jeweiligen Schritt. Ganz unten der Button **„Turnier generieren"** in Akzentfarbe. Danach direkt Weiterleitung zu Screen C1.

**Verhalten:** Eingaben werden bei jedem Schrittwechsel als Entwurf gespeichert, damit nichts verloren geht. „Weiter" ist deaktiviert, solange Pflichtangaben fehlen — mit einem Hinweistext, **welche** Angabe fehlt, nicht nur einem gesperrten Button.

### 13.4 Screen C — Turnier-Arbeitsbereich: Rahmenlayout

Das ist der wichtigste Bildschirm und der, an dem sich der Unterschied zur bisherigen Handy-Optik entscheidet.

**Wichtig zur Einordnung:** [kru:]nest hat bereits eine eigene linke Seitenleiste (Feed · Fotos · Turniere · Mitglieder · Gruppen · Einstellungen). Diese bleibt unverändert bestehen. Das hier beschriebene Layout füllt **den Bereich rechts davon** — also genau den Platz, der aktuell fast vollständig leer bleibt. Die Turnier-Navigation ist eine **zweite Ebene innerhalb** dieses Bereichs und ersetzt die App-Seitenleiste nicht. Sie steht dauerhaft sichtbar als schmale Spalte, **niemals** in einem horizontal scrollbaren Streifen wie im aktuellen Stand.

**Desktop ab 1200px — drei Spalten innerhalb des Inhaltsbereichs:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER (volle Breite, ca. 64px hoch)                                │
│  [Logo] Turniername · Status-Badge                 [Drucken] [⋯]     │
├────────────┬────────────────────────────────────┬────────────────────┤
│ NAVIGATION │  HAUPTBEREICH                      │  KONTEXTSPALTE     │
│ ca. 220px  │  flexibel, nutzt allen Restplatz   │  ca. 300px         │
│            │                                    │                    │
│ Übersicht  │  Inhalt des gewählten Menüpunkts   │  Als Nächstes      │
│ Spielplan  │                                    │  ├ 14:20 Tisch 1   │
│ Gruppen    │                                    │  ├ 14:20 Tisch 2   │
│ Turnierbaum│                                    │  └ 14:40 Tisch 1   │
│ Teams      │                                    │                    │
│ Zeitplan   │                                    │  Tischbelegung     │
│ Drucken    │                                    │  Tisch 1 · läuft   │
│ Einstellg. │                                    │  Tisch 2 · frei    │
└────────────┴────────────────────────────────────┴────────────────────┘
```

- Die **Navigationsspalte** ist immer sichtbar, der aktive Punkt farblich hervorgehoben. Menüpunkte mit Symbol und Text. „Zeitplan" und „Einstellungen" erscheinen nur für Admins.
- Die **Kontextspalte** ist ab 1600px sichtbar, zwischen 1200 und 1600px einklappbar. Sie zeigt immer: die nächsten vier Spiele mit Uhrzeit und Tisch, den Belegungsstatus jedes Tisches, und bei laufendem Turnier die aktuell laufenden Spiele mit Schnelleingabe des Ergebnisses (nur Admin).
- Der **Hauptbereich** hat kein enges `max-width`. Er füllt den Platz zwischen den beiden Spalten vollständig.

**Tablet 768–1200px:** Navigationsspalte klappt zu einer Symbolleiste (nur Icons, 64px) zusammen, Kontextspalte verschwindet und ihr Inhalt wandert als Abschnitt an den Anfang der Übersicht.

**Mobile unter 768px:** Header bleibt, Navigation wird zu einer horizontal scrollbaren Tab-Leiste direkt unter dem Header. Kontextspalte entfällt komplett. Ein Inhalt pro Bildschirm.

**Header-Aktionen:** „Drucken/PDF" (alle), Kontextmenü ⋯ mit Turnier bearbeiten · Duplizieren · Löschen (nur Admin).

### 13.5 C1 — Übersicht (Startansicht)

Vier Bereiche untereinander, jeder als abgesetzte Karte:

1. **Statuszeile:** Große Anzeige der aktuellen Phase („Gruppenphase · Runde 3 von 6"), Fortschrittsbalken, Countdown zum nächsten Spiel.
2. **Laufende Spiele:** Eine Karte pro belegtem Tisch, groß dargestellt, mit direkter Ergebniseingabe für Admins.
3. **Nächste Spiele:** Die nächsten sechs Begegnungen als kompakte Liste mit Uhrzeit, Tisch, Paarung.
4. **Kurz-Tabellen:** Alle Gruppen als kleine Karten nebeneinander (`auto-fit, minmax(280px, 1fr)`), jeweils nur Platz, Team, Punkte — mit Link „Vollständige Tabelle" zu C3.

Ist die Gruppenphase abgeschlossen, ersetzt eine kompakte Bracket-Vorschau die Kurz-Tabellen.

### 13.6 C2 — Spielplan

**Ansichtsumschalter oben:** `Alle` · `Nach Gruppe` · `Nach Tisch` · `Nach Runde` · `Nur offene`. Zusätzlich ein Suchfeld für Teamnamen.

**Darstellung Desktop:** Echte Tabelle über die volle Breite mit den Spalten *Zeit · Tisch · Phase/Gruppe · Heim · Ergebnis · Gast · Status · Aktion*. Zahlenspalten rechtsbündig mit tabellarischen Ziffern. Zeilen abwechselnd hinterlegt, laufende Spiele farblich hervorgehoben, beendete zurückgenommen dargestellt.

**Darstellung Mobile:** Dieselben Daten als Kartenliste — Uhrzeit und Tisch in der Kopfzeile, darunter die beiden Teams untereinander mit Ergebnis rechts. **Nicht** die Desktop-Tabelle horizontal scrollbar machen.

**Aktionen (Admin):** Klick auf eine Zeile öffnet den Match-Dialog (§13.10). Direkte Ergebniseingabe in der Zeile ohne Dialog ist zusätzlich möglich.

### 13.7 C3 — Gruppen

Karten-Grid, eine Karte pro Gruppe, `auto-fit, minmax(360px, 1fr)` — bei vier Gruppen auf einem breiten Monitor also zwei bis vier nebeneinander, **niemals alle untereinander in einer schmalen Spalte**.

**Jede Gruppenkarte enthält:** Titel „Gruppe A" und die vollständige Tabelle mit diesen Spalten in dieser Reihenfolge: **Pl.** (Platz) · **Team** (immer der Name, nie eine ID, mit Farbpunkt davor) · **Sp.** (Spiele) · **S** (Siege) · **U** (Unentschieden) · **N** (Niederlagen) · **Tore** (im Format 12:7) · **Diff** (mit Vorzeichen) · **Pkt.** Alle Zahlenspalten rechtsbündig mit tabellarischen Ziffern. Abgekürzte Überschriften bekommen einen Tooltip mit der ausgeschriebenen Bedeutung. Bei Sportarten mit anderer Bezeichnung heißt „Tore" entsprechend „Becher" oder „Punkte" (§3 Schritt 3).

Farbige Markierung der Qualifikationsplätze: durchgezogene Linie unter dem letzten direkten Aufstiegsplatz, Zeilen in `--qualified` hinterlegt; mögliche beste Dritte in `--pending`. Darunter ausklappbar die Spiele dieser Gruppe.

**Zusätzlich unterhalb des Grids:** Bei aktivierter Bester-Dritter-Regel eine eigene Karte „Wertung der Gruppendritten" mit der gruppenübergreifenden Rangliste und markierten Qualifikationsplätzen.

Bei Punktgleichheit auf einem entscheidenden Platz erscheint ein Hinweis „Entscheidung nötig" mit einem Button für den Losentscheid (nur Admin).

### 13.8 C4 — Turnierbaum

Vollbreite Darstellung, Runden als Spalten von links nach rechts, Verbindungslinien zwischen den Spielen. Über dem Baum eine Zoomsteuerung und der Schalter „An Bildschirm anpassen".

**Jeder Baum-Knoten** zeigt: beide Teams mit Farbpunkt, Ergebnis, Uhrzeit und Tisch in kleiner Schrift. Sieger fett und farblich hervorgehoben, Verlierer ausgegraut. Noch nicht feststehende Teilnehmer als Platzhaltertext („Sieger Gruppe A", „Sieger VF2") in kursiver, zurückgenommener Schrift.

Ein 8er- und ein 16er-Baum müssen auf 1920px vollständig ohne Scrollen sichtbar sein. Das Spiel um Platz 3 steht abgesetzt unterhalb des Halbfinal-Bereichs.

Mobile: horizontal scrollbar mit Einrastpunkten pro Runde, darüber Runden-Tabs zum direkten Springen.

### 13.9 C5–C7 — die übrigen Menüpunkte

**C5 Teams (nur Admin):** Tabelle aller Teams mit Name, Farbe, Gruppe, Platzierung und Bilanz. Button „Team hinzufügen" mit Copy-Paste-Feld (ein Name pro Zeile), nur solange das Turnier im Status `draft` oder `generated` ist.

**C6 Drucken/PDF (alle):** Links die Auswahl der zu druckenden Blöcke als Checkboxen (§8.5), rechts eine echte Seitenvorschau im A4-Format. Unten die Buttons „Als PDF speichern" und „Drucken", dazu die Umschaltung zwischen „Zum Ausfüllen" und „Aktueller Stand".

**C7 Einstellungen (nur Admin):** Fasst die gesamte Turnierkonfiguration zusammen, gegliedert in fünf Abschnitte. Oben ein Statushinweis, ob das Turnier bereits gestartet ist („Vor dem Turnierstart — alles änderbar" / „Turnier läuft — Struktur gesperrt").

1. **Grunddaten** — Name, Ort, Datum, Logo, Bezeichnung der Zähleinheit (Tore/Punkte/Becher).
2. **Regeln** — Punkte für Sieg und Unentschieden, Tiebreaker-Reihenfolge. Nach Turnierstart gesperrt.
3. **Spielfelder & Zeiten** — Anzahl der Felder/Tische **und deren Namen** frei konfigurierbar; Startzeit, Spieldauer und Pause. Button „Zeitplan neu berechnen" erzeugt daraus die Terminierung. Feldanzahl und -namen sind nach Turnierstart gesperrt, weil sie den bestehenden Spielplan ungültig machen würden. Darunter die Werkzeuge für den laufenden Betrieb, die **immer** verfügbar bleiben: „Offene Spiele +15 min", „−15 min", „Pause einfügen".
4. **Gruppen** — Anzahl der Gruppen mit Live-Vorschau der Verteilung („3 Gruppen → 4 / 4 / 4, 18 Spiele"), Verteilungsmethode (Zufällig auslosen · Setzliste · Manuell) und Button „Gruppen neu auslosen". Letzterer erzeugt den Spielplan komplett neu und löscht alle Ergebnisse — deshalb mit Bestätigung durch Eintippen des Turniernamens.
5. **Aktuelle Terminierung** — das Zeitraster (Spalten = Felder, Zeilen = Zeitslots), Spiele per Drag & Drop verschiebbar.
6. **Gefahrenbereich** — abgesetzt am Ende: „Alle Ergebnisse löschen", „Turnier abschließen", „Turnier löschen". Alle drei mit Bestätigung durch Eintippen des Turniernamens.

### 13.10 Modale Dialoge

Es gibt genau vier:

1. **Match-Dialog** — Ergebniseingabe mit großen Zahlenfeldern, Sätze/Runden falls konfiguriert, Uhrzeit und Tisch änderbar, Notizfeld, Statuswechsel, Verlauf der Änderungen. Buttons: Abbrechen · Speichern.
2. **Team-Dialog** — Name, Farbe, Logo, Spielerliste.
3. **Bestätigungsdialog** — für alle zerstörenden Aktionen, mit klarer Beschreibung der Folgen („Alle 24 Ergebnisse werden gelöscht").
4. **Kaskaden-Warnung** — erscheint bei Ergebniskorrekturen, die Folgespiele betreffen (§6.4). Zeigt konkret, welche Spiele zurückgesetzt würden, mit den Optionen „Zurücksetzen und speichern" oder „Abbrechen".

Alle Dialoge: schließbar per Escape und Klick außerhalb, Fokus wird beim Öffnen gesetzt und beim Schließen zurückgegeben, auf Mobile als von unten einfahrendes Blatt über die volle Breite.

### 13.11 Gestaltungsraster (verbindlich)

Farbwerte, Schriften, Radien und die Signaturkomponente stehen in **§8.6** und gelten unverändert. Ergänzend hier die Rasterwerte:

- **Abstände:** ausschließlich 4 · 8 · 12 · 16 · 24 · 32 · 48px. Keine krummen Zwischenwerte.
- **Spaltenraster:** 12 Spalten im Hauptbereich, 24px Rinne.
- **Zeilenhöhen:** Tabellenzeile 44px (kompakt 36px), Match-Karte 72px, Kartenüberschrift 56px.
- **Eine einzige Match-Komponente** wird in Spielplan, Gruppen, Baum und Kontextspalte wiederverwendet, in den Varianten kompakt · normal · groß. Nicht vier verschiedene Darstellungen bauen.
- Jede farbliche Aussage zusätzlich durch Text oder Symbol absichern, damit sie auch im Schwarz-Weiß-Ausdruck und für farbfehlsichtige Nutzer erhalten bleibt.

---

## 14. Hinweise an das implementierende Modell

- **Nicht alles auf einmal.** Arbeite die Reihenfolge aus §12 ab. Ein fertiger Schritt ist mehr wert als sieben halbe. Melde nach jedem Schritt, was fertig ist und was noch fehlt.
- **Kompletter Neubau, aber nur des Turniermoduls.** Kein Code, kein CSS und keine Komponente aus dem alten Turniermodul wird übernommen — und außerhalb des Modulverzeichnisses wird nichts angefasst (§0, Punkt 5). Nötige Änderungen außerhalb werden gemeldet, nicht durchgeführt.
- **Engine zuerst, mit Tests.** Wenn das Referenzbeispiel aus §6.3.2 in den Tests exakt die Paarungen A1–B3, A2–C2, C1–B2, B1–A3 liefert, ist der schwierigste Teil geschafft.
- **Design und Navigation sind kein Feinschliff.** §8 und §13 sind so verbindlich wie die Logikkapitel. Wenn die Desktop-Ansicht am Ende immer noch wie eine vergrößerte Handy-App aussieht, ist der Auftrag nicht erfüllt.
- **Genau die Screens aus §13 bauen** — keine zusätzlichen erfinden, keinen weglassen, keine anderen Menüpunkte benennen.
- **Falls dieser Spezifikation ein HTML/CSS-Prototyp beiliegt:** Der Prototyp ist die verbindliche Vorlage für Aussehen und Aufbau. Übernimm seine CSS-Variablen, Klassennamen, Abstände und Komponentenstruktur **unverändert** und fülle sie mit echten Daten. Bei Abweichungen zwischen Prototyp und Text gilt für das Aussehen der Prototyp, für das Verhalten dieser Text.

**Regeln zur Fehlervermeidung** (der vorherige Durchlauf hatte zu viele Fehler):

- **Keine Attrappen.** Jeder Button, jeder Menüpunkt und jedes Eingabefeld funktioniert vollständig oder existiert nicht. Lieber ein Feature weglassen als es halb zu bauen.
- **Keine Endlosschleifen.** Tiebreaker-Rekursion (§5.4) und Bracket-Konfliktauflösung (§6.3.2) brauchen eine harte Obergrenze und einen definierten Ausweg.
- **Keine stillen Annahmen.** Wenn eine Konstellation nicht eindeutig auflösbar ist, zeigt die App das dem Veranstalter an, statt sich still zu entscheiden.
- **Jede Berechnung geht von den Ergebnissen aus.** Tabellenstände werden nie gespeichert, immer neu berechnet. Das verhindert die häufigste Fehlerklasse: gespeicherte Werte, die nach einer Korrektur nicht mehr stimmen.
- **Fehler sichtbar machen statt verschlucken.** Schlägt eine Speicherung fehl, sieht der Nutzer eine verständliche Meldung und die Eingabe bleibt erhalten. Keine leeren `catch`-Blöcke.
- **Nach jedem Schritt selbst prüfen:** Widerspricht das Ergebnis einem Punkt aus §10? Dann nachbessern, bevor es weitergeht. Die Liste in §10 ist die Abnahmeprüfung, nicht eine Anregung.
- **Im Zweifel diese Spezifikation befolgen,** nicht den bestehenden Code oder verbreitete Beispiel-Implementierungen aus dem Netz.
