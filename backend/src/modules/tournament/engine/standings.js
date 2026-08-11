/**
 * Tabellenberechnung aus beendeten Spielen. Spec §5.4.
 *
 * Roh-Standings (finished matches):
 *   { teamId, played, won, drawn, lost, goalsFor, goalsAgainst,
 *     goalDiff, points, headToHead: { opponentId, gf, ga } }
 *
 * Keine Sortierung — das macht applyTiebreaker.
 * Keine Speicherung — wird bei jedem Aufruf frisch berechnet (Spec §5.4).
 */

export function computeStandings(teamIds, finishedMatches, config) {
  const pointsWin = config?.pointsPerWin ?? 3;
  const pointsDraw = config?.pointsPerDraw ?? 1;
  const pointsLoss = config?.pointsPerLoss ?? 0;

  const init = () => ({
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    h2h: new Map(), // opponentId → { gf, ga }
  });

  const map = new Map();
  for (const id of teamIds ?? []) {
    map.set(id, init());
  }

  for (const m of finishedMatches ?? []) {
    if (m.status !== 'finished') continue;
    if (m.teamHome == null || m.teamAway == null) continue;
    const h = map.get(m.teamHome);
    const a = map.get(m.teamAway);
    if (!h || !a) continue;

    const sh = m.scoreHome ?? 0;
    const sa = m.scoreAway ?? 0;

    h.played += 1;
    a.played += 1;
    h.goalsFor += sh;
    h.goalsAgainst += sa;
    a.goalsFor += sa;
    a.goalsAgainst += sh;

    const recordH2H = (self, oppId, gf, ga) => {
      const cur = self.h2h.get(oppId) ?? { gf: 0, ga: 0 };
      cur.gf += gf;
      cur.ga += ga;
      self.h2h.set(oppId, cur);
    };
    recordH2H(h, m.teamAway, sh, sa);
    recordH2H(a, m.teamHome, sa, sh);

    if (sh > sa) {
      h.won += 1;
      a.lost += 1;
      h.points += pointsWin;
      a.points += pointsLoss;
    } else if (sa > sh) {
      a.won += 1;
      h.lost += 1;
      a.points += pointsWin;
      h.points += pointsLoss;
    } else {
      h.drawn += 1;
      a.drawn += 1;
      h.points += pointsDraw;
      a.points += pointsDraw;
    }
  }

  const rows = [];
  for (const [teamId, s] of map.entries()) {
    rows.push({
      teamId,
      played: s.played,
      won: s.won,
      drawn: s.drawn,
      lost: s.lost,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      goalDiff: s.goalsFor - s.goalsAgainst,
      points: s.points,
      h2h: s.h2h,
    });
  }

  return rows;
}

/**
 * Head-to-Head-Tabelle (Sub-Tabelle) für eine Auswahl von Teams.
 * Wird vom Tiebreaker bei Punktgleichstand aufgerufen.
 *
 * @param {Array} teamIds        betroffene Teams
 * @param {Array} finishedMatches  alle relevanten Spiele
 * @returns {Array}              Zeilen mit { teamId, played, won, drawn, lost, gf, ga, points }
 */
export function computeHeadToHeadSubTable(teamIds, finishedMatches) {
  const teamSet = new Set(teamIds);
  const init = () => ({ played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 });

  const map = new Map();
  for (const id of teamIds) map.set(id, init());

  for (const m of finishedMatches ?? []) {
    if (m.status !== 'finished') continue;
    if (!teamSet.has(m.teamHome) || !teamSet.has(m.teamAway)) continue;
    const h = map.get(m.teamHome);
    const a = map.get(m.teamAway);
    if (!h || !a) continue;

    const sh = m.scoreHome ?? 0;
    const sa = m.scoreAway ?? 0;
    h.played += 1;
    a.played += 1;
    h.gf += sh;
    h.ga += sa;
    a.gf += sa;
    a.ga += sh;

    if (sh > sa) {
      h.won += 1; h.points += 3;
      a.lost += 1;
    } else if (sa > sh) {
      a.won += 1; a.points += 3;
      h.lost += 1;
    } else {
      h.drawn += 1; h.points += 1;
      a.drawn += 1; a.points += 1;
    }
  }

  return teamIds.map((id) => ({ teamId: id, ...map.get(id) }));
}