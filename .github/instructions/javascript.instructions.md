---
description: "Projektregeln fuer JavaScript im Fotoalbum-Repo: Backend API, Prisma, Auth/OIDC, PWA, Skripte, Testing und Doku. Verwenden bei allen Codeaenderungen in Backend, Frontend-Skripten und Projektdokumentation."
applyTo: "backend/src/**/*.js,backend/public/script/**/*.js,backend/scripts/**/*.mjs,backend/prisma/**/*.prisma,docs/**/*.md"
---

# GitHub Copilot Instructions

Diese Instructions sind auf dieses Repository zugeschnitten. Ziel ist konsistenter, wartbarer Code fuer Backend-API, PWA-Frontend und Projekt-Skripte.

## Kontext

- Projekt: Fotoalbum mit Fastify-Backend, Prisma, OIDC/JWT Auth, PWA-Frontend und Node-Skripten
- Sprache: JavaScript (ES Modules)
- Backend: backend/src (Routen, Middleware, Auth, Utils)
- Datenbank: Prisma Schema + Migrationen in backend/prisma
- Frontend: statische Assets in backend/public (script, style, media)
- Dokumentation: docs/*.md

## Allgemeine Regeln

- Bevorzuge klare, kleine, benannte Funktionen statt verschachtelter anonymer Closures.
- Lesbarkeit ist wichtiger als cleverer, kompakter Code.
- Nutze bei nicht-trivialer Logik kurze JSDoc-Kommentare (Parameter, Rueckgabe, Seiteneffekte).
- Halte dich an das bestehende Formatierungsniveau (Prettier/Projektstil), keine unnoetigen Stil-Diffs.
- Halte Aenderungen minimal-invasiv und konsistent mit bestehendem Stil.
- Keine neuen Architektur-Schichten einfuehren, wenn das Problem im bestehenden Muster loesbar ist.
- Keine Secrets, Tokens, Keys oder sensible Nutzerdaten in Code, Logs oder Doku ausgeben.
- Hardcodierte Werte vermeiden; stattdessen ENV/Config verwenden.

## Repo-spezifische Struktur

Bei neuen Features bestehende Struktur erweitern, nicht neu erfinden:

```text
backend/
  src/
    app.js
    routes/
    middleware/
    auth/
    utils/
  prisma/
    schema.prisma
    migrations/
  public/
    index.html
    script/
    style/
  scripts/
docs/
```

## Patterns to Follow

- Reuse vor Rewrite: vorhandene Middleware, Utils und Routenmuster bevorzugen.
- Input-Validierung in API-Endpunkten nicht auslassen; auf bestehende Validierungslogik aufsetzen.
- Fehlerbehandlung konsistent mit klaren Statuscodes und nachvollziehbaren Fehlermeldungen.
- Logging in Produktionspfaden sparsam und datenschutzkonform; in Dev-Kontexten hilfreich und konkret.

## Patterns to Avoid

- Keine Implementierung ohne zumindest Basis-Tests bei relevanter Logik.
- Kein unkontrollierter globaler Zustand in Backend oder Frontend-Skripten.
- Keine stillen Aenderungen an API-Vertraegen ohne Doku- und Consumer-Abgleich.
- Keine Repo-fremden Boilerplates oder unnoetig neue Libraries ohne klaren Mehrwert.

## Backend (Fastify + Prisma)

- API-Logik gehoert in passende Datei unter backend/src/routes.
- Route-Handler sollen Eingaben validieren und saubere HTTP-Statuscodes verwenden.
- Fehlerpfade explizit behandeln (z. B. 400, 401, 403, 404, 409, 500).
- Prisma-Zugriffe so schreiben, dass sie mit dem bestehenden Schema kompatibel sind.
- Bei Schema-Aenderungen immer passende Prisma-Migration vorsehen und bestehende Daten beruecksichtigen.
- Sicherheitsrelevante Endpunkte mit vorhandener Auth-Middleware und Rollen-/Gruppenlogik absichern.

## Auth, Gruppen, Benachrichtigungen

- Bestehende Auth-Mechanismen respektieren (backend/src/auth, backend/src/middleware/auth.js, OIDC-Utilities).
- Bei Gruppen-/Album-Aenderungen auf Contributor/Deputy/Admin-Berechtigungen achten.
- Benachrichtigungslogik zentral und konsistent ueber bestehende Notification-Utilities/Routen erweitern.

## Frontend (PWA)

- Bestehende Struktur in backend/public/script und backend/public/style beibehalten.
- Kein Framework-Refactor (z. B. auf React) ohne explizite Anforderung.
- UI-Aenderungen muessen mit vorhandenem Auth-Flow, Service Worker und API-Vertraegen kompatibel sein.
- Neue UI-Logik als wiederverwendbare, klar abgegrenzte Funktionen statt unstrukturierter Inline-Blocks.

## Skripte und Tools

- Skripte in backend/scripts sind produktiv relevant (Migration, Restore, Crawling, Infocards).
- Skript-Aenderungen idempotent und fehlertolerant gestalten.
- Keine destruktiven Operationen ohne explizite Guardrails (Dry-Run, klare Parameter, Warnhinweise).

## Testing Guidelines

- Bei Aenderungen an Kernlogik, Berechtigungen oder Datenbankzugriffen immer Tests mitliefern oder bestehende Tests anpassen.
- Bevorzugt werden reproduzierbare Unit- oder Integrations-Tests statt rein manueller Verifikation.
- Externe Abhaengigkeiten in Tests mocken/stubben, damit Tests stabil und schnell bleiben.
- Bei Bugfixes nach Moeglichkeit einen Regressionstest ergaenzen.

## Iteration & Review

- Copilot-Vorschlaege immer kritisch gegen bestehende Fachlogik und Berechtigungsregeln pruefen.
- Bei groesseren Aenderungen in kleinen, nachvollziehbaren Schritten arbeiten statt in einem grossen Wurf.
- Vor Abschluss pruefen: API-Vertraege, Fehlercodes, Migrationen, Doku und Seiteneffekte auf bestehende Flows.
- Wenn Vorgaben nicht eingehalten werden, Prompt praezisieren und mit repo-spezifischem Kontext nachschaerfen.
- Copilot-Output ist ein Entwurf und muss vor Merge aktiv reviewed und angepasst werden.

## Beispiel-Prompts (Projektbezogen)

- Copilot, erweitere die Route in backend/src/routes/groups.js um eine sichere Pruefung fuer Deputy-Berechtigungen und liefere passende Fehlercodes.
- Copilot, erstelle fuer diesen Bugfix einen Integrations-Test mit Mocking der externen Abhaengigkeiten.
- Copilot, ergaenze die Prisma-Aenderung inklusive sicherer Migration und passe die passende Doku in docs an.
- Copilot, dokumentiere den neuen Endpoint mit Request, Response und Fehlerfaellen im passenden Markdown-Dokument.

## Dokumentation und Aenderungsdisziplin

- Bei API-, Auth-, Gruppen-, Notification- oder Schema-Aenderungen passende Doku unter docs mit aktualisieren.
- Bei neuen Endpunkten mindestens Zweck, Request, Response, Fehlercodes dokumentieren.
- Changelog-/Versionierungsregeln des Projekts einhalten.

## Was vermieden werden soll

- Keine pauschalen, repo-fremden Boilerplate-Muster.
- Keine Umstrukturierung auf MVC/Clean-Architecture, wenn nicht explizit angefragt.
- Keine stillen Breaking Changes in API-Responses oder Berechtigungslogik.
- Keine massenhaften Refactors ohne fachlichen Nutzen.

## Referenzen

- Node.js: https://nodejs.org/en/docs
- Fastify: https://fastify.dev/docs/latest/
- Prisma: https://www.prisma.io/docs
- MDN JavaScript: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference
