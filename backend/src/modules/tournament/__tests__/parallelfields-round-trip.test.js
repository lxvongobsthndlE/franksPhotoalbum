/**
 * Round-Trip für die Plattenzahl: Wizard/Einstellungen → Validator →
 * config-Spalte → mergeConfig → generateSchedule.
 *
 * Warum es diesen Test gibt (2026-08-28): Der Betreiber meldete einen
 * Spielplan mit genau EINEM Spiel je Anstoßzeit, alles auf „Platte 1",
 * obwohl mehrere Platten eingestellt waren. Diese Fehlerklasse ist im Repo
 * mehrfach belegt — ein Wizard-Wert, der unterwegs verloren geht oder
 * hartcodiert überschrieben wird (`matchDuration`, `parallelFields`,
 * Bug 2 vom 2026-08-17), und ein PATCH auf die JSON-Spalte, der still
 * andere Felder derselben Spalte löscht (2026-08-26).
 *
 * Die Tests hier sind so gebaut, dass sie FALLEN, sobald jemand die
 * Plattenzahl unterwegs festnagelt: Sie prüfen für mehrere verschiedene
 * Werte, dass die Engine tatsächlich so viele Platten belegt — ein
 * Hardcode auf irgendeinen festen Wert kann nicht alle erfüllen.
 */

import { describe, it, expect } from 'vitest';
import { validateConfigPatch } from '../config-validator.js';
import { mergeConfig } from '../engine/config.js';
import { generateSchedule } from '../engine/schedule.js';
import { generateTournament } from '../engine/index.js';
import { buildRoundRobinMatches } from '../engine/round-robin.js';

const baseDate = new Date('2026-09-05');

function gruppenSpiele(gruppen, teamsProGruppe) {
  const alle = [];
  for (let g = 0; g < gruppen; g++) {
    const key = String.fromCharCode(65 + g);
    const ids = Array.from({ length: teamsProGruppe }, (_, i) => `${key}${i + 1}`);
    for (const rm of buildRoundRobinMatches(ids)) {
      alle.push({ ...rm, id: `${key}-${rm.bracketPos}`, stageType: 'group', groupKey: key });
    }
  }
  return alle;
}

/** Wie viele Platten belegt der Plan im am stärksten belegten Zeitfenster? */
function maxPlattenGleichzeitig(plan) {
  const nach = new Map();
  for (const m of plan) {
    const z = new Date(m.scheduledAt).getTime();
    if (!nach.has(z)) nach.set(z, new Set());
    nach.get(z).add(m.field);
  }
  return Math.max(...[...nach.values()].map((s) => s.size));
}

