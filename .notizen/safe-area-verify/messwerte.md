# Safe-Area-Verify — Messwerte

Stand: 2026-08-30 · Branch `feat/tourney-alpha` @ `72e52fc` · Server :3000 (fremde Session, nicht angefasst)
Pruefstand: `backend/public/pruefstand-safe-area.html` · Playwright 1.62.1 aus dem npx-Cache, `channel: 'msedge'`
Viewport 393x852 (iPhone 15), `deviceScaleFactor: 2`.

- **Lauf A** — nichts injiziert (`--sat/--sab` = `env(...)` = 0px am Desktop).
- **Lauf B** — `document.documentElement.style.setProperty('--sat','59px')` + `--sab: 34px`.
- **Lauf K** — Kontrolle: identisch zu B, aber Viewport **901px** (oberhalb des 900px-Breakpoints).
  K ist der Positivbeweis: dieselben Basisregeln liefern dort die Sollwerte.

Rohdaten: `messwerte.json`. Bilder: `a.png`, `b.png` (Sammelseite), `a-modal.png`, `b-modal.png`
(`?nur=modal`, Nachbarn ausgeblendet — sonst verdeckt `#invite-banner` (z-index 9998) die Titelzeile
des Modals (z-index 200)).

| Element / Eigenschaft         | A@393 | B@393 | K@901 | Soll B | Verdikt                      |
| ----------------------------- | ----: | ----: | ----: | -----: | ---------------------------- |
| `.toast-container` top        |    16 |    75 |    75 |     75 | gruen                        |
| `.toast-container` right      |    16 |    16 |    16 |     16 | gruen (kein `--sar` gesetzt) |
| `.modal-bg` padding-top       |     8 |     8 |    79 |     79 | **ROT**                      |
| `.modal-bg` padding-bottom    |     8 |     8 |    54 |     54 | **ROT**                      |
| `.modal-hdr` Oberkante (rect) |    17 |    17 |    80 |  >= 79 | **ROT**                      |
| `.modal` max-height           |   836 |   836 |   719 |    719 | **ROT**                      |
| `#invite-banner` padding-top  |    11 |    70 |    70 |     70 | gruen                        |
| `#setup-banner` padding-top   |    11 |    70 |    70 |     70 | gruen                        |
| `.dlg-bg` padding-top         |    20 |    79 |    79 |     79 | gruen                        |
| `.dlg-bg` padding-bottom      |    20 |    54 |    54 |     54 | gruen                        |
| `.notif-panel` top            |    57 |   116 |   116 |    116 | gruen                        |
| `.bulk-bar` bottom            |    14 |    14 |    58 |     58 | **ROT**                      |
| `.ss-bar` bottom              |    28 |    62 |    62 |     62 | gruen                        |
| `.sb-footer` padding-bottom   |    10 |    44 |    44 |     44 | gruen                        |

Toleranz 1px.

## Befund 1 — Upload-/App-Modal verliert die Safe-Area unterhalb 900px

`backend/public/style/main.css:4530` (`.modal-bg { padding: 8px }`) und `main.css:4528`
(`.modal { max-height: calc(100vh - 16px) }`), beide im Block `@media (max-width: 900px)`
(oeffnet `main.css:4241`), ueberschreiben die Safe-Area-Regeln aus `main.css:3369-3371`
bzw. `main.css:3393`.

`padding: 8px` ist eine **Kurzform** — sie kassiert alle vier Langformen der Basisregel.
Damit ist der Fix genau dort wirkungslos, wo der Notch existiert: auf dem Handy.
Gemessen bleibt die Titelzeile „Medien hochladen" bei injizierten 59px unveraendert auf
`top = 17` stehen, also vollstaendig innerhalb der Dynamic Island (`b-modal.png` zeigt es).
Oberhalb von 900px stimmt derselbe Wert (K = 80).

`a-modal.png` und `b-modal.png` sind **byteidentisch** (md5 `1021fbaf3bac8ffb1228eb4136991fef`):
die Injektion von 59px veraendert am 393px-Viewport kein einziges Pixel des Modals.

Dieselbe Klasse wie [[css-kaskade-container-spezifitaet]] und der P7-Shorthand-Fall
([[tournament-v3-p7-bottom-bar-overlap]]): eine spaetere Kurzform toetet still die
bedingte Rechnung der frueheren Regel.

## Befund 2 — `.bulk-bar` verliert den unteren Inset unterhalb 900px

`backend/public/style/main.css:4425` (`.bulk-bar { bottom: 14px }`), gleicher Media-Block,
ueberschreibt `main.css:2572` (`bottom: calc(24px + var(--sab))`). B = 14 statt 58.

Beleg dafuer, dass es ein Versehen und keine Absicht ist: **im selben Block** zieht
`main.css:4513` (`.ss-bar { bottom: calc(16px + var(--sab)) }`) den Inset korrekt mit.
Zwei Leisten am unteren Rand, eine kennt den Home-Indicator, die andere nicht.

## Nicht pruefbar am Desktop

- `backend/public/style/tournament.css` nutzt `env()` **direkt** (bewusst, laeuft ohne die
  main.css-Tokens). Die Variablen-Injektion greift dort per Definition nicht; Desktop-Browser
  liefern `env(safe-area-inset-*)` = 0px. Das beweist nur ein echtes Geraet nach Deploy —
  **nicht rot, ungeprueft.**
- Ebenso die `env()`-Direktstellen in `main.css` selbst: Zeilen 131/132, 929, 932, 1701,
  1749, 1750, 1916, 3617, 3658, 4258, 4261, 4336, 4346, 4372, 4410, 4411, 4459, 4507,
  4650, 4653, 4705, 4713. Sie sind von der Injektion unerreichbar.
- Der 59px-Balken (`?island=1`) ist eine gezeichnete Referenz, keine echte Statusleiste;
  er setzt selbst keine Variablen, damit sich A und B ausschliesslich durch die Injektion
  unterscheiden.
