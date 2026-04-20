# Frontend & PWA

## Überblick

Das Frontend ist eine **Vanilla-JS-Single-Page-App (SPA)** ohne Build-Schritt. Alle Dateien liegen unter `backend/public/` und werden vom Fastify-Server statisch ausgeliefert.

```
backend/public/
  index.html          ← Einzige HTML-Datei (SPA-Shell)
  manifest.json       ← PWA-Manifest
  script/
    main.js           ← Haupt-App-Logik
    auth-oidc.js      ← Auth, API-Client, Token-Management
    sw.js             ← Service Worker (Cache-Strategie)
  style/
    main.css          ← Alle Styles (kein Framework)
  media/              ← Icons, Logos
```

---

## Authentifizierung im Frontend (`auth-oidc.js`)

### Token-Speicherung

| Token | Speicherort | Lebensdauer |
|---|---|---|
| Access Token | `sessionStorage` | 15 Minuten |
| Refresh Token | HttpOnly-Cookie | 7 Tage (nur serverseitig lesbar) |

### API-Aufruf-Funktion

```js
import { apiCall } from './auth-oidc.js';

// GET
const data = await apiCall('/api/groups/my');

// POST mit Body
const result = await apiCall('/api/groups/join', 'POST', { code: 'A3F9KZ' });

// DELETE
await apiCall(`/api/comments/${id}`, 'DELETE');
```

`apiCall` setzt automatisch den `Authorization`-Header und erneuert den Token bei `401`.

### Auto-Refresh

```js
startTokenRefreshTimer(); // alle 14 Minuten POST /api/auth/refresh
```

### Foto-URLs

Da `<img src="...">` keine Header senden kann, wird der Token als Query-Parameter angehängt:

```js
img.src = `/api/photos/${id}/file?t=${accessToken}`;
```

### OIDC-Flow

```js
// Login starten
startOIDCLogin(); // → GET /api/auth/login → Redirect zu Authentik

// Callback verarbeiten (automatisch bei Rückkehr zur App)
await handleOIDCCallback(code, state);
```

---

## Routing (SPA)

Die App hat keine separate Router-Bibliothek. Navigation erfolgt über **Hash-basiertes Routing** oder durch dynamisches Anzeigen/Verstecken von Sektionen in `index.html`.

---

## Toast-Benachrichtigungen

Kurze Rückmeldungen für eigene Aktionen (z. B. Foto hochgeladen, Gruppe beigetreten):

```js
import { toast } from './main.js';

toast('Foto erfolgreich hochgeladen', 'success');
toast('Fehler beim Hochladen', 'error');
toast('Zur Gruppe hinzugefügt', 'info');
```

**Darstellung:** Fixiert oben rechts, automatisch nach 3,6 Sekunden ausgeblendet.

---

## Echtzeit-Benachrichtigungen (SSE)

Das Frontend öffnet beim Login eine SSE-Verbindung und zeigt eingehende Benachrichtigungen als Glocken-Badge an:

```js
const source = new EventSource(`/api/notifications/stream?token=${accessToken}`);

source.addEventListener('notification', (e) => {
  const notif = JSON.parse(e.data);
  // Badge aktualisieren, Glocken-Icon updaten
});
```

---

## Progressive Web App (PWA)

### Manifest (`manifest.json`)

Definiert App-Name, Icons, Startseite und Anzeigemodus (`standalone`). Ermöglicht „Zum Homebildschirm hinzufügen" auf Mobilgeräten.

### Service Worker (`sw.js`)

Implementiert eine **Cache-First-Strategie** für statische Assets:

- JS, CSS, Bilder und das App-Manifest werden beim ersten Laden gecacht
- Folgeaufrufe werden aus dem Cache bedient (Offline-Fähigkeit für die App-Shell)
- API-Anfragen (`/api/...`) werden **nicht gecacht** – immer live vom Server

```js
// Cache-Name (im Service Worker definiert)
const CACHE_NAME = 'fotoalbum-v1';
```

### Dark Mode

Automatisch aktiv über CSS-Media-Query:

```css
@media (prefers-color-scheme: dark) {
  :root { --bg: #1a1410; --text: #f0ebe4; /* … */ }
}
```

Kein manueller Toggle – folgt der Systemeinstellung.

---

## Bildkomprimierung (Upload)

Vor dem Upload wird jedes Bild clientseitig komprimiert:

- **Format:** JPEG
- **Maximale Breite/Höhe:** 1400 px (Seitenverhältnis erhalten)
- **Qualität:** ~85 %

Dies reduziert die übertragene Datenmenge deutlich, ohne sichtbaren Qualitätsverlust.

```js
// Intern in main.js via Canvas API
const blob = await compressImage(file, 1400, 0.85);
```
