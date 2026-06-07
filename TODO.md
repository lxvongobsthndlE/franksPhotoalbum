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
* Notification-Texte für Medien vereinheitlichen (Foto/Video statt pauschal "Foto")
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
* State-Store aus auth.js in eigenes Regis auslagern (persist over restart + multi instance support)
* Admin Action Log im FE
* Admin Blocked Users einsehen und entblocken.
* Module Feat
    * Erweiterung der Gruppen Einstellungen um eine Sektion „Module“
        * Dort werden alle verfügbaren Module als Kacheln angezeigt
        * Aktivierbare Module (solche die ein Admin für die Gruppe freischält) können aktiviert und deaktiviert werden
        * Die Gruppeneinstellungen des Moduls werden, wenn es aktiviert ist, als weitere Sektion in den Gruppen Einstellungen angezeigt 
        * Verfügbare aber nicht aktivierbare Module sollen einen Hinweis geben, warum diese nicht aktiviert werden können (nicht freigeschaltet, paywall etc.)
        * Hidden-Module (solche die ein Admin als hidden markiert) gelten als nicht verfügbar und werden somit nur angezeigt wenn von einem Admin freigeschalten
    * Erweiterung der Admin Einstellungen um die Sektion „Module“
        * Admins sollen für jedes installierte Modul die individuellen Admineinstellungen des Moduls vornehmen können. 
        * Pro installiertem Modul folgende Einstellungen zusätzlich vornehmen können:
            * Hidden ja/nein
            * Zugewiesene Gruppen verwalten (crud)
            * MasterSwitch um das Modul global komplett zu aktivieren/deaktivieren (überschreibt Gruppeneinstellungen etc.) -> Modul wird unsichtbar selbst für Gruppen die es freigeschalten haben.
        * Es gilt: neue Module sind initial immer keiner Gruppe zugewiesen, hidden und master switch off 
    * Module Definition
        * Ein Modul hat einen Namen, einen Autor, eine verpflichtende Gruppenconfig und eine verpflichtende Adminconfig und stellt eine oder mehrere Seiten zur Verfügung 
        * Module können (wenn aktiviert) ihre Seiten in einer eigenen Kategorie direkt im neuen HOME Bereich in der Sidebar einreihen.
        * Neuer HOME Bereich in der Sidebar:
            * "Fotos" umbenennen in "Home"
            * Neue Toplevel Kategorie wie „Alle Fotos“ -> "Fotos"
            * Bei Klick klappt Drunter aus:
                * Alle Fotos, Meine Fotos, Diashow
            * Module bekommen je eine Toplevel Kategorie


### DONE
* ~~Optionale max. Mitglieder in einer Gruppe. Nur Owner kann einstellen. (indirekt whitelist, voll nice)~~
    * ~~Admins bekommen im Gruppen verwalten Modal die Möglichkeit das Gruppenlimit zu ändern und zu sperren~~
    * ~~Join wird bei voller Gruppe mit Hinweis blockiert~~
    * ~~Sidebar zeigt Mitgliederstand `x/n` nur bei aktivem Limit~~
* ~~Sidebar öffnen on mobile soll header nicht ausgrauen~~
    * ~~Während die Sidebar offen ist, sind Profil- und Benachrichtigungs-Button nicht klickbar~~
* ~~Doku-Update zu Gruppenlimit, Limit-Sperre und mobilem Sidebar/Header-Verhalten~~
* ~~Toast button unten rechts "+" zum hochladen~~
* ~~Versionierung und Changelog~~
    * ~~App version am ende der Sidebar~~
    * ~~Klick auf version öffnet changelog Modal~~
    * ~~Modal kann jeder öffnen~~
    * ~~nur Admin kann changelog-Einträge anlegen~~
