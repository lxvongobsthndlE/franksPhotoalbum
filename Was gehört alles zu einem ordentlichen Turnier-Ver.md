<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Was gehört alles zu einem ordentlichen Turnier-Verwaltungs Tool? Ich möchte es so generisch wie möglich haben also ein Tool mit dem ich zum Beispiel sowohl Fußballturniere als auch Bier-Pong-Turniere anlegen und verwalten kann. Worauf miss ich achten? Welche features werden benötigt?

Ja — ein gutes, möglichst generisches Turnier-Tool braucht vor allem **flexible Strukturen**, damit es sowohl für Fußball als auch für Bier-Pong funktioniert, ohne dass du jedes Mal alles neu bauen musst. Aus den gängigen Funktionspaketen solcher Systeme lassen sich die Kernbereiche klar ableiten: Registrierung, Formate/Brackets, Terminplanung, Ergebnisverwaltung, Kommunikation und Exporte.[^1_1][^1_2][^1_3]

## Worauf du achten musst

Das wichtigste Prinzip ist: **nicht sport-spezifisch denken, sondern regel-spezifisch**. Fußball, Bier-Pong, Tischtennis oder E-Sport unterscheiden sich zwar im Ablauf, aber sie brauchen meist dieselben Bausteine: Teilnehmer, Teams, Gruppen, Spiele, Regeln, Tabellen, Zeitpläne und Ergebnisse. Ein gutes System sollte deshalb über Konfiguration statt Sonderlogik angepasst werden können.[^1_4][^1_2][^1_5]

## Pflicht-Features

- Turnier anlegen mit Typ, Titel, Ort, Datum, Status und Basisregeln.
- Teilnehmer, Teams oder Mixed-Formate verwalten.
- Mehrere Turnierformate unterstützen, etwa K.-o., Gruppenphase, Round Robin, Swiss oder Hybrid.[^1_2][^1_5][^1_4]
- Automatische Spielplan- und Bracket-Erstellung.[^1_6][^1_3][^1_4]
- Ergebnis-Erfassung und automatische Aktualisierung von Tabellen oder Folgerunden.[^1_7][^1_4][^1_2]
- Live-Ansicht für Teilnehmer, Zuschauer und Orga-Team.[^1_3][^1_6]
- Kommunikation bei Änderungen, Verzögerungen oder Ausfällen.[^1_8][^1_2]
- Exportfunktionen, etwa PDF, CSV oder Druckansichten.[^1_5]


## Flexible Datenmodelle

Damit das Tool wirklich generisch ist, solltest du die Datenmodelle sauber trennen. Ein „Spiel“ sollte nicht fest an Fußballregeln hängen, sondern nur Felder wie Teilnehmer A/B, Ergebnis, Zeit, Ort, Runde und Status haben. Regeln wie „3 Punkte pro Sieg“, „Tore zählen doppelt“ oder „Best of 3“ sollten pro Turnier oder sogar pro Division konfigurierbar sein.[^1_8][^1_2][^1_3]

## Wichtige Sonderfälle

Fußball braucht oft mehr Komplexität als Bier-Pong: Gruppen, Torverhältnis, Platzierungskriterien, Unentschieden, ggf. Fair-Play-Regeln. Bier-Pong braucht dagegen eher kurze Spielzyklen, flexible Tischzuweisung, schnelle Neuplanung und oft ein einfaches K.-o.-System. Deshalb sollte dein Tool sowohl **schwere** als auch **leichte** Regeln abbilden können, ohne dass das UI kompliziert wird.[^1_7][^1_2][^1_3]

## Admin- und Orga-Funktionen

Für den Betrieb sind Check-in, Rollen/Rechte, manuelle Overrides und Konfliktprüfung extrem wichtig. Gute Systeme unterstützen etwa Team-Check-in, Kapazitätsgrenzen, Zeitfenster, automatische Warnungen bei Überschneidungen und manuelle Eingriffe durch die Orga. Das spart vor allem bei Live-Events viel Stress.[^1_9][^1_4][^1_1][^1_6]

## Technische Anforderungen

Wenn du das als Produkt bauen willst, achte auf Mehrmandantenfähigkeit, API, saubere Rechteverwaltung und mobile Nutzbarkeit. Dazu kommen Performance bei Live-Aktualisierungen, Offline-Toleranz für Check-in oder Schiedsrichter-Scoring und gute Audit-Logs für Änderungen. Ein generisches System gewinnt, wenn es nicht nur schön aussieht, sondern robust gegen Fehler und spontane Turnieränderungen ist.[^1_10][^1_4][^1_1][^1_3]

