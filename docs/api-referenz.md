# API-Referenz

Alle Endpunkte sind unter `/api/` erreichbar. Sofern nicht anders angegeben, erfordert jeder Endpunkt einen gültigen **JWT Access Token** im `Authorization`-Header:

```
Authorization: Bearer <accessToken>
```

---

## Authentifizierung (`/api/auth`)

| Methode | Pfad                       | Beschreibung                                                               | Auth       |
| ------- | -------------------------- | -------------------------------------------------------------------------- | ---------- |
| `GET`   | `/api/auth/login`          | Startet OIDC-Flow, leitet zu Authentik weiter (`?invite=<TOKEN>`, `?feedPost=<ID>`, `?intent=register` optional) | Nein       |
| `GET`   | `/api/auth/config`         | Liefert `{ authentikBase }` fürs Frontend (aus `OIDC_ISSUER` abgeleitet)   | Nein       |
| `GET`   | `/api/auth/callback`       | OIDC-Callback; gibt JWT zurück und setzt Refresh-Cookie                    | Nein       |
| `POST`  | `/api/auth/refresh`        | Erneuert Access Token über Refresh-Cookie                                  | Cookie     |
| `GET`   | `/api/auth/me`             | Eigenes Nutzerprofil                                                       | JWT        |
| `POST`  | `/api/auth/logout`         | Löscht Refresh Token                                                       | JWT        |
| `GET`   | `/api/auth/avatar/:userId` | Avatar-Proxy (aus MinIO)                                                   | Öffentlich |
| `PATCH` | `/api/auth/profile`        | Profil aktualisieren (`color`, `displayNameField`)                         | JWT        |

---

## Content-Export (`/api/exports`)

| Methode  | Pfad                                     | Beschreibung                                                                         | Auth        |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| `POST`   | `/api/exports/request`                   | Export anfordern (asynchron, `202`), strikt auf 1 Request pro 24h pro User limitiert | JWT         |
| `GET`    | `/api/exports/mine`                      | Eigene Export-Historie inkl. Status (`queued`, `running`, `ready`, `failed`)         | JWT         |
| `GET`    | `/api/exports/:id/download`              | ZIP-Export herunterladen (nur Owner oder Admin, Rate-Limit: 10 req/min/IP)           | JWT         |
| `GET`    | `/api/exports/admin/exports`             | Admin: alle User-Exporte laden (inkl. User-Label und Status)                         | JWT (Admin) |
| `POST`   | `/api/exports/admin/exports/:id/refresh` | Admin: Export-Link um 30 Tage verlaengern                                            | JWT (Admin) |
| `DELETE` | `/api/exports/admin/exports/:id`         | Admin: Export endgueltig aus MinIO + DB loeschen                                     | JWT (Admin) |
| `POST`   | `/api/exports/admin/exports/cleanup`     | Admin: abgelaufene Exporte manuell aufraeumen                                        | JWT (Admin) |

Hinweise:

- Exportinhalt: eigene hochgeladene Medien + Metadaten als `metadata/export.json` und `metadata/photos.csv`
- Link-Laufzeit: 30 Tage (`410 Gone` nach Ablauf), Download nur fuer eingeloggten Owner oder Admin
- Wenn ein Export noch erstellt wird: `409`
- Exporte werden intern ueber eine Worker-Queue nacheinander verarbeitet
- Nach Server-Neustart werden verwaiste `queued`/`running` Exporte automatisch wieder eingeplant
- Automatischer Cleanup laeuft im Backend-Intervall (`EXPORT_CLEANUP_INTERVAL_MINUTES`, Default: 60)

---

## Account-Löschung (`/api/account-deletion`)

| Methode | Pfad                               | Beschreibung                                                                  | Auth |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------- | ---- |
| `POST`  | `/api/account-deletion/request`    | Sendet einen Bestätigungscode per Mail für die Account-Löschung               | JWT  |
| `GET`   | `/api/account-deletion/status`     | Liefert aktuellen Löschstatus (`none`, `pending`, `scheduled`, `reactivated`) | JWT  |
| `POST`  | `/api/account-deletion/confirm`    | Bestätigt Löschung mit Code; Account wird 14 Tage deaktiviert                 | JWT  |
| `POST`  | `/api/account-deletion/reactivate` | Hebt eine geplante Löschung vor Erreichen von `purgeAt` auf                   | JWT  |

