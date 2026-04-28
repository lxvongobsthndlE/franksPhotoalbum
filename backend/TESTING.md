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
