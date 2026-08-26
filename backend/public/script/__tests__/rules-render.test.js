/**
 * Tests für den Regeln-Tab-Renderer (Spec §8.4 Info-Seite).
 *
 * Regressionsschutz für User-Punkt 5: Regelwerk als Tab „Regeln"
 * zwischen Teams und Drucken, Paragraphs only, kein HTML/Markdown.
 *
 * Worauf wir testen:
 *   - Plain-Text mit Leerzeilen → <p>-Tags
 *   - Einzelne \n innerhalb eines Absatzes → <br>
 *   - HTML-Escape: kein <script>, kein onclick
 *   - Leere / null / undefined Eingaben → leerer String
 *   - Trimming: Whitespace-Ränder weg, leere Absätze raus
 */

import { describe, it, expect } from 'vitest';
import { renderRulesParagraphs } from '../rules-helpers.js';

describe('renderRulesParagraphs', () => {
  it('rendert mehrere Absätze als <p>-Liste', () => {
    const html = renderRulesParagraphs('Absatz 1\n\nAbsatz 2\n\nAbsatz 3');
    expect(html).toContain('<p>Absatz 1</p>');
    expect(html).toContain('<p>Absatz 2</p>');
    expect(html).toContain('<p>Absatz 3</p>');
  });

  it('einzelner Absatz ohne Leerzeilen', () => {
    const html = renderRulesParagraphs('Nur ein Absatz.');
    expect(html).toBe('<p>Nur ein Absatz.</p>');
  });

  it('einzelne \\n innerhalb Absatz → <br>', () => {
    const html = renderRulesParagraphs('Zeile 1\nZeile 2\nZeile 3');
    expect(html).toBe('<p>Zeile 1<br>Zeile 2<br>Zeile 3</p>');
  });

  it('Mischung: Absätze UND Zeilenumbrüche', () => {
    const html = renderRulesParagraphs('Regel 1\nFortsetzung\n\nRegel 2\n\nRegel 3');
    expect(html).toContain('<p>Regel 1<br>Fortsetzung</p>');
    expect(html).toContain('<p>Regel 2</p>');
    expect(html).toContain('<p>Regel 3</p>');
  });

  it('trimmt Whitespace am Anfang/Ende des Gesamttexts', () => {
    const html = renderRulesParagraphs('   \n\n  Hallo  \n\n   ');
    expect(html).toBe('<p>Hallo</p>');
  });

  it('ignoriert leere Absätze (doppelte Leerzeilen → keine leeren <p>)', () => {
    const html = renderRulesParagraphs('A\n\n\n\n\nB');
    expect(html).not.toContain('<p></p>');
    expect(html).toContain('<p>A</p>');
    expect(html).toContain('<p>B</p>');
  });

  it('HTML-Escape: kein <script> durchlassen', () => {
    const html = renderRulesParagraphs('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('HTML-Escape: Attribute-Quotes escapen', () => {
    const html = renderRulesParagraphs('Regel mit "Anführungszeichen" und \'Apostroph\'');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('\\r\\n Zeilenenden werden zu \\n normalisiert', () => {
    const html = renderRulesParagraphs('A\r\n\r\nB');
    expect(html).toContain('<p>A</p>');
    expect(html).toContain('<p>B</p>');
  });

  it('gibt leeren String zurück bei null/undefined/leer', () => {
    expect(renderRulesParagraphs(null)).toBe('');
    expect(renderRulesParagraphs(undefined)).toBe('');
    expect(renderRulesParagraphs('')).toBe('');
    expect(renderRulesParagraphs('   ')).toBe('');
  });

  it('gibt leeren String zurück bei nicht-String-Eingaben', () => {
    // Defensive: wenn jemand versehentlich ein Object reinpipet
    expect(renderRulesParagraphs(42)).toBe('');
    expect(renderRulesParagraphs({ foo: 'bar' })).toBe('');
    expect(renderRulesParagraphs(['a', 'b'])).toBe('');
  });

  it('sehr langer Text (>12 KB) bekommt einen Hinweis', () => {
    const long = 'A'.repeat(13000);
    const html = renderRulesParagraphs(long);
    expect(html).toContain('t-rules-overflow-note');
    expect(html).toContain('13000');
  });

  it('sehr viele Absätze (>200) zeigen Overflow-Hinweis', () => {
    const paragraphs = Array.from({ length: 250 }, (_, i) => `Absatz ${i + 1}`);
    const html = renderRulesParagraphs(paragraphs.join('\n\n'));
    expect(html).toContain('t-rules-overflow-note');
    expect(html).toContain('+50 weitere Absätze');
    // Sichtbar sind nur 200.
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(200);
  });
});