Hinweise:

- Bestätigungscode ist 15 Minuten gültig.
- Eine bestätigte Löschung wird nach 14 Tagen endgültig ausgeführt (`purgeAt`).
- Optional kann ein Erbe (`successorUserId`) angegeben werden, der den Content übernimmt.
- Ohne Erben kann `keepContent=true` gesetzt werden; Content wird dann auf ein Systemprofil übertragen.
- Nach `confirm` wird der Refresh-Cookie gelöscht; der User wird im Frontend ausgeloggt.
- Solange ein Löschvorgang `confirmed` ist, sind geschützte API-Endpunkte gesperrt (`403`), ausgenommen Login/Logout und `/api/account-deletion/*`.
- Login via OIDC reaktiviert einen `confirmed`-Vorgang automatisch, solange der User noch nicht tatsächlich gepurgt wurde (auch wenn `purgeAt` bereits überschritten war).
- Der Purge-Task läuft einmal beim App-Start und danach periodisch. Intervall: `ACCOUNT_DELETION_PURGE_INTERVAL_MINUTES`, Default 360 Minuten, Minimum 30 Minuten.
- Pro Purge-Lauf werden bis zu 50 fällige Accounts verarbeitet.

---

## Medien (`/api/photos`)

| Methode  | Pfad                      | Beschreibung                                                                                                        |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/photos`             | Medienliste; Parameter: `groupId`, `albumId`, `uploaderId`, `skip`, `limit`, `order`                                |
| `POST`   | `/api/photos`             | Bild/Video hochladen (`multipart/form-data`: `file`, `groupId`, `description`, `albumId`, optional `videoDuration`) |
| `GET`    | `/api/photos/video-quota` | Globales Video-Kontingent des eingeloggten Nutzers (`current`, `max`, `remaining`)                                  |
| `GET`    | `/api/photos/:id/file`    | Medien-Datei streamen; Token als `?t=<accessToken>` übergeben                                                       |
| `PATCH`  | `/api/photos/:id`         | Beschreibung oder Album-Zuordnung ändern                                                                            |
| `PATCH`  | `/api/photos/batch-album` | Mehrere Medien einem Album zuordnen/entfernen                                                                       |
| `DELETE` | `/api/photos/:id`         | Medium löschen (eigene oder als Gruppenmoderation: Owner/Vertreter, Admin nur als Gruppenmitglied)                  |

**Berechtigung:**

- Für gruppenbezogene Medien-Endpunkte ist eine **aktuelle Gruppenmitgliedschaft** erforderlich.
- Admins dürfen weiterhin gruppenübergreifend zugreifen.
- Bei fehlender Mitgliedschaft liefert die API `403` mit `code=not_group_member`.

**Upload-Details:**

- Bilder werden clientseitig auf max. 1400 px (JPEG) komprimiert, bevor sie hochgeladen werden
- Videos: erlaubt sind `video/mp4` und `video/quicktime` (MOV)
- Video-Limits: max. `60s`, max. `200 MB` pro Datei, max. `20` Videos global pro Nutzer
- Avatare werden in den `avatars`-Bucket abgelegt; Bilder/Videos in `photos`
- Wenn `uploadsRestrictedToModerators=true` auf der Gruppe gesetzt ist, dürfen nur Owner, Vertreter und Admins hochladen (`403`, `code=uploads_locked_for_members`)

**Streaming-Details (`GET /api/photos/:id/file`):**

- Unterstützt HTTP Byte-Range (`Range: bytes=...`)
- Antwort mit `206 Partial Content` bei gültiger Range
- Header `Accept-Ranges: bytes` ist gesetzt
- Für `<img>`/`<video>` wird Auth per Query-Token (`?t=`) genutzt

---

## Alben (`/api/albums`)

| Methode  | Pfad                                   | Beschreibung                                             |
| -------- | -------------------------------------- | -------------------------------------------------------- |
| `GET`    | `/api/albums`                          | Alben einer Gruppe (`?groupId=…`)                        |
| `POST`   | `/api/albums`                          | Neues Album erstellen (`name`, `groupId`)                |
| `PATCH`  | `/api/albums/:id`                      | Album umbenennen (Ersteller, Contributor, Owner, Deputy) |
| `DELETE` | `/api/albums/:id`                      | Album löschen                                            |
| `GET`    | `/api/albums/:id/contributors`         | Beitragende auflisten                                    |
| `POST`   | `/api/albums/:id/contributors`         | Beitragenden hinzufügen (`userId`)                       |
| `DELETE` | `/api/albums/:id/contributors/:userId` | Beitragenden entfernen                                   |

**Berechtigung:**

- Für gruppenbezogene Album-Endpunkte ist eine **aktuelle Gruppenmitgliedschaft** erforderlich.
- Admins dürfen weiterhin gruppenübergreifend zugreifen.
- Bei fehlender Mitgliedschaft liefert die API `403` mit `code=not_group_member`.
- Wenn `albumsRestrictedToModerators=true` auf der Gruppe gesetzt ist, dürfen nur Owner, Vertreter und Admins neue Alben anlegen (`403`, `code=albums_locked_for_members`).

---

## Gruppen (`/api/groups`)

| Methode  | Pfad                                       | Beschreibung                                                                                                                                                                |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/groups/my`                           | Eigene Gruppen (erstellt ggf. Auto-Gruppe)                                                                                                                                  |
| `POST`   | `/api/groups`                              | Neue Gruppe erstellen (`name`)                                                                                                                                              |
| `POST`   | `/api/groups/join`                         | Gruppe per Code beitreten (`code`); bei aktivem und erreichtem Limit: `409`                                                                                                 |
| `GET`    | `/api/groups/:id/members`                  | Mitglieder der Gruppe                                                                                                                                                       |
| `PATCH`  | `/api/groups/:id`                          | Gruppe umbenennen (nur Owner)                                                                                                                                               |
| `PATCH`  | `/api/groups/:id/settings`                 | Gruppeneinstellungen ändern (Owner/Admin). Felder: `inviteCodeVisibleToMembers`, `maxMembers`; `uploadsRestrictedToModerators` und `albumsRestrictedToModerators` nur Owner |
| `POST`   | `/api/groups/:id/code/rotate`              | Einladungscode neu generieren (Owner/Admin)                                                                                                                                 |
| `DELETE` | `/api/groups/:id`                          | Gruppe löschen (Owner/Admin), erstellt bei vorhandenen Fotos ein ZIP-Backup                                                                                                 |
| `DELETE` | `/api/groups/:id/leave`                    | Gruppe verlassen (`successorId` bei Owner-Wechsel)                                                                                                                          |
| `POST`   | `/api/groups/:id/members/:memberId/remove` | Mitglied entfernen (Owner/Vertreter), löscht dessen Gruppen-Content und optional mit `blockUser=true` dauerhaft blocken (dann `blockReason` Pflicht)                        |
| `GET`    | `/api/groups/:id/blocks`                   | Blockierte Mitglieder der Gruppe auflisten (Owner/Vertreter)                                                                                                                |
| `DELETE` | `/api/groups/:id/blocks/:memberId`         | Blockierung eines Mitglieds aufheben (Owner/Vertreter)                                                                                                                      |

