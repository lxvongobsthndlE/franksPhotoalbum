/**
 * Tests für den Zuschauer-Link-Block im Einstellungen-Tab.
 *
 * Anlass ist ein echter Fehler vom 26.08.2026: Die Freigabe landete in der
 * Datenbank, der Block zeigte danach aber weiter „Zuschauer-Link erstellen".
 * Kein Fehler, keine Meldung — nur kein Link.
 *
 * Ursache war nicht der Renderer, sondern sein Aufrufer: `loadEinstellungenTab`
 * in main.js baut das `tournament`-Objekt für den Renderer aus einer
 * ABZÄHLBAREN Liste von Feldern zusammen. Was dort fehlt, sieht der Renderer
 * nie — `isPublic` war undefined, also blieb der Block im Ausgangszustand.
 *
 * Deshalb prüft diese Datei beides:
 *   1. den Renderer gegen alle drei Zustände (verhält er sich richtig?)
 *   2. den AUFRUFER per Quelltext-Scan (kommen die Felder überhaupt an?)
 *
 * Punkt 2 ist der eigentliche Wächter. Ein Renderer-Test allein wäre grün
 * gewesen, während der Block im Browser falsch stand.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const skriptVerzeichnis = join(hier, '..');

let renderEinstellungen;

beforeAll(async () => {
  // spielplan-helpers.js hängt sich an `window`. Für den Test genügt ein
  // Minimal-Fenster; die Lock-Logik fällt dann auf ihre Inline-Variante
  // zurück, was für den Link-Block ohne Belang ist.
  globalThis.window = globalThis.window ?? {};
  const mod = await import('../spielplan-helpers.js');
  renderEinstellungen = mod.renderEinstellungen;
});

const basis = (tournament = {}) => ({
  tournament: {
    id: 't1',
    name: 'Sommerturnier',
    status: 'generated',
    startedAt: null,
    config: {},
    isPublic: false,
    publicToken: null,
    ...tournament,
  },
  teams: [],
  groups: [],
  matches: [],
});

describe('Zuschauer-Link-Block — die drei Zustände', () => {
  it('Entwurf: kein Knopf, sondern eine Erklärung', () => {
    const html = renderEinstellungen(basis({ status: 'draft' }), { isAdmin: true });
    expect(html).toContain('Zuschauer-Link');
    expect(html).not.toContain('data-action="create-public-link"');
    expect(html).toMatch(/Entwurf ist, gibt es keinen Zuschauer-Link|generiere zuerst/i);
  });

  it('nicht freigegeben: der Erstellen-Knopf, sonst nichts', () => {
    const html = renderEinstellungen(basis(), { isAdmin: true });
    expect(html).toContain('data-action="create-public-link"');
    expect(html).not.toContain('data-action="revoke-public-link"');
    expect(html).not.toContain('data-public-url');
    expect(html).not.toContain('qr.svg');
  });

  it('freigegeben: URL, Kopieren, QR, Aushang und Widerruf', () => {
    const token = 'A'.repeat(32);
    const html = renderEinstellungen(basis({ isPublic: true, publicToken: token }), {
      isAdmin: true,
    });
    expect(html).toContain('data-public-url');
    expect(html).toContain(`/t/${token}`);
    expect(html).toContain('data-action="copy-public-link"');
    expect(html).toContain(`/api/tournaments/public/${token}/qr.svg`);
    expect(html).toContain('data-action="open-aushang"');
    expect(html).toContain('data-action="revoke-public-link"');
    // Der Erstellen-Knopf gehört jetzt weg — sonst stünden zwei
    // widersprüchliche Angebote nebeneinander.
    expect(html).not.toContain('data-action="create-public-link"');
  });

  it('isPublic ohne Token gilt als NICHT freigegeben', () => {
    // Halber Zustand: Das darf nie einen Link mit "/t/null" erzeugen.
    const html = renderEinstellungen(basis({ isPublic: true, publicToken: null }), {
      isAdmin: true,
    });
    expect(html).toContain('data-action="create-public-link"');
    expect(html).not.toContain('/t/null');
    expect(html).not.toContain('data-public-url');
  });

  it('Mitglieder sehen den Block gar nicht (P1 Read-only)', () => {
    const html = renderEinstellungen(basis({ isPublic: true, publicToken: 'B'.repeat(32) }), {
      isAdmin: false,
    });
    expect(html).not.toContain('data-action="create-public-link"');
    expect(html).not.toContain('data-action="revoke-public-link"');
    expect(html).not.toContain('data-public-url');
  });
});

describe('Turnierlogo-Block', () => {
  it('kein Logo: nur der Hochladen-Knopf', () => {
    const html = renderEinstellungen(basis({ logoUrl: null }), { isAdmin: true });
    expect(html).toContain('Turnierlogo');
    expect(html).toContain('data-action="upload-logo"');
    expect(html).not.toContain('data-action="remove-logo"');
  });

  it('Logo vorhanden: Vorschau, Austauschen und Entfernen', () => {
    const html = renderEinstellungen(basis({ logoUrl: '/api/tournaments/t1/logo' }), {
      isAdmin: true,
    });
    expect(html).toContain('/api/tournaments/t1/logo');
    expect(html).toContain('data-action="upload-logo"');
    expect(html).toContain('data-action="remove-logo"');
  });

  it('die Vorschau trägt einen Cache-Brecher', () => {
    // Der Ablageort ist für jedes Turnier derselbe („logo"), die Adresse
    // also auch. Ohne den Zusatz zeigt der Browser nach dem Austausch
    // weiter das alte Bild — der Upload wirkt dann wirkungslos.
    const html = renderEinstellungen(basis({ logoUrl: '/api/tournaments/t1/logo' }), {
      isAdmin: true,
    });
    expect(html).toMatch(/\/api\/tournaments\/t1\/logo\?v=\d+/);
  });

  it('das Dateifeld erlaubt genau die Formate des Servers', () => {
    // Server-Allowlist ist PNG/JPEG/WebP; SVG ist dort bewusst gesperrt,
    // weil eine Vektordatei Skripte tragen kann.
    const html = renderEinstellungen(basis(), { isAdmin: true });
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).not.toContain('image/svg');
  });

  it('das Logo lässt sich auch im Entwurf und im laufenden Turnier setzen', () => {
    // Anders als der Zuschauer-Link: Ein Logo ändert keine Paarung und
    // kein Ergebnis, es gibt also keinen Grund, es zu sperren.
    for (const status of ['draft', 'generated', 'group_stage', 'finished']) {
      const html = renderEinstellungen(basis({ status }), { isAdmin: true });
      expect(html, `Status ${status}`).toContain('data-action="upload-logo"');
    }
  });

  it('Mitglieder sehen den Block nicht', () => {
    const html = renderEinstellungen(basis({ logoUrl: '/api/tournaments/t1/logo' }), {
      isAdmin: false,
    });
    expect(html).not.toContain('data-action="upload-logo"');
    expect(html).not.toContain('data-action="remove-logo"');
  });
});

describe('Der Aufrufer reicht die Felder durch (Wächter gegen den echten Fehler)', () => {
  let mainQuelle;
  beforeAll(() => {
    mainQuelle = readFileSync(join(skriptVerzeichnis, 'main.js'), 'utf8');
  });

  /**
   * Schneidet das `tournament: { … }`-Literal aus loadEinstellungenTab.
   *
   * Mit Klammerzählung, nicht mit der Suche nach dem nächsten `},`: Im
   * Literal steht `config: t.config || {}`, und ein naiver Schnitt endet
   * genau dort — also mitten drin und vor den Feldern, die dieser Test
   * eigentlich prüfen soll. (Erste Fassung dieses Helfers ist genau
   * darüber gestolpert.)
   */
  function tournamentLiteral() {
    const start = mainQuelle.indexOf('async function loadEinstellungenTab');
    expect(start).toBeGreaterThan(-1);
    const abschnitt = mainQuelle.slice(start, start + 3000);
    const von = abschnitt.indexOf('tournament: {');
    expect(von).toBeGreaterThan(-1);

    const auf = abschnitt.indexOf('{', von);
    let tiefe = 0;
    for (let i = auf; i < abschnitt.length; i += 1) {
      if (abschnitt[i] === '{') tiefe += 1;
      else if (abschnitt[i] === '}') {
        tiefe -= 1;
        if (tiefe === 0) return abschnitt.slice(von, i + 1);
      }
    }
    throw new Error('tournament-Literal nicht geschlossen gefunden');
  }

  it('loadEinstellungenTab gibt isPublic und publicToken an den Renderer', () => {
    const literal = tournamentLiteral();
    expect(literal).toContain('isPublic');
    expect(literal).toContain('publicToken');
  });

  it('loadEinstellungenTab gibt logoUrl an den Renderer', () => {
    // Ohne dieses Feld zeigt der Logo-Block dauerhaft „kein Logo" —
    // dieselbe Falle wie zuvor bei isPublic.
    expect(tournamentLiteral()).toContain('logoUrl');
  });

  it('die bisherigen Felder sind dabei nicht verloren gegangen', () => {
    const literal = tournamentLiteral();
    for (const feld of ['id', 'name', 'status', 'startedAt', 'config']) {
      expect(literal).toContain(feld);
    }
  });
});
