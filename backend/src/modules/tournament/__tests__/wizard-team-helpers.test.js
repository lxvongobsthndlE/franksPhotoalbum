/**
 * Unit-Tests für die pure Team-Helpers im Browser-Code.
 * Step 2 des Wizards (Spec §3, §5).
 *
 * Die Funktionen sind in public/script/tournament-team-helpers.js
 * definiert — ohne DOM, ohne State. Hier testen wir nur die pure Logik:
 *
 *   - isPlaceholderName: erkennt "Team 1", "Team 12"; NICHT "Team A" etc.
 *   - nextPlaceholderName: nimmt max+1, unabhängig von Lücken
 *   - parseTeamInput: Zeilen splitten, Duplikate erkennen, Seeds vergeben
 *   - duplicateNames: deduped Sortier-Liste der Doppelnamen
 *
 * Diese Tests sind die Grundlage dafür, dass "Weiter" nicht durch
 * Platzhalternamen blockiert (§3 Step 2: Platzhalter sind gültig).
 */

import { describe, expect, it } from 'vitest';

import {
  isPlaceholderName,
  nextPlaceholderName,
  parseTeamInput,
  duplicateNames,
} from '../../../../public/script/tournament-team-helpers.js';

describe('isPlaceholderName', () => {
  it('erkennt "Team 1" als Platzhalter', () => {
    expect(isPlaceholderName('Team 1')).toBe(true);
  });

  it('erkennt hohe Nummern (Team 99, Team 128)', () => {
    expect(isPlaceholderName('Team 99')).toBe(true);
    expect(isPlaceholderName('Team 128')).toBe(true);
  });

  it('akzeptiert führende und nachfolgende Whitespace', () => {
    expect(isPlaceholderName('  Team 7  ')).toBe(true);
  });

  it('lehnt "Team" ohne Nummer ab', () => {
    expect(isPlaceholderName('Team')).toBe(false);
    expect(isPlaceholderName('Team ')).toBe(false);
  });

  it('lehnt "Team A" / "Team 1a" ab', () => {
    expect(isPlaceholderName('Team A')).toBe(false);
    expect(isPlaceholderName('Team 1a')).toBe(false);
  });

  it('lehnt echte Teamnamen ab', () => {
    expect(isPlaceholderName('Rakija Boys')).toBe(false);
    expect(isPlaceholderName('FC Bayern München')).toBe(false);
    expect(isPlaceholderName('')).toBe(false);
    expect(isPlaceholderName(null)).toBe(false);
    expect(isPlaceholderName(undefined)).toBe(false);
  });
});

describe('nextPlaceholderName', () => {
  it('bei leerer Liste → "Team 1"', () => {
    expect(nextPlaceholderName([])).toBe('Team 1');
  });

  it('nimmt max+1 auch bei Lücken (1, 2, 5 → "Team 6")', () => {
    expect(nextPlaceholderName([{ name: 'Team 1' }, { name: 'Team 2' }, { name: 'Team 5' }])).toBe(
      'Team 6'
    );
  });

  it('nimmt max+1, ignoriert umbenannte Teams', () => {
    expect(
      nextPlaceholderName([{ name: 'Team 1' }, { name: 'Rakija Boys' }, { name: 'Team 7' }])
    ).toBe('Team 8');
  });

  it('wenn keine Platzhalter da sind, beginnt bei 1', () => {
    expect(nextPlaceholderName([{ name: 'Rakija Boys' }, { name: 'FC Bayern' }])).toBe('Team 1');
  });

  it('verträgt fehlende name-Felder ohne zu werfen', () => {
    expect(nextPlaceholderName([{}, { name: null }, { name: undefined }])).toBe('Team 1');
  });
});

