# Gruppen, Alben & Backups

## Inhaltsverzeichnis

- [Gruppen](#gruppen)
- [Einladungslinks](#einladungslinks)
- [Owner & Deputies](#owner--deputies)
- [Owner-Nachfolge beim Verlassen](#owner-nachfolge-beim-verlassen)
- [Gruppe auflösen](#gruppe-auflösen)
- [Alben](#alben)
- [Album-Beitragende (Contributors)](#album-beitragende-contributors)
- [Gruppen-Backups](#gruppen-backups)
- [Admin-Funktionen](#admin-funktionen)

---

## Gruppen

Fotos und Alben sind immer einer **Gruppe** zugeordnet. Gruppen sind der zentrale Organisationsrahmen der App.

**Beitreten:**  
Jede Gruppe hat einen zufälligen **6-stelligen Einladungscode** (z. B. `A3F9KZ`). Wer als Erster per Code beitritt, wird automatisch **Owner** der Gruppe.

**Auto-Erstellung:**  
Beim allerersten Login wird automatisch eine persönliche Gruppe mit dem Namen `<Anzeigename> Fotoalbum` angelegt.

### Mitgliederlimit (optional)

Gruppen können optional ein **maximales Mitgliederlimit** erhalten.

- Standard bei Erstellung: **kein Limit** (`maxMembers = null`)
- Wenn ein Limit aktiv ist und erreicht wurde, blockiert `POST /api/groups/join` den Beitritt mit `409`
- Die Sidebar zeigt den Zähler **`x/n` nur bei aktivem Limit**; ohne Limit bleibt die bisherige Anzeige unverändert

### Sperre des Limits durch Admin

Admins können in der Admin-Gruppenverwaltung das Mitgliederlimit zusätzlich sperren (`memberLimitLocked = true`).

- Owner sehen weiterhin den aktuellen Wert, können ihn dann aber nicht mehr ändern
- Ein Änderungsversuch durch den Owner wird serverseitig mit `403` abgewiesen
- Admins können Sperre und Limit jederzeit wieder anpassen

**API:**

| Methode  | Pfad                          | Beschreibung                                                                        |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `GET`    | `/api/groups/my`              | Eigene Gruppen abrufen (erstellt ggf. Auto-Gruppe)                                  |
| `POST`   | `/api/groups`                 | Neue Gruppe erstellen                                                               |
| `POST`   | `/api/groups/join`            | Gruppe per `code` beitreten                                                         |
| `GET`    | `/api/groups/:id/members`     | Mitglieder einer Gruppe                                                             |
| `PATCH`  | `/api/groups/:id`             | Gruppe umbenennen (nur Owner)                                                       |
| `PATCH`  | `/api/groups/:id/settings`    | Gruppeneinstellungen ändern (Owner/Admin), z. B. Code-Sichtbarkeit und `maxMembers` |
| `POST`   | `/api/groups/:id/code/rotate` | Einladungscode neu generieren (Owner/Admin)                                         |
| `DELETE` | `/api/groups/:id`             | Gruppe löschen (Owner/Admin, mit ZIP-Backup wenn Fotos vorhanden)                   |
| `DELETE` | `/api/groups/:id/leave`       | Gruppe verlassen                                                                    |

---

## Einladungslinks

Zusätzlich zum klassischen 6-stelligen Gruppen-Code gibt es dedizierte Invite-Links.

- Format: `/?invite=<TOKEN>`
- Owner dürfen Invite-Links nur für ihre eigene Gruppe erstellen
- Owner-Limit: maximal `10` aktive Links pro Gruppe
- Admins dürfen Invite-Links für mehrere Gruppen in einem Link erstellen
- In der Admin-Gruppenverwaltung kann beim Anlegen einer Gruppe optional direkt ein Invite-Link mit erstellt werden (ohne Ablaufdatum, ohne `maxUses`)
- Optional: Gültigkeit (`expiresAt`, max. 12 Monate) und Nutzungslimit (`maxUses`)
- Optional: On-Join-Benachrichtigung an den beitretenden User

### Einlösen (idempotent)

Das Einlösen ist idempotent: Ist ein User bereits Mitglied, kommt kein Fehler, sondern ein erfolgreicher Status (`already_member`).

Bei Multi-Group-Invites sind Teil-Erfolge erlaubt (`partial`), falls z. B. eine Gruppe voll ist, andere aber erfolgreich beigetreten werden können.

### OIDC-Flow bei nicht eingeloggten Nutzern

Wird ein Invite-Link ohne aktive Session geöffnet, wird der Invite-Kontext serverseitig an den OIDC-State gebunden und nach erfolgreichem Callback automatisch eingelöst.

Dadurch ist keine clientseitige Persistenz (z. B. localStorage) für den Invite-Token notwendig.

---

## Owner & Deputies

Jede Gruppe hat genau einen **Owner** (gespeichert in `Group.createdBy`). Der Owner kann **Vertreter (Deputies)** ernennen.

**Deputies haben dieselben Rechte wie der Owner**, mit folgenden Ausnahmen:

- Deputies dürfen die Gruppe **nicht umbenennen**
- Deputies dürfen die Gruppe **nicht löschen / auflösen**

**API:**

| Methode  | Pfad                               | Beschreibung                    |
| -------- | ---------------------------------- | ------------------------------- |
| `GET`    | `/api/groups/:id/deputies`         | Vertreter auflisten             |
| `POST`   | `/api/groups/:id/deputies`         | Vertreter ernennen (nur Owner)  |
| `DELETE` | `/api/groups/:id/deputies/:userId` | Vertreter entfernen (nur Owner) |

---

## Owner-Nachfolge beim Verlassen

Wenn der **Owner** die Gruppe verlassen möchte, muss er einen **Nachfolger** bestimmen:

```http
DELETE /api/groups/:id/leave
Content-Type: application/json

{ "successorId": "<userId>" }
```

Der neue Owner wird in `Group.createdBy` eingetragen. Ist der Owner das **letzte Mitglied**, kann er die Gruppe stattdessen [auflösen](#gruppe-auflösen).

---

## Gruppe auflösen

Wenn der Owner **das letzte verbliebene Mitglied** ist, kann er die Gruppe endgültig auflösen:

```http
DELETE /api/groups/:id/dissolve
```

**Was passiert:**

1. Alle Fotos der Gruppe werden in ein **ZIP-Archiv** gepackt (in MinIO unter `backups/`)
2. Ein `GroupBackup`-Eintrag in der DB wird angelegt (30 Tage gültig)
3. Alle Fotos, Kommentare, Likes und die Gruppe selbst werden gelöscht
4. Der Download-Link funktioniert **ohne Authentifizierung** für 30 Tage

---

## Alben

Alben gehören zu einer Gruppe und dienen zur thematischen Gruppierung von Fotos.

- Ein Foto kann in **mehreren Alben** gleichzeitig sein (n:m via `PhotoAlbum`)
- Jedes Album hat einen Ersteller (`createdBy`) und optionale [Beitragende](#album-beitragende-contributors)

**API:**

| Methode  | Pfad                                   | Beschreibung                                       |
| -------- | -------------------------------------- | -------------------------------------------------- |
| `GET`    | `/api/albums`                          | Alben einer Gruppe (`?groupId=…`)                  |
| `POST`   | `/api/albums`                          | Neues Album erstellen                              |
| `PATCH`  | `/api/albums/:id`                      | Album umbenennen (Ersteller oder Contributor)      |
| `DELETE` | `/api/albums/:id`                      | Album löschen (Ersteller oder Gruppe Owner/Deputy) |
| `GET`    | `/api/albums/:id/contributors`         | Beitragende auflisten                              |
| `POST`   | `/api/albums/:id/contributors`         | Beitragenden hinzufügen                            |
| `DELETE` | `/api/albums/:id/contributors/:userId` | Beitragenden entfernen                             |

---

## Album-Beitragende (Contributors)

Normalerweise kann nur der **Album-Ersteller** ein Album bearbeiten. Durch Hinzufügen als **Contributor** erhalten andere Mitglieder Bearbeitungsrechte.

Berechtigt zum Verwalten von Contributors ist:

- Der Album-Ersteller
- Der Gruppen-Owner oder ein Deputy

---

## Gruppen-Backups

Backups können auf mehreren Wegen entstehen:

| Auslöser               | Wer                      | Endpoint                            |
| ---------------------- | ------------------------ | ----------------------------------- |
| Gruppe auflösen        | Owner (letztes Mitglied) | `DELETE /api/groups/:id/dissolve`   |
| Gruppe löschen (Owner) | Owner                    | `DELETE /api/groups/:id`            |
| Manuelles Backup       | Admin                    | `POST /api/groups/admin/:id/backup` |
| Gruppe löschen (Admin) | Admin                    | `DELETE /api/groups/admin/:id`      |

**Download:**

```
GET /api/groups/admin/backup/:zipKey
```

- **Kein Auth erforderlich** – der `zipKey` ist das Geheimnis
- Gibt `410 Gone` zurück, wenn der Link abgelaufen ist
- **Rate-Limit:** 10 Anfragen pro Minute pro IP

**Gültigkeit:** 30 Tage ab Erstellung. Admins können den Link um weitere 30 Tage verlängern.

---

## Admin-Funktionen

| Methode  | Pfad                                        | Beschreibung                                                      |
| -------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/api/groups/admin/all`                     | Alle Gruppen auflisten (inkl. aggregierter Counts)                |
| `POST`   | `/api/groups/admin/create`                  | Gruppe anlegen, optional mit `maxMembers` und `memberLimitLocked` |
| `PATCH`  | `/api/groups/admin/:id`                     | Gruppe bearbeiten, inkl. Limit und Limit-Sperre                   |
| `GET`    | `/api/groups/admin/backups`                 | Alle Backup-Einträge auflisten                                    |
| `POST`   | `/api/groups/admin/backups/:zipKey/refresh` | Backup-Link um 30 Tage verlängern                                 |
| `DELETE` | `/api/groups/admin/backups/:zipKey`         | Backup aus MinIO und DB löschen                                   |
| `POST`   | `/api/groups/admin/:id/backup`              | Backup erstellen ohne Gruppe zu löschen                           |
| `DELETE` | `/api/groups/admin/:id`                     | Gruppe löschen + Backup erstellen                                 |
| `GET`    | `/api/groups/admin/:id/stranded-members`    | User anzeigen, die nach dem Löschen in keiner Gruppe mehr wären   |
