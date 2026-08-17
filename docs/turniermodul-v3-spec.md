# Turniermodul – Vollständige Spezifikation (Rewrite v3)

> Verbindliche Spezifikation für das Turnier-Modul der selbst gehosteten Anwendung **[kru:]nest**.
> Engine stack-neutral, UI in eigenständigem Modul. Bestehender Turnier-Code ist zu verwerfen, nicht zu reparieren.

---

## 0. Neubau-Auftrag — zuerst lesen

Das bestehende Turniermodul wird **nicht** weiterentwickelt. Es wird gelöscht und von Grund auf neu gebaut. Begründung: Die Fehler sind nicht oberflächlich, sondern strukturell. Ein Blick auf den aktuellen Stand zeigt, dass in den Gruppentabellen **Datenbank-IDs statt Teamnamen** stehen (`cmsm7zaqv0002qnvpjcmiw1h0`). Das ist kein Darstellungsfehler, sondern der Beweis, dass die Oberfläche rohe Datenbankzeilen ausgibt, ohne sie in verständliche Inhalte zu übersetzen.

**Verbindliches Vorgehen:**

1. Alle Dateien des bisherigen Turniermoduls löschen.
2. Die bisherigen Turniertabellen der Datenbank verwerfen und nach §4 vollständig neu anlegen.
3. Ein neues, leeres Modulverzeichnis anlegen und dort nach dieser Spezifikation aufbauen.
4. Den alten Code nicht als Vorlage lesen.
5. Der Auftrag betrifft AUSSCHLIESSLICH das Turniermodul. Außerhalb des Modulverzeichnisses wird nichts geändert als: turnierbezogene Migrationen und genau eine Zeile Routing. Bestehende Design-Tokens und Komponenten der Kernanwendung dürfen gelesen und verwendet, aber nicht verändert werden.

**Qualitätsanspruch:** Lieber weniger Funktionen, die vollständig und fehlerfrei sind, als viele halbfertige.

---

## 1. Zielbild & Einbettung

### 1.1 Einbettung in [kru:]nest — Modul-Architektur

Es gibt aktuell **keine Modul-Freischaltung**. Jeder Nutzer sieht das Turniermodul. Das bleibt vorerst so — baue kein Freischaltungs-System.

**Verbindliche Konsequenzen:**
- Kein Modul-Gating. Keine `group_modules`-Tabelle.
- Jedes Turnier gehört zu genau einer [kru:]nest-Gruppe (`tournaments.group_id`).
- Innerhalb einer Gruppe können mehrere Turniere existieren.
- Modulgrenzen sauber halten: kein direkter Zugriff auf Feed- oder Fototabellen.

### 1.2 Rollenmodell — bewusst schlank

Teams sind reine Datensätze, keine Nutzerkonten.

| Rolle | Rechte |
|---|---|
| Gruppen-Owner / Admin | Turnier anlegen, konfigurieren, Teams eintragen, Spielplan generieren, Zeiten/Tische ändern, **Ergebnisse eintragen und korrigieren**, Turnier abschließen |
| Gruppenmitglied | Alles **lesen**. Keine Schreibrechte. |
| Nicht-Mitglied | Kein Zugriff (Ausnahme: öffentliche Live-Seite, §11 Stufe B) |

**Turniere anlegen darf ausschließlich der Gruppen-Owner/Admin.** Für Mitglieder gibt es keinen „+ Neues Turnier"-Button, keinen Zugang zum Wizard und keinen Weg über die URL — direkter Wizard-Aufruf leitet zurück, der Erstellungs-Endpunkt antwortet Nicht-Admins mit 403.

**Sichtbarkeit nach Status:**

| Turnierstatus | Admin | Mitglied |
|---|---|---|
| `draft` | ✓ | — |
| `generated` | ✓ | ✓ |
| `group_stage` / `ko_stage` | ✓ | ✓ |
| `finished` | ✓ | ✓ |

**Ergebnisse eintragen darf ausschließlich der Admin.** Kein Bestätigungs-Workflow, keine Mitzeichner. Die Prüfung erfolgt im Backend bei jeder schreibenden Anfrage.

**Sichtbare Menüpunkte (verbindlich):**

| Menüpunkt | Admin | Mitglied |
|---|---|---|
| Übersicht | ✓ | ✓ |
| Spielplan | ✓ | ✓ |
| Gruppen | ✓ | ✓ |
| Turnierbaum | ✓ | ✓ |
| Teams | ✓ | — |
| Drucken / PDF | ✓ | ✓ |
| Einstellungen | ✓ | — |

**Optionale spätere Erweiterung:** `tournament_teams.linked_user_ids` für Push-Benachrichtigungen — Feld im Schema vorsehen, Logik nicht implementieren. Gibt KEINE Schreibrechte.

### 1.3 Funktionales Zielbild

Das Modul orientiert sich an meinturnierplan.de / kicker-Turnierplaner. Jede Kombination aus Teamanzahl, Gruppenanzahl, Aufsteigern pro Gruppe und KO-Struktur muss funktionieren.

---

## 2. Turniermodi

`tournament.mode`:
1. `groups_ko` – Gruppenphase + KO-Phase (Standard, WM-Stil)
2. `groups_only` – Nur Gruppenphase(n), Endstand = Tabelle
3. `ko_only` – Nur KO-Baum, optional mit Spiel um Platz 3
4. `double_elimination` – Doppel-KO (Phase 2; Architektur vorsehen)

---

## 3. Konfigurations-Wizard

Fünf Schritte, jeder validiert live, Vorschau zeigt "X Spiele werden generiert, Dauer ca. Y bei Z Feldern".

