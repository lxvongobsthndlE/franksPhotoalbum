/**
 * Tests: Turnier-DTO (Sport-Label, Grunddaten).
 *
 * Sicherstellen, dass der DTO die Spaltenbezeichnung passend zum Sport
 * liefert — Spec §5.4. Das Round-Trip baut darauf: Bierpong →
 * scoreLabel "Becher", Fußball → "Tore", Sonstiges → "Punkte".
 */

import { describe, it, expect } from 'vitest';
import {
  prepareTournamentView,
  sportScoreLabel,
  sportScoreShort,
} from '../access/tournament.js';

function rawTournament(overrides = {}) {
  return {
    id: 't-1',
    groupId: 'g-1',
    name: 'Test',
    logoUrl: null,
    coverUrl: null,
    mode: 'groups_ko',
    status: 'draft',
    config: null,
    isPublic: false,
    publicToken: null,
    publicEnabledAt: null,
    publicRevokedAt: null,
    startsAt: null,
    endsAt: null,
    location: null,
    sport: 'becher',
    tableLabels: null,
    createdById: 'u-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

describe('sportScoreLabel', () => {
  it('becher → "Becher"', () => {
    expect(sportScoreLabel('becher')).toBe('Becher');
  });
  it('tore → "Tore"', () => {
    expect(sportScoreLabel('tore')).toBe('Tore');
  });
  it('punkte → "Punkte"', () => {
    expect(sportScoreLabel('punkte')).toBe('Punkte');
  });
  it('unbekannter Sport → Fallback "Tore"', () => {
    expect(sportScoreLabel('fussball')).toBe('Tore');
  });
});

describe('sportScoreShort', () => {
  it('becher → "B."', () => {
    expect(sportScoreShort('becher')).toBe('B.');
  });
  it('tore → "Tore"', () => {
    expect(sportScoreShort('tore')).toBe('Tore');
  });
  it('punkte → "Pkt."', () => {
    expect(sportScoreShort('punkte')).toBe('Pkt.');
  });
});

describe('prepareTournamentView — Grunddaten', () => {
  it('location wird durchgereicht', () => {
    const v = prepareTournamentView(rawTournament({ location: 'Sporthalle' }));
    expect(v.location).toBe('Sporthalle');
  });

  it('location null wenn nicht gesetzt', () => {
    const v = prepareTournamentView(rawTournament({ location: null }));
    expect(v.location).toBe(null);
  });

  it('tableLabels wird als Array durchgereicht', () => {
    const v = prepareTournamentView(rawTournament({
      tableLabels: ['Platte 1', 'Platte 2'],
    }));
    expect(v.tableLabels).toEqual(['Platte 1', 'Platte 2']);
  });

  it('tableLabels null wenn nicht gesetzt', () => {
    const v = prepareTournamentView(rawTournament({ tableLabels: null }));
    expect(v.tableLabels).toBe(null);
  });

  it('tableLabels ungültig (kein Array) → null', () => {
    const v = prepareTournamentView(rawTournament({
      tableLabels: 'Platte 1',
    }));
    expect(v.tableLabels).toBe(null);
  });
});

describe('prepareTournamentView — Sport-Label', () => {
  it('sport "becher" → scoreLabel "Becher"', () => {
    const v = prepareTournamentView(rawTournament({ sport: 'becher' }));
    expect(v.sport).toBe('becher');
    expect(v.scoreLabel).toBe('Becher');
    expect(v.scoreShort).toBe('B.');
  });

  it('sport "tore" → scoreLabel "Tore"', () => {
    const v = prepareTournamentView(rawTournament({ sport: 'tore' }));
    expect(v.scoreLabel).toBe('Tore');
    expect(v.scoreShort).toBe('Tore');
  });

  it('sport "punkte" → scoreLabel "Punkte"', () => {
    const v = prepareTournamentView(rawTournament({ sport: 'punkte' }));
    expect(v.scoreLabel).toBe('Punkte');
    expect(v.scoreShort).toBe('Pkt.');
  });

  it('sport fehlt → Fallback "becher" / "Becher"', () => {
    const raw = rawTournament();
    delete raw.sport;
    const v = prepareTournamentView(raw);
    expect(v.sport).toBe('becher');
    expect(v.scoreLabel).toBe('Becher');
  });
});