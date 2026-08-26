# Turnier-Modul

Dieses Modul erweitert das Fotoalbum um generische Turnierverwaltung mit Presets und Instanzen.

## Ziel

Das System soll verschiedene Turnierarten ohne sportartspezifische Sonderlogik abbilden. Die Konfiguration erfolgt über:

- Presets (wiederverwendbare Startvorlagen)
- Instanzen (konkrete Event-Durchläufe)
- Laufende Verwaltung (Teilnehmer, Teams, Matches, Standings)

## Rollen und Rechte

Verwaltung (Create/Update/Delete) ist möglich für:

- Gruppen-Owner
- Gruppen-Vertreter
- Admins

Read-Zugriffe auf Listen/Details sind für Gruppenmitglieder vorgesehen.

## Preset-Prinzip

Ein Preset enthält die Grundlogik eines Formats:

- baseType: `single_elimination`, `double_elimination`, `round_robin`, `group_plus_knockout`, `custom`
- Stage-Typen: `single_elimination`, `double_elimination`, `round_robin`
- participantMode: `individual`, `team`, `pair`
- Stage-Reihenfolge (`stages`)
- optionale Zusatzkonfiguration (`config`)

Presets werden nicht gelöscht, sondern archiviert (`isArchived=true`).

## Instanz-Prinzip

Eine Instanz ist ein konkretes Turnier aus einem Preset.

- enthält eigene Teilnehmer, Teams, Runden und Matches
- kann eigene Konfiguration überschreiben
- nutzt Statusfluss über String-Statusfelder

Typische Stati:

- `draft`
- `registration`
- `scheduled`
- `in_progress`
- `completed`
- `cancelled`

## Backend-Struktur

Die API liegt unter `/api/tournaments`.

### Kern-Endpunkte

- Presets: `GET/POST/PATCH/DELETE /presets`
- Instanzen: `GET/POST/PATCH /instances`
- Teams: `POST /instances/:id/teams`
- Teilnehmer: `POST/DELETE /instances/:id/participants...`
- Matches: `POST /instances/:id/matches`
- Ergebnisse: `PATCH /instances/:id/matches/:matchId/result`
- Standings: `GET /instances/:id/standings`

Details siehe [api-referenz.md](api-referenz.md).

## Frontend-Integration (PWA)

Das Modul ist in die bestehende modulare Sidebar integriert:

- neuer Home-Bereich: Turniere
- Dashboard-Ansicht derzeit leer als Platzhalter
- eigene Seite für Turnier-Instanzen, getrennt nach:
  - Entwurf
  - Registrierung
  - Live
  - Abgeschlossen
- separate Preset-Seite
- Detailansicht für aktive Instanz:
  - Teams verwalten
  - Teilnehmer hinzufügen/entfernen
  - Matches anlegen
  - Ergebnisse eintragen
  - Standings anzeigen

## Datenmodell (Prisma)

Neue Modelle:

- `TournamentPreset`
- `TournamentPresetStage`
- `TournamentInstance`
- `TournamentTeam`
- `TournamentParticipant`
- `TournamentRound`
- `TournamentMatch`
- `TournamentMatchResult`

Designprinzipien:

- String-Status statt Prisma-Enums (erweiterbar)
- explizite Relationen und Join-Tabellen
- Indizes für Listen, Sortierung, Standings
- Audit-Felder wie `createdAt`, `updatedAt`, `recordedBy`

## Aktueller Scope

Aktuell enthalten:

- Preset CRUD (mit Archivierung)
- Instanz-Erstellung, Statuswechsel und Löschen
- Darstellung der Instanzen nach Phase (Entwurf/Registrierung/Live/Abgeschlossen)
- Team-/Teilnehmerverwaltung
- Match-Erstellung und Ergebnis-Erfassung
- Standings-Berechnung aus Match-Resultaten

Noch offen für Folgephasen:

- automatischer Bracket-Generator pro Modus
- tieferes Tiebreaker-Regelwerk je Format
- erweiterte Live-Ansicht/Realtime-Boards
- komfortablere UI-Formulare statt Prompt-Flow
