/**
 * KO-Bracket-Aufbau mit Same-Group-Auflösung. Spec §6.2, §6.3.
 *
 * Eingabe: Qualifikanten mit { seed, teamId, source.groupKey }
 * Ausgabe: Match-Paarungen mit Folge-Match-Verknüpfungen.
 *
 * Algorithmus (Standard-Bracket):
 *   1. Bracket auf Zweierpotenz hochrunden → ggf. Freilose (BYEs).
 *   2. Wenn kein Zweierpotenz: Vorrunde für die überzähligen Teams,
 *      Gewinner rücken ins Hauptbracket. (§6.4 / §9.5)
 *   3. Standard-Paarungen gegen Seed-Schema:
 *      8 Teams:  [1v8, 4v5, 3v6, 2v7]
 *      16 Teams: [1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15]
 *   4. Konfliktprüfung: jedes Match darf max. 1 Team aus derselben Gruppe
 *      enthalten. Konflikte werden per Tausch aufgelöst.
 *   5. Wenn Auflösung nicht möglich → unresolvedConflicts zurück.
 *
 * §6.3.2-Referenz (12 Teams / 3 Gruppen à 4 / Top 2 + 2 beste Dritte):
 *   Setzliste: A1=1, B1=2, C1=3, A2=4, B2=5, C2=6, A3=7, B3=8
 *   Standard-Paarungen:
 *     VF1: 1(A1)  vs 8(B3)
 *     VF2: 4(A2)  vs 5(C2)
 *     VF3: 3(C1)  vs 6(B2)
 *     VF4: 2(B1)  vs 7(A3)
 *   Kein Same-Group-Konflikt.
 */

import { mergeConfig } from './config.js';

// Standard-Paarungs-Mapping für 2^k Teams.
// pairs[i] = [seedA, seedB] für Match in Runde "QF"/"R16"/…
//
// Algorithmus: Tournament-Bit-Reversal.
//   Slot-Position eines Seeds s = reverseBits(s - 1, log2(n)) + 1
//   Dadurch landet Seed 1 oben links, Seed N unten rechts,
//   und im selben "Viertel" liegen Seeds, die frühestens im HF aufeinander treffen.
//   4 Teams:  [1v4, 2v3]
//   8 Teams:  [1v8, 4v5, 3v6, 2v7]   ← §6.3.2-Referenz
//   16 Teams: [1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15]
//
// Innerhalb jedes Paares wird die kleinere Seed-Nummer zuerst notiert
// (Heim-Vorteil-Konvention, irrelevant für die Logik selbst).
function standardPairs(powerOfTwo) {
  const n = powerOfTwo;
  const bits = Math.log2(n);

  // seedToSlot[s] = Position im Bracket-Frame (1..n)
  const seedToSlot = new Array(n + 1);
  for (let s = 1; s <= n; s++) {
    let v = s - 1;
    let r = 0;
    for (let i = 0; i < bits; i++) {
      r = (r << 1) | (v & 1);
      v >>= 1;
    }
    seedToSlot[s] = r + 1;
  }

  // slotToSeed[p] = Seed an Bracket-Position p
  const slotToSeed = new Array(n + 1);
  for (let s = 1; s <= n; s++) {
    slotToSeed[seedToSlot[s]] = s;
  }

  // Bracket-Pos k (1..n/2): Slots k und n-k+1 ergeben das Match.
  // Kleinere Seed-Nummer zuerst → Heim/Auswärts-Konvention.
  const pairs = [];
  for (let k = 1; k <= n / 2; k++) {
    const a = slotToSeed[k];
    const b = slotToSeed[n - k + 1];
    pairs.push(a < b ? [a, b] : [b, a]);
  }
  return pairs;
}

function nearestPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Erzeugt das Bracket.
 *
 * @param {Array} qualifiers        [{ seed, teamId, name, source: { groupKey } }]
 * @param {object} [opts]
 * @param {boolean} [opts.hasThirdPlacePlayoff]
 * @param {number}  [opts.maxIter=16]      §13 Constraint #4
 * @param {number|null} [opts.bracketSizeHint]
 *   Erwartete Qualifikantenzahl, wenn `qualifiers` leer ist (Skelett-Modus).
 *   Wenn gesetzt und `qualifiers.length < 2`, wird ein Skelett-Bracket der
 *   Größe `nearestPowerOfTwo(bracketSizeHint)` gebaut — alle Runden mit
 *   null-Teams und Platzhaltern ("Sieger VF X"). Das KO-Bracket ist
 *   dann sichtbar, aber leer, bis die Gruppenphase durch ist und
 *   `routes.js` /result die Qualifikanten nachpflegt.
 *
 * @returns {{
 *   matches: Array<{ id, round, bracketPos, teamHome, teamAway, winnerAdvancesTo, loserAdvancesTo,
 *                    homeGroup, awayGroup, source: { pairIndex } }>,
 *   bracketSize: number,
 *   byeSeeds: number[],
 *   unresolvedConflicts: Array,
 * }}
 */
export function buildBracket(qualifiers, opts = {}) {
  const config = mergeConfig(opts);
  const maxIter = config.maxTiebreakerDepth ?? 16;
  const hasThird = !!config.hasThirdPlacePlayoff;
  const bracketSizeHint = opts.bracketSizeHint ?? null;

  // Bracket-Größe ableiten: aus Qualifier-Anzahl ODER aus Hint (Skelett).
  const hasQualifiers = Array.isArray(qualifiers) && qualifiers.length >= 2;
  const useSkeleton = !hasQualifiers && Number.isInteger(bracketSizeHint) && bracketSizeHint >= 2;

  if (!hasQualifiers && !useSkeleton) {
    throw new Error('buildBracket: brauche mindestens 2 Qualifikanten oder bracketSizeHint >= 2');
  }

  const n = hasQualifiers ? qualifiers.length : bracketSizeHint;
  const bracketSize = nearestPowerOfTwo(n);
  const byeCount = bracketSize - n;

  // BYE-Quelle: schwächste Seeds bekommen Freilos → höchste Seed-Nummern.
  // Beispiel 6 Teams → bracketSize=8, BYE für Seed 7 und 8.
  const byeSeeds = [];
  for (let s = bracketSize; s > n; s--) byeSeeds.push(s);

  // Setzliste: index = seed - 1
  const seed = Array.from({ length: bracketSize + 1 }, () => null);
  if (hasQualifiers) {
    for (const q of qualifiers) {
      seed[q.seed] = { ...q };
    }
  }
  // Im Skelett-Modus bleiben alle seed[] = null. buildBracket nutzt
  // dann die `seed`-Liste als reine Struktur (Runden, Paarungen) — die
  // Teams in den QF-Matches bleiben null. Folgerunden bekommen ihre
  // Slots eh erst durch propagation gefüllt.
  for (const s of byeSeeds) {
    seed[s] = { seed: s, teamId: null, name: 'BYE', source: { groupKey: null }, isBye: true };
  }

  // Runde-1-Paarungen: erst Standard, dann Konfliktauflösung per Tausch.
  const basePairs = standardPairs(bracketSize);
  const finalPairs = hasQualifiers
    ? resolveSameGroupConflicts(basePairs, seed, maxIter)
    : basePairs; // Skelett: keine Konfliktauflösung nötig (alle null)

  // Wenn unresolvedConflicts zurückkommt → wir liefern trotzdem ein Bracket,
  // markieren aber die problematischen Stellen.
  const roundKey = roundKeyFor(bracketSize);
  const matches = [];
  for (let i = 0; i < finalPairs.length; i++) {
    const [aSeed, bSeed] = finalPairs[i];
    const a = seed[aSeed];
    const b = seed[bSeed];
    matches.push(patchLabel({
      id: `ko_${roundKey}_${i + 1}`,
      stageType: 'ko',
      round: roundKey,
      bracketType: 'winner',
      bracketPos: i + 1,
      teamHome: a?.isBye ? null : a?.teamId ?? null,
      teamAway: b?.isBye ? null : b?.teamId ?? null,
      placeholderHome: a?.isBye ? null : null,
      placeholderAway: b?.isBye ? null : null,
      homeSeed: aSeed,
      awaySeed: bSeed,
      homeGroup: a?.source?.groupKey ?? null,
      awayGroup: b?.source?.groupKey ?? null,
      isByeMatch: a?.isBye || b?.isBye,
      isSkeleton: !hasQualifiers && !a?.isBye && !b?.isBye,
      status: 'scheduled',
      source: { pairIndex: i, original: basePairs[i] },
    }));
  }

  // Folge-Match-Verknüpfungen aufbauen
  const linked = linkFollowers(matches, bracketSize, hasThird);

  // unresolvedConflicts: nur im Nicht-Skelett-Modus relevant.
  const unresolvedConflicts = [];
  if (hasQualifiers) {
    for (const m of linked) {
      if (m.homeGroup != null && m.homeGroup === m.awayGroup) {
        unresolvedConflicts.push({
          matchId: m.id,
          teamA: m.teamHome,
          teamB: m.teamAway,
          group: m.homeGroup,
        });
      }
    }
  }

  return {
    matches: linked,
    bracketSize,
    byeSeeds,
    unresolvedConflicts,
    hasThirdPlacePlayoff: hasThird,
    isSkeleton: useSkeleton && byeSeeds.length === 0, // komplettes Skelett ohne BYE
  };
}

