# TODO-Liste

### Features to implement

* Neuer Name! Prompt zur umsetzung: 
```
**Rename-Briefing**

1. Neuer Anzeigename (voll):  
`<NEUER_APP_NAME>`  
Beispiel: `Marias Erinnerungen`

2. Kurzer Name (PWA/Short Name):  
`<NEUER_KURZNAME>`  
Beispiel: `Erinnerungen`

3. Technischer Slug (kebab-case):  
`<NEUER_SLUG>`  
Beispiel: `marias-erinnerungen`

4. Scope der Umbenennung:  
`UI only` oder `UI + Config` oder `UI + Config + Repo/Docs komplett`

5. OIDC soll mit umbenannt werden?  
`ja/nein`  
Falls ja:
- `OIDC_ISSUER`: `<NEUE_ISSUER_URL>`
- `OIDC_CLIENT_ID`: `<NEUE_CLIENT_ID>`

6. SMTP-Absendername ändern?  
`ja/nein`  
Falls ja:
- `SMTP_FROM`: `<NEUER_SMTP_FROM_NAME>`

7. Soll der Default-Gruppenname (`<Name> Fotoalbum`) angepasst werden?  
`ja/nein`  
Falls ja:
- Neues Suffix: `<NEUES_SUFFIX>`  
Beispiel: `Erinnerungen`

8. Soll der Cache-Name/PWA-Version angepasst werden?  
`ja/nein`  
Falls ja:
- Neuer Cache-Key: `<NEUER_CACHE_KEY>`

9. Paketnamen (package.json) anfassen?  
`ja/nein`  
Falls ja:
- Root-Name: `<NEUER_ROOT_PAKETNAME>`
- Backend-Name: `<NEUER_BACKEND_PAKETNAME>`

10. Repository-/GitHub-Referenzen in Doku ebenfalls umstellen?  
`ja/nein`  
Falls ja:
- Neue Repo-URL: `<NEUE_REPO_URL>`

11. Nicht anfassen (Explizite No-Go-Liste):  
`<z.B. OIDC, package names, docker env defaults, etc.>`

12. Gewünschter Abschluss:  
`nur code changes` oder `code changes + commit` oder `code changes + commit + push`

13. Wenn Commit gewünscht:  
- Commit-Message: `<DEINE_COMMIT_MESSAGE>`
- Ziel-Branch (für Push): `<BRANCH_NAME>`
```

* Upgrade auf Node 24 !!
* Zoom in LightBox überarbeiten
* Auf mobile statt GroupSwitcher Dropdown in Header ein Group-Icon neben die Glocke, das das selbe "switch-group" modal öffnet wie der switcher.
* Modularisierung des Codes
    * Wiederverwendbare Komponenten im Frontend bauen.
        * Modals
            * Verschiedene Typen? Konfig? Was macht Sinn?
        * Helper-Funktionen zum rendern von Anzeige-Strings etc. Wo wird das benötigt? Wo ist es sinnvoll?
        * API Anbindung einheitlich pflegen um zukünftige Changes zu erleichtern
        * Wo möglich Funktionalitäten kapseln und in eigene files auslagern.
        * Kommentare! Die JS Teile sollten ordentlich nach standards im code dokumentiert sein (methoden, klassen, etc.)
        * Weiteres?
    * Wiederverwendbare Komponenten im Backend bauen.
        * Wo möglich Funktionalitäten kapseln und in eigene files auslagern.
        * Kommentare! Die JS Teile sollten ordentlich nach standards im code dokumentiert sein (methoden, klassen, etc.)
        * Weiteres?
* PWA Rework
    * Notifications that actually pop on mobile devices iOS and Android!
    * Note: Modals und co müssen für Devices mit notch nach unten verschoben werden
    * MUST HAVE: Solides ServiceWorker management -> Workarounds für testing, etc.
* Logo-Rework


### DONE
* Optionale max. Mitglieder in einer Gruppe. Nur Owner kann einstellen. (indirekt whitelist, voll nice)
    * Admins bekommen im Gruppen verwalten Modal die Möglichkeit das Gruppenlimit zu ändern und zu sperren
    * Join wird bei voller Gruppe mit Hinweis blockiert
    * Sidebar zeigt Mitgliederstand `x/n` nur bei aktivem Limit
* Sidebar öffnen on mobile soll header nicht ausgrauen
    * Während die Sidebar offen ist, sind Profil- und Benachrichtigungs-Button nicht klickbar
* Doku-Update zu Gruppenlimit, Limit-Sperre und mobilem Sidebar/Header-Verhalten
* Toast button unten rechts "+" zum hochladen
* Versionierung und Changelog
    * App version am ende der Sidebar
    * Klick auf version öffnet changelog Modal
    * Modal kann jeder öffnen
    * nur Admin kann changelog-Einträge anlegen