# Benachrichtigungen

## Überblick

Das Benachrichtigungssystem besteht aus drei Teilen:

1. **In-App-Benachrichtigungen** – gespeichert in der DB, in Echtzeit per SSE gepusht
2. **E-Mail-Benachrichtigungen** – optionaler Versand per SMTP (fire-and-forget)
3. **Benutzereinstellungen** – pro Typ individuell konfigurierbar (in-app und E-Mail getrennt)

---

## Server-Sent Events (SSE)

Neue Benachrichtigungen werden sofort über eine dauerhaft offene SSE-Verbindung an alle aktiven Tabs des Nutzers gepusht.

**Verbindung aufbauen:**

```
GET /api/notifications/stream?token=<accessToken>
```

Da `EventSource` keine Custom-Header senden kann, wird der JWT als Query-Parameter übergeben.

**Event-Format:**

```
event: notification
data: {"id":"…","type":"photoCommented","title":"…","body":"…","entityId":"…","entityType":"photo","imageUrl":"…","entityUrl":"…","read":false,"createdAt":"…"}
```

**Keep-Alive:** Das Backend sendet alle 25 Sekunden einen `: ping`-Kommentar, damit Proxys die Verbindung nicht schließen.

> **nginx:** `proxy_buffering off` und `proxy_read_timeout 3600s` sind für SSE erforderlich (siehe [Setup](setup.md#reverse-proxy)).

---

## Benachrichtigungstypen

| Typ                  | Auslöser                                 | Standard in-app | Standard E-Mail |
| -------------------- | ---------------------------------------- | --------------- | --------------- |
| `deputyAdded`        | Nutzer wird zum Deputy ernannt           | ✅              | ✅              |
| `deputyRemoved`      | Deputy-Status entzogen                   | ✅              | ❌              |
| `contributorAdded`   | Nutzer als Album-Contributor hinzugefügt | ✅              | ✅              |
| `contributorRemoved` | Contributor-Status entzogen              | ✅              | ❌              |
| `groupMemberJoined`  | Neues Mitglied tritt der Gruppe bei      | ✅              | ❌              |
| `groupMemberLeft`    | Mitglied verlässt die Gruppe             | ✅              | ❌              |
| `groupDeleted`       | Gruppe wurde gelöscht                    | ✅              | ✅              |
| `photoLiked`         | Eigenes Foto wurde geliked               | ✅              | ❌              |
| `photoCommented`     | Eigenes Foto wurde kommentiert           | ✅              | ❌              |
| `newPhoto`           | Neues Foto in der Gruppe hochgeladen     | ✅              | ❌              |
| `newAlbum`           | Neues Album in der Gruppe erstellt       | ✅              | ❌              |
| `system`             | Admin-Broadcast-Nachricht                | ✅ (immer)      | ❌              |

Hinweis zu Medien-Uploads:

- Der Typ `newPhoto` wird aktuell sowohl für Bild- als auch Video-Uploads verwendet.
- Die Textbausteine lauten derzeit weiterhin „Foto“. Eine medienneutrale Formulierung ist als Folgeaufgabe eingeplant.

---

## E-Mail-Benachrichtigungen

E-Mails werden per **nodemailer** versendet. Konfiguration über SMTP-Umgebungsvariablen (siehe [Setup](setup.md#umgebungsvariablen)).

Falls `SMTP_HOST` nicht gesetzt ist, wird kein E-Mail-Versand versucht.

**DEV-Modus:** Im `development`-Modus steuert `DEV_MAIL_CATCHALL` den E-Mail-Versand:

| `DEV_MAIL_CATCHALL`                | Verhalten                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| nicht gesetzt oder leer            | **kein E-Mail-Versand** im DEV-Modus                                                   |
| `dev@example.de`                   | alle Mails gehen an diese eine Adresse                                                 |
| `${local}-dev@catchall.example.de` | lokaler Teil der Original-Adresse wird eingesetzt, z. B. `max-dev@catchall.example.de` |

> **Hinweis:** In `.env`-Dateien und insbesondere in `docker-compose`/Compose kann `${local}` als Interpolationssyntax ausgewertet werden. Wenn der Platzhalter **wörtlich** im Container ankommen soll, je nach Setup z. B. als `$${local}-dev@catchall.example.de` escapen oder die Variable auf einem Weg setzen, der keine Compose-Interpolation ausführt.
> In Produktion (`NODE_ENV=production`) wird `DEV_MAIL_CATCHALL` ignoriert und Mails gehen an die echten Adressen.

---

## Benutzereinstellungen

Jeder Nutzer kann in seinem Profil unter **Benachrichtigungen** einstellen, welche Typen er in-app und per E-Mail erhalten möchte.

Einstellungen werden in `NotificationPreference` gespeichert (automatisch angelegt beim ersten Zugriff). Spalten folgen dem Schema `inApp_<typ>` und `email_<typ>`.

**System-Benachrichtigungen (`system`) können nicht deaktiviert werden** – sie werden immer in-app zugestellt.

---

## API-Endpunkte

| Methode | Pfad                             | Beschreibung                                          |
| ------- | -------------------------------- | ----------------------------------------------------- |
| `GET`   | `/api/notifications/stream`      | SSE-Stream öffnen (`?token=<jwt>`)                    |
| `GET`   | `/api/notifications`             | Liste der eigenen Benachrichtigungen (paginiert)      |
| `PATCH` | `/api/notifications/:id/read`    | Einzelne Benachrichtigung als gelesen markieren       |
| `PATCH` | `/api/notifications/read-all`    | Alle als gelesen markieren                            |
| `GET`   | `/api/notifications/preferences` | Eigene Einstellungen abrufen                          |
| `PATCH` | `/api/notifications/preferences` | Einstellungen aktualisieren                           |
| `POST`  | `/api/admin/broadcast`           | System-Benachrichtigung an alle Nutzer senden (Admin) |

**Paginierung (`GET /api/notifications`):**

```
GET /api/notifications?limit=30&cursor=<lastId>
```

Antwort:

```json
{
  "notifications": [...],
  "unreadCount": 5,
  "nextCursor": "<id>"
}
```

---

## Benachrichtigung erstellen (intern)

Die Hilfsfunktion `createNotification` in `backend/src/utils/notifications.js` prüft automatisch die Nutzereinstellungen und versendet sowohl den SSE-Push als auch ggf. die E-Mail:

```js
await createNotification(prisma, {
  userId: "<empfängerUserId>",
  type: "photoCommented",
  title: "Neuer Kommentar",
  body: "Max hat dein Foto kommentiert.",
  entityId: "<photoId>",
  entityType: "photo",
  imageUrl: "/api/photos/<photoId>/file?t=…",
  entityUrl: "/photos/<photoId>",
});
```