/**
 * Welches Round-Label passt zur Bracket-Größe?
 *   2  = F
 *   4  = SF
 *   8  = QF
 *   16 = R16
 *   32 = R32
 */
function roundKeyFor(bracketSize) {
  switch (bracketSize) {
    case 2:  return 'F';
    case 4:  return 'SF';
    case 8:  return 'QF';
    case 16: return 'R16';
    case 32: return 'R32';
    case 64: return 'R64';
    default: return 'R' + bracketSize;
  }
}

/**
 * Tauscht Konfliktpaare iterativ (Spec §13 Constraint #4: maxIter).
 * Strategie: Wenn seedA und seedB aus derselben Gruppe → finde ein anderes
 * Paar, dessen Seeds tauschbar sind, ohne neuen Konflikt zu erzeugen.
 *
 * §6.3.2-Referenz:
 *   12 Teams / 3 Gruppen / Top 2 + 2 Dritte → Setzliste A1=1, B1=2, C1=3,
 *   A2=4, B2=5, C2=6, A3=7, B3=8.
 *   Standard-Paarungen [1v8, 4v5, 3v6, 2v7]:
 *     VF1: 1(A1) vs 8(B3)  → A vs B ✓
 *     VF2: 4(A2) vs 5(C2)  → A vs C ✓
 *     VF3: 3(C1) vs 6(B2)  → C vs B ✓
 *     VF4: 2(B1) vs 7(A3)  → B vs A ✓
 *   → 0 Konflikte, keine Tauschs nötig.
 */
