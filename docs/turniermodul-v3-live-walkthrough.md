# Tournament v3 – Live-Walkthrough (Screen-B-Wizard gegen echtes Backend)

Diese Anleitung lässt dich den 5-Schritt-Wizard **gegen das echte Backend** durchklicken.
Du prüfst damit, ob `POST /api/tournaments/:id/generate` mit Status-Wechsel,
Bestätigungsdialog und Re-Generate-Schutz tatsächlich so reagiert, wie die Route
und die 16 Integrationstests es versprechen.

Die Mock-Variante (`?mock=clean|results|finished`) bleibt unverändert daneben –
du kannst jederzeit mit `?mock=results` zurückschalten.

---

## 1. Backend starten

```powershell
cd C:\Users\Rezo\Documents\franksPhotoalbum\backend
npm run dev
```

`npm run dev` startet zusätzlich MinIO lokal (siehe `backend/scripts/dev-with-minio.mjs`).
Erwarte zwei Prozesse im Terminal:

```
[backend] Fastify listening on http://0.0.0.0:3000
[minio]   MinIO started on http://localhost:9000
```

Falls MinIO schon extern läuft, erkennt der Dev-Runner das und überspringt den Auto-Start.
DB liegt unter `postgresql://postgres:rXqqqbFNpkT2C4ot@localhost:5432/photoalbum_dev`
(siehe `backend/.env.local`).

**Was du im Browser öffnest:**

| Modus | URL |
|---|---|
| Mock (alt) | `http://localhost:3000/screen-b-preview.html?mock=results&step=5` |
| **Live (neu)** | `http://localhost:3000/screen-b-preview.html?mock=off&tournamentId=<id>` |

Die Live-URL muss `mock=off` UND `tournamentId=<id>` enthalten. Ohne `tournamentId`
zeigt die Pille unten ein klares "Live-Modus braucht ?tournamentId=<id>".
Ohne `mock=off` läuft die Seite im Mock-Modus — das siehst du oben links an der Pille.

---

## 2. Authentik – zwei Test-Accounts anlegen

Das Backend nutzt OIDC gegen Authentik (siehe `OIDC_*` in `backend/.env.local`).
Login geht **nur** über die App, nicht über ein Backend-Endpoint.

### 2.1 Account „admin-test" (Gruppen-Owner)

1. Öffne die App im Browser: `http://localhost:3000`
2. Klick oben rechts auf **Anmelden** → du wirst zu Authentik weitergeleitet.
3. In Authentik: **Register** (oder **Create account**, je nach Theme).
   - Username: `admin-test`
   - E-Mail: `admin-test@local.test`
   - Passwort: beliebig (in der Dev-Instanz dürfen alle Domains anlegen)
4. Nach erfolgreichem Login landest du zurück in der App. Das Backend legt
   den User beim ersten Login automatisch in `users` an (`syncUserFromOIDC`).

### 2.2 Account „member-test" (normales Mitglied)

1. **Wichtig:** in einem **privaten Browser-Fenster** (Ctrl+Shift+P) oder
   einem zweiten Browser-Profil öffnen, damit die zwei Sessions getrennte
   Cookies haben.
2. Erneut auf **Anmelden** klicken und denselben Flow durchlaufen:
   - Username: `member-test`
   - E-Mail: `member-test@local.test`

### 2.3 Gruppe anlegen und Mitglied einladen

In der App als **admin-test**:

1. **Gruppe** → **Neue Gruppe** (oder Icon je nach UI-Variante).
   - Name: `Tournament-Test`
   - Code: `t-test` (muss eindeutig sein)
2. In der Gruppe auf **Mitglieder einladen** → Einladungslink kopieren.
3. Im privaten Fenster als **member-test** einloggen, Einladungslink öffnen,
   Gruppe beitreten.

Damit existieren in der DB:
- 1 Group `Tournament-Test` mit `createdBy = admin-test`
- 2 GroupMember-Zeilen (admin-test als Owner, member-test als normales Mitglied)

