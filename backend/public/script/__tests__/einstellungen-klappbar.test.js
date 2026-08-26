/**
 * Der Fehler, gegen den diese Datei schützt (2026-08-26).
 *
 * Jonas im Browser: „ablauf, spielbetrieb, notfall, gefahrenzone sind
 * ausgeklappt aber es gibt nichts. […] dass 4 einstellungen nonexistent
 * sind und es hier nur leere überschriften gibt ist definitiv ein fehler."
 *
 * Ursache
 * -------
 *   Beim Umbau auf einklappbare Gruppen hat der neue Baustein `gruppe()`
 *   eine EIGENE Struktur erzeugt — `.t-grp` / `.t-grp-kopf` /
 *   `.t-grp-koerper` — neben der bereits vorhandenen
 *   `.t-settings-section`. Der Umschalt-Handler in main.js sucht aber
 *
 *       btn.closest('.t-settings-section')
 *
 *   und fand die neuen Abschnitte deshalb nie. Vier Gruppen hatten eine
 *   Kopfzeile, die auf Klick nichts tat. Der Inhalt war die ganze Zeit
 *   da — er war nur unerreichbar.
 *
 * Warum ein Test und kein Browser-Blick
 * -------------------------------------
 *   Ein Screenshot zeigt eine geschlossene Gruppe. Er zeigt nicht, ob sie
 *   sich öffnen LÄSST — das hängt an einer einzigen Zusicherung zwischen
 *   Renderer und Handler, und genau die steht hier.
 *
 *   Die Lehre war nicht „Handler erweitern", sondern: keine zweite
 *   Struktur für dieselbe Sache. Dieser Test hält das fest, damit die
 *   nächste Abstraktion nicht wieder danebengreift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderEinstellungen } from '../spielplan-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(__dirname, '..', 'main.js'), 'utf-8');

const t = {
  tournament: {
    status: 'generated',
    startedAt: null,
    config: { fields: [], schedule: { matchDurationMinutes: 30, parallelFields: 4 } },
  },
  groups: [{ id: 'g1', key: 'A', name: 'Gruppe A' }],
  teams: [{ id: 't1', name: 'Team 1' }, { id: 't2', name: 'Team 2' }],
  matches: [{ id: 'm1', isFinished: false }],
};
const html = () => renderEinstellungen(t, { isAdmin: true, finishedCount: 0 });

/** Alle Abschnitte samt ihrem Rumpf aus dem HTML schneiden. */
function abschnitte(quelltext) {
  const raus = [];
  const re = /<section class="([^"]*)"[^>]*data-section="([^"]+)"[^>]*data-collapsed="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(quelltext)) !== null) {
    const ab = quelltext.slice(m.index, quelltext.indexOf('</section>', m.index));
    raus.push({ klassen: m[1], name: m[2], zu: m[3] === 'true', inhalt: ab });
  }
  return raus;
}

describe('Einstellungen: einklappbar', () => {
  it('JEDER Abschnitt trägt die Klasse, die der Umschalt-Handler sucht', () => {
    // Das ist der Kern. Der Handler in main.js macht
    // `btn.closest('.t-settings-section')` — ein Abschnitt ohne diese
    // Klasse ist ein toter Kopf.
    const gesucht = MAIN.match(/closest\('([^']*t-settings-section[^']*)'\)/);
    expect(gesucht, 'Der Handler sucht nicht mehr nach .t-settings-section — dann muss dieser Test nachziehen').toBeTruthy();

    const alle = abschnitte(html());
    expect(alle.length, 'gar keine Abschnitte gefunden').toBeGreaterThan(5);
    for (const a of alle) {
      expect(a.klassen, `Abschnitt "${a.name}" trägt die Handler-Klasse nicht`)
        .toContain('t-settings-section');
    }
  });

  it('jeder Abschnitt hat einen Kopf MIT data-action="toggle-section"', () => {
    for (const a of abschnitte(html())) {
      expect(a.inhalt, `Abschnitt "${a.name}" hat keinen Umschalt-Kopf`)
        .toContain('data-action="toggle-section"');
    }
  });

  it('kein Abschnitt ist leer — eine Überschrift ohne Inhalt ist der Fehler', () => {
    // Genau Jonas' Satz: „nur leere überschriften". Ein Abschnitt, der
    // gerendert wird, MUSS etwas zu bedienen haben; sonst gehört er gar
    // nicht gerendert (gruppe() liefert dafür einen leeren String).
    for (const a of abschnitte(html())) {
      const rumpf = a.inhalt.slice(a.inhalt.indexOf('t-settings-section-body'));
      const bedienbar = (rumpf.match(/<(button|input|select)\b/g) || []).length;
      expect(bedienbar, `Abschnitt "${a.name}" ist leer`).toBeGreaterThan(0);
    }
  });

  it('alle Abschnitte sind beim Öffnen zu', () => {
    const alle = abschnitte(html());
    const offen = alle.filter((a) => !a.zu).map((a) => a.name);
    expect(offen, 'diese Abschnitte stehen offen: ' + offen.join(', ')).toEqual([]);
  });

  it('die Parallelstruktur .t-grp ist NICHT zurückgekommen', () => {
    // Sie war der Grund für die toten Köpfe. Ein zweiter Satz Klassen für
    // dieselbe Sache sieht beim Schreiben harmlos aus und trennt sich
    // beim Lesen von allem, was daran hängt.
    expect(html()).not.toContain('t-grp-kopf');
    expect(html()).not.toContain('t-grp-koerper');
    expect(html()).not.toMatch(/class="[^"]*\bt-grp\b/);
  });
});
