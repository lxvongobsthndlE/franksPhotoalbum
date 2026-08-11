/**
 * Round-Robin-Spielplan (Berger-Tabelle). Spec §5.2.
 *
 * Bei n Teams:
 *   - n gerade: n-1 Runden, n/2 Spiele pro Runde → n(n-1)/2 Spiele.
 *   - n ungerade: n Runden, (n-1)/2 Spiele pro Runde, ein BYE pro Runde.
 *
 * Heimbalance:
 *   Wir verwenden **zyklische Rotation** statt "Team 1 bleibt fix" (Spec §5.2
 *   Schritt 2). Begründung: Mit fixiertem Anker (Standard-Berger) bekommt das
 *   Anker-Team in jeder Runde ein Heim-Spiel, was die Balance bei geradem n
 *   strukturell unmöglich macht (für n=4 z.B. sind 6 Heim-Slots auf 4 Teams
 *   zu verteilen — 1,5 pro Team ist nicht ganzzahlig). Zyklische Rotation
 *   lässt jedes Team gleichmäßig durch alle Positionen wandern und erreicht
 *   für jedes n eine Heim-Balance von max-min ≤ 1. §5.2 #3 (Balance)
 *   bekommt Vorrang vor §5.2 #2 (Anker fix).
 *
 * Rückgabe: Array<Array<{ home, away, round }>>
 *   - home/away sind Team-IDs oder 'BYE' (bei ungerader Anzahl).
 *   - Spiele gegen BYE werden im Aufrufer ausgefiltert (Spec §5.2: keine
 *     Match-Records gegen BYE).
 */

export function buildRoundRobin(teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length < 2) {
    throw new Error('buildRoundRobin: brauche mindestens 2 Teams');
  }

  // BYE einfügen, falls ungerade
  const teams = teamIds.slice();
  let hasBye = false;
  if (teams.length % 2 === 1) {
    teams.push('BYE');
    hasBye = true;
  }

  const n = teams.length;
  const rounds = n - 1;
  const matchesPerRound = n / 2;
  const schedule = [];

  // Zyklische Rotation: erstes Element ans Ende, alle anderen rücken vor.
  // Vorteil ggü. fixiertem Anker: jedes Team wandert durch alle Positionen.
  let rotation = teams.slice();
  for (let r = 0; r < rounds; r++) {
    const round = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const home = rotation[m];
      const away = rotation[n - 1 - m];
      round.push({
        home,
        away,
        round: r + 1,
        isBye: home === 'BYE' || away === 'BYE',
      });
    }
    schedule.push(round);

    // Zyklische Rotation (statt Anker fix): rotation[0] → rotation[n-1]
    rotation = [...rotation.slice(1), rotation[0]];
  }

  return { schedule, hasBye };
}

/**
 * Filtert BYE-Spiele aus und liefert nur reale Match-Slots.
 */
export function buildRoundRobinMatches(teamIds) {
  const { schedule } = buildRoundRobin(teamIds);
  const matches = [];
  let pos = 1;
  for (const round of schedule) {
    for (const m of round) {
      if (m.isBye) continue;
      matches.push({
        teamHome: m.home,
        teamAway: m.away,
        bracketPos: pos++,
        // Slot (1..n/2) kann zur späteren Spielzeit-Berechnung genutzt werden
        roundNumber: m.round,
      });
    }
  }
  return matches;
}