Beim Verlassen kann optional eigener Gruppen-Content gelöscht werden:

```json
{ "successorId": "<optional-userId>", "deleteOwnContent": true }
```

- `deleteOwnContent=true` entfernt eigenen Content in der Zielgruppe (eigene Medien, eigene Kommentare, eigene Likes).
- Bei `POST /api/groups/:id/members/:memberId/remove` ist `blockReason` erforderlich, wenn `blockUser=true` gesetzt wird.
- Album-Verhalten beim Verlassen:
  - `deleteOwnContent=true`: eigene Alben werden gelöscht; Contributor-Rechte des Users in Gruppen-Alben werden entfernt.
  - `deleteOwnContent=false`: eigene Alben ohne Contributors werden gelöscht; eigene Alben mit Contributors werden an den ersten verfügbaren Contributor übertragen; Contributor-Rechte des Users in Gruppen-Alben werden entfernt.
- Response enthält Zähler (`deletedPhotos`, `deletedComments`, `deletedLikes`, `deletedOwnedAlbums`, `transferredOwnedAlbums`, `removedAlbumContributorLinks`).

| `DELETE` | `/api/groups/:id/dissolve` | Gruppe auflösen – nur Owner als letztes Mitglied; erstellt ZIP-Backup |
| `GET` | `/api/groups/:id/deputies` | Vertreter auflisten |
| `POST` | `/api/groups/:id/deputies` | Vertreter ernennen (nur Owner) – Body: `{ "userId": "…" }` |
| `DELETE` | `/api/groups/:id/deputies/:userId` | Vertreter entfernen (nur Owner) |