## Gute Mindeststruktur

Eine sinnvolle Kernstruktur wäre:

1. Event.
2. Division/Kategorie.
3. Teilnehmer/Teams.
4. Format/Regeln.
5. Spielplan/Runden.
6. Matches.
7. Ergebnisse.
8. Ranglisten/Weiterkommen.
9. Kommunikation.
10. Exporte/Reports.[^1_2][^1_5][^1_8]

Wenn du willst, kann ich dir als Nächstes daraus direkt ein **sauberes Feature-Set für ein MVP** oder ein **Datenmodell/DB-Schema** ableiten.

<div align="center">⁂</div>

[^1_1]: https://sportlomo.com/events-tournaments/

[^1_2]: https://tourneysoft.com/en/

[^1_3]: https://www.regystra.com/features/tournament-scheduling-seeding

[^1_4]: https://leaguearc.com/for/tournament-directors/

[^1_5]: https://sourceforge.net/projects/tugeny/

[^1_6]: https://alternativeto.net/software/brakto/about/

[^1_7]: https://www.turnier.de/product/page.aspx?id=112\&s=55

[^1_8]: https://ro-turnier.updatestar.com/es

[^1_9]: https://www.regystra.com/features/all-features

[^1_10]: https://www.regystra.com/en/tournament-management-software


---

# Aber dann macht es vermutlich sinn presets anzubieten die dann finetuned werden können… weil sonst muss das tool ja so krass viele unterschiedliche turniermodi und co abbilden können, das ist ja auch mega komplex im Bau

Ja, genau — **Presets/Templates sind wahrscheinlich der richtige Weg**. Statt ein System zu bauen, das jeden möglichen Turniermodus „natürlich“ von Grund auf modelliert, nimmst du ein paar gut durchdachte Standardformate und lässt sie danach fein konfigurieren. Das ist auch ein Muster, das viele Turnier-Tools بالفعل nutzen: vorgefertigte Templates, die man an Format, Runden, Scoring und Regeln anpassen kann.[^2_1][^2_2][^2_3]

## Warum Presets sinnvoll sind

Der Kernpunkt ist Komplexitätskontrolle. Wenn du versuchst, sofort alle Varianten direkt zu unterstützen, explodiert dein Datenmodell und deine UI-Komplexität; Presets reduzieren das, weil du nur die 80% der typischen Fälle sauber abdeckst und den Rest über Anpassungen löst. Genau so arbeiten viele Systeme mit vorgefertigten Turnierstrukturen wie Single Elimination, Double Elimination, Round Robin oder Hybrid-Formaten.[^2_4][^2_5][^2_6]

## Gute Preset-Idee

Ich würde Presets nicht als „fertige Turniere“, sondern als **Startkonfigurationen** bauen. Ein Preset enthält dann z. B. Standardregeln, Spielstruktur, Punktevergabe, Rundenlogik, Tiebreaker und typische UI-Felder, die du danach ändern kannst. Das macht den Einstieg schnell, ohne dass du die Flexibilität verlierst.[^2_2][^2_3][^2_1]

## Sinnvolle Presets

- Fußball-Liga oder Turnier: Gruppenphase, Torverhältnis, Unentschieden, Platzierungskriterien.
- K.-o.-Turnier: einfache Brackets, Seeding, Byes, Finale.
- Round-Robin: jeder gegen jeden, automatische Tabelle, Tiebreaker.
- Bier-Pong: kurze Matches, freie Teamgrößen, schnelle Neuzuweisung, einfache K.-o.-Logik.
- Custom/Empty: komplett frei für Spezialfälle.[^2_5][^2_6][^2_4]


## So bleibt es baubar

Am besten trennst du zwischen **Preset-Definition** und **Turnier-Instanz**. Das Preset beschreibt die Struktur, die Instanz enthält nur die konkreten Daten eines Events. Dann kannst du ein Fußballturnier aus dem Fußball-Preset erzeugen, aber beim Bier-Pong dieselbe Engine mit anderem Regelset nutzen.[^2_3][^2_7][^2_2]

## Was du nicht zu früh bauen solltest

Du brauchst am Anfang wahrscheinlich nicht sofort jede exotische Sonderform wie Feed-In-Consolation, Compass Draws oder sehr komplexe Hybridlogiken. Solche Varianten zeigen zwar, wie weit gute Turniersoftware gehen kann, aber für ein generisches Produkt sind sie eher spätere Ausbaustufen. Starte lieber mit klaren Basismodulen und optionalen Erweiterungen.[^2_6][^2_4]

