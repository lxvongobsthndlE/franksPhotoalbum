/**
 * Das Upload-Modal muss in seinen Rahmen passen — und das X erreichbar bleiben.
 *
 * Gemeldet am 2026-08-31 mit Screenshot vom Handy, woertlich: „die funktion
 * 'medien hochladen' ist zu hoch (...) es ist auch so hoch, dass ich nichtmal
 * das x verwenden kann ums zu schliessen."
 *
 * Gemessen am Pruefstand (msedge, 393x852, --sat 59 / --sab 34 injiziert):
 *   LIVE-Stand (main)  Kopfzeile top = 17, X-Rechteck 41..69 — beides
 *                      vollstaendig INNERHALB der Dynamic Island (0..59).
 *   nach dem Fix       Kopfzeile top = 76, X-Rechteck 84..124, 40x40.
 *
 * Zwei Ursachen, die dieser Test getrennt festnagelt:
 *
 *   1. HOEHENRECHNUNG. `.modal-bg` polstert das Overlay (8px + Inset je
 *      Seite) und `.modal` setzt zusaetzlich `margin: 8px`. Die max-height
 *      zog aber nur die 16px des Overlays ab, nicht die 16px des eigenen
 *      Randes. Die Karte war damit 16px hoeher als ihr Rahmen, das Overlay
 *      bekam eine eigene Scrollleiste (scrollHeight 868 bei 852 Viewport)
 *      und die Titelzeile liess sich unter die Statusleiste schieben —
 *      genau das Bild, das der Safe-Area-Fix (d72c43f) verhindern sollte.
 *      Der Test rechnet die Klammern deshalb NACH, statt eine Zahl
 *      auswendig zu lernen: wer das Padding oder den Rand aendert, muss
 *      die max-height mitaendern, sonst faellt der Test.
 *
 *   2. TREFFERFLAECHE. Das X war 24x28 gross — kleiner als jede
 *      Daumenkuppe und kleiner als die 44px, die Apple/WCAG nennen.
 *      Unterhalb 900px gilt deshalb 40x40 als Mindestmass (der sichtbare
 *      Glyph bleibt klein, nur der Treffbereich waechst).
 *
 * Machart: Quelltext-Scan auf `main.css`, wie in den uebrigen CSS-Tests
 * dieses Verzeichnisses. Vor dem Vergleich werden Kommentare entfernt und
 * Leerraum normalisiert — ein `prettier --write` darf den Test nicht
 * kippen (siehe Memory `textscan-tests-brechen-beim-reformat`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const CSS_PFAD = join(HIER, '..', '..', 'style', 'main.css');

/** Kommentare raus, Leerraum auf ein Leerzeichen — reformat-fest. */
function normalisiere(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
}

/**
 * Schneidet den Mobil-Block heraus, in dem `.modal` steht. Geklammert
 * wird gezaehlt, nicht per Regex gematcht — der Block enthaelt selbst
 * verschachtelte @media-Regeln.
 */
