/**
 * Config-Validator für Tournament-PATCH.
 *
 * Spec §3 (Config-Schema) + §5.4 (Tiebreaker-Reihenfolge) + §13
 * ("keine stillen Annahmen"): der Client darf KEIN beliebiges JSON in
 * die DB schreiben. Unbekannte Schlüssel werden verworfen, Wertebereiche
 * geprüft, ungültige Werte führen zu 400.
 *
 * Dieses Modul hat absichtlich keinen DB-Zugriff — pure Funktion,
 * voll unit-testbar. Die Route ruft `validateConfigPatch(input)` auf,
 * bekommt entweder `{ ok: true, value }` (gespeichert werden darf)
 * oder `{ ok: false, error, message, field }` (Route antwortet 400).
 *
 * Felder, die hier NICHT stehen, gehören NICHT in config (z. B.
 * numGroups, groupSize, baseDate — die gehören in den /generate-Body).
 */

export const ALLOWED_TIEBREAKERS = Object.freeze([
  'points',
  'goalDiff',
  'goalsFor',
  'goalsAgainst',
  'headToHead',
  'wins',
]);

export const ALLOWED_DISTRIBUTION = Object.freeze(['snake', 'random', 'manual']);
export const ALLOWED_SEED_PROTECTION = Object.freeze(['group', 'none']);

/**
 * @typedef {{
 *   ok: true,
 *   value: object,         // gefilterte Config (nur erlaubte Schlüssel, geprüfte Werte)
 * }} ValidationOk
 * @typedef {{
 *   ok: false,
 *   error: string,         // 'invalid_config'
 *   message: string,       // menschenlesbar, deutsch
 *   field: string|null,    // welcher Schlüssel hat das Problem
 * }} ValidationFail
 */

/**
 * Validiert ein Config-Patch-Objekt.
 *
 * @param {unknown} input — beliebiges JSON aus dem Request-Body.
 * @returns {ValidationOk | ValidationFail}
 */