* ~~Auf mobile statt GroupSwitcher Dropdown in Header ein Group-Icon neben die Glocke, das das selbe "switch-group" modal öffnet wie der switcher.~~
* ~~Einladungs-System~~
    * ~~Group-Owner können in den Gruppen-Einstellungen mehrere Invite Links zu ihrer Gruppe erstellen (max. 10).~~
    * ~~Admins können in den Admin-Einstellungen Invite-Links für jegliche Gruppen erstellen (kein Limit).~~
    * ~~Invites sollen folgende Informationen enthalten können:~~
        * ~~Gruppe(n) zu der/denen Sie einladen. (min. 1 Pflicht)~~
        * ~~Gültigkeit (optional, max. 12 Monate, wenn nicht gesetzt: unendlich)~~
        * ~~Benachrichtigung on-join (optional, Text, wird nach Beitritt via Invite-link als Notification an den User ausgespielt)~~
    * ~~Beim Aufrufen eines Invite-Links soll folgendes Verhalten passieren:~~
        * ~~User ist bereits eingeloggt -> Check link valid, Add User to group(s), send optional Notifications~~
        * ~~User ist nicht eingeloggt, hat aber Account -> User meldet sich an, Check link valid, Add User to group(s), send optional Notifications~~
        * ~~User ist nicht eingeloggt, hat keinen Account -> User registriert sich, meldet sich an, Check link valid, Add User to group(s), send optional Notifications~~
    * ~~Nur Admins können multi-group-invites erstellen (Ein Link, mehrere Gruppen).~~
    * ~~Group-Owner können immer nur für die individuelle Gruppe Links erstellen.~~
    * ~~Admins können optional eine individuelle Notification verschicken.~~
    * ~~Group-Owner können optional eine vordefinierte Notification verschicken.~~
* ~~Account Deletion and Content Export~~
    * ~~User sollen ihren eigenen Account löschen können.~~
        * ~~Neue Schaltfläche im Profil~~
        * ~~Es wird ein Bestätigungscode per Mail verschickt, der dann in der "Bist du sicher?" Maske eingegeben werden muss~~
        * ~~User können hier auch optional einen "Erben" benennen, quasi ein "transfer ownership" was jeglichen content auf die gewählte Person umschlüsselt.~~
        * ~~User sollen außerdem entscheiden dürfen ob ihr Content nach der Löschung erhalten bleiben darf (angezeigt als von "gelöscht") oder mit gelöscht wird.~~
        * ~~Wenn ein Erbe benannt wurde, gibt es keine Frage mehr, was mit dem Content nach Löschung passieren soll.~~
        * ~~Außerdem soll der Hinweis gezigt werden, dass man auch vorher seinen Content exportieren kann vor der Löschung~~
        * ~~Eine Account-Löschung ist erstmal nicht permanent. Der Account wird für 14 Tage "deaktiviert", heißt er wird vom System wie "gelöscht" behandelt, kann aber theoretisch wieder eingeloggt und damit "re-aktiviert" werden.~~
        * ~~Nach 14 Tagen wird der Account restlos gelöscht.~~
    * ~~User sollen ihren content exportieren können~~
        * ~~Neue Schaltfläche im Profil~~
        * ~~Scheduled Task der ein Zip mit dem gesamten Content des Users erstellt und ihm einen Downloadlink per Mail zuschickt.~~
        * ~~Erzeugung Zip darf Betriebsfluss nicht negativ beeinflussen!~~
        * ~~Endpunkt muss striktes rate-limiting haben (Vorschlag: 1x per day) um unnötige Erzeugung von Exporten zu verhindern.~~
        * ~~Die Zip's sollen eine Lebenszeit von 1 Monat haben.~~
        * ~~Content exports sollen, genau wie Backups, den Admins im "Backups verwalten" Menü angezeigt werden. (Funktionen: Download, Link erneuern, Delete), das Menü kann dafür entsprechend umbenannt werden~~
* ~~Admins sollen Einladungscode in Gruppen immer sehen dürfen (auch wenn in Group-Settings anders konfiguriert)~~
* ~~Blocked Member Verwaltung! Entblocken, Grund ansehen, wer hat geblockt ansehen. Dafür nötig: Verpflichtende ANgabe von Grund beim Blocken.~~