function mobilBlockMitModal(css) {
  const marke = '@media (max-width: 900px) {';
  let von = -1;
  while ((von = css.indexOf(marke, von + 1)) !== -1) {
    let tiefe = 0;
    for (let i = von + marke.length - 1; i < css.length; i++) {
      if (css[i] === '{') tiefe++;
      else if (css[i] === '}') {
        tiefe--;
        if (tiefe === 0) {
          const block = css.slice(von, i + 1);
          if (/\.modal \{/.test(normalisiere(block))) return normalisiere(block);
          break;
        }
      }
    }
  }
  throw new Error('Kein @media(max-width:900px)-Block mit .modal gefunden');
}

/**
 * Liest den Rumpf EINER Regel aus dem normalisierten Block. Bewusst per
 * indexOf statt per gebautem RegExp: der Selektor enthaelt Punkte und
 * Bindestriche, und eine falsch maskierte Zeichenklasse wuerde hier still
 * die falsche Regel treffen statt zu scheitern.
 */
function regel(block, selektor) {
  const marke = ' ' + selektor + ' {';
  const von = (' ' + block).indexOf(marke);
  if (von === -1) throw new Error(`Regel ${selektor} nicht im Mobil-Block`);
  const start = von + marke.length - 1;
  const bis = block.indexOf('}', start);
  return block.slice(start, bis);
}

const css = readFileSync(CSS_PFAD, 'utf8');
const block = mobilBlockMitModal(css);

describe('Upload-Modal unterhalb 900px', () => {
  it('zieht BEIDE Klammern ab — Overlay-Padding und eigenen Rand', () => {
    const bg = regel(block, '.modal-bg');
    const modal = regel(block, '.modal');

    // Grundabstand des Overlays (die Insets stehen daneben als var()).
    const padOben = bg.match(/padding: calc\((\d+)px \+ var\(--sat\)\)/);
    const padUnten = bg.match(/calc\((\d+)px \+ var\(--sab\)\)/);
    expect(padOben, '.modal-bg padding-top traegt --sat').not.toBeNull();
    expect(padUnten, '.modal-bg padding-bottom traegt --sab').not.toBeNull();

    const rand = modal.match(/margin: (\d+)px/);
    expect(rand, '.modal hat einen eigenen Rand').not.toBeNull();

    const soll = Number(padOben[1]) + Number(padUnten[1]) + 2 * Number(rand[1]);

    // Die dvh-Zeile ist die massgebliche; die vh-Zeile davor ist nur der
    // Fallback fuer Browser ohne dvh und muss dieselbe Zahl tragen.
    const dvh = modal.match(/max-height: calc\(100dvh - (\d+)px - var\(--sat\) - var\(--sab\)\)/);
    const vh = modal.match(/max-height: calc\(100vh - (\d+)px\)/);
    expect(dvh, 'max-height rechnet mit 100dvh und beiden Insets').not.toBeNull();
    expect(vh, 'Fallback-Zeile mit 100vh existiert').not.toBeNull();

    expect(Number(dvh[1]), `max-height muss ${soll}px abziehen (Padding + Rand)`).toBe(soll);
    expect(Number(vh[1]), 'Fallback zieht denselben Betrag ab').toBe(soll);
  });

  it('haelt die Kopfzeile starr — sie traegt das Schliessen-X', () => {
    const hdr = regel(block, '.modal-hdr');
    expect(hdr, 'Kopfzeile darf nicht schrumpfen').toMatch(/flex: 0 0 auto/);
    // Gescrollt wird der Rumpf, nicht die Karte: min-height:0 erlaubt ihm,
    // unter seine Inhaltshoehe zu schrumpfen.
    expect(regel(block, '.modal-body')).toMatch(/min-height: 0/);
  });

  it('gibt dem X eine Trefferflaeche von mindestens 40px', () => {
    const x = regel(block, '.modal-x');
    const breite = x.match(/width: (\d+)px/);
    const hoehe = x.match(/height: (\d+)px/);
    expect(breite, '.modal-x hat eine feste Breite').not.toBeNull();
    expect(hoehe, '.modal-x hat eine feste Hoehe').not.toBeNull();
    expect(Number(breite[1])).toBeGreaterThanOrEqual(40);
    expect(Number(hoehe[1])).toBeGreaterThanOrEqual(40);
  });

  it('kappt die Ablegeflaeche — sie war der groesste Einzelposten', () => {
    const dz = regel(block, '.dz');
    const pad = dz.match(/padding: (\d+)px/);
    expect(pad, '.dz hat auf dem Handy einen eigenen Innenabstand').not.toBeNull();
    // Basiswert ist 48px (main.css .dz) — auf dem Handy deutlich darunter.
    expect(Number(pad[1])).toBeLessThanOrEqual(28);
  });
});