export function resolveSameGroupConflicts(pairs, seed, maxIter) {
  const result = pairs.map((p) => p.slice());

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    for (let i = 0; i < result.length; i++) {
      const [aSeed, bSeed] = result[i];
      const a = seed[aSeed];
      const b = seed[bSeed];

      if (!a || !b) continue;
      if (a.isBye || b.isBye) continue;
      if (a.source?.groupKey == null || b.source?.groupKey == null) continue;
      if (a.source.groupKey !== b.source.groupKey) continue;

      // Konflikt: probiere alle möglichen Swap-Partner-Paare durch.
      // Wir tauschen abwechselnd aSeed bzw. bSeed mit Seeds aus einem
      // konfliktfreien Partner-Paar.
      const partners = allConflictFreePartners(result, i, seed);
      for (const j of partners) {
        // Versuche aSeed zu tauschen
        if (trySwapSide(result, i, j, 'a', seed)) {
          changed = true;
          break;
        }
        // Versuche bSeed zu tauschen
        if (trySwapSide(result, i, j, 'b', seed)) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }

  return result;
}

/**
 * Liefert alle Indizes von Paaren, die selbst konfliktfrei sind
 * (also potenzielle Swap-Partner).
 */
function allConflictFreePartners(pairs, currentIdx, seed) {
  const result = [];
  for (let j = 0; j < pairs.length; j++) {
    if (j === currentIdx) continue;
    const [a, b] = pairs[j];
    if (!seed[a] || !seed[b]) continue;
    if (seed[a].isBye || seed[b].isBye) continue;
    if (seed[a].source?.groupKey === seed[b].source?.groupKey) continue;
    result.push(j);
  }
  return result;
}

/**
 * Tauscht eine Seite (a oder b) von Paar i mit einem Seed aus Paar j,
 * ohne einen neuen Konflikt zu erzeugen. Versucht beide Slots in j.
 *
 * @returns {boolean} true wenn Swap erfolgreich.
 */
function trySwapSide(pairs, i, j, side, seed) {
  const a = pairs[i];
  const b = pairs[j];
  const swapIdx = side === 'a' ? 0 : 1;
  const partnerSlots = [0, 1].filter((s) => s !== swapIdx || true);

  for (const partnerSlot of partnerSlots) {
    const movedSeed = a[swapIdx];
    const partnerSeed = b[partnerSlot];
    if (partnerSeed === movedSeed) continue;

    // Swap versuchen
    a[swapIdx] = partnerSeed;
    b[partnerSlot] = movedSeed;

    if (!hasConflict(a, seed) && !hasConflict(b, seed)) {
      return true;
    }

    // Rückgängig
    a[swapIdx] = movedSeed;
    b[partnerSlot] = partnerSeed;
  }
  return false;
}

/**
 * Findet ein Tausch-Paar: ein anderes Match in derselben "Spiel-Hälfte"
 * (für die spätere Bracket-Hierarchie irrelevant in V1 — wir tauschen
 * einfach mit jedem anderen Match, dessen andere Seite konfliktfrei ist).
 *
 * Heuristik: durchsuche alle Paare nach einem, das selbst konflikfrei ist
 * und mit dem aktuellen Paar kompatible Tausch-Seeds hat.
 */
function findSwap(pairs, currentIdx, seed) {
  for (let j = 0; j < pairs.length; j++) {
    if (j === currentIdx) continue;
    const [a, b] = pairs[j];
    if (!seed[a] || !seed[b]) continue;
    if (seed[a].isBye || seed[b].isBye) continue;
    if (seed[a].source?.groupKey === seed[b].source?.groupKey) continue;
    return [currentIdx, j];
  }
  return null;
}

function trySwap(pairs, iA, iB, oldSeed, newSeed, seed) {
  const a = pairs[iA];
  const b = pairs[iB];
  const sideA = a.indexOf(oldSeed);
  if (sideA < 0) return false;
  const sideB = b.indexOf(newSeed);
  if (sideB < 0) return false;

  // Tausche
  a[sideA] = newSeed;
  b[sideB] = oldSeed;

  // Prüfe, ob beide Paare jetzt konfliktfrei sind
  if (hasConflict(a, seed) || hasConflict(b, seed)) {
    // Rückgängig
    a[sideA] = oldSeed;
    b[sideB] = newSeed;
    return false;
  }

  return true;
}

function hasConflict(pair, seed) {
  const a = seed[pair[0]];
  const b = seed[pair[1]];
  if (!a || !b) return false;
  if (a.isBye || b.isBye) return false;
  if (a.source?.groupKey == null || b.source?.groupKey == null) return false;
  return a.source.groupKey === b.source.groupKey;
}

/**
 * Verknüpft Folge-Matches: Sieger von Runde R → Slot in Runde R+1.
 * Bei ungeradzahligen Slots (8 → 4 → 2 → 1) werden die zwei Sieger
 * benachbarter Spiele zusammengeführt.
 */
function linkFollowers(firstRoundMatches, bracketSize, hasThird) {
  const matches = firstRoundMatches.slice();
  const byId = new Map(matches.map((m) => [m.id, m]));

  let currentRound = matches;
  let roundKey = matches[0]?.round ?? 'QF';
  let nextRoundKey = nextRoundKeyOf(roundKey);

  while (currentRound.length > 1) {
    const nextRound = [];
    for (let i = 0; i < currentRound.length; i += 2) {
      const m1 = currentRound[i];
      const m2 = currentRound[i + 1];
      if (!m1 || !m2) break;

      const nextPos = Math.floor(i / 2) + 1;
      const nextId = `ko_${nextRoundKey}_${nextPos}`;
      const next = patchLabel({
        id: nextId,
        stageType: 'ko',
        round: nextRoundKey,
        bracketType: 'winner',
        bracketPos: nextPos,
        teamHome: null,
        teamAway: null,
        placeholderHome: { type: 'match_winner', matchLabel: m1.labelForPlaceholder() },
        placeholderAway: { type: 'match_winner', matchLabel: m2.labelForPlaceholder() },
        homeSourceMatchId: m1.id,
        awaySourceMatchId: m2.id,
        status: 'scheduled',
        homeGroup: null,
        awayGroup: null,
      });
      // Folge-Verknüpfung
      m1.winnerAdvancesTo = next.id;
      m2.winnerAdvancesTo = next.id;

      // Wenn HasThird und wir sind in Halbfinale (SF) → Loser gehen in 3RD
      if (hasThird && nextRoundKey === 'F') {
        const thirdId = `ko_3RD_1`;
        m1.loserAdvancesTo = thirdId;
        m2.loserAdvancesTo = thirdId;
        nextRound.push(patchLabel({
          id: thirdId,
          stageType: 'ko',
          round: '3RD',
          bracketType: 'winner',
          bracketPos: 1,
          teamHome: null,
          teamAway: null,
          placeholderHome: { type: 'match_loser', matchLabel: m1.labelForPlaceholder() },
          placeholderAway: { type: 'match_loser', matchLabel: m2.labelForPlaceholder() },
          homeSourceMatchId: m1.id,
          awaySourceMatchId: m2.id,
          status: 'scheduled',
          homeGroup: null,
          awayGroup: null,
        }));
        nextRound.push(next);
      } else {
        nextRound.push(next);
      }
    }
    matches.push(...nextRound);
    for (const m of nextRound) byId.set(m.id, m);
    currentRound = nextRound.filter((m) => m.round !== '3RD');
    roundKey = nextRoundKey;
    nextRoundKey = nextRoundKeyOf(nextRoundKey);
  }

  return matches;
}

function nextRoundKeyOf(round) {
  switch (round) {
    case 'R64': return 'R32';
    case 'R32': return 'R16';
    case 'R16': return 'QF';
    case 'QF':  return 'SF';
    case 'SF':  return 'F';
    case 'F':   return null;
    case '3RD': return null;
    default:    return null;
  }
}

function patchLabel(m) {
  if (typeof m.labelForPlaceholder !== 'function') {
    m.labelForPlaceholder = function () {
      const r = roundShort(m.round);
      if (m.round === '3RD') return 'Spiel um Platz 3';
      if (m.round === 'F')   return 'Finale';
      if (r) return `${r} ${m.bracketPos}`;
      return 'Spiel';
    };
  }
  return m;
}

function roundShort(round) {
  switch (round) {
    case 'R32': return 'SF';
    case 'R16': return 'AF';
    case 'QF':  return 'VF';
    case 'SF':  return 'HF';
    default:    return null;
  }
}