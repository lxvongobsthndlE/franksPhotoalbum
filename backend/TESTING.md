# Testing Guide — Fotoalbum Backend

## Quick Start

```bash
# Tests lokal laufen lassen
npm test

# Mit UI Dashboard
npm run test:ui

# Mit Coverage Report
npm run test:coverage

# Single Test-Datei
npm test -- auth.test.js

# Watch Mode (für Development)
npm test -- --watch
```

## Test-Philosophie

Unsere Tests fokussieren auf **echte Business-Logik**, nicht auf oberflächliche Mocks:

✅ **Was wir testen:**

- Permissions & Authorization (Owner/Admin/Member)
- Token-Management (JWT, Expiry, Payload)
- Notification-System (SSE, Email, Preferences)
- Error Handling & HTTP-Status
- Edge Cases & Race Conditions
- Input Validation & Security

❌ **Was wir nicht testen:**

- Externe Libraries (jest/vitest/prisma APIs)
- DB-Queries ohne Kontext (nur mit Mocking)
- UI/Frontend Logic (gehört zu PWA-Tests)

## Test-Struktur

```
backend/src/__tests__/
├── fixtures/
│   └── index.js          # Test-Daten Builder (Users, Groups, Albums, etc.)
├── mocks/
│   └── index.js          # Realistic Mocks (Prisma, Fastify JWT, Nodemailer)
├── auth.test.js          # JWT, Session, Token-Management
├── notifications.test.js # SSE, Email, Preferences
└── permissions.integration.test.js  # Real API Scenarios
```

## Fixtures — Wiederverwendbare Test-Daten

```javascript
import { createMockUser, createMockGroup, createMockAlbum } from '../fixtures/index.js';

const user = createMockUser({ id: 'custom-id', email: 'test@example.com' });
const group = createMockGroup({ name: 'My Group' });
const album = createMockAlbum({ groupId: group.id });
```

**Verfügbar:**

- `createMockUser()` — User mit Standard-Feldern
- `createMockGroup()` — Group (owner, description, etc.)
- `createMockAlbum()` — Album (name, groupId, etc.)
- `createMockPhoto()` — Photo (filename, uploadedBy, etc.)
- `createMockNotification()` — Notification (type, title, body, etc.)
- `createMockNotificationPreference()` — Email/SSE Preferences

## Mocks — Realistic Test Doubles

```javascript
import {
  createMockPrismaClient,
  createMockFastify,
  createMockRequest,
  createMockReply,
} from '../mocks/index.js';

const prisma = createMockPrismaClient();
prisma.user.findUnique.mockResolvedValue(user);

const fastify = createMockFastify();
const token = fastify.jwt.sign({ id: 'user-123' }, { expiresIn: '15m' });
```

**Verfügbar:**

- `createMockPrismaClient()` — All Prisma Models
- `createMockFastify()` — JWT Sign/Verify
- `createMockRequest()` — HTTP Request mit User
- `createMockReply()` — HTTP Response
- `createMockTransporter()` — Nodemailer Mock
- `createMockSseReply()` — SSE Stream Mock

## Test-Beispiele

### 1. Permission Check

```javascript
it('should allow group owner to edit album', async () => {
  const owner = createMockUser({ id: 'owner-123' });
  const album = createMockAlbum();

  prisma.album.findUnique.mockResolvedValue(album);
  prisma.groupMember.findUnique.mockResolvedValue({
    userId: 'owner-123',
    role: 'owner',
  });

  const canEdit = await checkEditPermission(prisma, owner, album.id);
  expect(canEdit).toBe(true);
});
```

### 2. JWT Token Validation

```javascript
it('should generate access token with 15m expiry', () => {
  const token = fastify.jwt.sign({ id: 'user-123', type: 'access' }, { expiresIn: '15m' });

  expect(token).toBeDefined();
  expect(fastify.jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ type: 'access' }), {
    expiresIn: '15m',
  });
});
```

### 3. Notification Preferences

```javascript
it('should respect email preference settings', async () => {
  const prefs = createMockNotificationPreference({
    email_photoCommented: false,
  });
  prisma.notificationPreference.findUnique.mockResolvedValue(prefs);

  await createNotification(prisma, {
    userId: 'user-456',
    type: 'photoCommented',
    title: 'Comment',
    body: 'Someone commented',
  });

  // Email sollte nicht gesendet werden (wird per resolveEmailAddress geprüft)
  expect(prisma.notification.create).toHaveBeenCalled();
});
```

## Running Tests mit Conditions

### Nur spezifische Tests

```bash
npm test -- auth.test.js
npm test -- --grep "JWT"
npm test -- --grep "Permission"
```

