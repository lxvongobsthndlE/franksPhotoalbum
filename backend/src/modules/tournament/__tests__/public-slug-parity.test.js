/**
 * Gleichstand zwischen Server und Browser (28.08.2026).
 *
 * Die Slug-Regeln stehen zweimal im Repo:
 *
 *   src/modules/tournament/public-slug.js   entscheidet
 *   public/script/tournament.js             zeigt die Vorschau
 *
 * Das ist Absicht und kein Versehen: Der Betreiber soll beim Tippen
 * sehen, welche Adresse herauskommt, und dafür braucht der Browser
 * dieselbe Rechnung. Ein Netzaufruf pro Tastendruck wäre die Alternative
 * gewesen — und eine Vorschau, die hinterherhinkt, ist schlimmer als
 * keine.
 *
 * Der Preis dieser Doppelung ist Drift, und der wird hier bezahlt:
 * Beide Fassungen laufen über denselben Eingabe-Korpus, und verglichen
 * wird nicht nur das Urteil, sondern auch der Fehlercode UND der
 * Meldungstext. Der Text steht mit im Vergleich, weil er das ist, was
 * der Mensch liest — eine Vorschau, die „zu kurz" sagt, während der
 * Server „reserviert" antwortet, ist genau die Sorte Widerspruch, die
 * niemand meldet und jeder wegklickt.
 *
 * Das Muster ist dasselbe wie bei locks-parity.test.js und
 * team-colors-parity.test.js: geteilte Wahrheit ohne geteilte Datei.
 */

import { describe, it, expect } from 'vitest';
import { normalisiereSlug, pruefeSlug, RESERVIERTE_SLUGS } from '../public-slug.js';
import {
  normalisiereSlugImBrowser,
  pruefeSlugImBrowser,
  PSLUG_RESERVIERT,
  PSLUG_MIN_LAENGE,
  PSLUG_MAX_LAENGE,
} from '../../../../public/script/tournament.js';
import { SLUG_MIN_LAENGE, SLUG_MAX_LAENGE } from '../public-slug.js';

/**
 * Der Korpus. Jede Zeile steht für eine Art, wie ein Mensch tippt oder
 * wie eine Fassung falsch abbiegen kann — nicht für „möglichst viele".
 */
const KORPUS = [
  '',
  '   ',
  'abc',
  'ab',
  'a',
  'Sommerfest 2026',
  'SOMMERFEST',
  'Grün-Weiß Café',
  'ÄÖÜäöüß',
  'Turnier_Nord.2026',
  'a/b\\c',
  '  --Test--  ',
  'a---b',
  '!!!',
  '★☆✦',
  '-fuehrend',
  'schliessend-',
  'doppel--strich',
  'aushang',
  'Aushang',
  'QR',
  'neu',
  'x'.repeat(SLUG_MAX_LAENGE),
  'x'.repeat(SLUG_MAX_LAENGE + 1),
  'a'.repeat(31),
  'a'.repeat(32),
  'a'.repeat(33),
  'A'.repeat(32),
  '2026',
  'turnier-1-runde-2',
  'über-uns',
  'stra ße',
  'Café-Élan-Öl',
];

describe('Normalisierung ist auf beiden Seiten dieselbe Rechnung', () => {
  for (const eingabe of KORPUS) {
    it(`normalisiert ${JSON.stringify(eingabe)} gleich`, () => {
      expect(normalisiereSlugImBrowser(eingabe)).toBe(normalisiereSlug(eingabe));
    });
  }

  it('auch für Nicht-Zeichenketten', () => {
    for (const wert of [null, undefined, 0, 42, {}, [], true]) {
      expect(normalisiereSlugImBrowser(wert)).toBe(normalisiereSlug(wert));
    }
  });
});

describe('Urteil, Code und Meldung sind auf beiden Seiten dieselben', () => {
  for (const eingabe of KORPUS) {
    it(`urteilt über ${JSON.stringify(eingabe)} gleich`, () => {
      expect(pruefeSlugImBrowser(eingabe)).toEqual(pruefeSlug(eingabe));
    });
  }
});

describe('Die Konstanten laufen nicht auseinander', () => {
  it('Mindest- und Höchstlänge', () => {
    expect(PSLUG_MIN_LAENGE).toBe(SLUG_MIN_LAENGE);
    expect(PSLUG_MAX_LAENGE).toBe(SLUG_MAX_LAENGE);
  });

  it('die Sperrliste ist Wort für Wort dieselbe', () => {
    // Nicht als Menge verglichen, sondern in der Reihenfolge: Wer einen
    // Eintrag ergänzt, ergänzt ihn an derselben Stelle — sonst ist beim
    // nächsten Lesen nicht zu sehen, welche Fassung die neuere ist.
    expect([...PSLUG_RESERVIERT]).toEqual([...RESERVIERTE_SLUGS]);
  });
});
