<div align="center">

![Franks Fotoalbum Logo](backend/public/media/icon-128x128.png)

# 🖼️ Franks Fotoalbum

**Deine sichere, selbst gehostete Familien-Fotogalerie**

Teile Fotos mit der Familie, organisiere sie in Alben, kommentiere und like was dir gefällt – alles auf deinem eigenen Server.

[🌐 Demo](#demo) • [✨ Features](#features) • [🚀 Starten](#schnellstart) • [📚 Docs](#dokumentation)

---

</div>

## ✨ Hauptfeatures

### 📸 **Gruppen & Alben**
- **Private Familiengruppen** mit Einladungscode – einfach Code teilen, fertig
- **Flexible Alben** – Fotos können in mehreren Alben gleichzeitig sein
- **Rechte-Management** – Bestimme, wer Fotos hinzufügen, bearbeiten oder löschen darf
- **Sichere Übergabe** – Wenn du die Gruppe nicht mehr verwalten möchtest, ernennen Sie einen Vertreter

### 💬 **Interaktion & Austausch**
- **Kommentare & Likes** – Diskutiere über Fotos, reagiere mit Herz ❤️
- **Echtzeit-Benachrichtigungen** – Sofort informiert, wenn's was Neues gibt
- **Mentions & Feedback** – Wissen, dass andere deine Bilder sehen und mögen

### 🔒 **Sicher & Privat**
- **Dein eigener Server** – Keine Daten bei Google, Facebook oder Amazon
- **OIDC-Login** – Integration mit deinem bestehenden Passwort-Manager
- **Ende-zu-Ende Kontrolle** – Du entscheidest, was sichtbar ist

### 📱 **Überall Zugriff**
- **PWA (App im Browser)** – Funktioniert offline, kein App Store nötig
- **Dark Mode** – Nachts augenfreundlich
- **Mobil optimiert** – Perfekt auf dem Handy
- **Floating Upload-Shortcut** – Runder Plus-Button unten rechts mit Notch/Safe-Area-Support und direktem Upload-Dialog

### 🎯 **Admin-Features**
- **Backup-Management** – Automatische Sicherungen bei Gruppenauflösungen
- **Benutzerverwaltung** – Überblick über alle Accounts
- **Broadcast** – Wichtige Mitteilungen an alle Nutzer
- **Version & Changelog** – Version in der Sidebar, Changelog für alle, Einträge erstellen/bearbeiten/löschen nur für Admins

---

## 🚀 Schnellstart

### Installation (Docker)

```bash
# Repository klonen
git clone https://github.com/lxvongobsthndlE/franksPhotoalbum.git
cd franksPhotoalbum

# Umgebung einrichten
cp .env.example .env.local
# → .env.local öffnen und ausfüllen

# Starten
docker-compose up -d
```

**Fertig!** Die App läuft unter `http://localhost:3000`

### Manuelle Installation

```bash
cd backend
npm install
cp ../.env.example .env.local   # Variablen befüllen
npx prisma migrate dev
node --env-file .env.local src/app.js
```

### Info-Karten als PNG generieren (1080x1080)

Im Backend gibt es ein Script fuer quadratische Info-Grafiken (z. B. Releasenotes, Ankuendigungen, Tipps).

```bash
cd backend
npm install
npm run generate:infocards
```

Standard-Eingabe und Ausgabe:
- Input JSON: `scripts/infocards.example.json`
- Output Ordner: `generated/infocards`

Eigene Pfade/Format:

```bash
node scripts/generate-infocards.mjs --input scripts/meine-karten.json --output generated/infos --size 1080 --app-icon public/media/icon-512x512.png
```

Wichtige Felder pro Datensatz:
- `name`, `variant` (`update`, `announcement`, `tip`), `icon`, `title`, `subtitle`, `bullets` (Array), `footer`

Anpassungen:
- Farben pro Variante in `backend/scripts/generate-infocards.mjs` unter `DESIGN_CONFIG.variants`
- Typografie in `backend/scripts/generate-infocards.mjs` unter `DESIGN_CONFIG.typography`

---

## 🛠️ Technologie-Stack

| Bereich | Technologie |
|---|---|
| Backend | Fastify 4 (Node.js 22, ES Modules) |
| Datenbank | PostgreSQL 16 + Prisma 5 |
| Objektspeicher | MinIO (S3-kompatibel) |
| Authentifizierung | OIDC via Authentik + JWT |
| Frontend | Vanilla JS (SPA, kein Framework) |
| Containerisierung | Docker + Docker Compose |

---

## 💡 Warum Franks Fotoalbum?

✅ **Datenschutz** – Keine Spionage, keine zielgerichteten Werbeanzeigen  
✅ **Kontrolliert** – Du verwaltest, wer sieht was  
✅ **Kostenlos & Open Source** – Selbst gehostet, keine Abo-Fallen  
✅ **Einfach** – Kein technisches Know-how nötig  
✅ **Zuverlässig** – Funktioniert auf deinem Server  

---

## 📚 Dokumentation

### Für Nutzer & Administratoren
- [**Setup & Deployment**](docs/setup.md) – Installation, Docker, Reverse Proxy, Umgebungsvariablen
- [**Gruppen & Alben**](docs/gruppen-und-alben.md) – Wie man Gruppen gründet, Alben erstellt, Rechte verwaltet
- [**Benachrichtigungen**](docs/benachrichtigungen.md) – Echtzeit-Updates & E-Mail-Versand konfigurieren

### Für Entwickler
- [**Authentifizierung**](docs/authentifizierung.md) – OIDC-Flow, JWT-Tokens, Rolle-Management
- [**API-Referenz**](docs/api-referenz.md) – Alle REST-Endpunkte mit Beispielen
- [**Datenbankschema**](docs/datenbankschema.md) – Prisma-Modelle, Beziehungen
- [**Frontend & PWA**](docs/frontend-pwa.md) – SPA-Struktur, Service Worker, Bildkomprimierung

---

## 🌟 Use Cases

🎉 **Familienalbum** – Hochzeiten, Urlaube, Baby-Fotos mit der ganzen Familie teilen  
🏕️ **Gruppenaktivitäten** – Vereinsfotos, Freundeskreis, Hobby-Clubs  
👪 **Mehrere Generationen** – Großeltern, Eltern, Kinder auf einem System  
📸 **Projekte** – Baufortschritt dokumentieren, Renovierungen tracken  

---

## 📝 Lizenz

Dieses Projekt ist open source. Siehe [LICENSE](LICENSE) für Details.

---

## 🤝 Support & Community

Fragen? Probleme?  
→ [Issues auf GitHub](https://github.com/lxvongobsthndlE/franksPhotoalbum/issues)

---

<div align="center">

**Gebaut mit ❤️ für Familien**

[GitHub](https://github.com/lxvongobsthndlE/franksPhotoalbum) • [Dokumente](docs/)

</div>