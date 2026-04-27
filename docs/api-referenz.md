# API-Referenz

Alle Endpunkte sind unter `/api/` erreichbar. Sofern nicht anders angegeben, erfordert jeder Endpunkt einen gültigen **JWT Access Token** im `Authorization`-Header:

```
Authorization: Bearer <accessToken>
```

---

## Authentifizierung (`/api/auth`)

| Methode | Pfad | Beschreibung | Auth |
|---|---|---|---|
| `GET` | `/api/auth/login` | Startet OIDC-Flow, leitet zu Authentik weiter | Nein |
| `GET` | `/api/auth/callback` | OIDC-Callback; gibt JWT zurück und setzt Refresh-Cookie | Nein |
| `POST` | `/api/auth/refresh` | Erneuert Access Token über Refresh-Cookie | Cookie |
| `GET` | `/api/auth/me` | Eigenes Nutzerprofil | JWT |
| `POST` | `/api/auth/logout` | Löscht Refresh Token | JWT |
| `GET` | `/api/auth/avatar/:userId` | Avatar-Proxy (aus MinIO) | Öffentlich |
| `PATCH` | `/api/auth/profile` | Profil aktualisieren (`color`, `displayNameField`) | JWT |

---

## Fotos (`/api/photos`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/photos` | Fotoliste; Parameter: `groupId`, `albumId`, `cursor`, `limit` |
| `POST` | `/api/photos` | Foto hochladen (`multipart/form-data`: `file`, `groupId`, `description`, `albumId`) |
| `GET` | `/api/photos/:id/file` | Foto-Datei streamen; Token als `?t=<accessToken>` übergeben |
| `PATCH` | `/api/photos/:id` | Beschreibung oder Album-Zuordnung ändern |
| `PATCH` | `/api/photos/batch-album` | Mehrere Fotos einem Album zuordnen/entfernen |
| `DELETE` | `/api/photos/:id` | Foto löschen (nur eigene; Admins können alle löschen) |

**Upload-Details:**
- Bilder werden clientseitig auf max. 1400 px (JPEG) komprimiert, bevor sie hochgeladen werden
- Avatare werden in den `avatars`-Bucket abgelegt; Fotos in `photos`

---

## Alben (`/api/albums`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/albums` | Alben einer Gruppe (`?groupId=…`) |
| `POST` | `/api/albums` | Neues Album erstellen (`name`, `groupId`) |
| `PATCH` | `/api/albums/:id` | Album umbenennen (Ersteller, Contributor, Owner, Deputy) |
| `DELETE` | `/api/albums/:id` | Album löschen |
| `GET` | `/api/albums/:id/contributors` | Beitragende auflisten |
| `POST` | `/api/albums/:id/contributors` | Beitragenden hinzufügen (`userId`) |
| `DELETE` | `/api/albums/:id/contributors/:userId` | Beitragenden entfernen |

---

## Gruppen (`/api/groups`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/groups/my` | Eigene Gruppen (erstellt ggf. Auto-Gruppe) |
| `POST` | `/api/groups` | Neue Gruppe erstellen (`name`) |
| `POST` | `/api/groups/join` | Gruppe per Code beitreten (`code`); bei aktivem und erreichtem Limit: `409` |
| `GET` | `/api/groups/:id/members` | Mitglieder der Gruppe |
| `PATCH` | `/api/groups/:id` | Gruppe umbenennen (nur Owner) |
| `PATCH` | `/api/groups/:id/settings` | Gruppeneinstellungen ändern (Owner/Admin) – Body: `{ "inviteCodeVisibleToMembers": true|false, "maxMembers": <int|null> }` |
| `POST` | `/api/groups/:id/code/rotate` | Einladungscode neu generieren (Owner/Admin) |
| `DELETE` | `/api/groups/:id` | Gruppe löschen (Owner/Admin), erstellt bei vorhandenen Fotos ein ZIP-Backup |
| `DELETE` | `/api/groups/:id/leave` | Gruppe verlassen (`successorId` bei Owner-Wechsel) |
| `DELETE` | `/api/groups/:id/dissolve` | Gruppe auflösen – nur Owner als letztes Mitglied; erstellt ZIP-Backup |
| `GET` | `/api/groups/:id/deputies` | Vertreter auflisten |
| `POST` | `/api/groups/:id/deputies` | Vertreter ernennen (nur Owner) – Body: `{ "userId": "…" }` |
| `DELETE` | `/api/groups/:id/deputies/:userId` | Vertreter entfernen (nur Owner) |

