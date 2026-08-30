/**
 * Querformat-Zusage des K.-o.-Bogens (2026-08-30).
 *
 * Die RANGFOLGE der beiden @media-print-Blöcke prüft
 * `druck-und-mobil.test.js` mit einem strukturierten Parser — hier
 * steht nur, was der nicht abdeckt: der Turnierbaum liegt auf einer
 * BENANNTEN Querformat-Seite. Zwei Sessions haben dieselbe Rangfolge
 * am selben Tag unabhängig gebaut (Merge 5b28884); das Querformat gab
 * es nur einmal, und ohne Test wäre es beim nächsten Aufräumen der
 * Doppelstruktur das erste, was still mitgelöscht wird.
 *
 * Warum eine benannte Seite: `@page { size: landscape }` global würde
 * auch Spielplan und Gruppentabellen querlegen. `@page bogen-quer` +
 * `page: bogen-quer` dreht genau das eine Blatt; Engines ohne benannte
 * Seiten drucken den Baum hochkant kleiner skaliert — lesbar, nur
 * nicht optimal.
 *
 * Machart: kein Textscan über die ganze Datei (Textscan-Tests brechen
 * beim Reformat, siehe Memory), sondern erst die @media-print-Blöcke
 * per Klammerzählung ausschneiden, dann darin whitespace-tolerant
 * suchen.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'style',
  'tournament.css'
);
const css = readFileSync(cssPath, 'utf8');

/** Alle `@media print { … }`-Blöcke, per Klammerzählung ausgeschnitten. */
function mediaPrintBloecke(quelle) {
  const bloecke = [];
  const re = /@media\s+print\s*\{/g;
  let m;
  while ((m = re.exec(quelle))) {
    let tiefe = 1;
    let i = re.lastIndex;
    while (i < quelle.length && tiefe > 0) {
      if (quelle[i] === '{') tiefe += 1;
      else if (quelle[i] === '}') tiefe -= 1;
      i += 1;
    }
    bloecke.push(quelle.slice(re.lastIndex, i - 1));
  }
  return bloecke;
}

const druckCss = mediaPrintBloecke(css).join('\n');

/** Erste Deklarationsliste direkt hinter einem Selektor-Muster. */
function regelKoerper(quelle, selektorMuster) {
  const re = new RegExp(selektorMuster.source + String.raw`\s*\{([^{}]*)\}`, 'm');
  const treffer = quelle.match(re);
  return treffer ? treffer[1] : null;
}

describe('Der K.-o.-Bogen druckt quer', () => {
  it('es gibt @media-print-Blöcke (sonst misst dieser Test Luft)', () => {
    expect(mediaPrintBloecke(css).length).toBeGreaterThanOrEqual(2);
  });

  it('die benannte Seite bogen-quer ist A4 landscape', () => {
    const seite = regelKoerper(druckCss, /@page\s+bogen-quer/);
    expect(seite).toBeTruthy();
    expect(seite).toMatch(/size:\s*A4\s+landscape/);
  });

  it('der Quer-Bogen liegt auf genau dieser Seite', () => {
    const zuweisung = regelKoerper(druckCss, /\.t-bogen--quer/);
    expect(zuweisung).toBeTruthy();
    expect(zuweisung).toMatch(/page:\s*bogen-quer/);
  });

  it('die Hochformat-Bögen bleiben hoch — kein globaler landscape-Schwenk', () => {
    // Ein `size: … landscape` darf NUR in der benannten @page stehen.
    const globaleQuerSeiten = (druckCss.match(/landscape/g) || []).length;
    const benannte = (druckCss.match(/@page\s+bogen-quer/g) || []).length;
    expect(benannte).toBe(1);
    expect(globaleQuerSeiten).toBe(1);
  });
});
