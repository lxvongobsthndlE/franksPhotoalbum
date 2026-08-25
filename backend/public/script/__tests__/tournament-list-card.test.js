/**
 * A4 — Turnierkarte in der Liste (redesign-umsetzung-teil2.md, 2026-08-25).
 *
 * Vorher rendete die Liste `.tournament-card` aus main.css: Status doppelt
 * (Abschnittsüberschrift + Badge), Turniername kleiner als die Überschrift
 * darüber, Kennzahlen als umbrechender Textblock, „Öffnen"-Knopf neben
 * einem Mülleimer.
 *
 * Jetzt `.t-list-card` aus tournament.css — die Klasse existierte bereits
 * vollständig, wurde nur nie benutzt.
 *
 * Geprüft wird hier die reine HTML-Ausgabe. Das Layout selbst (Breiten,
 * Nachtmodus) gehört in die Browser-Abnahme bei 360/390/430/768/1280/1920 —
 * dafür gibt es keinen sinnvollen Unit-Test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  renderTournamentListCard,
  formatTournamentCardDate,
  findMutatingAction,
  findDataActions,
} from '../tournament-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainJsPath = resolve(__dirname, '..', 'main.js');

const ICONS = { more: '<svg data-icon="more"></svg>', trash: '<svg data-icon="trash"></svg>' };

/** Ein vollständiges Turnier, wie prepareTournamentList es liefert. */
function makeInstance(overrides = {}) {
  return {
    id: 'cmt8rdvf200025bxaw12fo47e',
    name: 'Bierpong Turnier 2.0',
    status: 'generated',
    mode: 'groups_ko',
    logoUrl: null,
    startsAt: '2026-09-05T14:00:00.000Z',
    location: 'Gönningen',
    teamCount: 12,
    groupCount: 3,
    matchCount: 26,
    finishedCount: 18,
    ...overrides,
  };
}

function render(overrides = {}, opts = {}) {
  return renderTournamentListCard({
    instance: makeInstance(overrides),
    phase: 'ready',
    isAdmin: true,
    phaseLabel: 'Bereit',
    modeLabel: 'Gruppen + K.-o.',
    icons: ICONS,
    ...opts,
  });
}

describe('formatTournamentCardDate', () => {
  it('liefert Tag.Monat.Jahr', () => {
    expect(formatTournamentCardDate('2026-09-05T14:00:00.000Z')).toBe('05.09.2026');
  });

  it('liefert leeren String statt "Invalid Date"', () => {
    expect(formatTournamentCardDate(null)).toBe('');
    expect(formatTournamentCardDate(undefined)).toBe('');
    expect(formatTournamentCardDate('')).toBe('');
    expect(formatTournamentCardDate('kein Datum')).toBe('');
  });
});

describe('A4: Struktur der Turnierkarte', () => {
  it('nutzt .t-list-card, nicht mehr .tournament-card', () => {
    const html = render();
    expect(html).toContain('class="t-list-card"');
    expect(html).not.toContain('tournament-card');
  });

  it('der Turniername steht als eigene Überschrift auf der Karte', () => {
    const html = render();
    expect(html).toContain('<h3 class="t-list-card-name">Bierpong Turnier 2.0</h3>');
  });

  it('hat keinen „Öffnen"-Knopf mehr — die ganze Karte ist die Aktion', () => {
    const html = render();
    expect(html).not.toContain('Öffnen<');
    expect(html).toContain('data-action="open-instance"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Bierpong Turnier 2.0 öffnen"');
  });

  it('trägt die Instanz-ID für den Klick-Handler', () => {
    const html = render();
    expect(html).toContain('data-instance-id="cmt8rdvf200025bxaw12fo47e"');
  });

  it('zeigt den Status genau einmal — als Badge', () => {
    const html = render();
    const badgeHits = html.match(/>Bereit</g) || [];
    expect(badgeHits).toHaveLength(1);
    expect(html).toContain('t-list-card-status--ready');
  });

  it('Badge-Farbe folgt dem Status, nicht der Phase', () => {
    expect(render({ status: 'draft' })).toContain('t-list-card-status--draft');
    expect(render({ status: 'generated' })).toContain('t-list-card-status--ready');
    expect(render({ status: 'group_stage' })).toContain('t-list-card-status--running');
    expect(render({ status: 'ko_stage' })).toContain('t-list-card-status--running');
    expect(render({ status: 'finished' })).toContain('t-list-card-status--finished');
    // Unbekannter Status fällt auf draft zurück statt ohne Klasse zu rendern.
    expect(render({ status: 'irgendwas' })).toContain('t-list-card-status--draft');
  });

  it('zeigt Datum und Ort statt des wiederholten Status', () => {
    const html = render();
    expect(html).toContain('<div class="t-list-card-date">05.09.2026 · Gönningen</div>');
  });

  it('lässt die Datumszeile ganz weg, wenn weder Datum noch Ort da sind', () => {
    const html = render({ startsAt: null, location: null });
    expect(html).not.toContain('t-list-card-date');
  });

  it('zeigt nur den Ort, wenn kein Datum gesetzt ist', () => {
    const html = render({ startsAt: null });
    expect(html).toContain('<div class="t-list-card-date">Gönningen</div>');
  });
});