### Admin-Endpunkte für Gruppen

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/groups/admin/all` | Alle Gruppen auflisten (inkl. Member-/Foto-Counts) |
| `POST` | `/api/groups/admin/create` | Gruppe erstellen – Body: `{ "name": "...", "code": "...", "maxMembers": <int|null>, "memberLimitLocked": <bool> }` |
| `PATCH` | `/api/groups/admin/:id` | Gruppe bearbeiten – Felder: `name`, `code`, `maxMembers` (`<= 50`, `null` = unbegrenzt), `memberLimitLocked` |
| `POST` | `/api/groups/admin/:id/backup` | Backup erstellen ohne Gruppe zu löschen |
| `DELETE` | `/api/groups/admin/:id` | Gruppe löschen + Backup erstellen |
| `GET` | `/api/groups/admin/:id/stranded-members` | User, die danach in keiner Gruppe mehr wären |
| `GET` | `/api/groups/admin/backup/:zipKey` | ZIP herunterladen (kein Auth, Rate-Limit: 10 req/min/IP) |
| `GET` | `/api/groups/admin/backups` | Alle Backup-Einträge auflisten |
| `POST` | `/api/groups/admin/backups/:zipKey/refresh` | Backup-Link um 30 Tage verlängern |
| `DELETE` | `/api/groups/admin/backups/:zipKey` | Backup aus MinIO und DB löschen |

---

## Kommentare (`/api/comments`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/comments/:photoId` | Kommentare eines Fotos |
| `POST` | `/api/comments` | Kommentar erstellen (`photoId`, `content`) |
| `DELETE` | `/api/comments/:id` | Kommentar löschen (nur eigene) |

---

## Likes (`/api/likes`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/likes/:photoId` | Like togglen (Like hinzufügen oder entfernen) |

---

## Benachrichtigungen (`/api/notifications`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/notifications/stream` | SSE-Stream für Echtzeit-Benachrichtigungen (`?token=<jwt>`) |
| `GET` | `/api/notifications` | Liste eigener Benachrichtigungen (`?cursor=…&limit=30`) |
| `PATCH` | `/api/notifications/:id/read` | Als gelesen markieren |
| `PATCH` | `/api/notifications/read-all` | Alle als gelesen markieren |
| `GET` | `/api/notifications/preferences` | Eigene Einstellungen abrufen |
| `PATCH` | `/api/notifications/preferences` | Einstellungen aktualisieren |

---

## Changelog (`/api/changelog`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/changelog/meta` | Aktuelle App-Version für UI (Sidebar/Modal) |
| `GET` | `/api/changelog` | Changelog-Einträge laden (`?limit=40`, max. 100) |
| `POST` | `/api/changelog` | Neuen Eintrag erstellen (nur Admin) – Body: `{ "version", "title", "body" }` |
| `PATCH` | `/api/changelog/:id` | Eintrag bearbeiten (nur Admin) |
| `DELETE` | `/api/changelog/:id` | Eintrag löschen (nur Admin) |

Validierung:
- `version`: Pflicht, max. 32 Zeichen
- `title`: Pflicht, max. 140 Zeichen
- `body`: optional, max. 4000 Zeichen

---

## Admin (`/api/admin`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/admin/users` | Alle Nutzer auflisten |
| `GET` | `/api/admin/users/:id` | Detailprofil eines Nutzers (Statistiken, Gruppen mit Rolle) |
| `PATCH` | `/api/admin/users/:id/role` | Rolle eines Nutzers ändern (`user` oder `admin`) |
| `DELETE` | `/api/admin/users/:id` | Nutzer löschen inkl. Fotos, Kommentare, Likes und MinIO-Cleanup |
| `POST` | `/api/admin/users/:id/notify` | Gezielte System-Benachrichtigung an einzelnen Nutzer senden (`title`, `body`, `entityUrl`) |
| `POST` | `/api/admin/broadcast` | System-Benachrichtigung an alle Nutzer senden (`title`, `body`, `imageUrl`, `entityUrl`) |

---

## Fehlercodes

| Code | Bedeutung |
|---|---|
| `400` | Ungültige oder fehlende Parameter |
| `401` | Kein oder ungültiger JWT |
| `403` | Berechtigung fehlt (falsche Rolle oder nicht Mitglied) |
| `404` | Ressource nicht gefunden |
| `409` | Konflikt (z. B. bereits Mitglied, letzter Admin) |
| `410` | Backup-Link abgelaufen |
| `429` | Rate-Limit überschritten |
| `500` | Interner Serverfehler |

Hinweise zu `409` bei Gruppen:
- `POST /api/groups/join`: bereits Mitglied oder Gruppe ist voll (`Diese Gruppe ist voll (x/n)`).
- `POST/PATCH` in Admin-Gruppenverwaltung: Einladungscode bereits vergeben.
