# Fotoalbum Backend

Fastify-Backend für Franks Fotoalbum. Vollständige Dokumentation: [`../README.md`](../README.md)

## Schnellstart

```bash
npm install
cp .env.local.example .env.local   # Variablen befüllen

# Datenbank migrieren
npx prisma migrate dev

# Entwicklungsserver
node --env-file .env.local src/app.js
```

## Struktur

```
src/
  app.js               # Fastify-Einstiegspunkt, Plugin-Registrierung
  routes/
    auth.js            # OIDC-Callback, JWT, Refresh, Avatar-Proxy
    photos.js          # Upload, Stream-Proxy, Album-Zuordnung
    albums.js          # CRUD
    groups.js          # Mitglieder, Deputies, Backup, Auflösen, Admin-Routes
    comments.js        # CRUD
    likes.js           # Toggle
    admin.js           # Benutzerverwaltung
  utils/
    storage.js         # MinIO-Wrapper (Fotos, Avatare, Backups)
    oidc.js            # OIDC-Discovery & Token-Austausch
  auth/
    jwt.js             # JWT-Hilfsfunktionen
    password.js        # (nicht aktiv genutzt)
  middleware/
    auth.js            # (Platzhalter)
prisma/
  schema.prisma        # Datenbankschema
  migrations/          # Prisma-Migrationsverlauf
public/
  index.html           # SPA-Shell
  script/main.js       # Gesamte Frontend-Logik (Vanilla JS)
  style/main.css
```

## Migrations-Verlauf

| Migration | Inhalt |
|---|---|
| `20260416095944_init` | Initiales Schema: User, Group, GroupMember, Photo, Album, PhotoAlbum, Comment, Like |
| `20260416101506_add_oidc_support` | OIDC-Felder, Refresh-Token-Tabelle |
| `20260417132645_photo_multi_album` | Photo→Album n:m (PhotoAlbum Join-Tabelle) |
| `20260419133307_add_group_backups` | GroupBackup-Modell + GroupDeputy, `createdBy` in Group |
| `20260419143604_add_backup_deleted_by` | `deletedByName` in GroupBackup |
