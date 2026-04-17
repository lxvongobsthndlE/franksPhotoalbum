# Fotoalbum Backend

Fastify Backend zur Ablösung von Supabase.

## Setup

```bash
npm install

# .env.local konfigurieren
cp .env.local.example .env.local

# Datenbank migrieren
npm run migrate

# Entwicklungsserver
npm run dev

# Produktions-Start
npm start
```

## Struktur

- `src/app.js` - Fastify App Einstiegspunkt
- `src/routes/` - API Endpoints
- `src/auth/` - Authentifizierung (JWT, Passwort)
- `src/middleware/` - Custom Middleware
- `db/` - Prisma Schema & Migrations
- `uploads/` - Lokale Dateispeicherung

## TODO

- [ ] Datenbank Schema finalisieren
- [ ] Auth-Routes implementieren
- [ ] File Upload Handler
- [ ] JWT Middleware
- [ ] CORS & Security Headers
- [ ] Error Handling
- [ ] Logging
- [ ] Tests