---

## 3. Turnier anlegen (nur als Admin möglich)

Im normalen Tab als **admin-test**:

1. In der Gruppe auf **Turniere** → **Neues Turnier**.
   - Name: `Live-Walkthrough 1`
   - Status: `draft` (das ist Default)
2. Notiere die `id` aus der URL der Turnier-Detail-Seite. Sie sieht aus wie
   `cmXXXXXXXXXXXX` (cuid, 25 Zeichen).

**Alternativ ohne UI:** POST über die Konsole (im Browser DevTools, als admin-test eingeloggt):

```js
await fetch('/api/tournaments', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    groupId: '<groupId-aus-der-URL>',
    name: 'Live-Walkthrough 1',
    mode: 'groups_ko',
  }),
}).then(r => r.json());
// → { tournament: { id: 'cm…', status: 'draft', … } }
```

Teams hinzufügen (12 Stück, damit Step 5 die `3×4`-Verteilung trifft):

```js
await fetch('/api/tournaments/<id>/teams', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    names: ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot',
            'Golf','Hotel','India','Juliet','Kilo','Lima'],
  }),
}).then(r => r.json());
```

---

## 4. Walkthrough – was du im Browser klickst

### Schritt A: Wizard mit 12 Teams

1. Öffne:
   ```
   http://localhost:3000/screen-b-preview.html?mock=off&tournamentId=<id>&step=5
   ```
2. **Pille oben links muss grün pulsieren** und „LIVE — echtes Backend" zeigen.
   Wenn sie grau ist oder „Mock" zeigt: du bist nicht im Live-Modus.
3. Der Wizard ist mit 12 Demo-Teams vorbelegt. Klick **Turnier generieren**.
4. Erwartetes Banner:
   ```
   [live] 201 — 18 Matches in 3 Gruppen angelegt
   ```

### Schritt B: In der DB prüfen, was wirklich persistiert wurde

Im pgAdmin Query Tool (oder `psql`):

```sql
-- 1) Statuswechsel draft → generated
SELECT id, name, status, "updatedAt"
FROM tournaments
WHERE id = '<id>';
-- erwartet: status = 'generated'

-- 2) 12 Teams sind unverändert
SELECT count(*) FROM tournament_teams
WHERE "tournamentId" = '<id>';
-- erwartet: 12

-- 3) Eine Stage vom Typ 'group'
SELECT id, type, name, "orderIndex"
FROM tournament_stages
WHERE "tournamentId" = '<id>';
-- erwartet: 1 Zeile, type='group'

-- 4) Drei Gruppen
SELECT id, key, name FROM tournament_groups
WHERE "tournamentId" = '<id>'
ORDER BY key;
-- erwartet: A, B, C

-- 5) Drei Gruppen mit je 4 Teams
SELECT g.key, count(*) AS members
FROM tournament_groups g
JOIN tournament_group_memberships m ON m."groupId" = g.id
WHERE g."tournamentId" = '<id>'
GROUP BY g.key
ORDER BY g.key;
-- erwartet: A=4, B=4, C=4

-- 6) 18 Round-Robin-Matches (3 × C(4,2))
SELECT count(*) FROM tournament_matches
WHERE "tournamentId" = '<id>';
-- erwartet: 18
```

### Schritt C: Ergebnis eintragen (damit wir Bestätigungsdialog provozieren)

```js
// Im Browser DevTools, eingeloggt als admin-test
const r = await fetch('/api/tournaments/<id>/matches/<matchId>/result', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scoreHome: 10, scoreAway: 7 }),
});
console.log(await r.json());
```

`<matchId>` findest du per:

```sql
SELECT id, "matchNumber", "teamHomeId", "teamAwayId", status
FROM tournament_matches
WHERE "tournamentId" = '<id>'
ORDER BY "matchNumber" LIMIT 1;
```

Erwartung: HTTP 200, Match-Status `finished`, `winnerTeamId` gesetzt.