describe('parallelFields kommt vom Client bis in die Engine', () => {
  for (const platten of [1, 2, 3, 4, 6]) {
    it(`${platten} Platten: Validator → mergeConfig → generateSchedule`, () => {
      // 1. Der Wert, den der Client schickt (buildPatchPayload →
      //    PATCH /api/tournaments/:id, Body: { config: { schedule: … } }).
      const eingang = { schedule: { parallelFields: platten, matchDurationMinutes: 20 } };

      // 2. Validator: der Wert muss die Whitelist überleben.
      const geprueft = validateConfigPatch(eingang);
      expect(geprueft.ok).toBe(true);
      expect(geprueft.value.schedule.parallelFields).toBe(platten);

      // 3. So liegt er in der config-Spalte, so liest ihn /generate und
      //    /reschedule (routes.js: mergeConfig(ctx.tournament.config)).
      const config = mergeConfig(geprueft.value);
      expect(config.schedule.parallelFields).toBe(platten);
      // Defaults der übrigen schedule-Felder dürfen dabei nicht verloren gehen.
      expect(config.schedule.startTime).toBe('10:00');

      // 4. Die Engine muss ihn auch BENUTZEN. 8 Gruppen à 4 Teams sind 48
      //    Spiele — genug, dass jede Plattenzahl bis 6 voll ausgereizt wird.
      const plan = generateSchedule(gruppenSpiele(8, 4), config, baseDate);
      expect(maxPlattenGleichzeitig(plan)).toBe(platten);
      expect(new Set(plan.map((m) => m.field))).toEqual(
        new Set(Array.from({ length: platten }, (_, i) => i + 1))
      );
    });
  }

  it('generateTournament reicht die Plattenzahl bis zum fertigen Spielplan durch', () => {
    // Der ganze Weg, wie POST /:id/generate ihn geht: config-Spalte rein,
    // Gruppen + Bracket + Zeitplan raus.
    for (const platten of [2, 3, 5]) {
      const teams = Array.from({ length: 16 }, (_, i) => ({
        id: `t${i + 1}`,
        name: `Team ${i + 1}`,
        seed: i + 1,
      }));
      const gen = generateTournament({
        teams,
        config: {
          mode: 'groups_ko',
          numGroups: 4,
          qualifyPerGroup: 2,
          schedule: {
            matchDurationMinutes: 30,
            pauseAfterMatches: 0,
            parallelFields: platten,
            startTime: '10:00',
          },
        },
        baseDate: '2026-09-05',
      });
      const gruppenPlan = gen.groups.flatMap((g) => g.matches);
      expect(maxPlattenGleichzeitig(gruppenPlan), `${platten} Platten`).toBe(platten);
    }
  });

  it('ein Zeitplan-PATCH löscht die übrigen schedule-Werte nicht', () => {
    // Die zweite belegte Falle: PATCH auf eine JSON-Spalte, der still
    // andere Felder derselben Spalte überschreibt. routes.js merged
    // deshalb `{ ...bestehend.schedule, ...neu.schedule }`; hier ist die
    // Zusicherung dazu auf Config-Ebene.
    const bestehend = {
      schedule: { parallelFields: 4, startTime: '09:30', matchDurationMinutes: 25 },
      fields: [{ id: 'f1', name: 'Beach Court', order: 0 }],
    };
    const patch = validateConfigPatch({ schedule: { matchDurationMinutes: 40 } });
    expect(patch.ok).toBe(true);
    const zusammen = {
      ...bestehend,
      ...patch.value,
      schedule: { ...bestehend.schedule, ...patch.value.schedule },
    };
    expect(zusammen.schedule.parallelFields).toBe(4);
    expect(zusammen.schedule.startTime).toBe('09:30');
    expect(zusammen.schedule.matchDurationMinutes).toBe(40);
    expect(zusammen.fields).toHaveLength(1);
  });

  it('minRestSlots und groupLookaheadRounds fallen nicht mehr still aus der Whitelist', () => {
    // Beide liest die Engine, der Validator kannte sie bis 2026-08-28 nicht
    // — und weil er eine Whitelist baut, verschwanden sie beim PATCH
    // wortlos. Der Turnierleiter stellte etwas ein, das nie ankam.
    const ok = validateConfigPatch({ schedule: { minRestSlots: 0, groupLookaheadRounds: 2 } });
    expect(ok.ok).toBe(true);
    expect(ok.value.schedule.minRestSlots).toBe(0);
    expect(ok.value.schedule.groupLookaheadRounds).toBe(2);

    expect(validateConfigPatch({ schedule: { minRestSlots: 9 } }).ok).toBe(false);
    expect(validateConfigPatch({ schedule: { groupLookaheadRounds: -1 } }).ok).toBe(false);
  });

  it('parallelFields = 1 ist der Notnagel, nicht der Normalfall', () => {
    // Genau das Bild aus dem Screenshot vom 2026-08-28: ein Spiel je
    // Anstoßzeit, alles auf Platte 1. Der Test hält fest, dass das NUR bei
    // parallelFields = 1 herauskommt — wer es sonst irgendwo sieht, hat
    // einen verlorenen Konfigurationswert, keinen Planer-Fehler.
    const plan = generateSchedule(gruppenSpiele(2, 4), mergeConfig({}), baseDate);
    expect(new Set(plan.map((m) => m.field))).toEqual(new Set([1]));
    const zeiten = plan.map((m) => m.scheduledAt.getTime());
    expect(new Set(zeiten).size).toBe(plan.length); // jedes Spiel ein eigenes Fenster
  });
});
