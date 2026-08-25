# Turniermodul — Redesign-Plan

> **Auftrag:** Das Turniermodul funktioniert. Jetzt soll es aussehen, als hätte jemand es entworfen — nicht, als sei es gewachsen. Dieser Plan ist verbindlich für alle Gestaltungsfragen und ersetzt §8 der Spezifikation.
>
> **Grundregel:** Bei Widersprüchen zwischen diesem Plan und älteren Dokumenten gilt dieser Plan. Wo er schweigt, gilt die Spezifikation.

---

## 0. Was heute nicht stimmt

Gesammelt aus dem Betrieb, nach Schwere sortiert. Jeder Punkt ist ein Fehler, kein Geschmacksurteil.

**Mobil (der Hauptfall — am Turniertag steht der Veranstalter mit dem Handy an der Platte):**

1. Die Gruppentabelle passt nicht auf den Bildschirm. Überschriften überlappen („BECHERIFF"), rechte Spalten abgeschnitten.
2. Die Match-Karte ist asymmetrisch: Heimteam links, Gastteam rechts, Ergebnis dazwischen eingerückt. Drei Ausrichtungen in einer Karte.
3. Sieben Filter-Chips füllen zwei Zeilen, obwohl sie selten benutzt werden.
4. Der Kopfbereich braucht ein Drittel des Bildschirms, bevor der erste Inhalt kommt.
5. Die Tab-Leiste ist rechts abgeschnitten („Reg…"), ohne dass erkennbar wäre, dass sie scrollbar ist.
6. Die Turnierliste zeigt vier große Phasen-Kästen, drei davon mit „Keine Turniere in dieser Phase".

**Desktop:**

7. Die drei Spalten stehen zentriert, links und rechts bleiben je 200–400px leer.
8. Navigation und Kontextspalte ziehen sich über die volle Seitenhöhe, auch bei drei Zeilen Inhalt.
9. Tabellenüberschriften fluchten nicht mit den Werten darunter — Überschrift linksbündig, Zahlen rechtsbündig.
10. Die drei Gruppentabellen haben unterschiedliche Spaltenbreiten.
11. Drei Symbole pro Tabellenzeile für eine Information: Stern, Platznummer, Häkchen.

**Übergreifend:**

12. Der Nachtmodus ist halb umgesetzt: dunkler Seitenhintergrund, weiße Karten, dunkler Text auf dunklem Grund im Kopfbereich.
13. Die Turnierkarte in der Liste wirkt billig: „Bereit" steht zweimal, größer als der Turniername; die Kennzahlen brechen als Textblock um.
14. Der Ergebnis-Dialog zeigt dasselbe Spiel dreimal.

---

## 1. Gestalterische Haltung

### 1.1 Eine App in der App

Das Turniermodul ist kein weiterer Reiter neben Feed und Fotos. Es ist ein Werkzeug mit eigenem Zweck und eigenem Gebrauchsmoment — man benutzt es an einem Nachmittag, im Stehen, unter Zeitdruck.

**Deshalb bekommt es eine eigene Handschrift.** Nicht fremd, aber unterscheidbar: Wer vom Fotomodul hierher wechselt, soll merken, dass er ein anderes Werkzeug in der Hand hat.

Verwandt bleibt es über den Grundton — dasselbe warme Papier, dieselbe Schriftfamilie, dieselben weichen Kartenkanten. Eigenständig wird es über drei Dinge:

**Die Anzeigetafel.** Wo Ergebnisse und Zeiten stehen, wird der Grund dunkel und die Ziffern hell. Das ist die Sprache von Sporthallen, und sie taucht im Modul immer wieder auf: im Spielstand jeder Match-Zeile, im „Als Nächstes"-Band, im Turnierbaum, in der Beamer-Ansicht.

**Kondensierte Versalien für Struktur.** Rundenbezeichnungen, Gruppennamen und Spaltenüberschriften stehen in schmalen Großbuchstaben mit weiter Laufweite — wie auf einem Spielplan-Aushang. Das trennt die Gliederung sichtbar vom Inhalt.

**Dichte statt Luft.** Wo das Fotomodul großzügig atmet, packt das Turniermodul zusammen. Zwölf Spiele auf einen Blick sind besser als vier mit viel Weißraum.

### 1.2 Die Signatur: das Score-Feld

Bei einem Turnier ist die Zahl der Inhalt. Wer wie hoch gewonnen hat, wie viele Spiele offen sind, wann das nächste beginnt.

**Das Score-Feld ist das Element, an dem man das Modul erkennt:** ein dunkles Rechteck mit heller, tabellarischer Ziffer. Klein in der Match-Zeile, mittelgroß im Turnierbaum, groß im „Als Nächstes"-Band, sehr groß in der Beamer-Ansicht. Immer dieselbe Form.

```
  ● Rakija Boys          ┌────┐
                         │  7 │
  ● Klopfer Kollektiv    ├────┤
                         │  4 │
                         └────┘
```

Zwei gestapelte Felder, kein Doppelpunkt dazwischen. Bei offenen Spielen bleiben die Felder als Umriss stehen, ohne Füllung — der Platz für das Ergebnis ist sichtbar reserviert.

Regeln:
- Grund `--board`, Ziffer `--board-ink`, `tabular-nums`, Schriftstärke 700
- Radius 4px — kantiger als die übrigen Elemente, das ist beabsichtigt
- Bei offenem Spiel: 1px Umriss in `--line`, keine Füllung, Ziffer durch „–" ersetzt
- Feste Mindestbreite, damit zweistellige Ergebnisse passen und Spalten fluchten

Das ist die eine Stelle, an der das Modul laut sein darf. Alles andere bleibt zurückhaltend.

### 1.3 Drei Prinzipien

**Eine Zeile ist ein Spiel.** Die Match-Zeile sieht in Spielplan, Turnierbaum, Kontextspalte und Übersicht identisch aus — nur in drei Größen. Wer sie einmal gelesen hat, liest sie überall.

**Weniger Rahmen, mehr Abstand.** Heute ist alles ein Kasten mit Rand. Ruhiger wird es, wenn Bereiche durch Abstand getrennt sind und Rahmen nur dort stehen, wo etwas wirklich abgegrenzt gehört.

**Ein Element, eine Aufgabe.** Kein Stern *und* Platznummer *und* Häkchen für „qualifiziert". Kein Status als Badge *und* als Feld. Wenn zwei Elemente dasselbe sagen, fliegt eines raus.

---

## 2. Tokens

Diese Werte sind verbindlich und stehen in `tournament.css` unter `.t-mod`.

### 2.1 Farben — hell

```css
--paper:       #FAF7F1;  /* Seitengrund, von [kru:]nest übernommen */
--surface:     #FFFFFF;  /* Karten, Tabellen */
--surface-alt: #F5F1E9;  /* Zebra-Zeilen, hinterlegte Bereiche */
--ink:         #1F1B16;  /* Text */
--ink-soft:    #8A8077;  /* Sekundärtext, Beschriftungen */
--line:        #E7DFD2;  /* Trennlinien */
--accent:      #8B6B4A;  /* Hauptaktion, aktive Navigation */
--accent-soft: #F0E7DA;  /* Grund aktiver Elemente */

/* Anzeigetafel — die eigene Handschrift des Moduls */
--board:       #211C16;  /* Grund der Score-Felder und Bänder */
--board-ink:   #F7F2E8;  /* Ziffern darauf */
--board-dim:   #6B6055;  /* Sekundärtext auf dunklem Grund */

/* Zustände */
--open:        #C08A2E;  /* offenes Spiel */
--done:        #4F7A4A;  /* beendetes Spiel, qualifiziert */
--out:         #A79E94;  /* ausgeschieden, inaktiv */
--danger:      #C0453A;  /* zerstörende Aktionen, Fehler */
```

Die Anzeigetafel-Farben sind bewusst wärmer als reines Schwarz — sie gehören zum Papier, aus dem die App gemacht ist, statt wie ein Fremdkörper darauf zu liegen.

### 2.2 Farben — dunkel

**Der Nachtmodus wird vollständig durchgezogen.** Halb umgesetzt sieht schlechter aus als gar nicht.

```css
--paper:       #1A1714;
--surface:     #23201B;
--surface-alt: #2A2620;
--ink:         #F2EDE4;
--ink-soft:    #A69C90;
--line:        #332E27;
--accent:      #B8916A;   /* aufgehellt für Kontrast auf dunklem Grund */
--accent-soft: #332A22;

/* Anzeigetafel — im Nachtmodus umgekehrt: helles Feld, dunkle Ziffer */
--board:       #EDE6DA;
--board-ink:   #1A1714;
--board-dim:   #7A7166;

--open:        #D9A445;
--done:        #6B9A66;
--out:         #6E665D;
--danger:      #D66B60;
```

**Die Anzeigetafel dreht sich im Nachtmodus um.** Auf hellem Grund ist sie dunkel, auf dunklem Grund hell. So bleibt sie in beiden Modi das auffälligste Element — statt im Nachtmodus mit dem Hintergrund zu verschmelzen.

Anbindung an den bestehenden Schalter der App — dieselbe Klasse oder dasselbe Attribut, das Feed und Fotomodul verwenden. Nicht neu erfinden.

**Prüfpunkt:** Im Nachtmodus muss jeder Text auf jedem Grund mindestens 4,5:1 Kontrast haben. Der Kopfbereich ist heute der schlimmste Fall.

### 2.3 Schrift

Die Schriftfamilie der Kernanwendung wird übernommen. Keine zusätzliche Schrift, keine Einbindung von außen. Die eigene Handschrift entsteht über Größe, Stärke und Laufweite.

| Rolle | Desktop | Mobil | Stärke |
|---|---|---|---|
| Struktur-Label (Versalien) | 11px | 11px | 600 |
| Hilfstext | 12px | 12px | 500 |
| Standardtext | 14px | 15px | 400 |
| Teamname | 15px | 16px | 500 |
| Teamname (Sieger) | 15px | 16px | 700 |
| Spielstand in der Zeile | 18px | 18px | 700 |
| Spielstand im Band | 40px | 32px | 700 |
| Kartenüberschrift | 17px | 17px | 600 |
| Seitentitel | 24px | 20px | 600 |

**Struktur-Labels** — Rundenbezeichnungen, Gruppennamen, Tabellenüberschriften, Abschnittstitel — stehen in Versalien mit Laufweite `0.10em`. Diese weite Sperrung ist das zweite Erkennungsmerkmal des Moduls neben der Anzeigetafel:

```
VIERTELFINALE        GRUPPE A        ALS NÄCHSTES
```

Sie wird ausschließlich für Gliederung verwendet, nie für Inhalte. Ein Teamname steht nie in Versalien.

**Alle Zahlen** bekommen `font-variant-numeric: tabular-nums`. Ohne Ausnahme.

### 2.4 Raster

Abstände ausschließlich aus dieser Reihe: **4 · 8 · 12 · 16 · 24 · 32 · 48**. Keine krummen Zwischenwerte.

Radien: 12px für Karten, 10px für Buttons und Felder, 999px für Badges, 0 für Tabellenzeilen.

Schatten: nur bei modalen Dialogen. Sonst trennen Linien und Abstand.

---

## 3. Kernkomponenten

### 3.1 Die Match-Zeile

Eine Komponente, drei Größen. Sie ist das meistgesehene Element im Modul.

**Desktop, normal** (Spielplan):

```
│ 10:30      ● Rakija Boys              ┌───┐   │
│ PLATTE 3   ● Klopfer Kollektiv        │ 7 │   │  ⋯
│ VF 1                                  ├───┤   │
│                                       │ 4 │   │
│                                       └───┘   │
```

Grid: `3px 88px 1fr auto 32px`
Spalten: Statusstreifen · Zeit/Platte/Runde · Teams · Score-Feld · Aktion

**Die Teams stehen untereinander, nicht nebeneinander.** Das ist die Darstellung jedes etablierten Turnierbaums und hat drei Vorteile: Der Name bekommt die volle Breite, die Ziffern fluchten senkrecht, und die Zeile funktioniert auf jeder Bildschirmbreite gleich.

**Regeln:**
- Statusstreifen links, 3px: `--line` offen, `--done` beendet
- Uhrzeit in `--ink`, Platte darunter als Struktur-Label in Versalien, Runde in `--ink-soft`
- Farbpunkt des Teams, 8px, vor dem Namen
- Sieger: Schriftstärke 700, Farbe `--ink`. Verlierer: 400, Farbe `--ink-soft`
- Score-Feld nach §1.2 — zwei gestapelte Felder, bei offenem Spiel als Umriss
- Platzhalter („Sieger VF 2"): kursiv, `--ink-soft`
- Der Sieger wird über `scoreHome > scoreAway` bestimmt, nicht über `winnerTeamId` — das gibt es nur bei K.-o.-Spielen
- Die Aktion ist ein Kontextmenü-Symbol (⋯), kein Wort. Beim Überfahren der Zeile wird es deutlicher

**Kompakt** (Kontextspalte, Turnierbaum): Zeit und Platte einzeilig darüber, kein Aktionsbereich, Schriftgrößen eine Stufe kleiner.

**Groß** (Übersicht, Beamer): Spielstand 48px, mehr Innenabstand.

### 3.2 Die Tabelle

**Alle Zahlenspalten rechtsbündig — Überschrift und Wert.** Das ist der häufigste Fehler heute.

Feste Spaltenbreiten über `table-layout: fixed`, für alle Gruppentabellen identisch. Dann fluchten sie auch untereinander.

Desktop-Spalten: `Pl. · Team · Sp. · S · U · N · Becher · Diff · Pkt.`

**Markierung der Qualifikationsplätze — genau ein Signal:**
- Zeile hinterlegt (`--done` für direkt qualifiziert, `--open` für mögliche beste Dritte, beide bei 8 % Deckkraft)
- Eine durchgezogene 2px-Linie unter dem letzten direkten Aufstiegsplatz
- **Kein Stern, kein Pfeil, kein Häkchen.** Die Farbe und die Linie sagen alles.

Zebra-Zeilen in `--surface-alt`, Kopfzeile mit 1px-Linie darunter.

### 3.3 Die Turnierkarte in der Liste

Heute wirkt sie billig, weil vier Dinge gleichzeitig um Aufmerksamkeit ringen. Neue Ordnung:

```
┌────────────────────────────────────────┐
│ [Logo]  Bierpong Turnier 2.0    Bereit │
│         05.09.2026 · Gönningen         │
│                                        │
│         12 Teams · 3 Gruppen · 26 Spiele│
│         ████████████░░░░░░  18 von 26  │
└────────────────────────────────────────┘
```

- Der Turniername ist das Größte auf der Karte (17px, Stärke 600)
- Datum und Ort darunter, 13px, `--ink-soft`
- Status als kleines Badge oben rechts, 11px — **nicht** zusätzlich als Zeile
- Kennzahlen in einer Zeile, ohne Umbruch, 12px
- Fortschrittsbalken: 4px hoch, `--accent` auf `--surface-alt`. Das ist die Information, die interessiert.
- **Die ganze Karte ist anklickbar.** Kein „Öffnen"-Knopf.
- Löschen und Umbenennen in einem Kontextmenü (⋯), das rechts oben erscheint

**Leere Phasen werden nicht angezeigt.** Weder auf dem Handy noch auf dem Desktop. Wenn kein Turnier beendet ist, gibt es keinen Abschnitt „Beendet".

### 3.4 Der Ergebnis-Dialog

Heute erscheint das Spiel dreimal. Neu:

```
┌─────────────────────────────────┐
│ Ergebnis eintragen          ✕   │
├─────────────────────────────────┤
│ VF 1 · 10:30 · Platte 3         │
│                                 │
│ ● Rakija Boys        [   7   ]  │
│ ● Klopfer Kollektiv  [   4   ]  │
│                                 │
│      Abbrechen    Speichern     │
└─────────────────────────────────┘
```

- Eine graue Zeile mit Runde, Zeit und Platte — mehr Kontext braucht es nicht
- Teamname links, Eingabefeld rechts, in einer Zeile. Dann ist klar, welche Zahl zu wem gehört
- Keine Beschriftungen „Ergebnis Heim" / „Ergebnis Gast" — der Name steht daneben
- Eingabefelder: 20px, mittig, `inputmode="numeric"`
- Beim Öffnen liegt der Fokus im ersten Feld
- Enter im zweiten Feld speichert
- **Keine Emoji.** Weder im Titel noch auf Buttons

Auf dem Handy fährt der Dialog als Blatt von unten ein und nimmt die volle Breite.

---

## 4. Ansichten

### 4.1 Rahmenlayout Desktop

```
┌──────────────────────────────────────────────────────────┐
│ [Logo] Turniername · Bereit                    [⋯]       │  56px
├──────────┬──────────────────────────────┬────────────────┤
│ Nav      │ Inhalt                       │ Kontext        │
│ 200px    │ füllt den Rest               │ 280px          │
│          │                              │                │
│ endet    │                              │ endet mit      │
│ mit      │                              │ Inhalt         │
│ Inhalt   │                              │                │
└──────────┴──────────────────────────────┴────────────────┘
```

**Korrekturen gegenüber heute:**
- Der Inhalt beginnt **links** am Rand des Bereichs, nicht zentriert. Kein `margin: 0 auto`.
- Ein `max-width` von 1600px ist erlaubt, damit Zeilen auf sehr breiten Monitoren nicht ausufern — aber linksbündig, nicht mittig.
- **Die Spalten enden mit ihrem Inhalt.** Kein `height: 100%`, kein `min-height: 100vh`. Bei drei Zeilen Inhalt ist die Navigationsspalte drei Zeilen hoch.
- Der Kopfbereich ist 56px hoch, einzeilig. Turniername, Status-Badge, Kontextmenü rechts.

### 4.2 Rahmenlayout Mobil

```
┌─────────────────────────┐
│ Turniername      Bereit⋯│  48px, einzeilig
├─────────────────────────┤
│ Spielplan Gruppen Baum →│  44px, scrollbar
├─────────────────────────┤
│                         │
│ Inhalt                  │
│                         │
│                         │
│                    ┌───┐│
│                    │ + ││  schwebender Knopf
│                    └───┘│
└─────────────────────────┘
```

**Der Kopfbereich ist eine Zeile.** Turniername, Status, Kontextmenü. „Zurück", „Drucken" und „Zeitplan neu" wandern in das Menü.

**Die Tab-Leiste zeigt, dass sie scrollbar ist**: ein weicher Verlauf von `--paper` nach transparent über die letzten 24px am rechten Rand.

**Der schwebende Knopf unten rechts** ist die eine Hauptaktion: Ergebnis eintragen. Immer erreichbar, ohne Scrollen. Nur für Admins.

**Keine Kontextspalte.** Ihr Inhalt gehört in die Übersicht.

### 4.3 Spielplan mobil

Die Match-Karte in kompakter Form:

```
┌─────────────────────────────┐
│ 10:30 · PLATTE 3 · VF 1   ⋯ │
│ ● Rakija Boys        ┌────┐ │
│                      │  7 │ │
│ ● Klopfer Kollektiv  ├────┤ │
│                      │  4 │ │
└──────────────────────└────┘─┘
```

Höhe etwa 92px. Bei 390px Bildschirmbreite sieht man damit fünf bis sechs Spiele gleichzeitig statt zwei.

Die Kopfzeile ist einzeilig und darf gekürzt werden — Uhrzeit und Platte haben Vorrang vor der Rundenbezeichnung.

**Die Filter werden zu einem Knopf.** Statt sieben Chips über zwei Zeilen:

```
[ Filter: Nur offene (8) ▾ ]
```

Antippen öffnet ein Blatt von unten mit den Optionen. Die aktuelle Auswahl steht im Knopf. Das spart eine Bildschirmzeile und macht sichtbar, dass gefiltert ist.

### 4.4 Gruppen mobil

Die neunspaltige Tabelle passt nicht auf 360px — und soll es auch nicht. **Reduzierte Ansicht:**

```
GRUPPE A
┌─────────────────────────────┐
│ 1  ● Rakija Boys          9 │
│ 2  ● Burek Bande          6 │
│ ─────────────────────────── │
│ 3  ● Kangol Krew          3 │
│ 4  ● Pivo Patrol          0 │
└─────────────────────────────┘
```

Platz, Farbpunkt, Name, Punkte. Die Trennlinie markiert die Qualifikationsgrenze.

**Antippen einer Zeile klappt die Details auf:** Spiele, Siege, Unentschieden, Niederlagen, Becher, Differenz — als kleine Werteliste unter der Zeile.

### 4.5 Turnierbaum

**Desktop:** Runden als Spalten nebeneinander, Karten darin untereinander mit gleichmäßigem Abstand. Keine Verbindungslinien, keine Konvergenz-Berechnung. Das Spiel um Platz 3 steht in der Finale-Spalte darunter, mit eigener Beschriftung.

**Mobil:** Eine Runde pro Bildschirm, volle Breite. Horizontal wischbar mit Einrastpunkten, darüber die Runden-Tabs. Die aktive Runde wird beim Wischen im Tab hervorgehoben.

Die Karte ist nie breiter als der sichtbare Bereich. **Breite über `100%`, nicht über `100vw` oder `100cqw`** — beide rechnen mit Bezugsgrößen, die außerhalb des Containers liegen.

### 4.6 Übersicht

Die Ansicht, die den Zustand des Turniers auf einen Blick zeigt. Vier Bereiche untereinander:

**1. Das „Als Nächstes"-Band.** Dunkler Grund (`--ink`), volle Breite. Große Uhrzeit, darunter die nächsten Spiele mit Platte. Bei eintägigen Turnieren nur die Uhrzeit, bei mehrtägigen mit Datum. Für Admins je Spiel ein Knopf zum Eintragen.

Das ist das eine Element, das auffallen darf.

**2. Fortschritt.** „18 von 26 Spielen" mit Balken, dazu die aktuelle Phase und die geschätzte Endzeit.

**3. Plattenbelegung.** Je Platte das nächste Spiel mit Uhrzeit.

**4. Kurztabellen.** Alle Gruppen als kleine Karten nebeneinander, nur Platz, Team, Punkte. Mit Verweis auf die vollständige Ansicht.

---

## 5. Bewegung

Zwei Animationen im ganzen Modul, mehr nicht:

1. Eine gespeicherte Zeile blendet einmal kurz auf (150 ms, `--done` bei 12 % Deckkraft, dann zurück). Das ist die Rückmeldung, dass gespeichert wurde.
2. Dialoge fahren ein (200 ms).

`prefers-reduced-motion` schaltet beide ab.

Kein Schweben von Karten, kein Verschieben beim Überfahren, keine Übergänge zwischen Ansichten. Was zu viel bewegt, wirkt unruhig — und billig.

---

## 6. Sprache

- Deutsch, Du-Form, normale Groß- und Kleinschreibung
- **Niemals technische Werte:** nicht `group_stage`, sondern „Gruppenphase". Nicht `groups_ko`, sondern „Gruppen + K.-o."
- Buttons benennen die Handlung: „Ergebnis speichern", nicht „Absenden"
- Ein Vorgang behält seinen Namen: Was „Speichern" heißt, meldet „Gespeichert"
- Fehler sagen, was passiert ist und was zu tun ist. Keine Entschuldigungen, keine vagen Formulierungen
- Leere Ansichten fordern zur nächsten Handlung auf — und wiederholen dabei nicht einen Knopf, der direkt darüber schon steht
- **Keine Emoji.** Linien-Symbole aus demselben Satz wie der Rest der App

---

## 7. Reihenfolge

1. **Tokens und Nachtmodus.** Farbwerte setzen, dunkle Variante vollständig durchziehen. Ohne diese Grundlage bringt alles Weitere nichts.
2. **Match-Zeile.** Eine Komponente, drei Größen, Teams untereinander. Sie steckt in jeder Ansicht — wenn sie stimmt, stimmt vieles.
3. **Tabellen.** Ausrichtung, feste Spaltenbreiten, reduzierte Markierung.
4. **Rahmenlayout Desktop.** Linksbündig, Spalten enden mit Inhalt, Kopfbereich einzeilig.
5. **Rahmenlayout Mobil.** Kopfbereich einzeilig, Tab-Leiste mit Verlauf, schwebender Knopf, keine Kontextspalte.
6. **Spielplan und Gruppen mobil.** Kompakte Karte, Filter als Knopf, reduzierte Tabelle mit Aufklappen.
7. **Turnierkarte und Liste.** Neue Ordnung, leere Phasen weg.
8. **Ergebnis-Dialog.**
9. **Turnierbaum.**
10. **Übersicht.**

Nach jedem Schritt ein Commit. Nach den Schritten 4, 5 und 6 eine Abnahme durch den Veranstalter, bevor es weitergeht.

---

## 8. Abnahme

**Geprüft wird im echten Browser auf `localhost:3000`, nicht in einer nachgebauten Umgebung.** Die Prüfumgebung muss die echte App laden — andernfalls sind die Ergebnisse wertlos.

**Breiten:** 360, 390, 430, 768, 1280, 1920. Bei allen sechs gilt:

- [ ] Kein waagerechtes Scrollen, keine abgeschnittenen Inhalte
- [ ] Die Seite lässt sich nicht seitlich schieben
- [ ] Kein Element ist breiter als sein Container (`scrollWidth <= clientWidth + 1`)
- [ ] Alle Zahlen sind vollständig sichtbar
- [ ] Überschriften und Werte einer Tabellenspalte fluchten

**Zusätzlich:**

- [ ] Bei 1920 füllt der Inhalt die Breite, kein ungenutzter Rand über 5 %
- [ ] Navigation und Kontextspalte enden mit ihrem Inhalt
- [ ] Der Nachtmodus ist in jeder Ansicht vollständig, überall Kontrast mindestens 4,5:1
- [ ] Kein technischer Wert und keine Datenbank-ID ist sichtbar
- [ ] Keine Emoji
- [ ] Eine Match-Zeile sieht in allen Ansichten gleich aus
- [ ] Pro Ansicht genau eine gefüllte Hauptaktion
- [ ] Kein Bedienelement ohne Funktion

**Der Sichttest:** Ein Screenshot der Desktop-Ansicht darf nicht als vergrößerte Handy-Ansicht erkennbar sein — und umgekehrt. Unterschiedliche Spaltenzahl, unterschiedliche Informationsdichte.

---

## 9. Was ausdrücklich nicht dazugehört

Damit der Umfang nicht wächst:

- Keine neuen Funktionen. Dies ist ein Gestaltungsdurchgang.
- Keine zusätzliche Schrift, keine externen Einbindungen. Die eigene Handschrift entsteht über Anzeigetafel, Versalien und Dichte — nicht über eine neue Schriftart.
- Keine Symbolbibliothek zusätzlich zur vorhandenen
- Keine Farbverläufe, keine Glasoptik, keine weichen Schlagschatten
- Keine Animationen über die zwei genannten hinaus
- **Keine Änderungen an Feed, Fotomodul oder anderen Teilen von [kru:]nest.** Die Tokens dieses Plans gelten ausschließlich innerhalb von `.t-mod` und dürfen nicht ins globale Stylesheet wandern.
