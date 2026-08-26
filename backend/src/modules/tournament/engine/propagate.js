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
 *
 * Slot-Bug-Historie (Bug 2026-08-18): Eine frühere Variante hat die
 * Slot-Zuordnung aus `targetMatch.homeSourceMatchId` /
 * `targetMatch.awaySourceMatchId` gelesen. Diese Felder werden in
 * bracket.js linkFollowers gesetzt — ABER nur im RAM, nicht in der DB
 * persistiert. Beim DB-Read in routes.js /result waren sie weg, der
 * Fallback "winnerWasHome ? 'home' : 'away'" lief IMMER — und schrieb
 * bei einem 2-Slot-Folgespiel BEIDE Sieger in `teamHome`, sodass der
 * zweite den ersten überschrieb. Siehe routes.real-db.test.js Test 5
 * für die Regression.
 *
 * Lösung: Slot-Index aus bracketPos der Vormatches rekonstruieren.
 * bracket.js linkFollowers setzt bracketPos so, dass die zu einem
 * Ziel-Match gehörenden Vormatches zusammenstehen (VF1+VF2 → HF1,
 * VF3+VF4 → HF2; HF1+HF2 → F). Wir sortieren nach bracketPos und
 * weisen home = niedrigste Pos, away = nächste zu.
 */

function isFinished(m) {
  return m.status === 'finished';
}

function isSlot(m, side, teamId) {
  return side === 'home' ? m.teamHome === teamId : m.teamAway === teamId;
}

/**
 * Baut einen Index: pro Ziel-Match → { winnerHome, winnerAway,
 * loserHome, loserAway } (jeweils das Vormatch-Objekt oder null).
 *
 * Vormatches sind die mit winnerAdvancesTo/loserAdvancesTo === target.id.
 * Sortierung: bracketPos aufsteigend.
 *
 * Annahme: Vormatches, die zum selben Ziel-Match gehören, stehen in
 * bracketPos zusammen (linkFollowers-Reihenfolge). Das ist die
 * Standard-Bracket-Topologie für single-elim. Bei komplexeren
 * Topologien (z. B. wenn jemand manuell die DB editiert) kann der
 * Algorithmus fehlschlagen — dann lieber Schema-Migration mit
 * persistierten Source-Match-IDs als TODO.
 */
function buildSlotIndex(allMatches) {
  const targetMap = new Map();
  for (const m of allMatches) {
    if (m.winnerAdvancesTo) {
      const e = targetMap.get(m.winnerAdvancesTo) || { winner: [], loser: [] };
      e.winner.push(m);
      targetMap.set(m.winnerAdvancesTo, e);
    }
    if (m.loserAdvancesTo) {
      const e = targetMap.get(m.loserAdvancesTo) || { winner: [], loser: [] };
      e.loser.push(m);
      targetMap.set(m.loserAdvancesTo, e);
    }
  }
  const slotIndex = new Map();
  for (const [targetId, groups] of targetMap.entries()) {
    const winners = groups.winner.slice().sort((a, b) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0));
    const losers = groups.loser.slice().sort((a, b) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0));
    slotIndex.set(targetId, {
      winnerHome: winners[0] || null,
      winnerAway: winners[1] || null,
      loserHome: losers[0] || null,
      loserAway: losers[1] || null,
    });
  }
  return slotIndex;
}

function slotOf(slotIndex, targetMatchId, sourceMatchId, winnerWasHome) {
  const slots = slotIndex.get(targetMatchId);
  if (!slots) return null; // kein Vormatch-Eintrag → Caller entscheidet
  // Standardfall: ZIEL-Match hat mehrere Winner-Quellen (bracketPos-
  // basierte Zuordnung). Niedrigere bracketPos → home, höhere → away.
  // DIESER Fall trifft NICHT zu, wenn es nur eine Quelle gibt — dort
  // entscheidet der Vormatch-Result-Slot.
  if (slots.winnerHome && slots.winnerAway) {
    if (slots.winnerHome.id === sourceMatchId) return 'home';
    if (slots.winnerAway.id === sourceMatchId) return 'away';
  }
  if (slots.loserHome && slots.loserAway) {
    if (slots.loserHome.id === sourceMatchId) return 'home';
    if (slots.loserAway.id === sourceMatchId) return 'away';
  }
  // Single-Source-Fall: Es gibt nur EINE Winner-Quelle (oder Loser-Quelle).
  // Der neue Sieger/Verlierer erbt den Slot, der zu seinem Vormatch-
  // Result passt (Heim-Sieg → home, Auswärts-Sieg → away). Spec §6.4:
  // "slotOf inherits from source match". Historische Tests verlassen
  // sich auf dieses Verhalten, und es ist die richtige Wahl für den
  // Fall "Folgemanuell nachträglich gefüllt".
  const onlyWinner = slots.winnerHome || slots.winnerAway;
  if (onlyWinner && onlyWinner.id === sourceMatchId) {
    return winnerWasHome ? 'home' : 'away';
  }
  const onlyLoser = slots.loserHome || slots.loserAway;
  if (onlyLoser && onlyLoser.id === sourceMatchId) {
    return winnerWasHome ? 'home' : 'away';
  }
  return null;
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

  // Slot-Index einmal pro Aufruf bauen. Enthält für jedes Ziel-Match
  // die Zuordnung Vormatch → home/away (gewonnen/verloren).
  const slotIndex = buildSlotIndex(allMatches);

  return allMatches.map((m) => {
    let next = m;

    if (winnerTargetId && m.id === winnerTargetId) {
      const side = slotOf(slotIndex, m.id, finishedMatch.id, homeWins) || 'home';
      next = {
        ...m,
        teamHome: side === 'home' ? winner : m.teamHome,
        teamAway: side === 'away' ? winner : m.teamAway,
        placeholderHome: side === 'home' ? null : m.placeholderHome,
        placeholderAway: side === 'away' ? null : m.placeholderAway,
        // Wenn das Folgespiel schon einen Score hatte (vorherige
        // Eingabe), wird er durch die neue Slot-Belegung nullifiziert —
        // sonst wäre der Score eine Lüge.
        scoreHome: side === 'home' ? null : m.scoreHome,
        scoreAway: side === 'away' ? null : m.scoreAway,
        status: 'scheduled',
      };
    } else if (loserTargetId && m.id === loserTargetId) {
      const side = slotOf(slotIndex, m.id, finishedMatch.id, homeWins) || 'home';
      next = {
        ...m,
        teamHome: side === 'home' ? loser : m.teamHome,
        teamAway: side === 'away' ? loser : m.teamAway,
        placeholderHome: side === 'home' ? null : m.placeholderHome,
        placeholderAway: side === 'away' ? null : m.placeholderAway,
        scoreHome: side === 'home' ? null : m.scoreHome,
        scoreAway: side === 'away' ? null : m.scoreAway,
        status: 'scheduled',
      };
    }

    return next;
  });
}

