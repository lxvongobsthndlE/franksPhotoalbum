# Datenbankschema

Das Schema liegt unter `backend/prisma/schema.prisma` und wird mit [Prisma](https://prisma.io) verwaltet. Datenbank: **PostgreSQL 16**.

## Übersicht (Beziehungsdiagramm)

```
User ──< GroupMember >── Group ──< Album ──< AlbumContributor >── User
  │                        │          │
  │                    GroupDeputy  PhotoAlbum
  │                        │          │
  │                    GroupBackup  Photo ──< Comment
  │                                   │
  │                                   └──< Like
  │
  ├──< Notification
  └──  NotificationPreference
```

---

## Modelle

### User

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  username  String   @unique
  name      String?
  color            String?           // Farbe für Avatar-Platzhalter (hex oder hsl)
  avatar           String?           // URL, Proxy über /api/auth/avatar/:userId
  displayNameField String?  @default("name")  // "name" | "username" – bevorzugter Anzeigename
  role             String   @default("user")  // "user" | "admin"
  createdAt        DateTime @default(now())
}
```

Wird bei jedem Login mit Daten aus Authentik synchronisiert.

---

### Group

```prisma
model Group {
  id        String   @id @default(cuid())
  name      String
  code      String   @unique   // 6-stelliger Einladungscode, Großbuchstaben
  createdBy String?            // userId des aktuellen Owners
  inviteCodeVisibleToMembers Boolean @default(true) // Einladungscode für alle Mitglieder sichtbar
  maxMembers Int?              // Optionales Mitgliederlimit; null = unbegrenzt
  memberLimitLocked Boolean @default(false) // Admin-Sperre: Owner darf Limit dann nicht ändern
  createdAt DateTime @default(now())
}
```

---

### GroupMember

Verbindet User und Group (n:m).

```prisma
model GroupMember {
  userId  String
  groupId String

  @@id([userId, groupId])
}
```

---

### GroupDeputy

Vertreter eines Owners (besitzen Owner-Rechte außer Umbenennen/Löschen).

```prisma
model GroupDeputy {
  groupId String
  userId  String

  @@id([groupId, userId])
}
```

---

### Album

```prisma
model Album {
  id        String   @id @default(cuid())
  name      String
  groupId   String
  createdBy String   // userId
  createdAt DateTime @default(now())
}
```

---

### AlbumContributor

Erweiterte Bearbeitungsrechte für ein Album (neben dem Ersteller).

```prisma
model AlbumContributor {
  albumId String
  userId  String

  @@id([albumId, userId])
}
```

---

### Photo

```prisma
model Photo {
  id          String   @id @default(cuid())
  uploaderId  String
  groupId     String
  filename    String
  path        String   @unique   // Pfad in MinIO
  description String?
  createdAt   DateTime @default(now())
}
```

---

### PhotoAlbum

Verbindet Photos und Albums (n:m).

```prisma
model PhotoAlbum {
  photoId String
  albumId String

  @@id([photoId, albumId])
}
```

---

### Comment

```prisma
model Comment {
  id        String   @id @default(cuid())
  photoId   String
  userId    String
  content   String
  createdAt DateTime @default(now())
}
```

---

### Like

```prisma
model Like {
  id        String   @id @default(cuid())
  photoId   String
  userId    String
  createdAt DateTime @default(now())

  @@unique([photoId, userId])   // Jeder User kann ein Foto nur einmal liken
}
```

---

### GroupBackup

Metadaten zu gespeicherten ZIP-Backups (Foto-Archiv einer aufgelösten oder gelöschten Gruppe).

```prisma
model GroupBackup {
  id            String   @id @default(cuid())
  zipKey        String   @unique   // Geheimnis im Download-URL
  groupId       String?            // Null, wenn Gruppe bereits gelöscht
  groupName     String
  deletedByName String?
  photoCount    Int      @default(0)
  sizeBytes     BigInt?
  createdAt     DateTime @default(now())
  linkExpiry    DateTime            // Ablauf nach 30 Tagen

  @@map("group_backups")
}
```

---

### Notification

```prisma
model Notification {
  id         String   @id @default(cuid())
  userId     String
  type       String   // deputyAdded | photoCommented | newPhoto | system | …
  title      String
  body       String
  entityId   String?  // ID des betroffenen Objekts (Photo, Group, Album, …)
  entityType String?  // "group" | "photo" | "album" | "external"
  imageUrl   String?  // Optionale Vorschaubild-URL
  entityUrl  String?  // Optionale Navigations-URL
  read       Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@index([userId, read])
  @@index([userId, createdAt(sort: Desc)])
}
```

---

### NotificationPreference

Nutzerspezifische Einstellungen, welche Benachrichtigungstypen in-app bzw. per E-Mail zugestellt werden sollen. Wird automatisch beim ersten Zugriff angelegt.

Spalten folgen dem Schema:
- `inApp_<typ>` – Standard: `true`
- `email_<typ>` – Standard: je nach Typ (`true` bei wichtigen Ereignissen wie `deputyAdded`, `groupDeleted`; sonst `false`)

```prisma
model NotificationPreference {
  userId String @id
  // Beispiele:
  inApp_photoCommented  Boolean @default(true)
  email_photoCommented  Boolean @default(false)
  inApp_deputyAdded     Boolean @default(true)
  email_deputyAdded     Boolean @default(true)
  // ... weitere Felder im Schema
}
```

---

## Reporting-Views

Diese Views liegen bewusst nur als SQL-Migration vor und nicht als Prisma-Modelle im Schema.

### Normale Views

- `vw_user_groups`: Live-Sicht auf User-Gruppen inklusive Owner-/Deputy-Status sowie Gruppen-Counts
- `vw_user_overview`: Zentrale User-Übersicht mit Stammdaten und aggregierten Counts
- `vw_user_notifications_stats`: Notification-Statistiken je User, inklusive unread und Typ-Verteilung

### Materialized Views

- `mv_user_activity_stats`: Aktivitätskennzahlen je User, z. B. Uploads, Kommentare, Likes und letzte Aktivität
- `mv_group_overview`: Aggregierte Gruppenübersicht für Reporting und Admin-Dashboards

Materialized Views müssen manuell aktualisiert werden:

```sql
REFRESH MATERIALIZED VIEW mv_user_activity_stats;
REFRESH MATERIALIZED VIEW mv_group_overview;
```

---

## Migrationen

| Migration | Beschreibung |
|---|---|
| `20260416095944_init` | Initiales Schema: User, Group, GroupMember, Photo, Album, PhotoAlbum, Comment, Like |
| `20260416101506_add_oidc_support` | OIDC-Felder am User, Refresh-Token-Tabelle |
| `20260417132645_photo_multi_album` | Photo→Album n:m (PhotoAlbum Join-Tabelle ersetzt direkten FK) |
| `20260419111845_album_contributors` | AlbumContributor (erweiterte Bearbeitungsrechte) |
| `20260419130737_add_group_deputies` | GroupDeputy + `createdBy` (Owner) an Group |
| `20260419133307_add_group_backups` | GroupBackup-Modell (ZIP-Archiv-Metadaten) |
| `20260419143604_add_backup_deleted_by` | `deletedByName` an GroupBackup |
| `20260419162052_add_notifications` | Notification + NotificationPreference |
| `20260427194000_add_group_member_limit_lock` | `Group.maxMembers` (optional) + `Group.memberLimitLocked` (default `false`) |
| `20260419170520_update_notif_defaults` | Standard-Werte für Benachrichtigungs-Präferenzen |
| `20260420100000_add_imageurl_entityurl_system_notif` | `imageUrl`, `entityUrl` an Notification; `system`-Typ |
| `20260427153000_add_reporting_views` | Reporting-Views und Materialized Views für User- und Gruppen-Auswertungen |
| `20260421100000_add_display_name_field` | `displayName` am User |
| `20260423120000_add_user_migration_metadata` | `migrationStatus`, `migratedAt` am User |
| `20260427123000_add_group_invite_visibility` | `inviteCodeVisibleToMembers` an Group |
| `20260427153000_add_reporting_views` | Reporting-Views und Materialized Views für User- und Gruppen-Auswertungen |