---

## Turniere (`/api/tournaments`)

| Methode  | Pfad                                                           | Beschreibung |
| -------- | -------------------------------------------------------------- | ------------ |
| `GET`    | `/api/tournaments/presets?groupId=...`                        | Presets einer Gruppe laden |
| `POST`   | `/api/tournaments/presets`                                     | Preset erstellen (`groupId`, `name`, `baseType`, optional `participantMode`, `stages`) |
| `PATCH`  | `/api/tournaments/presets/:id`                                | Preset aktualisieren |
| `DELETE` | `/api/tournaments/presets/:id`                                | Preset archivieren (`isArchived=true`) |
| `GET`    | `/api/tournaments/instances?groupId=...&status=...`           | Instanzen einer Gruppe laden |
| `POST`   | `/api/tournaments/instances`                                  | Instanz aus Preset erstellen (`presetId`, `name`) |
| `GET`    | `/api/tournaments/instances/:id`                              | Vollständige Instanzdetails laden (Preset, Runden, Teams, Teilnehmer, Matches) |
| `PATCH`  | `/api/tournaments/instances/:id`                              | Instanz aktualisieren (z. B. `status`, `name`, `config`) |
| `DELETE` | `/api/tournaments/instances/:id`                              | Instanz löschen |
| `POST`   | `/api/tournaments/instances/:id/teams`                        | Team anlegen |
| `POST`   | `/api/tournaments/instances/:id/participants`                 | Teilnehmer hinzufügen |
| `DELETE` | `/api/tournaments/instances/:id/participants/:participantId`  | Teilnehmer entfernen |
| `POST`   | `/api/tournaments/instances/:id/matches`                      | Match anlegen |
| `PATCH`  | `/api/tournaments/instances/:id/matches/:matchId/result`      | Match-Ergebnis erfassen |
| `GET`    | `/api/tournaments/instances/:id/standings`                    | Standings/Rangliste der Instanz laden |

Hinweise:

- Berechtigungen: Gruppen-Owner, Vertreter und Admins dürfen verwalten; normale Gruppenmitglieder haben Read-Only-Zugriff auf listen-/detailbezogene Endpunkte.
- Preset-Typen (aktuell): `single_elimination`, `double_elimination`, `round_robin`, `group_plus_knockout`, `custom`.
- Stage-Typen (aktuell): `single_elimination`, `double_elimination`, `round_robin`.
- Teilnehmer-Modi (aktuell): `individual`, `team`, `pair`.
- Die Instanzen-Liste im Frontend trennt die Darstellung in `Entwurf`, `Registrierung`, `Live` und `Abgeschlossen`.
- Statusfelder sind absichtlich als Strings modelliert, damit Turnierabläufe ohne Enum-Migration erweitert werden können.
- Beim Eintragen von Match-Ergebnissen werden Teilnehmer-Statistiken (Punkte/Wins/Losses/Draws) serverseitig neu berechnet.

---

## Feed (`/api/group-feed`)

