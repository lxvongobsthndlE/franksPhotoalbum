# Authentifizierung

## Überblick

Die App verwendet **OIDC (OpenID Connect)** via [Authentik](https://goauthentik.io) zur Anmeldung. Nach erfolgreichem Login stellt das Backend ein **JWT Access Token** und ein **Refresh Token** aus.

---

## OIDC-Anmeldeflow

```
Browser                      Backend                        Authentik
  │                             │                               │
  │── GET /api/auth/login ──────►│                               │
  │                             │── Redirect ──────────────────►│
  │◄──────────────── Redirect ──│                               │
  │                             │                               │
  │── [Nutzer meldet sich an] ──────────────────────────────────►│
  │                             │                               │
  │◄── Redirect /auth/callback?code=… ─────────────────────────│
  │                             │                               │
  │── GET /api/auth/callback ───►│                               │
  │        ?code=…&state=…      │── POST /token ───────────────►│
  │                             │◄── id_token + access_token ───│
  │                             │── GET /userinfo ─────────────►│
  │                             │◄── name, email, picture ──────│
  │                             │                               │
  │                             │ User in DB anlegen/aktualisieren
  │                             │                               │
  │◄── JWT Access Token (15 min) + Set-Cookie: refreshToken ────│
```

---

## Token-Konzept

| Token | Typ | Lebensdauer | Speicherort |
|---|---|---|---|
| **Access Token** | JWT (signiert mit `JWT_SECRET`) | 15 Minuten | `sessionStorage` im Browser |
| **Refresh Token** | Opaker String (in DB gespeichert) | 7 Tage | HttpOnly-Cookie (`refreshToken`) |

**Token erneuern:**

```
Browser                         Backend
  │── POST /api/auth/refresh ───►│
  │   (Cookie mit Refresh Token) │
  │                              │ Token in DB prüfen
  │◄── Neues JWT Access Token ───│
```

Das Frontend ruft alle **14 Minuten** automatisch `/api/auth/refresh` auf (`startTokenRefreshTimer()`), bevor der Access Token abläuft.

---

## Foto-Authentifizierung

Da `<img src="...">` keine `Authorization`-Header senden kann, wird der Access Token als Query-Parameter übergeben:

```
GET /api/photos/:id/file?t=<accessToken>
```

Das Backend extrahiert und verifiziert den Token aus dem `t`-Parameter.

---

## User-Synchronisation

Bei jedem Login wird der User-Datensatz in der Datenbank mit den Daten aus dem OIDC-`userinfo`-Endpunkt aktualisiert:

| Feld | Quelle (Präzedenz) |
|---|---|
| `name` | Direkt aus dem `name`-Claim – `null` wenn nicht gesetzt (kein Fallback) |
| `username` | `preferred_username` → `email.split('@')[0]` |
| `email` | `email` (Pflicht) |
| `avatar` | `picture`-URL (wird in MinIO gecacht) |

---

## Rollen

Jeder User hat eine `role` in der Datenbank:

| Rolle | Berechtigungen |
|---|---|
| `user` | Eigene Fotos, Gruppen, Alben, Kommentare verwalten |
| `admin` | Zusätzlich: alle Nutzer sehen, Rollen vergeben, Gruppen löschen, Backups verwalten, Broadcast-Benachrichtigungen versenden |

Die erste Admin-Zuweisung muss manuell in der Datenbank oder über den Admin-Bereich eines bereits existierenden Admins erfolgen.

> **Sicherheit:** Ein Admin kann sich nicht selbst degradieren, wenn er der letzte verbleibende Admin ist (`PATCH /api/admin/users/:id/role` gibt dann `409` zurück).

---

## API-Endpunkte (Auth)

| Methode | Pfad | Beschreibung | Auth |
|---|---|---|---|
| `GET` | `/api/auth/login` | Startet OIDC-Flow, leitet zu Authentik weiter | Nein |
| `GET` | `/api/auth/callback` | OIDC-Callback; gibt JWT + setzt Cookie | Nein |
| `POST` | `/api/auth/refresh` | Erneuert Access Token via Refresh-Cookie | Cookie |
| `GET` | `/api/auth/me` | Gibt das eigene Nutzerprofil zurück | JWT |
| `POST` | `/api/auth/logout` | Löscht Refresh Token aus DB und Cookie | JWT |
| `GET` | `/api/auth/avatar/:userId` | Avatar-Proxy aus MinIO | Öffentlich |