```sql
SELECT count(*) FROM tournament_matches
WHERE "tournamentId" = '<id>' AND status = 'finished';
-- erwartet: 1
```

### Schritt D: Re-Generate ohne Bestätigung (sollte 409 ergeben)

Im Wizard erneut auf **Turnier generieren**:

Erwartetes Banner:
```
[live] 409 — results_present, finishedMatches=1
```

Bestätigungsdialog geht auf (Step 5 zeigt ihn automatisch):
> „Es sind bereits 1 Ergebnis eingetragen. Beim Neu-Generieren gehen sie verloren.
>  Tippe zur Bestätigung den Turniernamen ein:"

a) Tippe **einen falschen Namen** (z. B. `Live-Walkthrough 2`) → Button bleibt
   disabled bzw. liefert 400 `confirmation_mismatch`.
b) Tippe **`live-walkthrough 1`** (Kleinschreibung!) → Button wird klickbar.

Erwartetes Banner nach Klick auf **Neu generieren**:
```
[live] 201 — 0 Matches in 3 Gruppen angelegt
```

```sql
-- Persistenz-Check: alle alten Ergebnisse weg
SELECT count(*) FROM tournament_matches
WHERE "tournamentId" = '<id>' AND status = 'finished';
-- erwartet: 0

-- Aber 18 neue Matches (gleiche Anzahl, frische IDs)
SELECT count(*) FROM tournament_matches
WHERE "tournamentId" = '<id>';
-- erwartet: 18
```

### Schritt E: Member-Sichtbarkeit (§1.2)

Wechsle ins private Fenster als **member-test**.

a) **Turnier-Liste** prüfen:
```js
await fetch('/api/tournaments/group/<groupId>', {
  credentials: 'include',
}).then(r => r.json());
// erwartet: tournaments[] enthält das Turnier (status='generated', nicht 'draft')
```

b) **Turnier-Detail** prüfen:
```js
await fetch('/api/tournaments/<id>', {
  credentials: 'include',
}).then(r => r.json());
// erwartet: 200 mit komplettem DTO
```

c) **Erneut generieren** als Member sollte **403** liefern:

```js
await fetch('/api/tournaments/<id>/generate', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// erwartet: 403
```

d) Im UI darf für Member kein **Turnier generieren**-Button erscheinen. Im
   echten Haupt-UI (`main.js`) ist das v2-Wizard-Codestück noch tot —
   **main.js bleibt vorerst unangetastet** (Aufräumpunkt für später). Der
   Verifikationspunkt „kein Eingabe-Button" gilt erst nach v3-Hookup.

---

## 5. Was die Anleitung beweist

| Pfad | Erwartung | DB-Beweis |
|---|---|---|
| Erst-Generate | 201, status `draft → generated`, 18 Matches in 3 Gruppen | Schritte B + C oben |
| Re-Generate ohne Bestätigung | 409 `results_present` | Banner + Status bleibt `group_stage` |
| Re-Generate mit Kleinschreibung + Whitespace | 201, `warnings: ['results_deleted']` | Schritt D |
| Falscher Name | 400 `confirmation_mismatch` | nichts persistiert |
| Member generate | 403 | n/a |
| Member Detail | 200 | n/a |

Wenn einer dieser Pfade abweicht, ist der Fehler entweder in
`backend/src/modules/tournament/routes.js` (Server) oder in
`backend/public/script/tournament.js` (Client) — und nicht in main.js,
denn das v3-Stück hängt am `screen-b-preview.html`-Pfad und am
Wizard-Modul-Import.

---

## 6. Aufräumpunkte (NICHT JETZT)

- `main.js` hat an drei Stellen `openTournamentWizard()` — der **tote v2-Wizard**.
  Der fliegt raus, wenn v3 in die App eingehängt wird.
- Mock-Modi in `screen-b-preview.html` bleiben drin, bis wir den Wizard in
  main.js verdrahten — danach wird die Preview-Datei obsolet.