| Methode  | Pfad                          | Beschreibung                                                                     |
| -------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `GET`    | `/api/group-feed`             | Feed einer Gruppe laden (`groupId`, `view=all|mine|mentions|saved`, `skip`, `limit`) |
| `POST`   | `/api/group-feed`             | Neuen Feed-Post erstellen (`groupId`, `body`, optional `title`, Share-Metadaten) |
| `GET`    | `/api/group-feed/:id`         | Einzelnen Feed-Post für Direktlink/Sharing laden                                 |
| `PATCH`  | `/api/group-feed/:id`         | Eigenen Feed-Post bearbeiten (`title`, `body`)                                   |
| `DELETE` | `/api/group-feed/:id`         | Feed-Post löschen (Owner oder Gruppenmoderation)                                 |
| `GET`    | `/api/group-feed/:id/history` | Historie früherer Versionen eines Posts laden                                    |
| `POST`   | `/api/group-feed/:id/save`    | Feed-Post für den eingeloggten User speichern                                    |
| `DELETE` | `/api/group-feed/:id/save`    | Gespeicherten Feed-Post wieder entfernen                                         |
| `POST`   | `/api/group-feed/:id/like`    | Feed-Post liken (idempotent)                                                     |
| `DELETE` | `/api/group-feed/:id/like`    | Feed-Post-Unlike                                                                  |
| `GET`    | `/api/group-feed/:id/likes`   | User-Liste der Feed-Post-Likes laden                                              |

Hinweise:

- `view=saved` ist serverseitig userbezogen und ersetzt die frühere Browser-Only-Filterung.
- `GET /api/group-feed/:id` liefert zusätzlich `newerPostsCount`, damit das Frontend zwischen Listenfokus und Einzelansicht für Direktlinks entscheiden kann.
- Listen- und Einzelpost-Responses enthalten `isSaved`, `isEdited` und `historyCount` für die UI.
- `PATCH /api/group-feed/:id` ist aktuell nur für den Owner des Posts erlaubt; leere `body`-Werte werden mit `400` abgelehnt.
- Jede erfolgreiche Bearbeitung legt vor dem Update einen History-Snapshot mit vorherigem Titel/Text an.
- Gruppenzugriff ist für alle Feed-Endpunkte Pflicht; bei fehlender Mitgliedschaft liefert die API `403` mit `code=not_group_member`.

### Feed-Kommentare (`/api/group-feed`)

| Methode  | Pfad                                       | Beschreibung |
| -------- | ------------------------------------------ | ------------ |
| `GET`    | `/api/group-feed/:postId/comments`         | Hauptkommentare eines Feed-Posts laden (cursorbasiert, Standard `limit=15`) |
| `POST`   | `/api/group-feed/:postId/comments`         | Hauptkommentar erstellen (`content`) |
| `GET`    | `/api/group-feed/comments/:commentId/replies` | Antworten zu einem Hauptkommentar laden (cursorbasiert, Standard `limit=15`) |
| `POST`   | `/api/group-feed/comments/:commentId/replies` | Antwort auf Hauptkommentar erstellen (`content`) |
| `PATCH`  | `/api/group-feed/comments/:commentId`      | Eigenen Kommentar bearbeiten (`content`) |
| `DELETE` | `/api/group-feed/comments/:commentId`      | Kommentar soft-löschen (eigener Kommentar oder Moderation) |
| `GET`    | `/api/group-feed/comments/:commentId/history` | Bearbeitungshistorie eines Kommentars laden |
| `GET`    | `/api/group-feed/comments/:commentId/likes` | User-Liste der Kommentar-Likes laden |
| `POST`   | `/api/group-feed/comments/:commentId/like` | Kommentar liken (idempotent) |
| `DELETE` | `/api/group-feed/comments/:commentId/like` | Kommentar-Unlike |

Hinweise:

