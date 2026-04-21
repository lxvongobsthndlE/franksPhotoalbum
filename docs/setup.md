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
node --env-file .env.local src/app.js
# oder mit Auto-Reload:
npm run dev
```

Der Server läuft auf [http://localhost:3000](http://localhost:3000).

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

Drei Buckets müssen vor dem ersten Start existieren:

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
