/**
 * Round-Robin-Spielplan (Berger-Tabelle / Circle-Method). Spec §5.2.
 *
 * Bei n Teams:
 *   - n gerade: n-1 Runden, n/2 Spiele pro Runde → n(n-1)/2 Spiele.
 *   - n ungerade: n Runden, (n-1)/2 Spiele pro Runde, ein BYE pro Runde.
 *
 * Verfahren: EIN Team steht fest (Anker, Position 0), die übrigen n-1
 * rotieren um es herum. Gepaart wird der Anker mit dem Kopf des Rings,
 * danach jeweils von außen nach innen.
 *
 * Warum der Anker fest steht (Korrektur 2026-08-26):
 *   Vorher rotierten ALLE Positionen zyklisch, ausdrücklich um die
 *   Heimbalance zu retten. Das erzeugte aber keinen Round-Robin mehr:
 *   Eine Vollrotation hat die Periode n/2, nicht n-1 — ab der Hälfte
 *   wiederholen sich die Paarungen spiegelbildlich. Bei 8 Teams kamen so
 *   12 der 28 Begegnungen doppelt vor und 12 überhaupt nicht, bei jeder
 *   Teamzahl ≥ 3 dasselbe Muster. Die Spielanzahl stimmte, die Anzahl
 *   Spiele je Team stimmte, die Heimbalance stimmte — nur die Tabelle am
 *   Ende war erlogen, weil manche Teams zweimal gegeneinander antraten
 *   und andere nie. Alle vier bestehenden Tests waren grün.
 *
 *   Die Heimbalance war nie der Grund, den Anker zu lösen: Der Anker
 *   bekommt jede zweite Runde die Auswärtsseite, und die übrigen Paare
 *   tauschen die Seite nach ihrer Position im Ring. Damit bleibt die
 *   Spanne max-min ≤ 1 — geprüft für n = 3..16 —, ohne die Paarungen
 *   zu beschädigen. §5.2 #2 (Anker fix) und #3 (Balance) sind kein
 *   Widerspruch; sie wurden nur gegeneinander ausgespielt.
 *
 * Rückgabe: { schedule: Array<Array<{ home, away, round, isBye }>>, hasBye }
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
  const schedule = [];

  const anker = teams[0];
  let ring = teams.slice(1); // n-1 Einträge, rotieren um den Anker

  for (let r = 0; r < rounds; r++) {
    const round = [];

    // Anker gegen den Kopf des Rings. Die Seite alterniert je Runde —
    // sonst hätte der Anker in jeder Runde Heimrecht, und genau das war
    // der (berechtigte) Einwand gegen die Standard-Berger-Tabelle.
    const gegner = ring[0];
    const ankerHeim = r % 2 === 0;
    round.push({
      home: ankerHeim ? anker : gegner,
      away: ankerHeim ? gegner : anker,
      round: r + 1,
      isBye: anker === 'BYE' || gegner === 'BYE',
    });

    // Übrige Paare: von außen nach innen durch den Ring.
    for (let i = 1; i < n / 2; i++) {
      const a = ring[i];
      const b = ring[n - 1 - i];
      // Seite nach Ringposition, damit sich Heim/Auswärts über die Teams
      // verteilt statt sich auf einer Ringhälfte zu sammeln.
      const aHeim = i % 2 === 1;
      round.push({
        home: aHeim ? a : b,
        away: aHeim ? b : a,
        round: r + 1,
        isBye: a === 'BYE' || b === 'BYE',
      });
    }

    schedule.push(round);

    // Ring um eine Position weiterdrehen (letztes Element nach vorn).
    ring = [ring[ring.length - 1], ...ring.slice(0, -1)];
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
        // Spieltag (1-basiert); der Zeitplaner bildet daraus seine Blöcke.
        roundNumber: m.round,
      });
    }
  }
  return matches;
}