### Watch Mode (Development)

```bash
npm test -- --watch
```

### Coverage Report

```bash
npm test -- --coverage
```

## Coverage Ziele

Aktuell angestrebt:

- **Lines:** 70%
- **Functions:** 70%
- **Branches:** 60%
- **Statements:** 70%

```bash
# Coverage Report öffnen
npm run test:coverage
# → coverage/index.html
```

---

## Manuelle Testfälle — Einladungslinks

Diese Szenarien müssen manuell im Browser bzw. per HTTP-Client (z. B. Bruno, Postman oder curl) geprüft werden.

### Voraussetzungen

- Backend läuft lokal (`npm run dev`)
- Mindestens zwei Nutzeraccounts vorhanden (Owner A, User B)
- Mindestens eine Gruppe existiert, deren Owner Account A ist

---

### TC-01 — Invite erstellen (Owner, einfach)

**Ziel:** Owner kann einen einfachen Link ohne Ablauf und ohne Limit erstellen.

1. Als Owner A einloggen
2. Gruppe öffnen → Einstellungen → Einladungslinks
3. Keinen Ablauf, keine Nutzungsanzahl setzen
4. „Erstellen" klicken
5. **Erwartung:** Link erscheint in der Liste mit kopierbarer URL (`/?invite=…`)

---

### TC-02 — Invite-Vorschau (unauthenticated)

**Ziel:** Invite-Preview ist ohne Login aufrufbar.

1. Kopierten Link in einem neuen (ausgeloggten) Browser-Tab öffnen
2. **Erwartung:** Seite zeigt „Du wurdest eingeladen" mit Gruppenname, Login-Button ist sichtbar
3. Kein 401/403

---

### TC-03 — Redeem nach OIDC-Login (happy path)

**Ziel:** User B wird nach Login automatisch der Gruppe hinzugefügt.

1. Invite-Link (aus TC-01) im privaten/ausgeloggten Tab öffnen
2. Auf Login-Button klicken
3. Als User B einloggen (OIDC)
4. **Erwartung:** Nach Callback-Redirect ist User B Mitglied der Gruppe; ggf. Willkommens-Benachrichtigung vorhanden

---

### TC-04 — Redeem direkt per API (bereits eingeloggt)

**Ziel:** Eingeloggter User kann Link per Klick einlösen ohne erneuten Login.

1. Als User B einloggen
2. Invite-Link (`/?invite=TOKEN`) öffnen
3. **Erwartung:** Vorschau wird angezeigt, „Beitreten"-Button erscheint
4. Button klicken
5. **Erwartung:** Erfolgs-Meldung, User B ist Mitglied der Gruppe

---

### TC-05 — Idempotentes Redeem

**Ziel:** Zweimaliges Einlösen erhöht `useCount` nicht doppelt.

1. User B löst denselben Link nochmals ein (Button oder API `POST /api/invites/redeem/:token`)
2. **Erwartung:** Response enthält `status: already_member` oder `alreadyMemberGroups` mit der Gruppe; `useCount` bleibt unverändert

---

### TC-06 — Ablaufdatum in der Vergangenheit (API-Validierung)

**Ziel:** Server lehnt Erstellung mit vergangenem Datum ab.

```bash
POST /api/invites
{ "groupIds": ["<id>"], "expiresAt": "2000-01-01T00:00:00.000Z" }
```

**Erwartung:** `400 Bad Request`, Fehlermeldung „expiresAt muss in der Zukunft liegen"

---

### TC-07 — Abgelaufener Link

**Ziel:** Abgelaufener Link wird mit 410 abgelehnt.

1. Invite mit `expiresAt` in wenigen Minuten erstellen
2. Warten bis abgelaufen (oder Datum direkt in DB setzen)
3. Link öffnen
4. **Erwartung:** `GET /api/invites/preview/:token` → `410 Gone`, UI zeigt „Link abgelaufen"

---

### TC-08 — Nutzungslimit erschöpft

**Ziel:** Link mit `maxUses: 1` kann nur von einem User eingelöst werden.

1. Invite mit `maxUses: 1` erstellen
2. User B löst Link ein → Erfolg
3. User C versucht denselben Link einzulösen
4. **Erwartung:** `410 Gone`, `code: invite_exhausted`

---

### TC-09 — Deaktivierter Link (Revoke)

**Ziel:** Owner kann Link widerrufen, danach ist er nicht mehr nutzbar.

1. Invite aus Liste löschen (DELETE-Button)
2. **Erwartung:** Link verschwindet aus Liste
3. Link trotzdem im Browser öffnen
4. **Erwartung:** `404 Not Found`, UI zeigt „Link ungültig"

