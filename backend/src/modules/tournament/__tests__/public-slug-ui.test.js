/**
 * Der Anbau im Einstellungen-Tab (28.08.2026).
 *
 * Geprüft wird hier, was ohne Browser prüfbar ist — und das ist genau
 * das, worauf es ankommt:
 *
 *   1. Der Warntext. Er ist die einzige Stelle, an der der Betreiber
 *      erfährt, dass sein gedruckter Aushang mit dem nächsten Klick ins
 *      Leere zeigt. Eine Zusage dieser Tragweite gehört unter Test.
 *   2. Das Markup. Es darf keinen veränderlichen Wert interpolieren —
 *      alles Dynamische wird später über `.value`/`.textContent`
 *      gesetzt. Ein Turniername mit spitzen Klammern soll hier nichts
 *      anrichten können.
 *
 * Was hier NICHT geprüft wird: das Anhängen an den DOM. Dafür bräuchte
 * es eine Seite mit dem Nachbar-Block darin, und der wird von einer
 * anderen Datei gerendert. Diese Lücke ist benannt, nicht übersehen —
 * sie deckt die Browser-Abnahme ab.
 */

import { describe, it, expect } from 'vitest';
import { slugWarnung, baueSlugEditorMarkup } from '../../../../public/script/tournament.js';

describe('slugWarnung — „dein alter Link stirbt gleich"', () => {
  const stand = { slug: 'herbst-2026', url: 'https://krunest.de/t/herbst-2026' };

  it('schweigt, solange es keinen alten Namen gibt', () => {
    expect(slugWarnung({ slug: null, url: null }, 'sommerfest')).toBe('');
    expect(slugWarnung({}, 'sommerfest')).toBe('');
    expect(slugWarnung(null, 'sommerfest')).toBe('');
  });

  it('schweigt, wenn sich nichts ändert', () => {
    expect(slugWarnung(stand, 'herbst-2026')).toBe('');
    // Auch in der ungeschriebenen Form — der Vergleich läuft über die
    // Normalisierung, nicht über den rohen Text.
    expect(slugWarnung(stand, 'Herbst 2026')).toBe('');
  });

  it('schweigt bei leerer Eingabe — das ist der Abgabe-Fall, kein Umbenennen', () => {
    expect(slugWarnung(stand, '')).toBe('');
    expect(slugWarnung(stand, '   ')).toBe('');
  });

  it('warnt beim echten Umbenennen und nennt den sterbenden Link beim Namen', () => {
    const text = slugWarnung(stand, 'Winter 2027');
    expect(text).toContain('https://krunest.de/t/herbst-2026');
    expect(text).toMatch(/keine Weiterleitung/i);
    expect(text).toMatch(/Zufallslink bleibt g/i);
  });

  it('kommt ohne die volle URL aus, wenn der Stand sie nicht kennt', () => {
    const text = slugWarnung({ slug: 'herbst-2026' }, 'winter-2027');
    expect(text).toContain('/t/herbst-2026');
  });

  it('ist deutsch und in du-Form gehalten', () => {
    const text = slugWarnung(stand, 'winter-2027');
    expect(text).not.toMatch(/[\u3000-\u9fff]/);
    expect(text).not.toMatch(/\bSie\b/);
  });
});

describe('baueSlugEditorMarkup', () => {
  const html = baueSlugEditorMarkup();

  it('bringt Feld, Vorschau, Fehlerzeile, Warnung und beide Knöpfe mit', () => {
    expect(html).toContain('data-role="public-slug-editor"');
    expect(html).toContain('data-role="public-slug-input"');
    expect(html).toContain('data-role="public-slug-vorschau"');
    expect(html).toContain('data-role="public-slug-fehler"');
    expect(html).toContain('data-role="public-slug-warnung"');
    expect(html).toContain('data-action="save-public-slug"');
    expect(html).toContain('data-action="reset-public-slug"');
  });

  it('interpoliert nichts — kein einziger Platzhalter im Ergebnis', () => {
    // Wenn hier jemals ein `${…}` landet, ist der nächste Schritt ein
    // Turniername im Markup und damit eine Einfallstelle.
    expect(html).not.toContain('${');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  it('erklärt offen, dass ein sprechender Link erratbar ist', () => {
    // Die ehrliche Zeile ist Teil der Abwägung, nicht Deko. Fällt sie
    // weg, sieht das Feature harmloser aus, als es ist.
    expect(html).toMatch(/leichter zu erraten/i);
    expect(html).toMatch(/Spielernamen/i);
  });

  it('ist deutsch, in du-Form, ohne Fremdzeichen', () => {
    expect(html).not.toMatch(/[\u3000-\u9fff]/);
    expect(html).not.toMatch(/\bIhre\b|\bIhren\b/);
  });

  it('das Eingabefeld ist beschriftet', () => {
    expect(html).toMatch(/aria-label="[^"]+"/);
  });
});