- Threading ist auf zwei Ebenen begrenzt: Antworten auf Antworten sind nicht erlaubt (`400`).
- Gelöschte Kommentare werden soft-deleted (`deletedAt`, `deletedById`) und bleiben für Thread-/Mod-Zusammenhang erhalten.
- Cursor-Paginierung liefert `paging: { limit, hasMore, nextCursor }`.
- Antworten werden im API-Response chronologisch (älteste zuerst) zurückgegeben; geladen wird intern weiterhin cursorbasiert.
- Kommentar-Rate-Limit: maximal `10` neue Kommentare/Antworten pro Nutzer und Gruppe pro Minute (`429`, `code=comment_rate_limited`).
- Mention-Limit: maximal `5` Erwähnungen pro Kommentar (`400`, `code=too_many_mentions`).
- Erwähnungen werden nur für User aufgelöst, die Mitglied derselben Gruppe sind; Selbst-Erwähnungen werden ignoriert.
- Notification-Typen: `feedPostCommented` (Post-Owner), `feedCommentMentioned` (erwähnte User), `feedCommentReplied` (Antwort auf Kommentar) und `feedCommentLiked` (Like auf Kommentar).

---

## Einladungslinks (`/api/invites`)

| Methode  | Pfad                          | Beschreibung                                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/invites/preview/:token` | Öffentliche Vorschau eines Invite-Links (`404`, `410` möglich)                                    |
| `POST`   | `/api/invites`                | Invite-Link erstellen (`groupIds`, optional `expiresAt`, `maxUses`, `notificationText`)           |
| `GET`    | `/api/invites/group/:groupId` | Invite-Links einer Gruppe laden (Owner/Admin)                                                     |
| `DELETE` | `/api/invites/:id`            | Invite-Link widerrufen/deaktivieren                                                               |
| `POST`   | `/api/invites/redeem/:token`  | Invite-Link einlösen (idempotent; bei bereits bestehender Mitgliedschaft `status=already_member`) |

Hinweise:

- Group-Owner: max. `10` aktive Links pro Gruppe, kein Multi-Group-Invite
- Admins: Multi-Group-Invites erlaubt, kein künstliches Link-Limit
- `expiresAt` darf maximal `12 Monate` in der Zukunft liegen
- `maxUses` ist optional; ohne Wert ist ein Link unbegrenzt nutzbar
- Optionaler On-Join-Text wird als `system`-Benachrichtigung an den beitretenden User ausgespielt
- Ist ein User in einer Zielgruppe blockiert, liefert das Einlösen `403` mit `code=group_blocked`

### Admin-Endpunkte für Gruppen

| Methode  | Pfad                                        | Beschreibung                                                                                                 |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `GET`    | `/api/groups/admin/all`                     | Alle Gruppen auflisten (inkl. Member-/Foto-Counts)                                                           |
| `POST`   | `/api/groups/admin/create`                  | Gruppe erstellen – Body: `{ "name": "...", "code": "...", "maxMembers": <int                                 | null>, "memberLimitLocked": <bool> }` |
| `PATCH`  | `/api/groups/admin/:id`                     | Gruppe bearbeiten – Felder: `name`, `code`, `maxMembers` (`<= 50`, `null` = unbegrenzt), `memberLimitLocked` |
| `POST`   | `/api/groups/admin/:id/backup`              | Backup erstellen ohne Gruppe zu löschen                                                                      |
| `DELETE` | `/api/groups/admin/:id`                     | Gruppe löschen + Backup erstellen                                                                            |
| `GET`    | `/api/groups/admin/:id/stranded-members`    | User, die danach in keiner Gruppe mehr wären                                                                 |
| `GET`    | `/api/groups/admin/backup/:zipKey`          | ZIP herunterladen (kein Auth, Rate-Limit: 10 req/min/IP)                                                     |
| `GET`    | `/api/groups/admin/backups`                 | Alle Backup-Einträge auflisten                                                                               |
| `POST`   | `/api/groups/admin/backups/:zipKey/refresh` | Backup-Link um 30 Tage verlängern                                                                            |
| `DELETE` | `/api/groups/admin/backups/:zipKey`         | Backup aus MinIO und DB löschen                                                                              |

---

## Kommentare (`/api/comments`)

| Methode  | Pfad                     | Beschreibung                                                                                          |
| -------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/comments/:photoId` | Kommentare eines Fotos                                                                                |
| `POST`   | `/api/comments`          | Kommentar erstellen (`photoId`, `content`)                                                            |
| `DELETE` | `/api/comments/:id`      | Kommentar löschen (eigene oder als Gruppenmoderation: Owner/Vertreter, Admin nur als Gruppenmitglied) |

