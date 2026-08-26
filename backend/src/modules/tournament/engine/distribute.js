/**
 * Teamverteilung in Gruppen. Spec §5.1.
 *
 * Drei Verfahren:
 *   - 'snake':   1,4,5,8 → A ; 2,3,6,7 → B ; etc. (Setzliste bleibt verteilt)
 *   - 'random':  per RNG (seedbar für Determinismus §10.9)
 *   - 'manual':  Reihenfolge unverändert (UI hat das Sorting schon gemacht)
 *
 * Reste (teams.length % numGroups != 0) werden auf die ersten Gruppen verteilt.
 *
 * Rückgabe:
 *   Array<Array<Team>>      groups[0] = Gruppe A
 *   length = numGroups
 */

import { createHash } from 'node:crypto';

function seedFromString(str) {
  const hash = createHash('sha256').update(str).digest();
  // xorshift32-kompatibler 32-Bit-Seed
  return hash.readUInt32BE(0) || 1;
}

// Deterministischer Mulberry32
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Verteilt Teams in numGroups Gruppen.
 *
 * @param {Array} teams           Team-Roh-Objekte (oder IDs)
 * @param {number} numGroups
 * @param {object} opts           { method, seed }
 * @returns {Array<Array>}        groups
 */
export function distributeTeamsIntoGroups(teams, numGroups, opts = {}) {
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error('distributeTeamsIntoGroups: teams ist leer');
  }
  if (!Number.isInteger(numGroups) || numGroups < 1) {
    throw new Error('distributeTeamsIntoGroups: numGroups muss >= 1 sein');
  }
  if (teams.length < numGroups) {
    throw new Error(
      `distributeTeamsIntoGroups: weniger Teams (${teams.length}) als Gruppen (${numGroups})`
    );
  }

  const method = opts.method ?? 'snake';
  const seed =
    typeof opts.seed === 'string'
      ? seedFromString(opts.seed)
      : (opts.seed ?? seedFromString('default'));

  const groups = Array.from({ length: numGroups }, () => []);

  if (method === 'manual') {
    // Reihenfolge unverändert
    teams.forEach((t, idx) => {
      groups[idx % numGroups].push(t);
    });
    return groups;
  }

  let order = teams.slice();

  if (method === 'random') {
    const rng = mulberry32(seed);
    shuffleInPlace(order, rng);
  }

  // snake: 1→A, 2→B, 3→C, ..., n→A, n-1→B (Setzliste bleibt verteilt)
  // 'snake-back' wäre Alternative, Spec §5.1 sagt aber "snake" üblich.
  //
  // Beispiel 12 Teams / 4 Gruppen: indices 0..11
  //   snake round 0 (forward):  0,1,2,3  → A,B,C,D
  //   snake round 1 (backward): 4,5,6,7  → D,C,B,A  (also 4→D, 7→A)
  //   snake round 2 (forward):  8,9,10,11 → A,B,C,D
  //
  // §5.1: "Reste von vorne aufgefüllt" — wenn der letzte snake-Pass nicht
  // voll wird, füllen wir die vorderen Gruppen auf (sonst landet der Rest
  // bei einem Backward-Pass in der letzten Gruppe).
  let i = 0;
  let forward = true;
  while (i < order.length) {
    if (forward) {
      for (let g = 0; g < numGroups && i < order.length; g++, i++) {
        groups[g].push(order[i]);
      }
    } else {
      const remaining = order.length - i;
      if (remaining < numGroups) {
        // Partial-Backward: von vorne auffüllen statt rechts→links
        for (let g = 0; g < numGroups && i < order.length; g++, i++) {
          groups[g].push(order[i]);
        }
      } else {
        for (let g = numGroups - 1; g >= 0 && i < order.length; g--, i++) {
          groups[g].push(order[i]);
        }
      }
    }
    forward = !forward;
  }

  return groups;
}
