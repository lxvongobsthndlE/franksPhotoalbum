# PWA-Verify ohne Geraet und ohne Deploy

Beantwortet die Frage „klappt das mobil als PWA?", **bevor** etwas live ist.
Ergaenzt `.notizen/safe-area-verify/` — dort wurden die Insets als CSS-Variablen
injiziert, hier kommen sie aus echtem `env()`.

## Warum die Variablen-Injektion nicht reicht

Der aeltere Weg setzte `--sat`/`--sab` per `style.setProperty` auf `:root`. Das
misst die `calc()`-Rechnungen der Regeln — aber es ueberspringt die beiden
ersten Glieder der Kette:

```
<meta viewport-fit=cover>  ->  env(safe-area-inset-top)  ->  --sat  ->  calc(8px + var(--sat))
        uebersprungen              uebersprungen            ab hier gemessen
```

Ein Fehler in `viewport-fit` oder in der `env()`-Zeile waere unsichtbar geblieben.

## Was hier echt ist

- **`Emulation.setSafeAreaInsetsOverride`** (CDP, Edge/Chromium ab 152) setzt die
  Insets so, wie das Geraet sie liefert. `env()` loest sie auf, die Token-Zeile in
  `:root` greift, die `calc()`-Rechnungen bekommen echte Werte. Der Kettenbeweis
  steht in der Spalte `padding-top`: iPhone 15 zeigt `67px` = `8px + 59px`.
- **Die echte `index.html` ueber echtes HTTP** (`statik-server.cjs`), nicht
  `file://` und kein nachgebautes Modal-Markup: Meta-Viewport, Reihenfolge der
  Stylesheets und das Theme-Schnipsel im `<head>` wirken wie im Betrieb.
- **Die angemeldete Schale.** `#app` ist ohne `.show` `display:none`; ohne diesen
  Schritt misst man ein Modal der Hoehe 0 und haelt es fuer gruen.

## Was NICHT bewiesen ist

- **iOS-Safari selbst.** Der Test laeuft auf Chromium/Edge. WebKits eigene
  `100dvh`-Mechanik mit ein- und ausfahrenden Leisten kann abweichen. Dafuer
  braucht es das Geraet.
- **`display-mode: standalone`** geht bewusst nicht ins Verdikt: die Medienabfrage
  kommt im ganzen CSS nicht vor (`grep -rn "display-mode" style/`), sie aendert
  also an der Geometrie nichts ausser den Insets — und die sind hier echt gesetzt.
- **Der Auslieferungsweg.** Ob das neue CSS beim Nutzer ankommt, ist eine Cache-
  Frage, keine Layout-Frage (Statics kommen ohne `cache-control`).

## Benutzung

```bash
# 1. Den zu pruefenden Stand ausliefern (Pfad = public-Ordner des Zweiges)
node .notizen/pwa-verify/statik-server.cjs backend/public 4323 &

# 2. Messen. Zweites Argument = Praefix der Screenshots.
node .notizen/pwa-verify/pwa-test.cjs http://127.0.0.1:4323 fix
```

Playwright liegt nicht im Projekt, sondern im npx-Cache; der Pfad steht oben in
`pwa-test.cjs` und muss ggf. nachgezogen werden (Memory `screenshot-verify-msedge`).
Browser ist System-Edge (`channel: 'msedge'`), es wird nichts installiert.

## Messung 2026-08-31 — Upload-Modal

Vier Geraete, jeweils schlimmster Fall (Feed-Teilen an, Upload-Knopf sichtbar).
`Luft unten` = Abstand der Kartenunterkante zum unteren Inset.

| Geraet | Inset o./u. | Stand | Hoehe | Unterkante | Safe-Ende | Luft unten | X (b×h) | Overlay scrollt | Verdikt |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| iPhone 15 | 59 / 34 | live (`92791e3`) | 743 | 818 | 818 | **0** | 24×28 | **ja** | ROT |
| iPhone 15 | 59 / 34 | Fix | 668 | 743 | 818 | 75 | 40×40 | nein | gruen |
| iPhone SE | 20 / 0 | live | 631 | 667 | 667 | **0** | 24×28 | **ja** | ROT |
| iPhone SE | 20 / 0 | Fix | 615 | 651 | 667 | 16 | 40×40 | nein | gruen |
| Pixel 8 | 24 / 24 | live | 762 | 802 | 891 | 89 | 24×28 | nein | ROT (nur X) |
| Pixel 8 | 24 / 24 | Fix | 668 | 708 | 891 | 183 | 40×40 | nein | gruen |
| iPhone 15 quer | 0 / 21 | live | 356 | 372 | 372 | **0** | 24×28 | **ja** | ROT |
| iPhone 15 quer | 0 / 21 | Fix | 340 | 356 | 372 | 16 | 40×40 | nein | gruen |

Der Live-Befund ist NICHT „die Karte ragt heraus" — sie endet exakt auf der
Kante, mit null Abstand. Der Fehler ist das **scrollbare Overlay**: die Karte ist
16px hoeher als ihr Rahmen, also laesst sich der ganze Block um 16px hochschieben
und die Titelzeile samt X wandert unter die Statusleiste. Nach dem Fix passt die
Karte in ihren Rahmen, das Overlay hat nichts mehr zu scrollen, und je nach
Geraet bleiben 16 bis 183px Luft. Bilder: `live-iphone15.png` gegen `fix-iphone15.png`.

## Eine Falle, die diesen Test schon einmal verfaelscht hat

`.modal` traegt `animation: fadeUp` mit `from { transform: translateY(14px) }`.
Wer das Modal oeffnet und im selben `page.evaluate` misst, erwischt die Animation
bei t=0 und liest **jede Kante 14px zu tief** — die erste Fassung dieses Tests hat
daraus faelschlich „die Karte ragt 14px ueber das Inset hinaus" gemacht. Das
Skript oeffnet deshalb jetzt getrennt, wartet 500ms und protokolliert `transform`
als Kontrolle mit. Steht dort nicht `none`, ist die Messung wertlos.