---

### TC-10 — Owner-Limit (10 aktive Links)

**Ziel:** Owner kann nicht mehr als 10 aktive Links pro Gruppe erstellen.

1. 10 Links für dieselbe Gruppe erstellen
2. 11. Link versuchen
3. **Erwartung:** `409 Conflict`, `code: owner_active_invite_limit`

---

### TC-11 — Owner versucht Multi-Gruppe

**Ziel:** Owner darf nur 1 Gruppe pro Invite angeben.

```bash
POST /api/invites
{ "groupIds": ["<id1>", "<id2>"] }
```

**Erwartung:** `403 Forbidden`, `code: owner_single_group_only`

---

### TC-12 — Admin-Invite mit mehreren Gruppen

**Ziel:** Admin kann Invite für mehrere Gruppen gleichzeitig erstellen.

1. Als Admin einloggen → Admin-Panel → Einladungen
2. Zwei Gruppen auswählen, optionalen Benachrichtigungstext eingeben
3. Erstellen
4. **Erwartung:** Link erscheint, Preview-Endpoint gibt beide Gruppen zurück
5. User B löst Link ein → Mitglied in beiden Gruppen

---

### TC-13 — Invite-Preview für nicht-existenten Token

```bash
GET /api/invites/preview/GIBBERISH123
```

**Erwartung:** `404 Not Found`, `code: invite_not_found`

---

## CI/CD Integration

GitHub Actions laufen automatisch auf PR:

```yaml
# .github/workflows/compliance.yml
- Test execution mit coverage upload
- ESLint + Prettier Format-Check
- Prisma Schema Validation
```

Alle Tests müssen **grün** sein vor Merge.

## Häufige Probleme

### "Module not found"

```bash
# Stelle sicher, dass du im backend/ Ordner bist
cd backend
npm test
```

### "Prisma Client not instantiated"

```javascript
// Richtig: Mock Prisma
import { createMockPrismaClient } from '../mocks/index.js';
const prisma = createMockPrismaClient();

// Falsch: Real Prisma in Tests
import { PrismaClient } from '@prisma/client';
```

### "Timeout in async tests"

```javascript
// Timeout erhöhen für langsame Operations
it('should handle slow operations', async () => {
  // ...
}, 10000); // 10 seconds
```

## Best Practices

1. **Verwende Fixtures** — Nicht hart-gecoded Test-Daten

   ```javascript
   // ✅ Gut
   const user = createMockUser({ email: 'test@example.com' });

   // ❌ Schlecht
   const user = { id: 'user-123', email: 'test@example.com', ... };
   ```

2. **Mock nur External Dependencies** — Nicht Interno-Logik

   ```javascript
   // ✅ Gut — Mock Prisma (External)
   prisma.user.findUnique.mockResolvedValue(user);

   // ❌ Schlecht — Mock interne Logik
   checkPermission.mockResolvedValue(true);
   ```

3. **Test Real Scenarios** — Nicht Implementation Details

   ```javascript
   // ✅ Gut
   it('should allow owner to edit album', async () => {
     // Real permission check
   });

   // ❌ Schlecht
   it('should call findUnique', async () => {
     expect(prisma.album.findUnique).toHaveBeenCalled();
   });
   ```

4. **Beschreibe Expected Behavior** — Nicht "what the code does"

   ```javascript
   // ✅ Gut
   it('should deny access to non-members', () => {});

   // ❌ Schlecht
   it('should return false when groupMember is null', () => {});
   ```

## Test-Erweiterung

Um neue Tests hinzuzufügen:

1. **Entsprechende Test-Datei wählen** oder neue erstellen

   ```bash
   backend/src/__tests__/
   ├── auth.test.js
   ├── notifications.test.js
   ├── permissions.integration.test.js
   └── yourmodule.test.js (NEW)
   ```

2. **Fixtures/Mocks** verwenden

   ```javascript
   import { createMockUser, createMockPrismaClient } from '../index.js';
   ```

3. **Real Business Logic testen**

   ```javascript
   it('should validate permission rule X', async () => {
     // Your test
   });
   ```

4. **Tests lokal prüfen**
   ```bash
   npm test -- yourmodule.test.js
   ```

## Weitere Ressourcen

- [Vitest Docs](https://vitest.dev/)
- [Testing Library Best Practices](https://testing-library.com/docs/queries/about)
- [Prisma Testing](https://www.prisma.io/docs/orm/prisma-client/testing)

---

**Fragen?** Schau in die Test-Dateien für Beispiele oder frag im Team! 🚀