describe('A4: Kennzahlen und Fortschritt', () => {
  it('stehen in einer Zeile, ohne Umbruch-Markup', () => {
    const html = render();
    expect(html).toContain(
      '<div class="t-list-card-info">Gruppen + K.-o. · 12 Teams · 3 Gruppen · 26 Spiele</div>',
    );
  });

  it('lässt „Gruppen" weg, wenn es keine gibt (ko_only)', () => {
    const html = render({ groupCount: 0, mode: 'ko_only' }, { modeLabel: 'Nur K.-o.' });
    expect(html).toContain('<div class="t-list-card-info">Nur K.-o. · 12 Teams · 26 Spiele</div>');
  });

  it('zeigt einen Gedankenstrich statt "null", wenn Teams fehlen', () => {
    const html = render({ teamCount: null });
    expect(html).toContain('– Teams');
    expect(html).not.toContain('null Teams');
  });

  it('zeigt den Fortschrittsbalken, sobald Spiele existieren', () => {
    const html = render();
    expect(html).toContain('style="width:69%"'); // 18/26 = 69,2 %
    expect(html).toContain('<div class="t-list-card-progress-label">18 von 26 Spielen</div>');
  });

  it('zeigt keinen Fortschrittsbalken ohne Spiele', () => {
    const html = render({ matchCount: 0, finishedCount: 0 });
    expect(html).not.toContain('t-list-card-progress');
  });

  it('rechnet 0 % statt NaN, wenn nichts gespielt ist', () => {
    const html = render({ finishedCount: 0 });
    expect(html).toContain('style="width:0%"');
    expect(html).not.toContain('NaN');
  });
});

describe('A4: Logo', () => {
  it('zeigt das Turnierlogo als echtes Bild', () => {
    const html = render({ logoUrl: 'https://minio.example/t/logo.png' });
    expect(html).toContain('<img src="https://minio.example/t/logo.png" alt="">');
  });

  it('fällt ohne Logo auf den Anfangsbuchstaben zurück', () => {
    const html = render({ logoUrl: null });
    expect(html).toContain('<span class="t-list-card-logo">B</span>');
  });

  it('fällt ohne Namen auf "T" zurück statt auf einen leeren Kreis', () => {
    const html = render({ name: '', logoUrl: null });
    expect(html).toContain('<span class="t-list-card-logo">T</span>');
    expect(html).toContain('>Turnier</h3>');
  });
});

describe('A4: P1-Read-only — Mitglieder sehen kein Kontextmenü', () => {
  it('isAdmin=false enthält keine mutierende Aktion', () => {
    const html = render({}, { isAdmin: false });
    expect(findMutatingAction(html)).toBeNull();
    expect(html).not.toContain('instance-menu');
    expect(html).not.toContain('instance-delete');
    expect(html).not.toContain('t-list-card-menu');
  });

  it('isAdmin=false darf die Karte trotzdem öffnen', () => {
    const html = render({}, { isAdmin: false });
    expect(findDataActions(html).has('open-instance')).toBe(true);
  });

  it('isAdmin=true bekommt Menü-Knopf und Löschen-Eintrag', () => {
    const html = render();
    const actions = findDataActions(html);
    expect(actions.has('instance-menu')).toBe(true);
    expect(actions.has('instance-delete')).toBe(true);
    // Das Menü ist zu, bis der Knopf gedrückt wird.
    expect(html).toContain('<div class="t-list-card-menu" hidden>');
    expect(html).toContain('aria-expanded="false"');
  });

  it('der Löschen-Eintrag trägt Name und ID für den Bestätigungsdialog', () => {
    const html = render();
    expect(html).toContain('data-instance-name="Bierpong Turnier 2.0"');
  });

  it('kein Mülleimer-Knopf mehr direkt auf der Karte', () => {
    const html = render();
    expect(html).not.toContain('preset-icon-btn');
  });
});

describe('A4: Escaping', () => {
  it('escapt Namen mit HTML-Sonderzeichen', () => {
    const html = render({ name: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapt Anführungszeichen im Namen, damit data-Attribute nicht brechen', () => {
    const html = render({ name: 'Turnier "Nord"' });
    expect(html).toContain('data-instance-name="Turnier &quot;Nord&quot;"');
  });

  it('escapt den Ort', () => {
    const html = render({ location: 'Bar & Grill' });
    expect(html).toContain('Bar &amp; Grill');
  });
});

describe('A4: leere Phasen erscheinen nicht mehr', () => {
  // Der Phasen-Loop selbst lebt in main.js (renderTournamentInstancesPage)
  // und hängt an Modul-Globals, ist also nicht direkt aufrufbar. Statt
  // eines künstlichen Mocks prüfen wir, dass der Platzhaltertext weg ist
  // und der Filter steht — das ist die eigentliche Aussage.
  const source = readFileSync(mainJsPath, 'utf-8');

  it('der Platzhalter-Absatz ist aus dem Renderer entfernt', () => {
    // Nur noch als Kommentar erlaubt — gerendert wird er nicht mehr.
    expect(source).not.toContain('tournament-instance-empty');
  });

  it('leere Phasen-Buckets werden ausgefiltert', () => {
    expect(source).toContain('.filter(([, instances]) => instances.length > 0)');
  });

  it('der Leerzustand unterscheidet Admin und Mitglied', () => {
    expect(source).toContain('Noch kein Turnier angelegt.');
    expect(source).toContain('In dieser Gruppe läuft gerade kein Turnier.');
  });

  it('die Listen-Schale trägt t-mod, sonst fehlen der Karte alle Tokens', () => {
    expect(source).toContain('class="tournament-page-shell t-mod t-list-host"');
  });
});
