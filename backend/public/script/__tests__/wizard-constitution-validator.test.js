/**
 * §9-Konstellations-Validierung (Spec §9, Bug B 2026-08-17).
 *
 * Hintergrund: Der User hat im Bug-Report gemeldet, dass 4 Teams /
 * 2 Gruppen à 2 Teams / Top 2 = 4 Qualifikanten ohne Warnung
 * generiert wurden. Die KO-Phase war sinnlos, weil jeder weiterkam.
 * Spec §9 verlangt: "Wenn eine Konstellation nicht eindeutig
 * auflösbar ist, zeigt die App das dem Veranstalter an."
 *
 * validateConstitution() ist eine Pure-Function. Sie gibt zurück:
 *   { level: 'ok' | 'warn' | 'block', messages: [...] }
 *
 * 'block' deaktiviert den "Turnier generieren"-Button, damit der
 * User die Konstellation reparieren muss, bevor er fortfahren kann.
 *
 * Die hier geprüften Cases sind 1:1 aus dem Bug-Report und Spec §9
 * abgeleitet — wenn die Engine einen neuen Edge-Case dazubekommt,
 * gehört der Test hierher.
 */

import { describe, it, expect } from 'vitest';
import { validateConstitution } from '../tournament.js';

/**
 * Baut einen Minimal-State für die Tests. Die Defaults entsprechen
 * einem sinnvollen 12-Teams-Turnier — die Tests überschreiben die
 * Felder, die sie konkret prüfen wollen.
 */
function makeState(overrides = {}) {
  return {
    mode: 'groups_ko',
    numGroups: 4,
    advancePerGroup: 2,
    bestThirdsCount: 0,
    teams: Array.from({ length: 12 }, (_, i) => ({
      name: `Team ${i + 1}`,
    })),
    ...overrides,
  };
}