export function validateConfigPatch(input) {
  if (input == null) {
    return { ok: true, value: {} };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'invalid_config',
      message: 'Config muss ein Objekt sein.',
      field: null,
    };
  }

  const out = {};
  const src = input;

  // ---- Anzahl Gruppen (Bug A, 2026-08-17)
  //
  // Vor diesem Fix stand numGroups nur im /generate-Body — die Engine
  // konnte es dort lesen, aber config.numGroups blieb null. Bei
  // Re-Generate oder /reschedule fehlte der Wert, und die Engine
  // fiel auf 1 Gruppe zurück. Jetzt darf der Wizard numGroups in
  // config schreiben, und der Validator lehnt ungültige Werte ab.
  if ('numGroups' in src) {
    const v = src.numGroups;
    if (!Number.isInteger(v) || v < 1) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'numGroups muss eine ganze Zahl >= 1 sein.',
        field: 'numGroups',
      };
    }
    out.numGroups = v;
  }
  // ---- Verteilung
  if ('distribution' in src) {
    if (!ALLOWED_DISTRIBUTION.includes(src.distribution)) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'distribution muss einer von ' + ALLOWED_DISTRIBUTION.join(', ') + ' sein.',
        field: 'distribution',
      };
    }
    out.distribution = src.distribution;
  }

  // ---- Punkte (alle >= 0, integer)
  for (const key of ['pointsPerWin', 'pointsPerDraw', 'pointsPerLoss']) {
    if (!(key in src)) continue;
    const v = src[key];
    if (!Number.isInteger(v) || v < 0) {
      return {
        ok: false,
        error: 'invalid_config',
        message: `${key} muss eine ganze Zahl >= 0 sein.`,
        field: key,
      };
    }
    out[key] = v;
  }

  // ---- Tiebreaker-Reihenfolge
  if ('tiebreakers' in src) {
    const tb = src.tiebreakers;
    if (!Array.isArray(tb) || tb.length === 0) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'tiebreakers muss eine nicht-leere Liste sein.',
        field: 'tiebreakers',
      };
    }
    for (const t of tb) {
      if (!ALLOWED_TIEBREAKERS.includes(t)) {
        return {
          ok: false,
          error: 'invalid_config',
          message:
            'Tiebreaker "' +
            t +
            '" ist unbekannt. Erlaubt: ' +
            ALLOWED_TIEBREAKERS.join(', ') +
            '.',
          field: 'tiebreakers',
        };
      }
    }
    // Duplikate-Check
    const seen = new Set();
    for (const t of tb) {
      if (seen.has(t)) {
        return {
          ok: false,
          error: 'invalid_config',
          message:
            'Tiebreaker "' + t + '" ist doppelt. Jeder Sortier­schritt darf nur einmal vorkommen.',
          field: 'tiebreakers',
        };
      }
      seen.add(t);
    }
    out.tiebreakers = tb;
  }

  // ---- Tiebreaker-Rekursionstiefe (harte Obergrenze, §13)
  if ('maxTiebreakerDepth' in src) {
    const v = src.maxTiebreakerDepth;
    if (!Number.isInteger(v) || v < 1) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'maxTiebreakerDepth muss eine ganze Zahl >= 1 sein.',
        field: 'maxTiebreakerDepth',
      };
    }
    out.maxTiebreakerDepth = v;
  }

  // ---- Qualifikation aus Gruppenphase
  if ('qualifyPerGroup' in src) {
    const v = src.qualifyPerGroup;
    if (!Number.isInteger(v) || v < 1) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'qualifyPerGroup muss eine ganze Zahl >= 1 sein.',
        field: 'qualifyPerGroup',
      };
    }
    out.qualifyPerGroup = v;
  }
  if ('bestThirds' in src) {
    const v = src.bestThirds;
    if (!Number.isInteger(v) || v < 0) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'bestThirds muss eine ganze Zahl >= 0 sein.',
        field: 'bestThirds',
      };
    }
    out.bestThirds = v;
  }

  // ---- KO-Konfiguration
  if ('hasThirdPlacePlayoff' in src) {
    if (typeof src.hasThirdPlacePlayoff !== 'boolean') {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'hasThirdPlacePlayoff muss true oder false sein.',
        field: 'hasThirdPlacePlayoff',
      };
    }
    out.hasThirdPlacePlayoff = src.hasThirdPlacePlayoff;
  }
  if ('seedProtection' in src) {
    if (!ALLOWED_SEED_PROTECTION.includes(src.seedProtection)) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'seedProtection muss einer von ' + ALLOWED_SEED_PROTECTION.join(', ') + ' sein.',
        field: 'seedProtection',
      };
    }
    out.seedProtection = src.seedProtection;
  }

  // ---- Zeitplan (schedule.*)
  if ('schedule' in src) {
    const s = src.schedule;
    if (s == null || typeof s !== 'object' || Array.isArray(s)) {
      return {
        ok: false,
        error: 'invalid_config',
        message: 'schedule muss ein Objekt sein.',
        field: 'schedule',
      };
    }
    const sched = {};
    if ('slotMinutes' in s) {
      const v = s.slotMinutes;
      if (!Number.isInteger(v) || v <= 0) {
        return {
          ok: false,
          error: 'invalid_config',
          message: 'schedule.slotMinutes muss eine ganze Zahl > 0 sein.',
          field: 'schedule.slotMinutes',
        };
      }
      sched.slotMinutes = v;
    }
    if ('matchDurationMinutes' in s) {
      const v = s.matchDurationMinutes;
      if (!Number.isInteger(v) || v <= 0) {
        return {
          ok: false,
          error: 'invalid_config',
          message: 'schedule.matchDurationMinutes muss eine ganze Zahl > 0 sein.',
          field: 'schedule.matchDurationMinutes',
        };
      }
      sched.matchDurationMinutes = v;
    }
    if ('pauseAfterMatches' in s) {
      const v = s.pauseAfterMatches;
      if (!Number.isInteger(v) || v < 0) {
        return {
          ok: false,
          error: 'invalid_config',
          message: 'schedule.pauseAfterMatches muss eine ganze Zahl >= 0 sein.',
          field: 'schedule.pauseAfterMatches',
        };
      }
      sched.pauseAfterMatches = v;
    }
    if ('parallelFields' in s) {
      const v = s.parallelFields;
      if (!Number.isInteger(v) || v < 1) {
        return {
          ok: false,
          error: 'invalid_config',
          message: 'schedule.parallelFields muss eine ganze Zahl >= 1 sein.',
          field: 'schedule.parallelFields',
        };
      }
      sched.parallelFields = v;
    }
    if ('startTime' in s) {
      const v = s.startTime;
      if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
        return {
          ok: false,
          error: 'invalid_config',
          message: 'schedule.startTime muss im Format HH:MM sein (z. B. 14:00).',
          field: 'schedule.startTime',
        };
      }
      sched.startTime = v;
    }
    if (Object.keys(sched).length > 0) {
      out.schedule = sched;
    }
  }

  return { ok: true, value: out };
}
