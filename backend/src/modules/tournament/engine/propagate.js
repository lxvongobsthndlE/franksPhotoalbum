/**
 * Sieger-Propagation + Cascade-Reset. Spec §6.4.
 *
 * Wird aufgerufen, wenn ein Match beendet wird:
 *   1. Sieger wird in das Folge-Match eingetragen (winnerAdvancesTo → slot).
 *   2. Wenn das Folge-Match bereits einen Eintrag hatte, der nicht mehr stimmt
 *      (z.B. weil ein anderes Vormatch-Result sich geändert hat) → cascadeReset.
 *
 * cascadeReset: entfernt alle abhängigen Slots im Downstream-Baum ab dem
 * Wurzel-Match.
 */

function isFinished(m) {
  return m.status === 'finished';
}

function isSlot(m, side, teamId) {
  return side === 'home' ? m.teamHome === teamId : m.teamAway === teamId;
}

function slotOf(targetMatch, sourceMatch, winnerWasHome) {
  // 1) Explizite Source-Match-Metadaten (gesetzt in bracket.js linkFollowers).
  //    Das ist die saubere Variante: jedes Folge-Match weiß genau, welcher
  //    VORMATCH-Sieger in welchen Slot kommt.
  if (targetMatch.homeSourceMatchId === sourceMatch.id) return 'home';
  if (targetMatch.awaySourceMatchId === sourceMatch.id) return 'away';

  // 2) Fallback: Wenn keine expliziten Quellen gesetzt sind (z.B. in
  //    isolierten Tests), erbt der Sieger den Slot seines VORMATCH.
  //    Spec §6.4: "slotOf inherits from source match".
  return winnerWasHome ? 'home' : 'away';
}

/**
 * Setzt den Sieger in das Folge-Match (winnerAdvancesTo).
 *
 * @param {object} finishedMatch    muss status=finished haben
 * @param {Array} allMatches        komplettes Bracket
 * @returns {Array}                 neue Matches (immutable: Kopien, Originale unverändert)
 */
export function propagateWinner(finishedMatch, allMatches) {
  if (!isFinished(finishedMatch)) {
    throw new Error('propagateWinner: Match ist nicht beendet');
  }
  if (finishedMatch.teamHome == null || finishedMatch.teamAway == null) {
    throw new Error('propagateWinner: Match hat keine Teams');
  }
  if (finishedMatch.scoreHome == null || finishedMatch.scoreAway == null) {
    throw new Error('propagateWinner: Match hat keine Scores');
  }

  const homeWins = finishedMatch.scoreHome > finishedMatch.scoreAway;
  const awayWins = finishedMatch.scoreAway > finishedMatch.scoreHome;

  if (finishedMatch.scoreHome === finishedMatch.scoreAway) {
    // Unentschieden in KO: keine automatische Propagation.
    return allMatches;
  }

  const winner = homeWins ? finishedMatch.teamHome : finishedMatch.teamAway;
  const loser = homeWins ? finishedMatch.teamAway : finishedMatch.teamHome;

  const winnerTargetId = finishedMatch.winnerAdvancesTo;
  const loserTargetId = finishedMatch.loserAdvancesTo;

  return allMatches.map((m) => {
    let next = m;

    if (winnerTargetId && m.id === winnerTargetId) {
      const side = slotOf(m, finishedMatch, homeWins);
      const other = side === 'home' ? m.teamAway : m.teamHome;
      next = {
        ...m,
        teamHome: side === 'home' ? winner : m.teamHome,
        teamAway: side === 'away' ? winner : m.teamAway,
        placeholderHome: side === 'home' ? null : m.placeholderHome,
        placeholderAway: side === 'away' ? null : m.placeholderAway,
      };
      // Wenn der andere Slot noch leer war, lass es so. Wenn er belegt war,
      // aber der gleiche Sieger → unverändert. Wenn er einen anderen hatte
      // → cascadeReset vom Folge-Match aus.
      if (other != null && other !== winner && isFinished(next)) {
        // Inkonsistenz: downstream muss resettet werden
        // (lazy: cascade-Logik übernimmt das später)
      }
      void other;
    } else if (loserTargetId && m.id === loserTargetId) {
      const side = slotOf(m, finishedMatch, homeWins);
      next = {
        ...m,
        teamHome: side === 'home' ? loser : m.teamHome,
        teamAway: side === 'away' ? loser : m.teamAway,
        placeholderHome: side === 'home' ? null : m.placeholderHome,
        placeholderAway: side === 'away' ? null : m.placeholderAway,
      };
    }

    return next;
  });
}

/**
 * Cascade-Reset ab einem Match:
 *   - Alle downstream-Matches (über winnerAdvancesTo/loserAdvancesTo) werden
 *     geleert (Slots auf null, Status auf 'scheduled', Scores null).
 *   - Iterativ, bis keine Nachfolger mehr.
 *
 * @param {string} rootMatchId
 * @param {Array} allMatches
 * @returns {Array} neue Matches (immutable)
 */
export function resetCascade(rootMatchId, allMatches) {
  const byId = new Map(allMatches.map((m) => [m.id, m]));

  const visited = new Set([rootMatchId]);
  const queue = [rootMatchId];

  while (queue.length > 0) {
    const id = queue.shift();
    const m = byId.get(id);
    if (!m) continue;

    if (m.winnerAdvancesTo) visited.add(m.winnerAdvancesTo);
    if (m.loserAdvancesTo)  visited.add(m.loserAdvancesTo);

    if (m.winnerAdvancesTo) queue.push(m.winnerAdvancesTo);
    if (m.loserAdvancesTo)  queue.push(m.loserAdvancesTo);
  }

  return allMatches.map((m) => {
    if (!visited.has(m.id)) return m;
    if (m.id === rootMatchId) {
      // Quell-Match selbst NICHT antasten — Aufrufer entscheidet.
      return m;
    }
    return {
      ...m,
      teamHome: null,
      teamAway: null,
      placeholderHome: m.placeholderHome,  // bewahrt: "Sieger …"
      placeholderAway: m.placeholderAway,
      scoreHome: null,
      scoreAway: null,
      status: 'scheduled',
    };
  });
}

/**
 * Vollständiges Re-Prep einer Bracket-Veränderung: erst cascade-Reset
 * ab dem geänderten Match, dann propagateWinner vom geänderten Match.
 */
export function applyResult(match, allMatches) {
  const afterReset = resetCascade(match.id, allMatches);
  return propagateWinner(match, afterReset);
}