### Schritt 1 — Grunddaten
- Turniername, Datum, optional Ort
- Turnier-Logo (Upload), optional Titelbild
- Sportart/Disziplin (Labels: „Tore"/„Punkte"/„Becher")
- Spielfelder/Tische: Anzahl + frei benennbar
- Zeitraster: Startzeit, Standard-Spieldauer, Pausenzeit, optional Mindestpause pro Team

### Schritt 2 — Teams
- Copy-Paste-Massen-Eingabe (ein Teamname pro Zeile)
- Einzeln bearbeiten, Drag & Drop = Setzliste
- Pro Team: Name, optional Farbe, optional Logo, optional Spielerliste
- Duplikatprüfung
- Mindestanzahl abhängig vom Modus

### Schritt 3 — Modus & Gruppenkonfiguration
- Anzahl Gruppen (1 bis ⌊Teams/2⌋)
- UI zeigt sofort: „3 Gruppen → 4 / 4 / 4"
- Verteilungsmethode: random | manual | seeded (Snake)
- Hin- und Rückrunde
- Punkteregel (Standard 3/1/0)
- Tabellen-Darstellung konfigurierbar (Spalten ein/aus, Reihenfolge, Labels — Anzeige-Labels ändern nur die Beschriftung, nicht die Datenstruktur)
- Unentschieden erlaubt?
- Tiebreaker-Reihenfolge frei sortierbar

**Drag & Drop verbindlich für Touch UND Maus UND Tastatur.** Drei gleichwertige Bedienwege:
1. Maus (HTML5 Drag & Drop mit `preventDefault()`)
2. Touch (Pointer-Events mit `document.elementFromPoint()`)
3. Tastatur (Pfeil-Buttons UND Pfeiltasten)

### Schritt 4 — Qualifikation & KO-Phase (nur bei `groups_ko`)
- Aufsteiger pro Gruppe (N)
- Beste Drittplatzierte (M zusätzlich)
- Berechnung: `Qualifikanten = Gruppen × N + M`, Empfehlung wenn keine Zweierpotenz → „2 beste Dritte hinzunehmen → sauberes Viertelfinale"
- Spiel um Platz 3
- Unentschieden-Auflösung im KO (Label, technisch: KO-Spiele brauchen Sieger)

### Schritt 5 — Zusammenfassung & Generierung
- Übersicht aller Einstellungen
- Button „Turnier generieren" → erzeugt alle Spiele in einer Transaktion

---

## 4. Datenmodell

Phasen-Konzept: `stages` als Container, `group_memberships` als N:M Team↔Gruppe über Phasen hinweg.

```sql
tournaments (
  id, group_id, name, logo_url, cover_url,
  mode, status, is_public, public_token,
  public_enabled_at, public_revoked_at,
  config jsonb, created_at, created_by
)

tournament_teams (
  id, tournament_id, name, color, logo_url,
  players, linked_user_ids jsonb, seed
  -- KEIN group_key: Zuordnung über group_memberships
)

stages (
  id, tournament_id, type ('group' | 'ko' | 'intermediate_group' | 'losers'),
  name, order_index
)

groups_ (
  id, stage_id, key ('A','B','C'), name
)

group_memberships (
  id, group_id, team_id, position,
  unique (group_id, team_id)
)

matches (
  id, tournament_id, stage_id, group_id,
  round, bracket_type ('winner' | 'loser' | 'grand_final'),
  bracket_pos,
  team_home, team_away,
  placeholder_home jsonb, placeholder_away jsonb,
  score_home, score_away,
  status ('scheduled' | 'live' | 'finished'),
  field, scheduled_at,
  winner_advances_to, loser_advances_to
)
```

**Tabellenstände werden nicht persistiert, immer live aus `matches` berechnet.**

**Autorisierung:** Genau eine Prüfung im Backend: Ist der Nutzer Owner/Admin der Gruppe? Wenn nein, darf er nur lesen.

**Integrität:** Foreign Keys mit `ON DELETE CASCADE`. Ergebnisänderungen in Transaktionen. Indizes auf `matches(tournament_id, stage_id)`, `matches(scheduled_at)`, `matches(field, scheduled_at)`.

---

## 5. Gruppenphasen-Logik

### 5.1 Gruppenbildung
Anzahl Gruppen = `config.num_groups`. Teams werden gemäß Verteilungsmethode auf die Gruppen aufgeteilt. Reste werden von vorne aufgefüllt (12 / 5 → 3,3,2,2,2).

### 5.2 Spielplan pro Gruppe: Round Robin (Berger)
1. Teams nummerieren 1..n. Bei ungeradem n: FREI ergänzen.
2. Runden = n-1.
3. Heim/Auswärts über die Runden ausbalancieren.
4. Hin- & Rückrunde: Plan spiegeln.

### 5.3 Terminierung (Scheduling-Engine)

Jedes Spiel bekommt Uhrzeit + Tisch, beides manuell übersteuerbar.

**Automatische Generierung:**
1. Runden aller Gruppen verzahnen.
2. Spiele in Zeitslots auf Tische verteilen. Slot = Dauer + Pause.
3. Startzeit = Turnierstart + Slot-Index × Slot-Länge.
4. **Harte Constraints:** Ein Team spielt nie zwei Spiele im selben Slot. Ein Tisch hat nie zwei Spiele im selben Slot.
5. Weiche Constraints: Mindestpause pro Team, faire Tischrotation, Gruppen möglichst parallel fertig.

**Algorithmus mit Prioritätenordnung:**
1. Hart: kein Team / kein Tisch doppelt im selben Slot, kein KO-Spiel vor abhängigen Gruppenspielen
2. Hart: Rundenreihenfolge innerhalb einer Gruppe
3. Weich: Mindestpause pro Team (bei Konflikt: ausnahmsweise verletzen, Spiel markieren)
4. Weich: Gruppen parallel fertig
5. Weich: faire Tischrotation

**Determinismus:** Bei Gleichstand entscheidet feste Reihenfolge (Gruppen-Key, Rundennummer, Match-ID). Zweimaliges Generieren mit identischer Config → identischer Plan.

**Manuelle Kontrolle:**
- Zeitraster (Spalten=Tische, Zeilen=Slots), Drag & Drop
- Konflikte rot markieren, aber NICHT blockieren
- Pro Spiel: Uhrzeit, Tisch, Dauer einzeln editierbar
- „+15 min ab jetzt", „Pause einfügen"
- „Zeitplan neu berechnen ab Spiel X"

### 5.4 Tabellenberechnung

Pro Gruppe live aus `finished`-Spielen:
- Spiele, Siege, Unentschieden, Niederlagen, Tore, Gegentore, Differenz, Punkte
- Sortierung strikt nach konfigurierter Tiebreaker-Reihenfolge

**Direkter Vergleich bei punktgleichen Teams:**
Bilde Sub-Tabelle aus Spielen der punktgleichen Teams untereinander. Wende der Reihe nach an: Punkte, Tordifferenz, erzielte Tore. **Rekursion:** Trennt die Sub-Tabelle nur teilweise, wird sie für jede verbleibende Teilgruppe **neu berechnet**.

```
rangfolge(teams, kriterien):
  gruppiere teams nach punkten
  für jede punktgleiche gruppe mit >1 team:
      wende direkten vergleich an → sub-rangfolge
      falls sub-rangfolge weiter teilt:
          für jede noch gleiche teilgruppe: rangfolge(teilgruppe) rekursiv
      falls sub-rangfolge gar nicht teilt:
          weiter mit nächstem gesamt-kriterium
  abbruch: maxDepth = anzahl teams in gruppe
```

Bei Gleichstand auf Quali-Platz: Status „Entscheidung nötig", Losentscheid durch Admin.

---

## 6. KO-Phasen-Logik

### 6.1 Qualifikanten bestimmen
1. Direktqualifikanten: Ränge 1..N jeder Gruppe.
2. Falls konfiguriert: beste Teams auf Rang N+1 (Top M).
3. Gesamtseeding: erst Sieger untereinander, dann Zweite, dann Dritte.

### 6.2 Bracket-Erzeugung & Seeding
- Bracketgröße = kleinste Zweierpotenz ≥ Qualifikantenzahl.
- **Standard-Seeding (WM-Logik):** Sieger/Zweite über Kreuz. Teams aus derselben Gruppe frühestens im Halbfinale. Beste Dritte gegen Gruppensieger, nie gegen eigenes Gruppenteam.
- Bei `ko_only`: 1 vs. n, 2 vs. n-1, Seeds 1/2 in gegenüberliegende Hälften.

### 6.3 Wenn Qualifikantenzahl keine Zweierpotenz

**Priorität 1 — Mit besten Drittplatzierten auffüllen** (Standard, vorausgewählt)
**Priorität 2 — Vorrunde/Play-off** (z. B. 10 Qualifikanten)
**Priorität 3 — Freilose** (nur wenn explizit gewählt)

### 6.3.1 Ranking der besten Drittplatzierten

Ohne direkten Vergleich. Immer **pro Spiel normalisiert** (Punkte/Spiel, Tordiff/Spiel, Tore/Spiel, Gegentore/Spiel). Bei gleich großen Gruppen deckungsgleich mit Rohvergleich. **Genau diese eine Methode, keine Konfigurationsalternative.**

Reihenfolge: Punkte → Tordifferenz → erzielte Tore → wenigste Gegentore → Losentscheid.

### 6.3.2 Durchgerechnetes Referenzbeispiel (Pflicht-Testfall)

**Konfiguration:** 12 Teams, 3 Gruppen à 4, Top 2 + 2 beste Dritte → Viertelfinale.

Endstände:
- Gruppe A: A1 9 Pkt, A2 6 Pkt, A3 3 Pkt (TD +1), A4 0 Pkt
- Gruppe B: B1 7 Pkt, B2 4 Pkt, B3 4 Pkt (TD 0), B4 1 Pkt
- Gruppe C: C1 6 Pkt, C2 5 Pkt, C3 2 Pkt (TD −2), C4 2 Pkt

**Schritt 1 — Beste Dritte:** B3 (4 Pkt) und A3 (3 Pkt) qualifiziert, C3 ausgeschieden.

**Schritt 2 — Gesamtsetzliste:** A1, B1, C1, A2, C2, B2, B3, A3.

**Schritt 3 — Standardpaarungen** (1–8, 4–5, 3–6, 2–7):
- VF1: A1 – A3 ⚠️ Konflikt
- VF2: A2 – C2 ✓
- VF3: C1 – B2 ✓
- VF4: B1 – B3 ⚠️ Konflikt

**Schritt 4 — Konfliktauflösung** (Tausch Seeds 7/8 innerhalb derselben Ebene):
- VF1: A1 – B3
- VF2: A2 – C2
- VF3: C1 – B2
- VF4: B1 – A3

**Bewusste Einschränkung:** A1 und A2 können sich im Halbfinale treffen. Bei nur 3 Gruppen und 8 Qualifikanten mathematisch nicht vermeidbar. Regel: Gruppengegner nie im VF, ab HF zulässig.

**Allgemeiner Algorithmus:** Standardpaarungen → auf gleiche Gruppenherkunft prüfen → bei Konflikt Tauschpartner in derselben Seed-Ebene suchen, der keinen neuen Konflikt erzeugt → tauschen → erneut prüfen. Bei Bedarf in nächsthöhere Ebene ausweichen. MaxIter = Anzahl Seeds. Bleiben Konflikte: manuelle Entscheidung anzeigen.

### 6.4 Automatisches Aufsteigen

KO-Match kennt `winner_advances_to` und ggf. `loser_advances_to`. Beim Ergebnis:
1. Sieger ermitteln (Gleichstand im KO ungültig).
2. Sieger in Folgespiel-Slot.
3. Verlierer ggf. ins Spiel um Platz 3.
4. Bei Korrektur: Kaskade prüfen — wenn Sieger wechselt und Folgespiele Ergebnisse haben, Warnung und Option zum Zurücksetzen.

### 6.5 Rundenbenennung
32 → Sechzehntelfinale, 16 → Achtelfinale, 8 → Viertelfinale, 4 → Halbfinale, 2 → Finale, plus „Spiel um Platz 3".

---

## 7. Ergebniseingabe & Aktualisierung

**Grundsatz: Es gibt keinen Live-Ticker.** Ergebnisse ausschließlich vom Admin nachträglich eingetragen, wenn ein Spiel fertig ist.

**Die geplante Uhrzeit ist eine Planung, keine Sperre.** Ergebnis jederzeit eintragbar — vor/nach geplanter Zeit, in beliebiger Reihenfolge. Einzige Ausnahme: KO-Spiel erst eintragbar, wenn Teilnehmer feststehen.

- Eingabe am Spiel („Eintragen" / „Ändern") und über Hauptaktion „Ergebnis eintragen"
- Korrekturen jederzeit (mit Kaskadenprüfung)
- Mehrgeräte-Betrieb: WebSocket/SSE/Polling 5–10s
- Undo: letztes Ergebnis mit Tap korrigierbar

**„Als Nächstes" statt „Jetzt live":** Prominentes Element zeigt nächste Spiele mit Uhrzeit + Tisch.

---

## 8. UI / UX — das Design ist ein Hauptauftrag, kein Beiwerk

### 8.0 Was aktuell falsch ist

14 dokumentierte Fehler. Diese dürfen im Neubau KEINER mehr auftreten. Insbesondere gilt:
- Niemals Rohwerte aus der Datenbank anzeigen.
- Zwischen Datenschicht und Darstellung liegt eine Aufbereitungsschicht.

**Zielzustand:** Auf dem Desktop eine eigenständige Anwendung, die den verfügbaren Platz nutzt. Auf dem Handy voll bedienbar. Beide eigenständige Layouts, nicht dieselbe Ansicht in zwei Größen.

**Prüfkriterium:** Bei 1920×1080 kein ungenutzter Rand >5 % der Bildschirmbreite. Drei Kernelemente (Gruppentabellen, Spielplan, Turnierbaum) ohne Scrollen erreichbar.

### 8.1 Responsive-Strategie — zwei eigenständige Layouts

**Container-Queries statt Media-Queries.** Das Modul reagiert auf seine eigene Breite, nicht auf die Viewport-Breite. Grund: Die echte [kru:]nest-Sidebar wird bei ≤900px zum Off-Screen-Drawer — die Modul-Breite ist dann größer als Viewport minus App-Sidebar. Implementierung: `container-type: inline-size` auf `.t-mod`, alle Breakpoints als `@container (min-width: …)` auf `.t-mod`.

**Breakpoints (Modul-eigene Breite, nicht Viewport):**

- `< 768px` — Mobile: einspaltig, Tabs für Gruppen / Spielplan / Baum, große Touch-Targets (min. 44px), Ergebniseingabe mit Zahlenfeld.
- `768–1499px` — Tablet: zweispaltig — **160px** schmale Navigation links, Hauptinhalt rechts. Kontextspalte eingerollt.
- `≥ 1500px` — Desktop: dreispaltiges Arbeitslayout. **212px** Navigation links, Hauptinhalt Mitte, **300px** Kontextspalte rechts. Gruppentabellen als Karten-Grid mit 2–4 Karten nebeneinander.

**Warum 160px statt 2-Spalten auf Tablet:** Bei 820px Modul-Breite mit 212px Nav bleiben nur ~580px für die Hauptliste. 2 Karten à 340px + Gaps = 696px — passt nicht. Mit 160px Nav bleiben ~636px, 2 Karten à 260px + Gaps passen.

**Warum 212px Nav, 300px Aside (statt 220/280 wie im Spec-Entwurf):** Werte sind nach Sichtprüfung festgezurrt, kein Runde der Spec-Iteration.

**Keine absoluten Pixelbreiten für Kernelemente.** Grid und Flex mit `minmax()`, `fr` und `auto-fit`. Kein horizontaler Überlauf auf Mobil: `overflow-x: hidden` auf `body`, `min-width: 0` auf allen Grid- und Flex-Kindern, und `minmax(min(100%, 300px), 1fr)` statt `minmax(300px, 1fr)`. Die Seite darf sich auf dem Handy nicht seitlich verschieben lassen. Breite Inhalte wie der Turnierbaum bekommen einen eigenen Scrollcontainer, der die Seite nicht mitschiebt.

**Mobile Tab-Leiste feste Höhe:** `height` (nicht nur `min-height`), `align-items: center`, jeder Tab `flex: 0 0 auto`, feste `height`, `line-height: 1`, `white-space: nowrap`. Ohne diese Kombination wächst die Leiste bei aktivem „Einstellungen"-Tab.

**Typografie und Abstände getrennt skalieren:** Desktop bekommt kleinere Schrift und engere Zeilenhöhen als Mobile, nicht dieselben Werte hochgerechnet. `clamp()` für flüssige Skalierung, einheitliches Spacing-Raster (4/8/12/16/24/32px).

**Tabellen:** Desktop als echte Tabellen mit ausgerichteten Spalten; Mobile als kompakte Kartenliste. Nicht dieselbe Tabelle horizontal scrollbar machen.

**Dichte-Umschalter** optional („kompakt" / „komfortabel").

### 8.2 Bracket-Rendering

KO-Baum als CSS-Grid oder SVG: Spalten = Runden, Verbindungslinien.

**Desktop:** 8er- und 16er-Baum vollständig ohne Scrollen sichtbar. Bei 32er-Baum horizontal scroll- und zoombar.

**Mobile:** horizontal scrollbar mit Snap pro Runde, Mini-Map oder Runden-Tabs.

Platzhaltertexte („Sieger Gruppe A", „Sieger VF2"), feststehende Teams mit Farbe/Logo. Sieger fett/farbig, Verlierer ausgegraut.

### 8.3 Match-Detail-Panel

Klick öffnet Panel/Modal:
- Ergebnis (inkl. Sätze/Runden)
- Status, Uhrzeit, Tisch
- Notizfeld, Foto
- Spielerstatistiken (optional)
- Audit-Log
- `results_per_match` (1–n) für Sätze/Legs/Runden

### 8.4 Branding

- Turnier-Logo + Titelbild
- Akzentfarbe frei wählbar
- Hell-/Dunkeltheme
- Teamlogos oder Icon-/Farbauswahl
- Info-Seiten/Blöcke: Regelwerk, Anfahrt, Getränke, Strafenkatalog, Sponsoren

### 8.5 Druck- & PDF-Export

Eigene Druckansicht, A4-PDF.

**Auswählbare Blöcke:**
- Spielplan chronologisch (Uhrzeit | Tisch | Gruppe/Runde | Team A – Team B | Ergebnisfeld)
- Gruppen mit Tabellen
- Turnierbaum (Querformat, ggf. 2 Seiten)
- Zeitplan pro Tisch (1 Seite pro Tisch)
- Regelwerk / Info-Seiten

**Layout-Anforderungen:**
- Logo + Turniername im Kopf, Seitenzahlen im Fuß
- Schwarz-weiß-tauglich: Qualifikationsplätze zusätzlich durch Linie/Symbol
- Sauberer Seitenumbruch (`break-inside: avoid`)
- Zwei Varianten: „Zum Ausfüllen" / „Aktueller Stand"

### 8.6 Konkrete Designvorgabe — verbindliche Werte

**Grundsatz:** Turniermodul fügt sich in [kru:]nest ein. Cremefarbener Hintergrund, weiße Karten, gedeckter brauner Akzent, weiche Rundungen, feine Linien-Symbole, freundliche Groteskschrift.

**Farbpalette (hell):**
```css
--paper:      #FAF7F1;
--surface:    #FFFFFF;
--surface-alt:#F5F1E9;
--ink:        #1F1B16;
--ink-soft:   #8A8077;
--line:       #E7DFD2;
--accent:     #8B6B4A;
--accent-soft:#F0E7DA;
--live:       #C0453A;
--qualified:  #4F7A4A;
--pending:    #C08A2E;
--out:        #A79E94;
--highlight:  #DDE86B;
```

**Farbpalette (dunkel):** `--paper: #1A1714`, `--surface: #23201B`, `--surface-alt: #2A2620`, `--ink: #F2EDE4`, `--ink-soft: #A69C90`, `--line: #332E27`. Akzent- und Statusfarben um ~12% aufhellen. `prefers-color-scheme: dark` und expliziter Toggle.

**Schriften:** Schriftfamilie der Kernanwendung übernommen. Teamnamen/Runden: 600, Laufweite 0.01em. Keine Versalien für Teamnamen, aber für „VIERTELFINALE" / „GRUPPE A" (klein, 0.08em). Zahlen: `font-variant-numeric: tabular-nums`.

**Größen (Desktop / Mobile):** Hilfstext 12/13 · Standard 14/15 · Betonung 16/17 · Kartenüberschrift 20/20 · Seitentitel 28/24 · Spielstand 22/20.

**Formen:** 12px Karten, 10px Buttons/Eingaben, 999px Badges. Tabellenzeilen ohne Rundung. 1px-Linien in `--line`, Schatten nur bei modalen Dialogen.

**Symbole:** Linien-Icon-Satz wie Rest von [kru:]nest, 20px Nav, 16px inline. Keine Emojis.

**Match-Zeile:** 3px-Statusstreifen links (--line geplant, --live läuft, --qualified beendet). Dann Uhrzeit + Tisch klein in --ink-soft. Teams mit 8px-Farbpunkt. Sieger 700, nicht durch Hintergrundfarbe.

**Schaltflächen-Hierarchie:** Pro Ansicht genau eine Hauptaktion (gefüllt in --accent). Zerstörung in eigenem abgesetzten Bereich. Nie mehr als 6 Buttons gleichzeitig.

**Sprache:** Deutsch, du-Form. Keine technischen Werte. Buttons benennen die Handlung.

**Bewegung:** Nur zwei Animationen — Tabellen-Aufblenden (150ms) und Dialog-Öffnen (200ms). `prefers-reduced-motion` schaltet ab.

### 8.7 Allgemeine visuelle Qualität

- Designsystem der App übernehmen
- Klare Hierarchie: laufende Spiele prominent, kommende normal, beendete zurückgenommen
- Gruppen-Tabellen: Zebra, rechtsbündige Zahlen, `tabular-nums`, Qualifikationszonen farblich
- Zustände: Leerzustände mit Erklärung + nächstem Schritt, Skeleton statt Spinner
- Micro-Feedback: Speicherbestätigung, sanfte Übergänge
- Konsistenz: Eine Match-Komponente, nicht vier
- Barrierefreiheit: 4.5:1 Kontrast, Fokus-Ringe, Tastatur, Status nie nur über Farbe

---

## 9. Validierung & Edge Cases

- num_groups so, dass Gruppen mit nur 1 Team entstünden → blockieren
- Ungerade Teamzahl → Round Robin mit BYE
- Qualifikanten keine Zweierpotenz → Empfehlung „2 beste Dritte" ODER Vorrunde ODER Freilose
- Punktgleichheit auf Quali-Platz inkl. identischem H2H → Losentscheid-Flow
- Ergebniskorrektur nach Gruppenabschluss → Warnung + Re-Seed (nur wenn KO noch nicht gestartet)
- Team zieht zurück: vor Start → aus Verteilung; während Gruppe → Restspiele 0:X-Wertung; im KO → Gegner Freilos
- `groups_only` mit 1 Gruppe = Ligamodus (einzige Ausnahme)
- Doppelte Teamnamen verhindern, Turnier ohne Teams nicht generierbar

---

## 10. Akzeptanzkriterien (Definition of Done)

- 12 Teams → 4 Gruppen à 3, Top 2 → VF: 4 Gruppen, 12 Gruppenspiele, 8er-KO, kein Same-Group im VF
- 12 Teams → 3 Gruppen à 4, Top 2 + 2 beste Dritte → VF: **18 Gruppenspiele, exakt A1–B3, A2–C2, C1–B2, B1–A3**
- 6 Qualifikanten → Wizard schlägt „2 beste Dritte ergänzen" vor
- Beste-Dritte-Ranking bei ungleich großen Gruppen rechnet pro Spiel
- 32 Teams WM-Modus vollständig durchspielbar
- 10 Teams groups_only Hin+Rück = 90 Spiele
- Tiebreaker inkl. direktem Vergleich korrekt (Dreier-Gleichstand → Sub-Tabelle rekursiv)
- Größen 8/16/24/32/10/16 alle mit derselben Engine
- Kein Code prüft auf konkrete Turniergrößen
- Determinismus: 2× Generieren mit identischer Config = identischer Plan
- Team über zwei Phasen unterschiedlichen Gruppen zuordenbar
- Korrektur kaskadiert sauber
- Desktop 1920×1080: Layout füllt die Breite
- 8er- und 16er-Baum vollständig ohne Scrollen
- Kein horizontaler Scroll 320–2560px (Ausnahme: Baum im eigenen Scrollcontainer)
- Mobile Tab-Leiste konstante Höhe
- Ergebnis jederzeit eintragbar, Korrekturen möglich
- Filter im Spielplan funktionieren
- Tiebreaker-Reihenfolge sofort wirksam
- Drag & Drop mit Maus, Touch, Tastatur
- Mobile voll bedienbar, Touch-Targets ≥44px
- Eine Match-Komponente überall
- Realtime: A nach B ohne Reload
- Scheduling: 16/4/4/15+5 = 6 Slots, keine Doppelbelegung
- Drag & Drop Schedule mit Konflikt-Warnung
- +15 min verschiebt Folge-Spiele
- Außerhalb Modulverzeichnis: keine Änderungen außer einer Routing-Zeile + Migrationen
- Alle Screens aus §13
- Keiner der §8.0-Fehler
- Keine DB-IDs in der Oberfläche
- 4 Gruppentabellen nebeneinander
- Pro Ansicht eine Hauptaktion, max 6 Buttons
- 16 Teamnamen per Copy-Paste
- PDF-Export A4 lesbar, schwarz-weiß
- Admins-only anlegen, Mitglieder ohne „+ Neues Turnier"
- Draft unsichtbar für Mitglieder
- Admins-only Ergebnisse, Backend 403

---

## 11. Feature-Parität (Benchmark meinspielplan.de)

### Stufe A — Kern
- Automatische Paarungsgenerierung + manuelles Nachbearbeiten
- Teams per Copy-Paste-Massenimport
- Zeitplanung mit Drag & Drop
- Frei konfigurierbare Tabelle
- Match-Detail-Panel
- Turnier-Logo, Teamfarben, Branding
- Druck-/PDF-Export
- Mobile + Desktop gleichwertig

### Stufe B — Architektur jetzt vorbereiten
- Öffentliche Live-Seite (Felder `is_public`, `public_token` da; Read-Bypass im Auth-Helper)
- Benachrichtigungen für `linked_user_ids`
- Platzierungsspiele & Zwischenrunde (Phasen-Konzept)
- Spielerstatistiken
- Zusätzliche Spielleiter-Rolle

### Stufe C — später
- Doppel-KO
- Schweizer System
- Vorlagen (WM 32, EM 24, Bierpong 16)
- Ligamodus über mehrere Tage
- Ergebniseintragung durch Team-Verantwortliche (bewusst zurückgestellt)

---

## 12. Implementierungsreihenfolge

1. Altes Modul vollständig löschen, leeres Verzeichnis, eine Einstiegsroute
2. Datenmodell + Migrationen
3. Aufbereitungsschicht (DB → Anzeigeobjekte)
4. Reine Logik-Engine (`tournament-engine.js`) + Unit-Tests
5. Gestaltungsgrundlage: CSS-Variablen, Match-Komponente
6. Wizard-UI inkl. Copy-Paste-Teamimport
7. Gruppen-/Spielplan-Ansichten + Ergebniseingabe
8. Bracket-Rendering
9. Zeitplanung mit Tischen und Drag & Drop
10. Desktop-Layout-Feinschliff
11. Druck-/PDF-Export
12. Erst dann Stufe B

---

## 13. Detaillierte Screen- & Navigationsspezifikation

### 13.1 Navigationsbaum

```
[kru:]nest → Gruppe → Turniere        ← Screen A: Turnierliste
                       ├── + Neues Turnier  ← Screen B: Wizard (nur Admin)
                       └── Turnier öffnen   ← Screen C: Turnier-Arbeitsbereich
                             ├── Übersicht (C1)        alle
                             ├── Spielplan (C2)        alle
                             ├── Gruppen (C3)          alle
                             ├── Turnierbaum (C4)      alle
                             ├── Teams (C5)            NUR ADMIN
                             ├── Drucken/PDF (C6)      alle
                             └── Einstellungen (C7)    NUR ADMIN
```

### 13.2 Screen A — Turnierliste

Desktop: Seitentitel „Turniere" links oben, rechts oben Button „+ Neues Turnier" (nur Admin). Karten-Grid: **`repeat(auto-fill, minmax(260px, 1fr))`** (260 statt 340 px Spec-Entwurf — bei 390px Viewport mit eingeklappter App-Sidebar + Content-Padding + Modul-Padding bleiben real ~286px für die Karten, 340px min würde horizontalen Scroll erzwingen. „Kein horizontaler Scrollen schlägt Wunschzahl"). Sortierung: laufende zuerst, dann kommende, dann beendete.

Pro Karte: Logo/Initialen-Platzhalter, Name, Datum, Status-Badge (Entwurf · Bereit · Läuft · Beendet), Kurzinfo („16 Teams · 4 Gruppen · 12 von 24 Spielen gespielt"), Fortschrittsbalken, bei laufendem Turnier aktuelles Spiel.

Aktionen: Klick → Screen C. Kontextmenü (⋯, nur Admin): Umbenennen · Duplizieren · Löschen (Sicherheitsabfrage mit Eintippen des Turniernamens).

**Leerzustand:** Für Admins zentriert „Noch kein Turnier angelegt" + Button „+ Neues Turnier". Für Mitglieder: „In dieser Gruppe läuft gerade kein Turnier." — ohne Button, **kein Hinweis auf Entwurf**.

**Mobile:** Karten einspaltig, „+ Neues Turnier" als schwebender Aktionsbutton unten rechts.

### 13.3 Screen B — Wizard „Neues Turnier"

**Fünf Schritte, oben Fortschrittsanzeige mit klickbaren abgeschlossenen Schritten. Unten rechts „Weiter", unten links „Zurück".**

**Desktop: Wizard ist ein zentrierter Bereich mit maximal 900px Breite — das ist die einzige Ansicht im ganzen Modul, die absichtlich schmal ist.** Alle anderen Ansichten nutzen die volle Breite.

**Rechts neben dem Formular (ab 1200px Modul-Breite) eine Live-Vorschau-Karte:** Anzahl Gruppen, resultierende Gruppengrößen, Anzahl Spiele, geschätzte Dauer, erwartetes Turnierende.

**Schritt 1 — Grunddaten:** Turniername (Pflicht), Datum, Ort, Logo-Upload (Drag & Drop), Sportart-Auswahl (Labels: „Tore"/„Punkte"/„Becher").

**Schritt 2 — Teams:** Großes Textfeld „Ein Team pro Zeile" + Button „Teams übernehmen". Darunter die Teamliste, jede Zeile mit Farbwähler, Bearbeiten/Löschen, per Drag & Drop sortierbar (= Setzliste). Zähler „16 Teams". Warnung bei Duplikaten.

**Schritt 3 — Modus:** Vier große Karten (Gruppen + KO · Nur Gruppen · Nur KO · Doppel-KO, letztere ausgegraut). Nach Auswahl: Anzahl Gruppen als Schieberegler mit Live-Anzeige „3 Gruppen → 4 / 4 / 4", Verteilungsmethode, Hin- und Rückrunde, Punkteregel, Tiebreaker-Reihenfolge als sortierbare Liste.

**Schritt 4 — Qualifikation & Zeitplan:** Aufsteiger pro Gruppe, beste Dritte mit Anzahl, Spiel um Platz 3. Tische (Anzahl + Namen), Startzeit, Spieldauer, Pause. Vorschau: „24 Spiele · 4 Tische · 6 Runden · Ende ca. 17:40".

**Schritt 5 — Zusammenfassung:** Alle Einstellungen als übersichtliche Liste mit „Ändern"-Links. Button „Turnier generieren" in Akzentfarbe. Danach Weiterleitung zu C1.

**Verhalten:** Eingaben werden bei jedem Schrittwechsel als Entwurf gespeichert. „Weiter" deaktiviert, solange Pflichtangaben fehlen — **mit Hinweistext, WELCHE Angabe fehlt**, nicht nur ein gesperrter Button.

### 13.4 Screen C — Rahmenlayout

Wichtig: [kru:]nest hat eine eigene linke Seitenleiste. Die bleibt. Das hier beschriebene Layout füllt den Bereich rechts davon.

**Desktop ≥ 1500px Modul-Breite — drei Spalten:**
- Header (volle Breite, ~64px) mit Logo, Turniername, Status-Badge, Drucken, ⋯
- Navigation 212px (immer sichtbar)
- Hauptbereich flexibel
- Kontextspalte 300px

**Tablet 768–1499px:** Navigation 160px, Kontextspalte eingerollt.

**Mobile < 768px:** Header + Tab-Leiste (kein Kontext-Spalte), ein Inhalt pro Bildschirm.

Header-Aktionen: „Drucken/PDF" (alle), ⋯ mit Bearbeiten · Duplizieren · Löschen (nur Admin).

### 13.5 C1 — Übersicht

Vier Bereiche:
- Statuszeile (aktuelle Phase, Fortschritt, Countdown)
- Laufende Spiele (große Karten, Ergebniseingabe für Admins)
- Nächste Spiele (6 Stück, kompakte Liste)
- Kurz-Tabellen (auto-fit, minmax(280px, 1fr)) oder Bracket-Vorschau wenn Gruppenphase fertig

### 13.6 C2 — Spielplan

Filter oben: Alle · Nach Gruppe · Nach Tisch · Nach Runde · Nur offene. Suchfeld.

Desktop: Tabelle über volle Breite: Zeit · Tisch · Phase/Gruppe · Heim · Ergebnis · Gast · Status · Aktion. Zebra, rechtsbündige Zahlen, `tabular-nums`.

Mobile: Kartenliste (Uhrzeit+Tisch in Kopfzeile, Teams untereinander mit Ergebnis rechts).

Klick öffnet Match-Dialog. Direkte Ergebniseingabe in Zeile ist möglich.

### 13.7 C3 — Gruppen

Karten-Grid, `repeat(auto-fit, minmax(360px, 1fr))`. Bei 4 Gruppen auf breitem Monitor: 2–4 nebeneinander.

Pro Gruppe: Pl. · Team · Sp. · S · U · N · Tore (12:7) · Diff · Pkt. Tooltips für Abkürzungen. Qualifikationsplätze farblich (grün = weiter, gelb = mögliche beste Dritte).

Wertung der Gruppendritten als eigene Karte bei aktivierter Regel. Losentscheid-Button bei Gleichstand (nur Admin).

### 13.8 C4 — Turnierbaum

Vollbreite, Runden als Spalten, Verbindungslinien. Über dem Baum Zoomsteuerung und „An Bildschirm anpassen".

Knoten: beide Teams mit Farbpunkt, Ergebnis, Uhrzeit + Tisch klein. Sieger fett/farbig, Verlierer ausgegraut. Platzhalter („Sieger Gruppe A") in kursiv.

8er- und 16er-Baum auf 1920px vollständig ohne Scrollen. Spiel um Platz 3 unter HF-Bereich.

Mobile: horizontal scrollbar mit Snap, Runden-Tabs.

### 13.9 C5–C7

**C5 Teams (nur Admin):** Tabelle Name · Farbe · Gruppe · Platzierung · Bilanz. „Team hinzufügen" mit Copy-Paste (nur draft/generated).

**C6 Drucken/PDF (alle):** Block-Auswahl + Seitenvorschau A4. „Als PDF speichern" / „Drucken". „Zum Ausfüllen" / „Aktueller Stand".

**C7 Einstellungen (nur Admin):** Status-Hinweis („Vor dem Turnierstart — alles änderbar" / „Turnier läuft — Struktur gesperrt"). Fünf Abschnitte: Grunddaten · Regeln · Spielfelder & Zeiten · Gruppen · Terminierung. Gefahrenbereich abgesetzt: „Alle Ergebnisse löschen", „Turnier abschließen", „Turnier löschen" — alle mit Name-Eintippen-Bestätigung.

### 13.10 Modale Dialoge

Genau vier:
- Match-Dialog (Ergebnis, Status, Notiz, Verlauf)
- Team-Dialog (Name, Farbe, Logo, Spielerliste)
- Bestätigungsdialog (zerstörende Aktionen)
- Kaskaden-Warnung (Korrektur mit Folgespielen)

Alle: Escape-schließbar, Klick außerhalb, Fokus-Management, Mobile als Bottom-Sheet.

### 13.11 Gestaltungsraster

- Abstände: 4 · 8 · 12 · 16 · 24 · 32 · 48px
- Spaltenraster: 12 Spalten, 24px Rinne
- Zeilenhöhen: 44px (kompakt 36px), Match-Karte 72px, Kartenüberschrift 56px
- Eine Match-Komponente in Spielplan, Gruppen, Baum, Kontextspalte
- Farbe zusätzlich durch Text/Symbol absichern

---

## 14. Hinweise an das implementierende Modell

- Nicht alles auf einmal. Reihenfolge aus §12 abarbeiten.
- Kompletter Neubau, aber nur des Turniermoduls.
- Engine zuerst, mit Tests. §6.3.2-Referenz ist der Prüfstein.
- Design und Navigation sind kein Feinschliff.
- Genau die Screens aus §13 bauen.
- Keine Attrappen. Lieber Feature weglassen als halb bauen.
- Keine Endlosschleifen.
- Keine stillen Annahmen.
- Jede Berechnung geht von Ergebnissen aus.
- Fehler sichtbar machen.
- Nach jedem Schritt §10-Abnahmeprüfung.
- Im Zweifel diese Spec, nicht bestehender Code oder Internet.