describe('validateConstitution — Spec §9', () => {
  describe('Sinnvolle Konstellationen (ok)', () => {
    it('12 Teams / 4 Gruppen / Top 2 = sauberes 8er-KO', () => {
      const r = validateConstitution(makeState());
      expect(r.level).toBe('ok');
      expect(r.messages).toHaveLength(0);
    });

    it('8 Teams / 2 Gruppen / Top 2 = sauberes 4er-KO (Halbfinale)', () => {
      const r = validateConstitution(
        makeState({ teams: Array.from({ length: 8 }, (_, i) => ({ name: `T${i}` })),
                    numGroups: 2, advancePerGroup: 2 })
      );
      expect(r.level).toBe('ok');
    });

    it('10 Teams / 2 Gruppen à 5 / Top 2 = sauberes 4er-KO', () => {
      const r = validateConstitution(
        makeState({ teams: Array.from({ length: 10 }, (_, i) => ({ name: `T${i}` })),
                    numGroups: 2, advancePerGroup: 2 })
      );
      expect(r.level).toBe('ok');
    });

    it('reines K.-o. (ko_only) mit 6 Teams ist OK', () => {
      const r = validateConstitution(
        makeState({ mode: 'ko_only', numGroups: 1,
                    teams: Array.from({ length: 6 }, (_, i) => ({ name: `T${i}` })) })
      );
      // numGroups wird für ko_only ignoriert; das wäre ein „ungültiger"
      // State, aber ko_only kümmert sich nicht um Gruppen. Mit 6 Teams
      // ist es trotzdem ok — K.O.-Baum ohne Gruppenphase.
      // validateConstitution betrachtet aber den numGroups-Stepper
      // (für andere Modi) — daher prüfen wir nur, dass keine
      // QUALIFIERS_GE_TEAMS-Message da ist.
      expect(r.messages.some((m) => m.code === 'QUALIFIERS_GE_TEAMS')).toBe(false);
    });

    it('groups_only mit 1 Gruppe = Ligamodus (§9.7), kein KO', () => {
      const r = validateConstitution(
        makeState({ mode: 'groups_only', numGroups: 1,
                    teams: Array.from({ length: 6 }, (_, i) => ({ name: `T${i}` })) })
      );
      // Sollte nur die Info-Message SINGLE_GROUP_NO_KO haben, kein block.
      expect(r.level).not.toBe('block');
      expect(r.messages.some((m) => m.code === 'SINGLE_GROUP_NO_KO')).toBe(true);
    });
  });

  describe('Sinnlose Konstellationen (block)', () => {
    it('Bug B: 4 Teams / 2 Gruppen / Top 2 = alle kommen weiter', () => {
      const r = validateConstitution(
        makeState({
          teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i}` })),
          numGroups: 2,
          advancePerGroup: 2,
        })
      );
      expect(r.level).toBe('block');
      const msg = r.messages.find((m) => m.code === 'QUALIFIERS_GE_TEAMS');
      expect(msg).toBeDefined();
      expect(msg.severity).toBe('error');
      expect(msg.text).toMatch(/alle.*weiter|sinnlos/);
      // Die Message enthält einen Fix-Vorschlag (advancePerGroup reduzieren).
      expect(msg.fix?.reduceAdvancePerGroup).toBeLessThan(2);
    });

    it('4 Teams / 2 Gruppen / Top 1 + 2 beste Dritte = 4 Qualifikanten', () => {
      // 2 * 1 + 2 = 4 = 4 Teams → ebenfalls sinnlos.
      const r = validateConstitution(
        makeState({
          teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i}` })),
          numGroups: 2,
          advancePerGroup: 1,
          bestThirdsCount: 2,
        })
      );
      expect(r.level).toBe('block');
      expect(r.messages.some((m) => m.code === 'QUALIFIERS_GE_TEAMS')).toBe(true);
    });

    it('3 Teams / 1 Gruppe / Top 2 = 2 Qualifikanten, K.-o. macht keinen Sinn', () => {
      // 1 * 2 = 2, aber 3 Teams → 2 < 3, also NICHT QUALIFIERS_GE_TEAMS.
      // Trotzdem ist die Konstellation fragwürdig — aber §9 erlaubt
      // 1-Gruppen-Fälle explizit. Hier testen wir, dass die Validierung
      // bei 2 < 3 kein block auswirft.
      const r = validateConstitution(
        makeState({
          teams: Array.from({ length: 3 }, (_, i) => ({ name: `T${i}` })),
          numGroups: 1,
          advancePerGroup: 2,
        })
      );
      // 1 Gruppe: groups_only-Verhalten wird hier toleriert (kein
      // harter Block). Aber validieren wir zumindest, dass die Engine
      // nicht silent crasht.
      expect(['ok', 'warn']).toContain(r.level);
    });

    it('keine Teams → block', () => {
      const r = validateConstitution(makeState({ teams: [] }));
      expect(r.level).toBe('block');
      expect(r.messages.some((m) => m.code === 'NO_TEAMS')).toBe(true);
    });

    it('nur 1 Team → block', () => {
      const r = validateConstitution(
        makeState({ teams: [{ name: 'Lonely' }] })
      );
      expect(r.level).toBe('block');
      // Bei 1 Team ist groups_ko mit 4 Gruppen automatisch unsinnig,
      // egal welche Quali-Konfig.
      expect(r.messages.some((m) =>
        m.severity === 'error'
      )).toBe(true);
    });

    it('KO-Modus mit 1 Team → block (KO_WITH_ONE_TEAM)', () => {
      const r = validateConstitution(
        makeState({
          mode: 'ko_only',
          teams: [{ name: 'Solo' }],
        })
      );
      expect(r.level).toBe('block');
    });

    it('Mehr Gruppen als Teams/2 (manipulierter State) → block', () => {
      // Der Stepper lässt das nicht zu, aber wenn der State extern
      // gesetzt wird (z. B. via localStorage-Restore), muss die
      // Validierung es fangen. Bei 4 Teams und 5 Gruppen ist die
      // Konstellation UNABHÄNGIG vom Qualifier-Code problematisch:
      // die reine Gruppenzahl reicht schon.
      const r = validateConstitution(
        makeState({
          teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i}` })),
          numGroups: 5, // mehr als 4/2 = 2
          advancePerGroup: 1, // damit nicht QUALIFIERS_GE_TEAMS zuerst feuert
        })
      );
      expect(r.level).toBe('block');
      // Es muss mindestens eine error-Message da sein. Welcher Code
      // (QUALIFIERS_GE_TEAMS oder TOO_MANY_GROUPS) zuerst kommt,
      // hängt von der internen Reihenfolge ab — das ist hier nicht
      // der Test-Gegenstand.
      expect(r.messages.some((m) => m.severity === 'error')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('fehlende State-Felder (undefined) führen zu safe defaults', () => {
      const r = validateConstitution({
        mode: undefined,
        numGroups: undefined,
        advancePerGroup: undefined,
        bestThirdsCount: undefined,
        teams: [],
      });
      expect(r.level).toBe('block'); // NO_TEAMS
    });

    it('Return-Shape ist stabil für UI-Renderer', () => {
      const r = validateConstitution(makeState());
      expect(r).toHaveProperty('level');
      expect(r).toHaveProperty('messages');
      expect(Array.isArray(r.messages)).toBe(true);
      for (const m of r.messages) {
        expect(m).toHaveProperty('severity');
        expect(m).toHaveProperty('code');
        expect(m).toHaveProperty('text');
      }
    });
  });
});