describe('parseTeamInput', () => {
  it('splitet Zeilen, trimmed, filtert Leerzeilen', () => {
    const r = parseTeamInput('A\n\n  B  \nC\n');
    expect(r.entries.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(r.duplicates).toEqual([]);
  });

  it('splitet auch \\r\\n (Windows-Paste)', () => {
    const r = parseTeamInput('A\r\nB\r\nC');
    expect(r.entries.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('Duplikate (case-insensitive) werden markiert, nicht eingefügt', () => {
    const r = parseTeamInput('Foo\nfoo\nFOO\nBar');
    expect(r.entries.map((e) => e.name)).toEqual(['Foo', 'Bar']);
    expect(r.duplicates).toEqual(['foo', 'FOO']);
  });

  it('vergibt fortlaufende seeds', () => {
    const r = parseTeamInput('A\nB\nC');
    expect(r.entries.map((e) => e.seed)).toEqual([1, 2, 3]);
  });

  it('setzt color=null als Initialwert', () => {
    const r = parseTeamInput('A');
    expect(r.entries[0].color).toBeNull();
  });

  it('bei leerem Input → leere Einträge, leere Duplikate', () => {
    const r = parseTeamInput('');
    expect(r.entries).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it('verträgt undefined/null', () => {
    expect(parseTeamInput(undefined).entries).toEqual([]);
    expect(parseTeamInput(null).entries).toEqual([]);
  });
});

describe('duplicateNames', () => {
  it('gibt deduped Liste der doppelt vorkommenden Namen zurück', () => {
    expect(
      duplicateNames([
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'alpha' },
        { name: 'Beta' },
        { name: 'gamma' },
      ])
    ).toEqual(['alpha', 'beta']);
  });

  it('Duplikate erscheinen in der Reihenfolge, in der sie ZWEIMAL auftauchen', () => {
    // Implementierungs-Detail: das erste Vorkommen landet in `seen`,
    // das zweite in `duplicates`. Set insertion-order spiegelt das wider.
    expect(duplicateNames([{ name: 'Z' }, { name: 'A' }, { name: 'a' }, { name: 'Z' }])).toEqual([
      'a',
      'z',
    ]);
  });

  it('ignoriert leere Namen', () => {
    expect(
      duplicateNames([{ name: '' }, { name: '   ' }, { name: 'Foo' }, { name: 'Foo' }])
    ).toEqual(['foo']);
  });

  it('leere Liste → leeres Array', () => {
    expect(duplicateNames([])).toEqual([]);
  });
});

describe('Platzhalter-Workflow: Step 2 lässt sich ohne echte Namen abschließen', () => {
  it('Wizard generiert Platzhalter "Team N" und "Weiter" blockiert nicht', () => {
    // Spec §3 Step 2: "Weiter" darf nicht blockieren, solange Namen
    // gültig sind (Platzhalter zählen als gültig).
    const teams = [];
    for (let i = 1; i <= 12; i++) {
      teams.push({ name: `Team ${i}`, color: null, seed: i });
    }
    for (const t of teams) {
      expect(isPlaceholderName(t.name)).toBe(true);
    }
    expect(duplicateNames(teams)).toEqual([]);
  });

  it('Apply-Count erzeugt lückenlose Platzhalter', () => {
    // Simuliert: User wählt 5, dannach auf 8.
    let teams = [];
    for (let i = 1; i <= 5; i++) {
      teams.push({ name: nextPlaceholderName(teams), color: null, seed: teams.length + 1 });
    }
    for (let i = teams.length; i < 8; i++) {
      teams.push({ name: nextPlaceholderName(teams), color: null, seed: i + 1 });
    }
    expect(teams.map((t) => t.name)).toEqual([
      'Team 1',
      'Team 2',
      'Team 3',
      'Team 4',
      'Team 5',
      'Team 6',
      'Team 7',
      'Team 8',
    ]);
  });

  it('Weg B (Copy-Paste) parst 12 Namen ohne Duplikate', () => {
    const pasted = [
      'Rakija Boys',
      'Bierversorium',
      'Kubb Küken',
      'Los Chungos',
      'Team Tango',
      'Die Schlümpfe',
      'Wüstenfüchse',
      'Nordlichter',
      'Südbande',
      'Ostblock',
      'Westend',
      'Mittelreich',
    ].join('\n');
    const r = parseTeamInput(pasted);
    expect(r.entries).toHaveLength(12);
    expect(r.duplicates).toEqual([]);
    expect(duplicateNames(r.entries)).toEqual([]);
  });
});
