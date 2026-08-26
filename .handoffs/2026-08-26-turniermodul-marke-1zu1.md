# Turniermodul 1:1 nach Artefakt — Nacharbeit

Stand 2026-08-26. Vorgänger-Session: Job `20260825-213923-161`, Branch
`fix/tourney-marke`, neun Etappen committet und in `main` gemerged.
Jonas hat das Ergebnis im Browser gesehen und abgelehnt.

---

> **STAND 2026-08-26, 14:xx — vier Etappen gebaut, nicht mehr nur geplant.**
>
> Jonas hat die Arbeit selbst angestossen („worauf wartest du?") und dabei eine
> ANDERE Artefakt-Adresse genannt als die in Abschnitt 3:
> `https://claude.ai/code/artifact/96b93072-2411-4733-807b-9ca461f201c5`
> („Turniermodul in der Marke", 12 Abschnitte, vollstaendig gelesen).
> **Seine Adresse gilt.** Sie ist umfassender als die alte und deckt auch Liste,
> Wizard, Teams, Regelwerk, Dialoge, Druck, Desktop und den Nachtmodus ab.
>
> **Erledigt und committet** (Branch `fix/tourney-marke`, ungepusht):
> B2, B3, B4, B5, B6, B7, B8 — sieben der acht Beschwerden.
> Commits `224662d` (Kopf), `9c2d8a5` (Gruppen-Umschalter),
> `8aa82c7` (Filter + Statusgruppen). Belege in `.handoffs/belege/`.
>
> **Noch offen:**
> - **B1 (Creme)** nur teilweise: die groessten Quellen in der Listenansicht sind
>   weg, ein systematischer Durchgang durch die restlichen hartkodierten Werte
>   plus Screenshot-Kontrolle je Ansicht steht aus.
> - **Die Struktur-Neubauten der uebrigen Screens**, die das Artefakt zeigt und
>   die bisher niemand angefasst hat: Spielplan als **Zeitachse** (Abschnitt 03 —
>   das ist die zentrale Idee des Entwurfs und der groesste Posten), K.-o.-Baum
>   mit Miniatur + Runden-Pillen + Herkunfts-Chips (05), Teams und Regelwerk als
>   Listenzeilen (06), Einstellungen mit Statuskarte und Steppern (06),
>   Listenkarten mit Pille/Kennzahlen/Balken (02), Wizard-Fortschritt als
>   Streifen (02), Desktop-Sidebar (09), Turnier-Symbol in der Seitenleiste
>   statt Emoji (11).
>
> Die Fallen in Abschnitt 8 haben sich alle bestaetigt, und der Pruefstand hat
> viermal einen intakten Zustand fuer kaputt erklaert (fehlende Klasse, fehlender
> Handler, fehlendes `main.css`, falsch gezaehlte Spalten). Wer weiterbaut:
> Pruefstand-Markup IMMER aus der Quelle schneiden, nie nachtippen — und
> `main.css` mitladen, dort steht die Spalten-Ausblendung.

## 1. Auftragslage — Jonas' Worte

> „also ich bin noch nicht zufrieden. vieles sieht nicht aus wie im artefakt sondern
> weniger sauber. das muss noch deutlich besser werden. prüfe nochmals alles genau
> anhand des artefakts sodass es noch besser wird. und ich will nicht mehr das
> cremefarbene im turniermodul haben. sondern wie im artefakt. bei tabellen: wieso
> sind die untereinander während sie im artefakt durch den button gewitcht werden
> konnten? wieso hast du es ncith geschafft 1:1 das artefakt umzusetzen. es ist noch
> zu viel vom alten design dabei. zB turnier erstellen und aktualisieren hat noch das
> alte layout. das brauch ich da gar nicht während ich in einem turnier drin bin.
> finde mir hier eine bessere lösung. auch die filter sahen im artefakt wesentlich
> besser aus. und unter "bereit" bei der turnierauswahl ist noch ein kasten im
> hintergrund, wahrscheinlich ein relikt aus den vorherigen versionen. es soll
> deutlich näher am artefakt dran sein, dieses sah nämlich perfekt aus. setze es 1:1
> so um designtechnisch und schaue, dass alle alten designrelikte nicht mehr stören."

Vorher, beim GO zum Artefakt:

> „es gefällt mir sehr gut und kann genauso umgesetzt werden"
> „das turniermodul soll möglichst genau dieses design haben, auch schriftart etc."

**Das Artefakt ist keine Anregung. Es ist die Abnahme-Vorlage.**

---

## 2. Warum der erste Anlauf gescheitert ist — bitte lesen

Die Vorgänger-Session hat **Komponenten umgefärbt, statt Strukturen nachzubauen.**
Jede einzelne Etappe war für sich verifiziert (43 Browser-Checks, 1679 Tests grün) —
und trotzdem sieht das Ergebnis nicht aus wie das Artefakt, weil die geprüfte Frage
falsch war. Geprüft wurde „stimmt die Farbe / der Kontrast / die Spaltenbreite",
nie „steht hier dasselbe Ding wie im Artefakt".

Konkret: Wo das Artefakt einen **Umschalter** zeigt, blieb eine **Liste** stehen und
bekam nur neue Farben. Wo das Artefakt **keine** Kopfleiste hat, blieb die alte
Kopfleiste stehen und bekam neue Farben. Das ist der rote Faden durch alle fünf
Beschwerden.

**Konsequenz für dich:** Nimm das Artefakt Screen für Screen und vergleiche die
*Struktur*, bevor du eine Farbe anfasst. Ein Screen ist erst fertig, wenn er neben
dem Artefakt liegt und man beide verwechseln könnte.

---

## 3. Die Vorlage

- **Referenz-Artefakt (Jonas' Zielbild):**
  `https://claude.ai/code/artifact/a5f79862-dcdd-444b-9c86-3be4311094ed`
  Lesen mit dem Artifact-Tool: `action: "read"`, `url: <die URL>`.
  **Das ist die Abnahme-Vorlage — im Zweifel gewinnt sie gegen jedes Planungsdokument.**
- **Design-Dokument der Vorgänger-Session** (12 Abschnitte, Begründungen, Tokentabelle):
  `https://claude.ai/code/artifact/96b93072-2411-4733-807b-9ca461f201c5`
  Lokale Kopie: `docs/turniermodul-v3/turniermodul-marke.html`
- **Achtung, Altlast:** Die drei Planungsdokumente unter `docs/turniermodul-v3/`
  (`redesign-plan.md`, `umsetzung-teil1.md`, `umsetzung-teil2.md`) beschreiben das
  **alte beige Design**. Gemessen: null Vorkommen von Orange, Archivo oder Plex.
  Sie sind überholt. Wer ihnen folgt, baut das falsche Ziel.

---

## 4. Die fünf Beschwerden mit Fundort

Alle am 2026-08-26 gegen `fix/tourney-marke` @ `79faace` gemessen. Weicht dein HEAD
ab, sind das ungeprüfte Prämissen — erst nachmessen.

**Es sind acht.** Abschnitt 4b trägt drei weitere nach (B6–B8), die Jonas nach dem
Schreiben dieser Datei per Screenshot belegt hat — sie stehen nicht in seiner
Aufzählung, sind aber dieselbe Fehlerklasse.

### B1 — „ich will nicht mehr das cremefarbene im turniermodul haben"

Zwei Quellen, beide müssen weg:

1. **Hartkodiert in `backend/public/style/tournament.css`** — 12 Werte:
   `#8B6B4A` (141), `#F0E7DA` (2660), `#F5F1E9` (3052, 4038, 4466),
   `#E7DFD2` (3512, 3575, 3598, 3618, 3643, 3684), `#FAF7F1` (3577).
2. **Die App-Tokens, auf denen das Modul sitzt** — `backend/public/style/main.css:2-13`:
   `--bg: #f8f5f1` · `--accent: #8a6a4a` · `--border: #ede7df` · `--accent-l: #f5ede3`.
   Das Modul liegt im App-Rahmen; wo es keinen eigenen Grund setzt, scheint Creme durch.
   **Das ist der Grund, warum es „weniger sauber" wirkt** — die Markenfarben schwimmen
   auf einem beigen Untergrund.

**Vorschlag:** `.t-mod` (und `.t-list-host`) bekommen einen eigenen, deckenden Grund
aus `--ground` und überschreiben die App-Tokens **lokal** — also `--bg`, `--accent`,
`--border`, `--accent-l` innerhalb von `.t-mod` auf die Markenwerte mappen. Damit ist
das Modul farblich abgeschlossen, ohne die restliche App anzufassen (die bleibt bis
auf Weiteres beige — Jonas' Entscheid: „lass die app erstmal hinten anstellen").
Der Token-Block dafür steht schon: `backend/public/style/tokens.css`.

### B2 — „bei tabellen: wieso sind die untereinander"

`backend/public/script/spielplan-helpers.js`, `renderStandingsGroups()` (ab Zeile 774)
mappt über **alle** Gruppen und klebt sie mit `join('')` untereinander. Es gibt keinen
Umschalter.

Im Artefakt liegt über den Tabellen ein **Segment-Control** (Gruppe A / B / C), und es
ist immer genau **eine** Tabelle sichtbar. Die CSS-Klasse dafür existiert bereits:
`.t-seg` in `tournament.css`. Sie wird an dieser Stelle nur nicht benutzt.

**Zu entscheiden (konservativ selbst entscheiden, dann loggen):** Bei genau EINER
Gruppe keinen Umschalter zeigen — ein Segment-Control mit einem Segment ist Unsinn.

### B3 — „turnier erstellen und aktualisieren hat noch das alte layout.
###       das brauch ich da gar nicht während ich in einem turnier drin bin"

`backend/public/script/main.js`, `renderTournamentHeaderActions()` (Zeile 2359,
aufgerufen 2442 / 2489 / 2535). Die Funktion hängt Knöpfe mit den **App-Klassen**
`btn btn-ghost` und `btn btn-primary tournament-new-instance-btn` in die
**Kopfleiste der App-Hülle** (neben `uploadBtn`) — nicht in den Modul-Kopf.

Zwei Fehler auf einmal: falsches Design (App-Knöpfe statt `.t-mod-action`) und
falscher Ort (sie stehen auch dann da, wenn man **in** einem Turnier ist, wo sie
nichts zu suchen haben).

**Vorschlag für die „bessere Lösung", die Jonas verlangt:**
- **In der Detailansicht:** App-Kopfleisten-Knöpfe **vollständig leeren**. Der
  Modul-Kopf hat bereits seinen eigenen Aktionsknopf
  (`main.js:3407`, `<button class="t-mod-action" data-view-action>`), der je Tab
  die passende Aktion trägt (`T_VIEW_CHROME`). Der ist die einzige Aktion, die man
  drinnen braucht.
- **In der Listenansicht:** „Turnier erstellen" bleibt, wandert aber in den
  Listen-Kopf als `.t-mod-action` — also in Markenoptik statt `.btn btn-primary`.
- „Aktualisieren" ersatzlos streichen: Die Ansicht lädt bei jedem Wechsel neu; ein
  Knopf, der das von Hand tut, ist ein Relikt aus der Zeit vor dem Auto-Refresh.
  **Falls du das anders siehst: konservativ behalten und loggen.**


**Kollision, gemeldet und nachgemessen 26.08. 12:45 (Nachbar-Session
`franksphotoalbum-cd`):** In genau dieser Funktion steckt seit heute eine
**Rechte-Prüfung**, und darauf liegt ein Test. Beides selbst geprüft:

- `main.js:2388` — `const darfErstellen = currentTournamentListIsAdmin === true;`
  Der Knopf hing vorher allein an `isInstancesView`, also am Ansichts-Zustand,
  nicht an der Rolle. Ein Mitglied sah „Turnier erstellen", durfte den Wizard
  durchlaufen und lief erst beim Abschicken in den 403 von `POST /api/tournaments`.
- Gesetzt wird der Wert bei `main.js:2530`
  (`currentTournamentListIsAdmin = instanceData?.isAdmin === true`); direkt danach
  muss die Leiste neu gebaut werden, sonst fehlt der Knopf auch Admins.
  Voreinstellung ist bewusst „kein Knopf" — die Leiste entsteht einmal, bevor die
  Liste geladen ist.
- Wächter: `backend/public/script/__tests__/admin-only-header-buttons.test.js`.
  Er liest den Quelltext, ankert an `function renderTournamentHeaderActions` und
  liest 4000 Zeichen Rumpf. **Verschiebst du den Knopf in den Listen-Kopf, findet
  er ihn nicht mehr.**

**Was das für dich heißt:** Der Ort darf wandern, die Rechte-Prüfung wandert mit.
Den Test darfst du anpassen, er ist kein Denkmal — aber danach einmal die
Mutationsprobe fahren: Prüfung testweise raus, Test **muss** rot werden. Zwei
Fassungen dieses Tests blieben grün, obwohl der Schutz weg war — einmal, weil der
erklärende Kommentar die gesuchten Wörter enthielt, einmal, weil `const
darfErstellen = …` stehen blieb, als nur seine Verwendung fiel. Das ist dieselbe
Falle wie in Abschnitt 8. Willst du den Test nicht selbst nachziehen, sagt die
Nachbar-Session zu, es nach deinem Umbau zu tun.

### B4 — „auch die filter sahen im artefakt wesentlich besser aus"

Die Vorgänger-Session hat `.t-filter-chip` gebaut (Trigger + Zähler + Aktiv-Chip).
Vergleiche die Leiste im Artefakt Pixel für Pixel — dort ist sie ruhiger und trägt
die Zähler anders. **Nicht aus dem Gedächtnis nachbauen: Artefakt lesen, dann bauen.**

### B5 — „unter 'bereit' bei der turnierauswahl ist noch ein kasten im hintergrund"

Gefunden. `backend/public/style/main.css`, Regel `.tournament-instance-group`:

```
padding: 14px 16px;
border-radius: 12px;
background: rgba(255, 255, 255, 0.5);
border: 1px solid var(--border2);
```

Ein halbtransparenter weißer Kasten mit beigem Rand um **jede** Statusgruppe
(„Bereit", „Läuft", „Beendet"). Im Artefakt gibt es das nicht — dort steht nur eine
Beschriftung und darunter die Karten, ohne Rahmen.

Erzeugt wird das Markup in `main.js` ab ~2735 (`<section class="tournament-instance-group">`).

**Achtung:** `.tournament-instance-group` steht in `main.css` und könnte auch außerhalb
des Turniermoduls benutzt werden — vor dem Ändern prüfen (`grep`), sonst statt der
globalen Regel eine Überschreibung unter `.t-mod`/`.t-list-host` setzen.

---

## 4b. Nachtrag 26.08. 12:35 — was der Screenshot zusätzlich zeigt (B6–B8)

Jonas hat nach dem Schreiben dieser Übergabe einen Bildschirmausschnitt des
**Detail-Kopfs** nachgereicht: `.handoffs/belege/2026-08-26-detailkopf-ist.png`
(im Repo, damit er nicht verlorengeht). Auf ~650 px Breite, Ansicht „Spielplan".

Der Ausschnitt belegt B1 und B3 sichtbar — auf **einem** Schirm stehen zwei
Akzentfarben nebeneinander: der braune „Turnier erstellen" (App-Token) und
darunter angeschnitten der orange Modul-Knopf (Marken-Token). Genau das meint
„es ist noch zu viel vom alten Design dabei".

Er zeigt darüber hinaus **drei Mängel, die in den fünf Beschwerden nicht
vorkommen**. Alle drei sind dieselbe Fehlerklasse wie in Abschnitt 2: additiv
gearbeitet statt ersetzt.

### B6 — „Spielplan" steht zweimal untereinander

Etappe 2 hat den Kopf gedreht: der `<h1>` trägt seither die ANSICHT, nicht mehr
den Turniernamen (`main.js:3406`, `data-view-title`, gespeist aus
`T_VIEW_CHROME` ab `main.js:3243`). Die **alten View-Köpfe wurden dabei nicht
entfernt**. Also rendert `renderSpielplanSectionHead()` weiterhin ein
`.t-view-title` mit dem Text „Spielplan" (`tournament-render.js:240`) — und
`.t-view-title` ist unverändert sichtbar (`tournament.css:726`, 20 px/600;
zweite Definition derselben Klasse in derselben Datei bei `1777` — eine der
Kollisionen aus Abschnitt 8).

Betrifft nicht nur den Spielplan: dasselbe Muster bei Gruppen
(`main.js:3481`), Regeln (`renderRegelnSectionHead`,
`tournament-render.js:~257`) und Einstellungen
(`renderEinstellungenSection`, `tournament-render.js:~269`).

**Vorschlag (prüfen, nicht blind übernehmen):** `.t-view-head` behält seine
Aktionsknöpfe („Bearbeiten", „Ergebnis eintragen") und verliert den Titel —
der steht jetzt im Kopf. Ist ein View-Head danach leer (Mitglieder-Ansicht,
`isAdmin=false`), darf er gar nicht erst gerendert werden, sonst bleibt eine
leere Zeile mit Abstand stehen. Das Artefakt entscheidet.

### B7 — verwaiste Zeile mit nur einem Drei-Punkte-Knopf

Unter dem Kopf liegt eine eigene, volle Zeile mit Panel-Hintergrund
(`.t-mod-header-actions`, `tournament.css:5060`), die als Geschwister direkt
hinter `<header class="t-mod-header">` hängt (`main.js:3431`, eingesetzt bei
`main.js:~3455`). Unterhalb von 900 px Container-Breite blendet die
`@container`-Regel „Zurück" und „Drucken" aus (`tournament.css:765`) — übrig
bleibt ein ⋮ in einem grauen Kreis, allein auf voller Breite.

Dazu kommt: **beide Menüpunkte sind Dubletten.** „Zurück zur Liste" steht
bereits als `‹ Turniere` im Kicker (`main.js:3403`), „Drucken" ist ein
eigenes Nav-Item (`tournament-render.js:290`). Das Menü führt also nichts,
was nicht zwei Zentimeter daneben schon steht.

**Vorschlag:** Die Zeile **ersatzlos streichen**. Nachgemessen 26.08. 12:55, auf
Hinweis der Nachbar-Session: `.t-mod-header-actions` kommt im gesamten Frontend
**nur an einer Stelle** vor — dem statischen Template `main.js:3431–3433`. Nichts
wird dort dynamisch eingehängt, weder aus `tournament.js` noch aus
`spielplan-helpers.js`. Die Zeile trägt genau die zwei Dubletten und das Menü,
sonst nichts.

**Der Kommentar bei `tournament.css:5057` ist überholt** und darf dich nicht
aufhalten: Er behauptet, die Zeile trage „Zeitplan neu". Tut sie nicht — das ist
2026-08-18 in die Spielplan-View gewandert (`main.js:3416` sagt es selbst,
verdrahtet ist es bei `main.js:4742` als `data-action="reschedule-auto"`). Es
gibt also nichts umzuhängen, bevor die Zeile fällt.

**Nicht verwechseln:** B7 (`.t-mod-header-actions`, **innerhalb** von `.t-mod`,
Template bei `main.js:3431`) und B3 (`renderTournamentHeaderActions()`,
`main.js:2359`, hängt in die **App-Kopfleiste** neben `uploadBtn`) sind **zwei
verschiedene Leisten**. Im Screenshot sehen sie wie eine aus. Streichst du die
falsche, zeigt B3 ins Leere und die App-Knöpfe bleiben stehen.

### B8 — Kicker bricht mitten im Wort ab

`‹ Turniere DSAD · BEREIT · ÖFFENTLICH · 15 SPI…` — der Kicker ist
`white-space: nowrap` + `text-overflow: ellipsis` (`tournament.css:5051`) und
setzt sich aus vier festen Teilen plus einem ansichtsabhängigen Zusatz
zusammen (`kickerBase`, `main.js:3395`; Zusatz aus `T_VIEW_CHROME.kontext`,
angehängt bei `main.js:3302`). Versalien plus `letter-spacing: 0.16em`
(`tournament.css:313`) machen ihn zusätzlich breit. Auf realer Breite bleibt
vom Zusatz „15 Spiele" ein „15 SPI…" übrig — der Teil, der die Ansicht
erklärt, ist genau der, der abgeschnitten wird.

**Vorschlag:** gegen das Artefakt messen, wie viele Segmente der Kicker dort
trägt. Vermutlich weniger. Kandidaten zum Streichen: „Öffentlich" (steht als
Zustand woanders) und das Datum. Reihenfolge so drehen, dass der
ansichtsabhängige Zusatz **vorn** steht, wenn er bleiben soll.

### Noch zu messen, nicht behauptet

Die Aktion rechts im Kopf („TEAMS", `.t-mod-action`, `tournament.css:1014`)
soll laut Regel `color: var(--flare)` sein — orange. Im Ausschnitt wirkt sie
dunkel. Ob `--flare` an dieser Stelle definiert ist, ist mit
`getComputedStyle()` im Browser zu klären, nicht per Quelltextlesen
(Abschnitt 8). Der Verdacht ist die bekannte Klasse „undefinierte Custom
Property tötet die Deklaration still".

---

## 5. Was bereits steht (nicht neu bauen)

Neun Etappen sind in `main`. Was funktioniert und bleiben soll:

- `backend/public/style/tokens.css` — **einzige Quelle der Palette.** Trägt alle drei
  Themen-Zustände (hell / dunkel / „wie das System"). Auch `live.html` und
  `aushang.html` hängen seit heute daran. **Nicht eigene Tokens danebenlegen.**
- Schriften: Archivo (Display), Archivo Narrow (Condensed), IBM Plex Sans (Fließtext),
  IBM Plex Mono (Zahlen/Labels).
- Zeitachse im Spielplan (`renderZeitmarke`), Rangbänder in den Tabellen,
  „Weg zum Titel" im Baum, Statuskarte im Einstellungen-Tab.
- **Druckbögen** (`renderDruckboegen`) — drei eigens gebaute Bögen (Spielplan,
  Gruppen, K.-o. quer mit SVG-Klammer). Die waren Jonas' zweiter Wunsch und sind
  nicht beanstandet. `@media print` in `tournament.css`. **Nicht anfassen.**
- 1679 Tests grün, 5 übersprungen (Stand 2026-08-26).

---

## 6. Revier — es arbeiten mehrere Sessions am selben Repo

Drei Arbeitsbäume auf einem Repo:

| Pfad | Branch | wer |
|---|---|---|
| `C:/Users/Rezo/Documents/franksPhotoalbum` | `feat/tourney-alpha` | Haupt-Tree, **liefert den Server aus** |
| `C:/Users/Rezo/Documents/fpa-css` | `fix/tourney-marke` | **deiner** |
| `C:/Users/Rezo/Documents/fpa-live` | `chore/live-tokens` | Nachbar (Zuschauerseiten) |

Die Nachbar-Session (`franksphotoalbum-cd`) hat ihre Runde heute abgeschlossen und
zwei Dinge ausdrücklich **dir** überlassen:

1. `renderLogoBlock()` in `spielplan-helpers.js` läuft noch auf den alten Klassen —
   sie fasst es nicht an, damit ihr euch nicht in die Quere kommt.
2. Beim Zuschauer-Link-Block klebt noch ein Inline-`flex` am Eingabefeld
   (`t-settings-actions > .t-input`) — kann raus, es gibt jetzt eine Regel dafür.

**Vor dem ersten Schreiben `git worktree list` fahren** und prüfen, ob inzwischen ein
vierter Baum dazugekommen ist.

Ein Hinweis der Nachbar-Session, der Zeit spart: Ihr Quelltext-Scan-Test war zweimal
**grün, obwohl der Schutz entfernt war** — einmal, weil der erklärende Kommentar die
gesuchten Wörter enthielt, einmal, weil `const darfErstellen = …` stehen bleibt, wenn
nur seine Verwendung fällt. Bei Scan-Tests: erst rot sehen, dann glauben.

---

## 7. Betrieb

- Dev-Server läuft auf **Port 3000**, gestartet aus
  `C:/Users/Rezo/Documents/franksPhotoalbum/backend` mit
  `node --env-file=.env.local --watch src/app.js`. `--watch` lädt `src/`-Änderungen
  selbst nach; **statische Dateien** (`public/**`) brauchen nur ein hartes Neuladen
  im Browser.
- Der Server liefert aus dem **Haupt-Tree**, nicht aus deinem. Damit Jonas deine
  Arbeit sieht, muss sie in `main` und der Haupt-Tree auf `main` vorgespult sein.
  Der Haupt-Tree stand am 26.08. auf `feat/tourney-alpha` — das ist derselbe Commit
  wie `main` (447fa93), aber das kann sich ändern: nachmessen.
- **Screenshot-Verify ohne Playwright-Binaries:** Modul aus dem npx-Cache
  `C:/Users/Rezo/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright`,
  starten mit `chromium.launch({ channel: 'msedge' })`. Memory
  `screenshot-verify-msedge` hat die Einzelheiten inkl. Junction-Trick für Worktrees.

---

## 8. Zwei Fallen, die die Vorgänger-Session Zeit gekostet haben

1. **Kaskaden-Kollisionen über Dateigrenzen.** `main.css` und `tournament.css`
   definieren dieselben Klassen (`.t-standings-table`, `.tournaments-grid` u. a.).
   `@media` und `@container` heben die Spezifität **nicht** an — bei Gleichstand
   gewinnt die später geladene Datei, also `tournament.css`. Sechs solcher
   Kollisionen wurden gefunden; es können mehr sein. Symptom: Eine Regel steht
   sichtbar im Quelltext und wirkt trotzdem nicht.
   **Werkzeug:** `getComputedStyle()` im Browser gegen den Quelltext prüfen, nicht
   den Quelltext lesen und glauben.
2. **Der eigene Prüfstand lügt.** Die Vorgänger-Session hat dreimal einen intakten
   Zustand für kaputt gehalten (und umgekehrt), weil das Prüf-Markup von Hand
   geschrieben war statt aus den echten Renderern zu kommen.
   **Regel:** Prüfstände importieren `spielplan-helpers.js` und rendern damit —
   nie Markup nachtippen.

---

## 9. Definition of Done

1. Jeder Screen des Artefakts liegt neben dem Screenshot der Umsetzung, und man
   könnte beide verwechseln. **Belege ablegen**, nicht behaupten.
2. Kein cremefarbener Pixel mehr im Modul — auch nicht durchscheinend, auch nicht
   im Nachtmodus. Gegenprobe: `grep` auf die 12 Werte aus B1 findet nichts mehr,
   **und** ein Screenshot bestätigt es (die App-Tokens sind per `grep` unsichtbar).
3. Gruppentabellen per Segment-Control umschaltbar, genau eine sichtbar.
4. In der Detailansicht keine App-Kopfleisten-Knöpfe mehr.
5. Kein Kasten hinter den Statusgruppen der Turnierliste.
6. Filterleiste wie im Artefakt.
7. **Der Titel steht genau einmal auf dem Schirm** (B6) — nicht im Kopf *und*
   im View-Head. Gilt für alle sieben Ansichten, nicht nur den Spielplan.
8. **Keine verwaiste Aktionszeile** unter dem Kopf (B7), und kein Menü, das nur
   Dubletten dessen führt, was zwei Zentimeter daneben schon steht.
9. **Der Kicker bricht nicht mitten im Wort ab** (B8) — auf 390 px im Browser
   gemessen, nicht geschätzt.
10. Alle Tests grün (Basis: 1679/5), Screenshot-Verify bei **390 px und 1920 px**,
    je **hell und dunkel** — drei Themen-Zustände nicht vergessen (auch „kein
    Attribut", das ist der Normalfall auf den Zuschauerseiten).
11. Committet in kleinen Etappen mit deutscher `@@ … @@`-Nachricht, chirurgisch
    per Pathspec gestaget.

---

## 10. Grenzen

- **Kein Push nach `origin/main`.** Das ist Jonas' GO-Gate (Live-Schaltung).
- **Merge nach `main` nur nach Rückfrage** — der Haupt-Tree liefert den Server aus,
  ein Merge zur Unzeit ändert Jonas den Bildschirm unter den Händen.
- **Die restliche App nicht umfärben.** Jonas' Entscheid vom 26.08.:
  „dann lass die app erstmal hinten anstellen." Nur das Turniermodul.
- **Druckbögen und `tokens.css` nicht umbauen** — beide sind abgenommen bzw. tragen
  jetzt drei Seiten. Ergänzen ja, umbauen nein.
- `npm install` / `npm ci` / `prisma generate` **niemals** in einem Worktree:
  `node_modules` sind Verzeichnis-Junctions auf den Haupt-Tree.