## Praktische Empfehlung

Baue dein Produkt so:

1. Preset wählen.
2. Feinparameter anpassen.
3. Teilnehmer importieren/anlegen.
4. Spielplan generieren.
5. Live verwalten.

Damit hast du eine gute Balance aus Einfachheit für den Nutzer und Machbarkeit für dich als Entwickler.[^2_1][^2_2][^2_3]

Wenn du möchtest, kann ich dir als Nächstes ein **konkretes Preset-Modell als JSON/DB-Struktur** skizzieren, damit du direkt siehst, wie man das technisch sauber aufzieht.
<span style="display:none">[^2_10][^2_8][^2_9]</span>

<div align="center">⁂</div>

[^2_1]: https://tournifyapp.com/en

[^2_2]: https://pickleball.com/docs/en/72000645106-using-premade-templates-to-create-tournaments

[^2_3]: https://docs.scoreholio.com/run-a-tournament/tournament-templates

[^2_4]: https://www.r2sports.com/site/r2brackets.asp

[^2_5]: https://bracketfast.com/en/bracket-generator

[^2_6]: https://scoreleader.com/online-tournament-bracket/

[^2_7]: https://www.tournamentsoftware.com/product/article.aspx?s=2\&id=E0524F9C-E95F-4A82-93C9-316BB47FA6C6

[^2_8]: https://playground.com/templates/s/tournament

[^2_9]: https://weblium.com/templates/tag/tournament-website/

[^2_10]: https://edit.org/blog/templates-sport-tournaments


---

# Ja mach das gerne

Ja — und genau dafür ist ein **Preset + Override**-Modell sehr passend. Die Idee ist: Du speicherst ein Turnier nicht als riesigen Spezialfall, sondern als Kombination aus einem Standard-Template und den Abweichungen davon. Solche Trennung von Turnierlogik und Einstellungen findet man auch in anderen Turnier-/Bracket-Modellen und APIs.[^3_1][^3_2][^3_3]

## Grundidee

Ich würde drei Ebenen bauen:

1. **Preset**: beschreibt das Standardformat.
2. **Tournament Instance**: konkrete Veranstaltung.
3. **Overrides**: alles, was vom Preset abweicht.[^3_4][^3_5][^3_1]

So kannst du z. B. „Fußball 6er-Gruppe“ und „Bier-Pong K.-o.“ beide aus derselben Engine erzeugen, aber mit unterschiedlichen Einstellungen. Die Presets enthalten dabei nur die relevanten Defaults, statt den kompletten Ablauf fest zu verdrahten.[^3_3][^3_6][^3_7]

## Beispielstruktur

```json
{
  "presetId": "preset_ko_single",
  "name": "Single Elimination",
  "description": "Einfaches K.-o.-Turnier",
  "category": "generic",
  "baseType": "single_elimination",
  "settings": {
    "participantsType": "team",
    "minParticipants": 2,
    "maxParticipants": 128,
    "allowByes": true,
    "seedingMode": "manual",
    "thirdPlaceMatch": false,
    "scoreVisibility": "public",
    "tiebreakers": []
  },
  "matchRules": {
    "bestOf": 1,
    "allowDraw": false,
    "overtime": false,
    "penaltyShootout": false
  },
  "ui": {
    "showBracket": true,
    "showStandings": false,
    "showMatchClock": false,
    "showLiveScoring": true
  },
  "workflow": {
    "registrationOpen": true,
    "checkInRequired": false,
    "manualAdvanceAllowed": true
  }
}
```

Das ist nur die Preset-Seite. Die konkrete Turnierinstanz könnte dann so aussehen:

```json
{
  "tournamentId": "t_2026_berlin_bierpong",
  "presetId": "preset_ko_single",
  "name": "Bier-Pong Cup Sommer 2026",
  "overrides": {
    "participantsType": "pair",
    "allowDraw": false,
    "bestOf": 3,
    "showMatchClock": false
  },
  "participants": [],
  "matches": [],
  "status": "draft"
}
```


## Was ins Preset gehört

Ein gutes Preset sollte nur Dinge enthalten, die den **Turniermodus** definieren, nicht die konkreten Teilnehmer. Dazu gehören vor allem:

- Teilnehmer-Typ: Einzelperson, Team, Paar, frei gemischt.
- Format: K.-o., Gruppenphase, Round Robin, Swiss, Hybrid.
- Regeln: Best-of, Unentschieden, Verlängerung, Tiebreaker.
- Sichtbarkeit: Live-Scores, Tabelle, Bracket.
- Orga-Workflow: Check-in, manuelle Eingriffe, automatische Weiterleitung.[^3_8][^3_6][^3_3]


## Was als Override rein sollte

Overrides sind perfekt für alles, was der Nutzer im Event anpassen will:

- Anzahl der Teams.
- Matchdauer.
- Anzahl der Gruppen.
- Punktevergabe.
- Sonderregeln pro Event.
- Darstellungseinstellungen.[^3_5][^3_1]

Damit bleibt das Preset stabil, und du vermeidest, dass jeder kleine Sonderwunsch direkt das Grundmodell kaputtmacht.[^3_2][^3_1]

## Gute Architektur dafür

Technisch würde ich das in Module trennen:

- **Preset Engine**: erzeugt aus einem Template die Startstruktur.
- **Rule Engine**: berechnet Punkte, Weiterkommen und Tiebreaker.
- **Scheduler**: legt Matches auf Zeiten und Felder/Tische.
- **Scoring Service**: nimmt Ergebnisse entgegen und aktualisiert den Stand.
- **Admin Layer**: Overrides, manuelle Korrekturen, Check-in.[^3_9][^3_2][^3_3]


## Praktische Faustregel

Wenn du dir bei einem Feld denkst „das brauchen nur 10% der Turniere“, dann ist es oft kein Preset-Feld, sondern ein Override oder eine optionale Erweiterung. So hältst du das System klein genug, aber nicht zu starr. Das ist meistens der beste Kompromiss zwischen Flexibilität und Bauaufwand.[^3_7][^3_1][^3_5]

## Nächster sinnvoller Schritt

Der beste nächste Schritt wäre, diese Struktur in ein kleines, konkretes Schema zu gießen:

- Preset-Definition.
- Tournament-Definition.
- Match-Definition.
- Rule-Definition.

Ich kann dir als Nächstes direkt ein **sauberes DB-Schema oder TypeScript-Interfaces** dafür entwerfen.
<span style="display:none">[^3_10][^3_11][^3_12]</span>

<div align="center">⁂</div>

[^3_1]: https://github.com/fnogatz/chess.json

[^3_2]: https://bracketry.app/data-shape/

[^3_3]: https://the-tournament.net/apidocs/tournaments.html

[^3_4]: https://themes-developers.storeden.com/hc/en-us/articles/360019547611-How-to-create-and-to-modify-widget-preset-json

[^3_5]: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates

[^3_6]: https://www.r2sports.com/site/r2brackets.asp

[^3_7]: https://docs.scoreholio.com/run-a-tournament/tournament-templates

[^3_8]: https://pkg.go.dev/github.com/fezcode/go-tournament-brackets

[^3_9]: https://github.com/david-torres/tournament-organizer

[^3_10]: https://github.com/SanketRevankar/TournamentManagement

[^3_11]: https://www.npmjs.com/package/react-tournament-ready

[^3_12]: https://docs.elixir.app/api-docs/api-docs-1/tournaments-api


---

# Db schema

Ja — für dein Vorhaben würde ich das DB-Schema so aufbauen, dass es **Preset-, Turnier-, Teilnehmer-, Match- und Regel-Daten sauber trennt**. Ein gutes Grundmodell ist relational, aber mit genug Flexibilität für verschiedene Formate und Overrides.[^4_1][^4_2][^4_3]

## Kern-Tabellen

```sql
tournament_presets
tournaments
tournament_overrides
participants
teams
entries
groups
rounds
matches
match_participants
scores
rules
rule_sets
venues
schedules
audit_logs
```

Das Ziel ist: ein Preset erzeugt eine Turnierinstanz, und diese Instanz enthält dann Teilnehmer, Spiele, Runden und Ergebnisse. So vermeidest du, dass dein Datenmodell schon im Kern auf ein einziges Format festgenagelt ist.[^4_4][^4_5][^4_1]

## Vorschlag fürs Schema

```sql
CREATE TABLE tournament_presets (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  base_type TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tournaments (
  id UUID PRIMARY KEY,
  preset_id UUID REFERENCES tournament_presets(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tournament_overrides (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  UNIQUE (tournament_id, key)
);
```

