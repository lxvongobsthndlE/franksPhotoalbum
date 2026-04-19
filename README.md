# Franks Fotoalbum

Eine selbst gehostete Familien-Fotogalerie mit Gruppen, Alben, Kommentaren und OIDC-Login via Authentik.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Technologie-Stack](#technologie-stack)
- [Architektur](#architektur)
- [Voraussetzungen](#voraussetzungen)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Deployment mit Docker](#deployment-mit-docker)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Datenbankschema](#datenbankschema)
- [API-Übersicht](#api-übersicht)
- [Authentifizierung](#authentifizierung)

---

## Features

- **Gruppen** – Fotos und Alben sind einer Gruppe zugeordnet; Beitritt per Einladungscode
- **Alben** – Fotos können mehreren Alben gleichzeitig zugeordnet werden (n:m)
- **Lightbox** – Vollbild-Ansicht mit Slideshow, Album-Picker, Like- und Kommentarfunktion
- **Likes & Kommentare** – pro Foto, mit Echtzeit-Zählern
- **Upload** – Bilder werden clientseitig komprimiert (JPEG, max. 1400 px), dann per Multipart hochgeladen
- **Gruppen-Verwalter (Deputies)** – Owner kann Mitglieder als Vertreter ernennen; Deputies haben alle Owner-Rechte außer Umbenennen/Löschen
- **Owner-Succession** – Beim Verlassen als Owner kann ein Nachfolger bestimmt werden; ist man das letzte Mitglied, kann die Gruppe aufgelöst werden
- **Gruppen auflösen** – Letztes Mitglied (Owner) kann die Gruppe inkl. optionalem ZIP-Backup endgültig auflösen; Link bleibt 30 Tage gültig
- **Gruppen-Backup** – Admin oder Owner kann ein ZIP aller Gruppenfotos erzeugen; Backup-Link ist 30 Tage gültig und kann weitergegeben werden (kein Auth nötig)
- **Admin Backup-Verwaltung** – Admins sehen alle gespeicherten Backups mit Gruppe, Ersteller, Timestamp, Dateigröße und Fotoanzahl; Links können erneuert oder Backups gelöscht werden
- **Profil** – Avatar, Anzeigename (aus Authentik), Link zum Authentik-Account
- **Admin-Panel** – Benutzerliste, Rollenvergabe (user / admin), Gruppenübersicht mit Owner/Deputies
- **PWA** – Web-App-Manifest und Service Worker für Offline-Caching
- **Dark Mode** – automatisch per `prefers-color-scheme`
- **Mobil-optimiert** – responsives Layout, Gruppen-Wechsel in der Sidebar

---

## Technologie-Stack

| Bereich | Technologie |
|---|---|
| Backend | [Fastify 4](https://fastify.dev) (Node.js 22, ES Modules) |
| Datenbank | PostgreSQL 16 + [Prisma 5](https://prisma.io) ORM |
| Objektspeicher | [MinIO](https://min.io) (S3-kompatibel) |
| Authentifizierung | OIDC via [Authentik](https://goauthentik.io) + JWT |
| Frontend | Vanilla JS, kein Framework |
| Containerisierung | Docker + Docker Compose |

---

## Architektur

```
Browser
  │
  ├─ GET /          → backend/public/index.html (SPA)
  ├─ GET /api/*     → Fastify REST-API
  │    ├─ /auth     → OIDC-Callback, JWT-Ausgabe, Avatar-Proxy
  │    ├─ /photos   → Upload, Proxy zu MinIO, Album-Zuordnung
  │    ├─ /albums   → CRUD
  │    ├─ /groups   → Mitglieder, Backup-ZIP
  │    ├─ /comments → CRUD
  │    ├─ /likes    → Toggle
  │    └─ /admin    → Benutzerverwaltung
  │
  ├─ Fastify ──────── PostgreSQL (via Prisma)
  └─ Fastify ──────── MinIO (Fotos, Avatare, Backups)
```

**Auth-Flow:**
1. Browser → `GET /api/auth/login` → Redirect zu Authentik
2. Authentik → `GET /api/auth/callback?code=…` → JWT Access Token (15 min) + Refresh Token (HttpOnly Cookie, 7 Tage)
3. Fotos werden über `/api/photos/:id/file?t=<accessToken>` gestreamt (kein direkter MinIO-Zugriff)

---

## Voraussetzungen

- **Node.js** ≥ 22
- **PostgreSQL** ≥ 14
- **MinIO** (oder S3-kompatiblen Dienst) mit drei Buckets: `photos`, `avatars`, `backups`
- **Authentik** als OIDC-Provider (oder beliebiger anderer OIDC-Provider)

---

## Lokale Entwicklung

```bash
# 1. Repository klonen
git clone https://github.com/frankzudemo17/Fotoalbum.git
cd Fotoalbum/backend

# 2. Abhängigkeiten installieren
npm install

# 3. Umgebungsvariablen setzen
cp ../.env.example .env.local
# .env.local befüllen (siehe Abschnitt Umgebungsvariablen)

# 4. Datenbank migrieren
npx prisma migrate dev

# 5. Server starten (mit Auto-Reload)
npm run dev
```

Der Server läuft dann auf [http://localhost:3000](http://localhost:3000).

---

## Deployment mit Docker

```bash
# 1. Umgebungsvariablen vorbereiten
cp .env.example .env
# .env befüllen

# 2. Container starten
docker compose up -d

# Logs ansehen
docker compose logs -f app
```

**Was passiert beim Start:**
1. Postgres-Container startet und wird per Health-Check überwacht
2. App-Container wartet auf die DB, führt dann `prisma migrate deploy` aus
3. Fastify-Server lauscht auf Port 3000

> Für den Betrieb hinter einem Reverse Proxy (nginx, Caddy, Traefik) den Port `3000` nicht direkt exponieren und stattdessen über HTTPS weiterleiten.

---

## Umgebungsvariablen

Alle Variablen werden in `.env.local` (Entwicklung) bzw. `.env` (Docker) gesetzt. Vorlage: [`.env.example`](.env.example).

| Variable | Beschreibung | Beispiel |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindungsstring | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Mindestens 32 Zeichen langer geheimer Schlüssel | – |
| `OIDC_ISSUER` | Issuer-URL des OIDC-Providers | `https://auth.example.de/application/o/app/` |
| `OIDC_CLIENT_ID` | Client-ID in Authentik | `franks-fotoalbum` |
| `OIDC_CLIENT_SECRET` | Client-Secret aus Authentik | – |
| `OIDC_REDIRECT_URI_PROD` | Callback-URL in Produktion | `https://photoalbum.example.tld/auth/callback` |
| `OIDC_REDIRECT_URI_DEV` | Callback-URL lokal | `http://localhost:3000/auth/callback` |
| `MINIO_ENDPOINT` | MinIO-Hostname (ohne `https://`) | `192.168.1.10` |
| `MINIO_PORT` | MinIO-Port | `9000` |
| `MINIO_ACCESS_KEY` | MinIO Access Key | – |
| `MINIO_SECRET_KEY` | MinIO Secret Key | – |
| `MINIO_BUCKET_PHOTOS` | Bucket für Fotos | `photos` |
| `MINIO_BUCKET_AVATARS` | Bucket für Avatare | `avatars` |
| `MINIO_BUCKET_BACKUPS` | Bucket für Gruppen-Backups (ZIP) | `backups` |
| `PORT` | Server-Port | `3000` |
| `NODE_ENV` | `development` oder `production` | `production` |

---

## Datenbankschema

```
User ──< GroupMember >── Group ──< Album
           │               │          │
           │           GroupDeputy  Photo ─────< PhotoAlbum
           │               │          │
           │               │       Comment / Like
           │               │
           └───────────────┴── GroupBackup (ZIP-Archiv, 30 Tage gültig)
```

- **User** – wird bei jedem Login aus dem OIDC-Token synchronisiert (`name › preferred_username › email`)
- **Group** – Beitritt per zufälligem 6-stelligen Code; `createdBy` zeigt den aktuellen Owner (erster Beitretender nach Admin-Anlage wird automatisch Owner)
- **GroupMember** – n:m zwischen User und Group
- **GroupDeputy** – Vertreter eines Owners; haben alle Owner-Rechte außer Umbenennen/Löschen
- **Photo** – gespeichert in MinIO; wird über Backend-Proxy ausgeliefert
- **PhotoAlbum** – n:m Join-Tabelle (ein Foto kann in mehreren Alben sein)
- **Comment / Like** – pro Foto, User-gebunden
- **GroupBackup** – Metadaten zu gespeicherten ZIP-Backups: `zipKey`, `groupName`, `deletedByName`, `photoCount`, `sizeBytes`, `linkExpiry`

---

## API-Übersicht

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/auth/login` | Startet OIDC-Flow |
| `GET` | `/api/auth/callback` | OIDC-Callback, gibt JWT zurück |
| `POST` | `/api/auth/refresh` | Access Token erneuern |
| `GET` | `/api/auth/me` | Eigenes Profil |
| `GET` | `/api/auth/avatar/:userId` | Avatar-Proxy (öffentlich) |
| `GET` | `/api/photos` | Fotoliste (paginiert, filterbar nach Gruppe/Album) |
| `POST` | `/api/photos` | Foto hochladen (multipart) |
| `GET` | `/api/photos/:id/file` | Foto-Datei streamen (`?t=<token>`) |
| `PATCH` | `/api/photos/:id` | Album-Zuordnung oder Beschreibung ändern |
| `PATCH` | `/api/photos/batch-album` | Mehrere Fotos einem Album zuordnen/entfernen |
| `DELETE` | `/api/photos/:id` | Foto löschen (nur eigene) |
| `GET` | `/api/albums` | Alben einer Gruppe |
| `POST` | `/api/albums` | Neues Album erstellen |
| `PATCH` | `/api/albums/:id` | Album umbenennen |
| `DELETE` | `/api/albums/:id` | Album löschen |
| `GET` | `/api/groups` | Eigene Gruppen |
| `POST` | `/api/groups` | Neue Gruppe erstellen |
| `POST` | `/api/groups/join` | Gruppe per Code beitreten (erster Beitretender wird Owner) |
| `GET` | `/api/groups/:id/members` | Mitglieder einer Gruppe |
| `DELETE` | `/api/groups/:id/leave` | Gruppe verlassen (Owner kann Nachfolger per `successorId` übergeben) |
| `DELETE` | `/api/groups/:id/dissolve` | Gruppe auflösen (nur Owner als letztes Mitglied); erstellt ZIP-Backup |
| `GET` | `/api/groups/:id/deputies` | Vertreter einer Gruppe auflisten |
| `POST` | `/api/groups/:id/deputies` | Vertreter ernennen (nur Owner) |
| `DELETE` | `/api/groups/:id/deputies/:userId` | Vertreter entfernen (nur Owner) |
| `POST` | `/api/groups/admin/:id/backup` | Gruppen-Backup-ZIP erzeugen ohne zu löschen (Admin) |
| `DELETE` | `/api/groups/admin/:id` | Gruppe löschen + Backup erzeugen (Admin) |
| `GET` | `/api/groups/admin/:id/stranded-members` | User die nach dem Löschen in keiner Gruppe mehr wären (Admin) |
| `GET` | `/api/groups/admin/backup/:zipKey` | ZIP herunterladen – **kein Auth nötig**, `zipKey` ist das Geheimnis; 410 wenn abgelaufen; **Rate-Limit: 10 req/min pro IP** |
| `GET` | `/api/groups/admin/backups` | Alle Backup-Einträge auflisten (Admin) |
| `POST` | `/api/groups/admin/backups/:zipKey/refresh` | Backup-Link um 30 Tage verlängern (Admin) |
| `DELETE` | `/api/groups/admin/backups/:zipKey` | Backup aus MinIO + DB löschen (Admin) |
| `GET` | `/api/comments/:photoId` | Kommentare eines Fotos |
| `POST` | `/api/comments` | Kommentar erstellen |
| `DELETE` | `/api/comments/:id` | Kommentar löschen |
| `POST` | `/api/likes/:photoId` | Like togglen |
| `GET` | `/api/admin/users` | Alle User (Admin) |
| `PATCH` | `/api/admin/users/:id/role` | Rolle ändern (Admin) |

---

## Authentifizierung

Die App verwendet einen **Token-Rotation**-Ansatz:

- **Access Token** (JWT, 15 min) – wird im `sessionStorage` des Browsers gehalten
- **Refresh Token** (opakes Token, 7 Tage) – HttpOnly-Cookie, wird nur serverseitig gelesen
- Foto-Proxys erwarten den Access Token als `?t=<token>` Query-Parameter, da `<img src>` keine `Authorization`-Header senden kann

Beim Login wird der User-Datensatz aus dem OIDC-`userinfo`-Endpunkt synchronisiert. Namens-Präzedenz: `name` › `preferred_username` › `email.split('@')[0]`.