/**
 * Cascade-Reset ab einem Match.
 *
 *   - Wenn ein Downstream-Match SELBST schon beendet ist
 *     (status='finished'): komplett geleert — sein Score war von
 *     Annahmen abhängig, die durch die Änderung am Root-Match
 *     ungültig geworden sind.
 *   - Sonst (status='scheduled'): NUR der Slot geleert, den das
 *     Root-Match füllen würde. Andere Slots (von anderen Vormatches
 *     gefüllt) bleiben stehen. Beispiel:
 *
 *       SF1 (winner→F) SF2 (winner→F)
 *               ↓              ↓
 *              F:  teamHome=T1, teamAway=null
 *
 *     Wenn SF2 fertig wird, soll nur F.teamAway=T2 gesetzt werden —
 *     F.teamHome=T1 (von SF1) muss stehen bleiben.
 *
 *   - Root-Match selbst wird nicht angetastet.
 *
 * Bug-Historie (2026-08-18): Die ältere Variante hat ALLE downstream-
 * Matches komplett geleert. Das war für den Single-Source-Fall korrekt,
 * aber bei 2+ Vormatches führte es dazu, dass der zweite Vormatch-
 * Result-Eintrag den ersten überschrieb (siehe routes.real-db.test.js
 * Test 5).
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
    if (m.loserAdvancesTo) visited.add(m.loserAdvancesTo);

    if (m.winnerAdvancesTo) queue.push(m.winnerAdvancesTo);
    if (m.loserAdvancesTo) queue.push(m.loserAdvancesTo);
  }

  // SlotIndex: pro Ziel-Match → welcher Slot wird vom Root-Match
  // gefüllt? Wir brauchen das, um den richtigen Slot zu leeren.
  const slotIndex = buildSlotIndex(allMatches);

  return allMatches.map((m) => {
    if (!visited.has(m.id)) return m;
    if (m.id === rootMatchId) {
      // Quell-Match selbst NICHT antasten — Aufrufer entscheidet.
      return m;
    }
    // Wenn das Downstream-Match selbst schon beendet ist: komplett
    // leeren. Sein Ergebnis ist ungültig, weil eine Vorbedingung
    // (der Sieger des Root-Matches) sich ändert.
    if (m.status === 'finished') {
      return {
        ...m,
        teamHome: null,
        teamAway: null,
        placeholderHome: m.placeholderHome,
        placeholderAway: m.placeholderAway,
        scoreHome: null,
        scoreAway: null,
        status: 'scheduled',
      };
    }
    // Sonst: nur den Slot leeren, den das Root-Match füllen wird.
    const slots = slotIndex.get(m.id);
    if (!slots) return m; // keine Vormatch-Beziehung gefunden
    // winnerHome/winnerAway/loserHome/loserAway: leerer Eintrag = Slot
    // bleibt; wenn der Slot vom Root-Match gefüllt würde → leeren.
    const isWinnerHome = slots.winnerHome?.id === rootMatchId;
    const isWinnerAway = slots.winnerAway?.id === rootMatchId;
    const isLoserHome = slots.loserHome?.id === rootMatchId;
    const isLoserAway = slots.loserAway?.id === rootMatchId;
    return {
      ...m,
      teamHome: isWinnerHome || isLoserHome ? null : m.teamHome,
      teamAway: isWinnerAway || isLoserAway ? null : m.teamAway,
      placeholderHome: isWinnerHome || isLoserHome ? m.placeholderHome : m.placeholderHome,
      placeholderAway: isWinnerAway || isLoserAway ? m.placeholderAway : m.placeholderAway,
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
