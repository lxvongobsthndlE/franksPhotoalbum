# Franks Fotoalbum

Eine selbst gehostete Familien-Fotogalerie mit Gruppen, Alben, Kommentaren, Echtzeit-Benachrichtigungen und OIDC-Login via Authentik.

## Features auf einen Blick

- Gruppen mit Einladungscode, Owner-Nachfolge und Deputy-System
- Alben mit n:m-Foto-Zuordnung und Contributor-Rechten
- Foto-Upload (clientseitig komprimiert), Lightbox, Likes & Kommentare
- Echtzeit-Benachrichtigungen per SSE + optionaler E-Mail-Versand
- Admin-Panel: Benutzerverwaltung, Gruppenübersicht, Backup-Verwaltung, Broadcast
- PWA (Offline-fähig), Dark Mode, mobiloptimiert

## Technologie-Stack

| Bereich | Technologie |
|---|---|
| Backend | Fastify 4 (Node.js 22, ES Modules) |
| Datenbank | PostgreSQL 16 + Prisma 5 |
| Objektspeicher | MinIO (S3-kompatibel) |
| Authentifizierung | OIDC via Authentik + JWT |
| Frontend | Vanilla JS (SPA, kein Framework) |
| Containerisierung | Docker + Docker Compose |

## Schnellstart

```bash
git clone https://github.com/lxvongobsthndlE/franksPhotoalbum.git
cd franksPhotoalbum/backend
npm install
cp ../.env.example .env.local   # Variablen befüllen
npx prisma migrate dev
node --env-file .env.local src/app.js
```

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [Setup & Deployment](docs/setup.md) | Lokale Entwicklung, Docker, Reverse Proxy, alle Umgebungsvariablen, MinIO & Authentik einrichten, Projektstruktur |
| [Authentifizierung](docs/authentifizierung.md) | OIDC-Flow, JWT/Refresh-Token, Rollen |
| [Gruppen & Alben](docs/gruppen-und-alben.md) | Gruppen, Owner, Deputies, Auflösen, Alben, Contributors, Backups |
| [Benachrichtigungen](docs/benachrichtigungen.md) | SSE-Echtzeit-Push, E-Mail, Benachrichtigungstypen, Benutzereinstellungen |
| [API-Referenz](docs/api-referenz.md) | Alle REST-Endpunkte mit Parametern und Fehlercodes |
| [Datenbankschema](docs/datenbankschema.md) | Alle Prisma-Modelle, Beziehungen, Migrationshistorie |
| [Frontend & PWA](docs/frontend-pwa.md) | SPA-Aufbau, auth-oidc.js, Service Worker, Bildkomprimierung |