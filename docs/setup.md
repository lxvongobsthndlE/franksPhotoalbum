# Setup & Deployment

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Deployment mit Docker](#deployment-mit-docker)
- [Reverse Proxy (nginx / Caddy)](#reverse-proxy)
- [Umgebungsvariablen](#umgebungsvariablen)
- [MinIO einrichten](#minio-einrichten)
- [Authentik konfigurieren](#authentik-konfigurieren)
- [Datenbank-Migrationen](#datenbank-migrationen)
- [Supabase Alt-Daten Migration](#supabase-alt-daten-migration)

---

## Voraussetzungen

| Dienst | Mindestversion | Zweck |
|---|---|---|
| Node.js | 22 | Backend-Runtime |
| PostgreSQL | 14 | Primäre Datenbank |
| MinIO | aktuell | Objektspeicher (Fotos, Avatare, Backups) |
| Authentik | aktuell | OIDC-Provider |
| Docker + Compose | v2 | Containerisierung (optional lokal, Pflicht Produktion) |

---

## Lokale Entwicklung

```bash
# 1. Repository klonen
git clone https://github.com/lxvongobsthndlE/franksPhotoalbum.git
cd franksPhotoalbum/backend

# 2. Abhängigkeiten installieren
npm install

# 3. Umgebungsvariablen anlegen
cp ../.env.example .env.local
# .env.local mit eigenen Werten befüllen (siehe Abschnitt Umgebungsvariablen)

# 4. Datenbank migrieren
npx prisma migrate dev

# 5. Prisma Client generieren (falls nötig)
npx prisma generate

# 6. Server starten
# nur App (ohne MinIO-Autostart):
node --env-file .env.local src/app.js

# Dev-Workflow (Auto-Reload + optional lokales MinIO):
npm run dev

# nur App im Watch-Modus (ohne MinIO-Autostart):
npm run dev:app
```

Der Server läuft auf [http://localhost:3000](http://localhost:3000).

`npm run dev` startet lokal automatisch MinIO, wenn `MINIO_ENDPOINT=localhost` oder `MINIO_ENDPOINT=127.0.0.1` gesetzt ist.
Voraussetzung: `minio.exe` liegt unter `backend/dev_tools/minio.exe` (oder `MINIO_BINARY_PATH` ist gesetzt).

Wichtig: Der Dev-Runner maskiert MinIO-Credentials (`RootUser`, `RootPass`, `mc alias set ...`) in der Konsole.

> **Tipp:** Für OIDC lokal muss `OIDC_REDIRECT_URI_DEV` auf `http://localhost:3000/auth/callback` gesetzt und in Authentik als erlaubter Redirect registriert sein.

---

## Deployment mit Docker

Das Projekt enthält eine fertige `docker-compose.yml` mit drei Services:

| Service | Image | Port (Host → Container) |
|---|---|---|
| `app` | Eigener Build (`./backend/Dockerfile`) | `3001 → 3000` |
| `postgres` | `postgres:16-alpine` | `5433 → 5432` |
| `minio` | `minio/minio:latest` | `9000 → 9000`, `9001 → 9001` |

```bash
# 1. Umgebungsvariablen vorbereiten
cp .env.example .env
# .env befüllen

# 2. Container bauen und starten
docker compose up -d --build

# Logs in Echtzeit anzeigen
docker compose logs -f app

# Neustart eines einzelnen Dienstes
docker compose restart app
```

**Startablauf:**
1. `postgres` startet und meldet sich per Health-Check als bereit
2. `app` wartet auf Postgres, führt dann automatisch `prisma migrate deploy` aus
3. Fastify-Server lauscht intern auf Port 3000

---

## Reverse Proxy

Port `3000` (bzw. `3001` am Host) **nicht direkt öffentlich exponieren**. Stattdessen einen Reverse Proxy vorschalten, der HTTPS terminiert.

**Beispiel nginx (minimale Konfiguration):**

```nginx
server {
    listen 443 ssl;
    server_name photoalbum.example.de;

    ssl_certificate     /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # SSE: kein Buffering
        proxy_buffering    off;
        proxy_read_timeout 3600s;
    }
}
```

> **SSE-Hinweis:** Für den Benachrichtigungs-Stream (`/api/notifications/stream`) muss `proxy_buffering off` und ein großzügiges `proxy_read_timeout` gesetzt sein.

---

## Umgebungsvariablen

Alle Variablen werden in `.env.local` (Entwicklung) bzw. `.env` (Docker Compose) gesetzt.

### Datenbank

| Variable | Beschreibung | Beispiel |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindungsstring | `postgresql://user:pass@localhost:5432/photoalbum` |

### JWT

| Variable | Beschreibung | Hinweis |
|---|---|---|
| `JWT_SECRET` | Signierschlüssel für Access Tokens | Mindestens 32 Zeichen, zufällig generieren |

### OIDC

| Variable | Beschreibung | Beispiel |
|---|---|---|
| `OIDC_ISSUER` | Issuer-URL des OIDC-Providers | `https://auth.example.de/application/o/fotoalbum/` |
| `OIDC_CLIENT_ID` | Client-ID in Authentik | `franks-fotoalbum` |
| `OIDC_CLIENT_SECRET` | Client-Secret aus Authentik | – |
| `OIDC_REDIRECT_URI_PROD` | Callback-URL (Produktion) | `https://photoalbum.example.de/auth/callback` |
| `OIDC_REDIRECT_URI_DEV` | Callback-URL (Entwicklung) | `http://localhost:3000/auth/callback` |

### MinIO

| Variable | Beschreibung | Standard |
|---|---|---|
| `MINIO_ENDPOINT` | Hostname ohne Protokoll | `192.168.1.10` |
| `MINIO_PORT` | Port | `9000` |
| `MINIO_ACCESS_KEY` | Access Key | – |
| `MINIO_SECRET_KEY` | Secret Key | – |
| `MINIO_BUCKET_PHOTOS` | Bucket für Fotos | `photos` |
| `MINIO_BUCKET_AVATARS` | Bucket für Avatare | `avatars` |
| `MINIO_BUCKET_BACKUPS` | Bucket für ZIP-Backups | `backups` |
| `MINIO_BINARY_PATH` | Optionaler Pfad zu `minio.exe` für `npm run dev` | `backend/dev_tools/minio.exe` |
| `MINIO_DATA_DIR` | Optionales lokales MinIO-Datenverzeichnis für `npm run dev` | `backend/dev_tools/minio_data` |

### SMTP (optional – für E-Mail-Benachrichtigungen)

| Variable | Beschreibung | Standard |
|---|---|---|
| `SMTP_HOST` | SMTP-Server-Hostname | – |
| `SMTP_PORT` | SMTP-Port | `587` |
| `SMTP_SECURE` | TLS: `true` oder `false` | `false` |
| `SMTP_USER` | Benutzername / Absende-Adresse | – |
| `SMTP_PASS` | Passwort | – |
| `SMTP_FROM` | Anzeigename des Absenders | `Franks Fotoalbum` |
| `DEV_MAIL_CATCHALL` | Catch-All-Adresse für DEV-Modus (optional). Ohne Wert: kein E-Mail-Versand im DEV-Modus. Mit `${local}` als Platzhalter für den lokalen Teil der Originaladresse. | `${local}-dev@catchall.example.de` |

> Falls `SMTP_HOST` nicht gesetzt ist, wird kein E-Mail-Versand versucht.

### Server

| Variable | Beschreibung | Standard |
|---|---|---|
| `PORT` | Port des Fastify-Servers | `3000` |
| `NODE_ENV` | `development` oder `production` | `production` |

---

## MinIO einrichten

Die Buckets werden beim Backend-Start automatisch angelegt, falls sie fehlen.
Manuelles Anlegen ist nur nötig, wenn du Buckets vorab selbst kontrollieren willst:

```bash
# MinIO Client (mc) konfigurieren
mc alias set local http://localhost:9000 MINIO_ACCESS_KEY MINIO_SECRET_KEY

# Buckets erstellen
mc mb local/photos
mc mb local/avatars
mc mb local/backups
```

Alternativ über die MinIO-Konsole unter [http://localhost:9001](http://localhost:9001).

> Die Buckets müssen **privat** bleiben. Fotos werden ausschließlich über den Backend-Proxy ausgeliefert – kein direkter öffentlicher Zugriff.

---

## Authentik konfigurieren

1. In Authentik eine neue **OAuth2/OIDC-Provider**-Anwendung anlegen
2. Folgende Redirect-URIs eintragen:
   - Produktion: `https://photoalbum.example.de/auth/callback`
   - Entwicklung: `http://localhost:3000/auth/callback`
3. **Client-Typ**: Confidential
4. **Scopes**: `openid`, `profile`, `email`
5. Client-ID und Client-Secret in die `.env` eintragen

Der Backend-Auth-Flow liest folgende Claims aus dem `userinfo`-Endpunkt:

| Claim | Verwendung |
|---|---|
| `sub` | Eindeutige Nutzer-ID (wird intern als OIDC-ID gespeichert) |
| `email` | Pflichtfeld |
| `name` | Anzeigename (Fallback: `preferred_username` → `email`) |
| `preferred_username` | Benutzername |
| `picture` | Avatar-URL (wird über Backend-Proxy gecacht) |

---

## Projektstruktur (Backend)

```
backend/
  src/
    app.js                  # Fastify-Einstiegspunkt, Plugin-Registrierung
    routes/
      auth.js               # OIDC-Callback, JWT, Refresh, Avatar-Proxy
      photos.js             # Upload, Stream-Proxy, Album-Zuordnung
      albums.js             # CRUD
      groups.js             # Mitglieder, Deputies, Backup, Auflösen, Admin-Routes
      comments.js           # CRUD
      likes.js              # Toggle
      notifications.js      # SSE-Stream, Liste, Präferenzen
      admin.js              # Benutzerverwaltung, Broadcast
    utils/
      storage.js            # MinIO-Wrapper (Fotos, Avatare, Backups)
      oidc.js               # OIDC-Discovery & Token-Austausch
      notifications.js      # SSE-Registry, E-Mail-Versand, createNotification()
    auth/
      jwt.js                # JWT-Hilfsfunktionen
      password.js           # (nicht aktiv genutzt)
    middleware/
      auth.js               # (Platzhalter)
  prisma/
    schema.prisma           # Datenbankschema
    migrations/             # Prisma-Migrationsverlauf
  public/
    index.html              # SPA-Shell
    script/
      main.js               # Gesamte Frontend-Logik (Vanilla JS)
      auth-oidc.js          # Auth, API-Client, Token-Management
      sw.js                 # Service Worker
    style/
      main.css              # Alle Styles
    media/                  # Icons, Logos
```

---

## Supabase Alt-Daten Migration

Fuer den Umzug aus der alten Supabase-App steht ein Migrationsskript bereit.
Der empfohlene Weg ist der Login-Mode (RLS-sichtbare Daten des Login-Users):

```bash
cd backend
npm run migrate:supabase -- --login --dry-run --skip-storage
```

Standardverhalten des Skripts:

- Merge in bestehende Ziel-Datenbank (kein TRUNCATE)
- Physische Migration der Foto-Objekte aus Supabase Storage nach MinIO
- Avatare werden bewusst ignoriert

Optional:

- `--login`: Importiert nur Daten, die fuer den angegebenen Supabase-User sichtbar sind (RLS)
- `--email=<mail>` und `--password=<pass>`: Login-Credentials direkt als CLI-Flags
- `--replace`: Zieltabellen vor Import leeren
- `--skip-storage`: nur DB-Migration, keine Foto-Dateien kopieren
- `--strict`: bei Referenz-Warnungen abbrechen

Noetige Variablen zusaetzlich zu den normalen Backend-Variablen:

Allgemein:

| Variable | Beschreibung |
|---|---|
| `TARGET_DATABASE_URL` | Optionale Ziel-DB fuer Migration; Fallback ist `DATABASE_URL` |
| `SUPABASE_STORAGE_BUCKET` | Quell-Bucket in Supabase (Standard: `photos`) |

Login-Mode (`--login`, empfohlen):

| Variable | Beschreibung |
|---|---|
| `SUPABASE_URL` | Supabase Projekt-URL, z.B. `https://xyz.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon Key fuer Login + Rest-API |
| `SUPABASE_LOGIN_EMAIL` | Login-E-Mail (alternativ `--email=...`) |
| `SUPABASE_LOGIN_PASSWORD` | Login-Passwort (alternativ `--password=...`) |
| `VISIBLE_IMPORT_EMAIL_DOMAIN` | Optionales Domain-Suffix fuer Platzhalter-E-Mails (Default: `visible-import.local`) |

Full-DB-Mode (ohne `--login`):

| Variable | Beschreibung |
|---|---|
| `SUPABASE_DB_URL` | Direkte Postgres-Verbindung auf das alte Supabase-Projekt |
| `SUPABASE_URL` | Supabase Projekt-URL, z.B. `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-Role Key fuer Storage-Downloads im Full-DB-Mode |

Typische Befehle:

```bash
# 1) Sicherer Check ohne Writes
npm run migrate:supabase -- --login --dry-run --skip-storage

# 2) Echter Import mit Login-Mode
npm run migrate:supabase -- --login

# 3) Full-DB-Import (nur wenn SUPABASE_DB_URL vorhanden)
npm run migrate:supabase -- --dry-run
```

Hinweis: `TARGET_DATABASE_URL` kann identisch mit `DATABASE_URL` sein.

---

## Datenbank-Migrationen

```bash
# Alle ausstehenden Migrationen anwenden (Produktion)
npx prisma migrate deploy

# Neue Migration erstellen (Entwicklung)
npx prisma migrate dev --name beschreibung_der_aenderung

# Aktuellen Schema-Status anzeigen
npx prisma migrate status
```

Migrationen liegen unter `backend/prisma/migrations/`.
