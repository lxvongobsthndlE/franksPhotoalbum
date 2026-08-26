/**
 * Tests für die Spielplan-Edit-Erweiterung (Etappe B.7).
 *
 * renderMatchCard bekommt ein drittes Flag `isEdit`. Im Edit-Modus
 * werden die Inputs (HH:MM + Platte) gerendert statt der Read-View-
 * Meta-Zelle. KO-Matches + finished Matches: Inputs sind disabled.
 */

import { describe, it, expect } from 'vitest';
import { renderMatchCard, serializeScheduleInput, resolveFieldName } from '../spielplan-helpers.js';

const sample = {
  id: 'm-1',
  home: { name: 'A', color: '#111' },
  away: { name: 'B', color: null },
  scoreHome: null,
  scoreAway: null,
  scheduledTime: '14:30',
  field: 1,
  isFinished: false,
};

describe('renderMatchCard — Edit-Modus', () => {
  it('isEdit=false rendert Standard-Meta (KEIN Input)', () => {
    const html = renderMatchCard(sample, false, false, null);
    expect(html).not.toContain('t-match-edit-time');
    expect(html).not.toContain('t-match-edit-field');
    expect(html).toContain('14:30');
  });

  it('isEdit=true rendert Inputs für Zeit und Platte', () => {
    const html = renderMatchCard(sample, true, true, null);
    expect(html).toContain('t-match-edit-time');
    expect(html).toContain('t-match-edit-field');
    expect(html).toContain('value="14:30"');
    expect(html).toContain('value="1"');
  });

  it('isEdit=true aber KO-Match: Inputs sind disabled', () => {
    const koMatch = { ...sample, id: 'm-ko', isKo: true };
    const html = renderMatchCard(koMatch, true, true, null);
    expect(html).toContain('t-match-edit-time');
    expect(html).toContain('disabled');
  });

  it('isEdit=true aber finished Match: Inputs sind disabled', () => {
    const finishedMatch = { ...sample, id: 'm-done', isFinished: true };
    const html = renderMatchCard(finishedMatch, true, true, null);
    expect(html).toContain('t-match-edit-time');
    expect(html).toContain('disabled');
  });

  it('HH:MM → Input-Value, scheduledAt (ISO) → Slice(11,16)', () => {
    const withIso = { ...sample, scheduledTime: undefined, scheduledAt: '2026-09-12T15:45:00Z' };
    const html = renderMatchCard(withIso, true, true, null);
    expect(html).toContain('value="15:45"');
  });

  it('XSS: Teamname mit <script> wird escaped', () => {
    const xss = { ...sample, home: { name: '<script>', color: null } };
    const html = renderMatchCard(xss, true, true, null);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('serializeScheduleInput', () => {
  it('HH:MM mit baseDate → ISO-Konvertierung', () => {
    const out = serializeScheduleInput(
      [{ matchId: 'm1', scheduledAt: '14:30' }],
      '2026-09-12T00:00:00Z'
    );
    expect(out.ok).toBe(true);
    expect(out.updates[0].scheduledAt).toBe('2026-09-12T14:30:00.000Z');
  });

  it('field: integer ≥ 1', () => {
    const out = serializeScheduleInput([{ matchId: 'm1', field: 3 }]);
    expect(out.ok).toBe(true);
    expect(out.updates[0].field).toBe(3);
  });

  it('field: null wird durchgelassen', () => {
    const out = serializeScheduleInput([{ matchId: 'm1', field: null }]);
    expect(out.ok).toBe(true);
    expect(out.updates[0].field).toBeNull();
  });

  it('field: string → Fehler', () => {
    const out = serializeScheduleInput([{ matchId: 'm1', field: '1' }]);
    expect(out.ok).toBe(false);
  });

  it('scheduledAt: null → field leer', () => {
    const out = serializeScheduleInput([{ matchId: 'm1', scheduledAt: null }]);
    expect(out.ok).toBe(true);
    expect(out.updates[0].scheduledAt).toBeNull();
  });

  it('leere State → Fehler', () => {
    expect(serializeScheduleInput([]).ok).toBe(false);
    expect(serializeScheduleInput(null).ok).toBe(false);
  });

  it('matchId fehlt → Fehler', () => {
    const out = serializeScheduleInput([{ scheduledAt: '14:30' }]);
    expect(out.ok).toBe(false);
  });
});

describe('resolveFieldName', () => {
  const fields = [
    { id: 'f1', name: 'Tischtennisplatte A', order: 0 },
    { id: 'f2', name: 'Platte 2', order: 1 },
  ];

  it('gibt Namen für bekannte ID zurück', () => {
    expect(resolveFieldName('f1', fields)).toBe('Tischtennisplatte A');
    expect(resolveFieldName('f2', fields)).toBe('Platte 2');
  });

  it('Fallback: numerische ID ohne config baut "Platte N" mit geschuetztem Leerzeichen', () => {
    // 2026-08-26, Fund von Jonas am iPhone SE: die Meta-Zeile der
    // Spielkarte darf umbrechen (damit lange Feldnamen nicht abgeschnitten
    // werden) — sie hat das genutzt und die Nummer auf eine eigene Zeile
    // geschoben, wo sie linksbuendig unter der Uhrzeit stand.
    //
    // Der Fallback ist der EINZIGE Ort, an dem dieser Name entsteht; ein
    // konfigurierter Feldname kommt unveraendert aus der Config.
    const NBSP = String.fromCharCode(160);
    expect(resolveFieldName(3, null)).toBe('Platte' + NBSP + '3');
    expect(resolveFieldName(3, [])).toBe('Platte' + NBSP + '3');
    // Gegenprobe. Ohne sie bliebe der Test auch dann gruen, wenn das NBSP
    // wieder verschwindet: die beiden Zeichen sehen im Quelltext gleich aus.
    expect(resolveFieldName(3, null)).not.toBe('Platte 3');
  });

  it('null/undefined → leerer String', () => {
    expect(resolveFieldName(null, fields)).toBe('');
    expect(resolveFieldName(undefined, fields)).toBe('');
  });
});