`config` und `overrides` geben dir Flexibilität, ohne dass du für jede Sonderregel sofort neue Spalten brauchst. Das ist besonders sinnvoll, wenn du später Formate wie Bier-Pong, Fußball oder eigene Custom-Turniere mit leicht unterschiedlichen Regeln unterstützen willst.[^4_6][^4_7][^4_8]

## Teilnehmer und Teams

```sql
CREATE TABLE participants (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  participant_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  seed INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE entries (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id),
  team_id UUID REFERENCES teams(id),
  entry_type TEXT NOT NULL,
  CHECK (
    (participant_id IS NOT NULL AND team_id IS NULL) OR
    (participant_id IS NULL AND team_id IS NOT NULL)
  )
);
```

Damit kannst du sowohl Einzelspieler als auch Teams abbilden. Für Bier-Pong könntest du Teams als Doppelteams nutzen, für Fußball klassische Teams, und für andere Events Einzelpersonen.[^4_3][^4_4]

## Runden und Matches

```sql
CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  name TEXT,
  stage TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE matches (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id UUID REFERENCES rounds(id) ON DELETE SET NULL,
  bracket_slot INT,
  scheduled_at TIMESTAMP,
  venue_id UUID,
  status TEXT NOT NULL DEFAULT 'planned',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  winner_entry_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE match_participants (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id),
  side TEXT NOT NULL,
  score NUMERIC,
  outcome TEXT,
  UNIQUE (match_id, entry_id)
);
```

Das `match_participants`-Modell ist flexibler als feste `p1/p2`-Spalten, weil du damit auch Sonderfälle, mehrere Teilnehmer pro Match oder spätere Erweiterungen besser abbilden kannst. So bleibt das Schema generisch genug für unterschiedliche Turnierarten.[^4_9][^4_5][^4_1]

## Regeln und Scoring

```sql
CREATE TABLE rule_sets (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE scores (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES entries(id),
  points NUMERIC NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

Regeln sollten nicht direkt im Match hart codiert sein, sondern in einem regelbaren Set liegen. Dadurch kannst du z. B. Fußball mit Torverhältnis und Bier-Pong mit Punkte-/Rundenlogik unterschiedlich auswerten, ohne das Grundschema umzubauen.[^4_5][^4_1]

## Praktische Empfehlung

Ich würde `JSONB` gezielt für konfigurierbare Teile nutzen, aber die operativen Kerndaten normalisieren. Das heißt: Teilnehmer, Matches, Runden und Turniere als echte Tabellen; Sonderregeln, UI-Einstellungen und Preset-Parameter als JSON. So bekommst du gute Abfragebarkeit und trotzdem genug Freiheit für neue Modi.[^4_7][^4_8][^4_3]

## Minimaler MVP-Schnitt

Wenn du es klein anfangen willst, reichen erstmal diese 8 Tabellen:

- `tournament_presets`
- `tournaments`
- `participants`
- `teams`
- `entries`
- `rounds`
- `matches`
- `match_participants`

Alles andere wie `rules`, `scores`, `venues`, `audit_logs` kannst du später ergänzen. So kommst du schnell zu einem funktionierenden Kern, ohne dich im Modell zu verlieren.[^4_2][^4_1][^4_4]

Wenn du möchtest, mache ich dir als Nächstes daraus ein **ER-Diagramm in Textform** oder direkt ein **PostgreSQL-DDL-Schema mit Constraints und Indexen**.
<span style="display:none">[^4_10][^4_11][^4_12][^4_13]</span>

<div align="center">⁂</div>

[^4_1]: https://the-tournament.net/apidocs/tournaments.html

[^4_2]: https://github.com/foahchon/tournamentdb/blob/master/tournament.sql

[^4_3]: https://stackoverflow.com/questions/11201755/database-design-for-tournament-management-software

[^4_4]: https://stackoverflow.com/questions/53772633/database-model-tournaments-for-esports

[^4_5]: https://scoreleader.com/how-tournament-brackets-work/

[^4_6]: https://github.com/fnogatz/chess.json

[^4_7]: https://bracketry.app/data-shape/

[^4_8]: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates

[^4_9]: https://stackoverflow.com/questions/650182/best-schema-to-represent-ncaa-basketball-bracket

[^4_10]: https://gist.github.com/anonymous/6879261

[^4_11]: https://mintlify.wiki/AlexanderAsprilla98/Tournament-Management-App/api/data/context

[^4_12]: https://www.youtube.com/watch?v=d_IB0OxBWE0

[^4_13]: https://github.com/bencam/tournament-database