**Berechtigung:**

- Für Kommentar-Aktionen auf einem Medium ist eine aktuelle Mitgliedschaft in der Medium-Gruppe erforderlich.
- Bei fehlender Mitgliedschaft: `403` mit `code=not_group_member`.

---

## Likes (`/api/likes`)

| Methode  | Pfad                  | Beschreibung                     |
| -------- | --------------------- | -------------------------------- |
| `POST`   | `/api/likes`          | Like hinzufügen (`photoId`)      |
| `DELETE` | `/api/likes/:photoId` | Eigenen Like zu Medium entfernen |

**Berechtigung:**

- Für Like-Aktionen auf einem Medium ist eine aktuelle Mitgliedschaft in der Medium-Gruppe erforderlich.
- Bei fehlender Mitgliedschaft: `403` mit `code=not_group_member`.

---

## Benachrichtigungen (`/api/notifications`)

| Methode | Pfad                             | Beschreibung                                                |
| ------- | -------------------------------- | ----------------------------------------------------------- |
| `GET`   | `/api/notifications/stream`      | SSE-Stream für Echtzeit-Benachrichtigungen (`?token=<jwt>`) |
| `GET`   | `/api/notifications`             | Liste eigener Benachrichtigungen (`?cursor=…&limit=30`)     |
| `PATCH` | `/api/notifications/:id/read`    | Als gelesen markieren                                       |
| `PATCH` | `/api/notifications/read-all`    | Alle als gelesen markieren                                  |
| `GET`   | `/api/notifications/preferences` | Eigene Einstellungen abrufen                                |
| `PATCH` | `/api/notifications/preferences` | Einstellungen aktualisieren                                 |

---

## Feedback & Meldungen (`/api/feedback`)

| Methode  | Pfad                              | Beschreibung                                                                                   |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | -------- | --------------------------- |
| `GET`    | `/api/feedback/eligible-users`    | Nutzerliste für "Nutzer melden" (gleiche Gruppen wie der aufrufende User)                      |
| `POST`   | `/api/feedback`                   | Neues Ticket erstellen (`category`, `subject`, `body`, optional `anonymous`, `reportedUserId`) |
| `GET`    | `/api/feedback`                   | Admin: Tickets auflisten (`?status=open                                                        | closed | accepted | rejected`, `?category=...`) |
| `GET`    | `/api/feedback/mine`              | Eigene Tickets des eingeloggten Users                                                          |
| `GET`    | `/api/feedback/:id/messages`      | Konversationsverlauf eines Tickets laden                                                       |
| `POST`   | `/api/feedback/:id/messages`      | Nachricht in bestehender Ticket-Konversation senden                                            |
| `PATCH`  | `/api/feedback/:id`               | Admin: Ticket aktualisieren (`markReadAdmin`, `status`, `resolution`)                          |
| `PATCH`  | `/api/feedback/:id/accept`        | Admin: Bug/Feature annehmen (`decisionNote`, optional `createGithubIssue`)                     |
| `PATCH`  | `/api/feedback/:id/reject`        | Admin: Bug/Feature ablehnen (`decisionNote`)                                                   |
| `PATCH`  | `/api/feedback/:id/recategorize`  | Admin: Ticket-Art ändern (`category`, optional `reportedUserId`)                               |
| `PATCH`  | `/api/feedback/:id/close-by-user` | User: eigenes Ticket schließen (nicht bei `report_user`)                                       |
| `DELETE` | `/api/feedback/:id`               | Admin: Ticket endgültig löschen                                                                |

Hinweise:

- `POST /api/feedback`: Rate-Limit `5` Requests / `10 Minuten`
- `POST /api/feedback/:id/messages`: Rate-Limit `20` Requests / `5 Minuten`
- `resolution` ist nur für Kategorie `report_user` erlaubt (`no_action` oder `action_taken`)
- `accepted` und `rejected` sind aktuell nur für `bug` und `feature` erlaubt
- `PATCH /api/feedback/:id/accept` kann optional direkt ein GitHub-Issue anlegen; die Referenz wird am Ticket gespeichert
- `PATCH /api/feedback/:id/recategorize` nach `report_user` erfordert zusätzlich `reportedUserId`
- Beim Admin-Schließen während `waitingFor=support` ist ein Schließungsgrund erforderlich

---

## Changelog (`/api/changelog`)

| Methode  | Pfad                  | Beschreibung                                                                 |
| -------- | --------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/api/changelog/meta` | Aktuelle App-Version für UI (Sidebar/Modal)                                  |
| `GET`    | `/api/changelog`      | Changelog-Einträge laden (`?limit=40`, max. 100)                             |
| `POST`   | `/api/changelog`      | Neuen Eintrag erstellen (nur Admin) – Body: `{ "version", "title", "body" }` |
| `PATCH`  | `/api/changelog/:id`  | Eintrag bearbeiten (nur Admin)                                               |
| `DELETE` | `/api/changelog/:id`  | Eintrag löschen (nur Admin)                                                  |

Validierung:

- `version`: Pflicht, max. 32 Zeichen
- `title`: Pflicht, max. 140 Zeichen
- `body`: optional, max. 4000 Zeichen

---

## Admin (`/api/admin`)

| Methode  | Pfad                          | Beschreibung                                                                                                                                |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/admin/users`            | Alle Nutzer auflisten                                                                                                                       |
| `GET`    | `/api/admin/users/:id`        | Detailprofil eines Nutzers (Statistiken, Gruppen mit Rolle)                                                                                 |
| `PATCH`  | `/api/admin/users/:id/role`   | Rolle eines Nutzers ändern (`user` oder `admin`)                                                                                            |
| `DELETE` | `/api/admin/users/:id`        | Nutzer endgültig löschen inkl. Fotos, Kommentare, Likes und MinIO-Cleanup (`reason`, `irreversibleConfirmed`, optional `blockAuthIdentity`) |
| `POST`   | `/api/admin/users/:id/notify` | Gezielte System-Benachrichtigung an einzelnen Nutzer senden (`title`, `body`, `entityUrl`)                                                  |
| `POST`   | `/api/admin/broadcast`        | System-Benachrichtigung an alle Nutzer senden (`title`, `body`, `imageUrl`, `entityUrl`)                                                    |

Hinweis zu `DELETE /api/admin/users/:id`:

- Body ist Pflicht: `{ "reason": "...", "irreversibleConfirmed": true }`
- `reason` darf nach `trim()` nicht leer sein.
- `irreversibleConfirmed` muss exakt `true` sein.
- Optional: `blockAuthIdentity: true` sperrt zukünftige Logins mit derselben E-Mail + Auth-Quelle.

---

## Fehlercodes

| Code  | Bedeutung                                                 |
| ----- | --------------------------------------------------------- |
| `400` | Ungültige oder fehlende Parameter                         |
| `401` | Kein oder ungültiger JWT                                  |
| `403` | Berechtigung fehlt (falsche Rolle oder nicht Mitglied)    |
| `404` | Ressource nicht gefunden                                  |
| `409` | Konflikt (z. B. bereits Mitglied, letzter Admin)          |
| `413` | Payload zu groß (z. B. Video-Datei > 200 MB)              |
| `410` | Download-Link abgelaufen (z. B. Backup- oder Export-Link) |
| `429` | Rate-Limit überschritten                                  |
| `500` | Interner Serverfehler                                     |

Hinweise zu `409` bei Gruppen:

- `POST /api/groups/join`: bereits Mitglied oder Gruppe ist voll (`Diese Gruppe ist voll (x/n)`).
- `POST/PATCH` in Admin-Gruppenverwaltung: Einladungscode bereits vergeben.
