/**
 * Die Gruppenphase aus der AKTUELLEN Einteilung neu erzeugen.
 *
 * Warum es das gibt
 * -----------------
 * Bis zum 2026-08-26 durfte man die Gruppeneinteilung nach der
 * Generierung noch ändern („Zufällig verteilen", Paar-Tausch), und die
 * Spiele blieben, wo sie waren. Die Route sagte das sogar ausdrücklich:
 * „keine Team-, Match- oder Stage-Änderungen".
 *
 * Das Ergebnis war ein Turnier, das sich selbst widersprach. An der
 * echten Datenbank gemessen (Turnier „Franks Bierpong Turnier 2.0"):
 *
 *   Gruppe A  Mitglieder:   Team 12, Team 3, Team 7, Team 10
 *             spielen dort: Team 6,  Team 3, Team 5, Team 4
 *
 * In jeder Gruppe waren drei von vier Mitgliedern Teams, die dort kein
 * Spiel haben. Die Tabellen standen auf 0 Spielen, obwohl im Spielplan
 * Ergebnisse sichtbar waren — und aus diesen Tabellen kommen die
 * Qualifikanten der K.-o.-Phase.
 *
 * Jonas' Entscheid (26.08.): Die Spiele ziehen mit. Wer die Einteilung
 * ändert, ändert den Spielplan der Gruppenphase.
 *
 * Was diese Funktion tut — und was nicht
 * --------------------------------------
 *   1. Sie baut je Gruppe ein frisches Jeder-gegen-jeden aus den
 *      aktuellen Mitgliedern.
 *   2. Sie löscht die alten Gruppenspiele. Damit sind eingetragene
 *      Gruppenergebnisse weg — das ist der Preis, den der Entscheid
 *      bewusst zahlt, und deshalb steht davor eine Bestätigung.
 *   3. Sie setzt die K.-o.-Phase auf ihr Skelett zurück: die
 *      Qualifikanten sind mit den Gruppen hinfällig geworden. Ein
 *      Bracket mit Teams aus der alten Einteilung wäre die zweite
 *      Wahrheit, die wir gerade abschaffen.
 *   4. Sie rechnet die Zeiten neu — sonst hätten die neuen Spiele keine.
 *
 * Sie fasst Teams, Setzreihenfolge und Konfiguration NICHT an. Der Modus
 * bleibt, die Gruppengrößen bleiben (die Mitgliedschaften geben sie vor).
 */

/**
 * @param {object} tx        Prisma-Client ODER Transaktionsobjekt
 * @param {string} tournamentId
 * @param {object} engine    { buildRoundRobinMatches, generateSchedule, mergeConfig, makeCuid }
 * @returns {Promise<{gruppen:number, spieleVorher:number, spieleNachher:number, koZurueckgesetzt:number}>}
 */
export async function regeneriereGruppenphase(tx, tournamentId, engine) {
  const { buildRoundRobinMatches, generateSchedule, mergeConfig, makeCuid } = engine;

  const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) {
    const err = new Error('Turnier nicht gefunden');
    err.statusCode = 404;
    throw err;
  }
  const config = mergeConfig(tournament.config ?? {});

  const stages = await tx.stage.findMany({
    where: { tournamentId },
    orderBy: { orderIndex: 'asc' },
  });
  const istGruppenStage = (s) => s.type === 'group' || s.type === 'intermediate_group';
  const gruppenStages = stages.filter(istGruppenStage);
  const koStages = stages.filter((s) => !istGruppenStage(s));

  if (gruppenStages.length === 0) {
    // Reine K.-o.-Turniere haben keine Gruppenphase — dann gibt es hier
    // nichts zu tun, und das ist kein Fehler.
    return { gruppen: 0, spieleVorher: 0, spieleNachher: 0, koZurueckgesetzt: 0 };
  }

  const gruppen = await tx.group_.findMany({
    where: { stageId: { in: gruppenStages.map((s) => s.id) } },
    orderBy: { key: 'asc' },
    include: { memberships: { orderBy: { position: 'asc' } } },
  });

  const spieleVorher = await tx.match.count({
    where: { tournamentId, stageId: { in: gruppenStages.map((s) => s.id) } },
  });

  // 1) Neue Paarungen bauen, BEVOR etwas gelöscht wird. Wirft der
  //    Rundenbau, ist noch nichts kaputt.
  const neueSpiele = [];
  for (const g of gruppen) {
    const teamIds = g.memberships.map((m) => m.teamId).filter(Boolean);
    // Eine Gruppe mit weniger als zwei Teams hat keine Paarung. Das ist
    // ein gültiger Zwischenzustand, kein Fehler.
    if (teamIds.length < 2) continue;
    for (const m of buildRoundRobinMatches(teamIds)) {
      neueSpiele.push({
        id: makeCuid(),
        tournamentId,
        stageId: g.stageId,
        groupId: g.id,
        round: String(m.roundNumber ?? 1),
        bracketType: 'winner',
        bracketPos: m.bracketPos ?? null,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        status: 'scheduled',
        scheduledAt: null,
        field: null,
      });
    }
  }

  // 2) Alte Gruppenspiele weg, neue rein.
  await tx.match.deleteMany({
    where: { tournamentId, stageId: { in: gruppenStages.map((s) => s.id) } },
  });
  if (neueSpiele.length > 0) {
    await tx.match.createMany({ data: neueSpiele });
  }

  // 3) K.-o.-Phase auf das Skelett zurücksetzen.
  //
  //    Nur die Teams und Ergebnisse fallen weg, nicht die Struktur: die
  //    Runden, ihre Reihenfolge und die Verweise winnerAdvancesTo /
  //    loserAdvancesTo bleiben stehen. Ein Bracket neu zu bauen wäre mehr
  //    Zerstörung als nötig — es soll ja dieselbe Form wieder gefüllt
  //    werden, nur aus den neuen Gruppen.
  let koZurueckgesetzt = 0;
  if (koStages.length > 0) {
    const res = await tx.match.updateMany({
      where: { tournamentId, stageId: { in: koStages.map((s) => s.id) } },
      data: {
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        status: 'scheduled',
      },
    });
    koZurueckgesetzt = res.count ?? 0;
  }

  // 4) Zeiten für ALLE Spiele neu rechnen.
  //
  //    Bezugspunkt ist die früheste bisherige Anstoßzeit, nicht „jetzt" —
  //    ein Turnier, das um 10:00 beginnen sollte, soll nach einer
  //    Neuverteilung nicht um 15:47 anfangen. Dieselbe Regel benutzt die
  //    Reschedule-Route (Etappe B.8.1).
  const alle = await tx.match.findMany({
    where: { tournamentId },
    include: { stage: true },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
  });
  if (alle.length > 0) {
    //    Die Spalte `match.round` trägt ZWEI Bedeutungen: in der
    //    Gruppenphase den Spieltag als Zahl ("1", "2", "3"), in der
    //    K.-o.-Phase das Rundenkürzel ("QF", "SF", "3RD", "F"). Wer sie
    //    pauschal durch parseInt schickt, macht aus jeder K.-o.-Runde
    //    dieselbe Zahl — und die Engine sieht statt vier aufeinander
    //    folgenden Runden EINEN Block, den sie parallel auf die Felder
    //    legt. Gemessen am 2026-08-26: Spiel um Platz 3 und Finale lagen
    //    um 12:15, das Viertelfinale erst um 12:30.
    //    Deshalb wird hier je Stage-Art übersetzt, wie es die
    //    Reschedule-Route tut: Kürzel als `round`, Spieltag als
    //    `roundNumber` — und `bracketPos`/`groupKey` mit, sonst fällt
    //    die Sortierung innerhalb eines Blocks auf die ID zurück.
    const engineInput = alle.map((m) => {
      if (!istGruppenStage(m.stage ?? {})) {
        return {
          id: m.id,
          teamHome: m.teamHome,
          teamAway: m.teamAway,
          stageType: 'ko',
          round: m.round,
          bracketPos: m.bracketPos,
        };
      }
      const spieltag = Number.parseInt(m.round ?? '1', 10);
      return {
        id: m.id,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        stageType: 'group',
        groupKey: m.groupId,
        roundNumber: Number.isFinite(spieltag) ? spieltag : 1,
        bracketPos: m.bracketPos,
      };
    });
    const fruehester = alle
      .filter((m) => m.scheduledAt != null)
      .map((m) => new Date(m.scheduledAt).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];
    const baseDate =
      fruehester != null
        ? new Date(fruehester)
        : config.baseDate
          ? new Date(config.baseDate)
          : new Date('2026-09-05');

    const geplant = generateSchedule(engineInput, config, baseDate);
    for (const s of geplant) {
      await tx.match.update({
        where: { id: s.id },
        data: { scheduledAt: s.scheduledAt ?? null, field: s.field ?? null },
      });
    }
  }

  return {
    gruppen: gruppen.length,
    spieleVorher,
    spieleNachher: neueSpiele.length,
    koZurueckgesetzt,
  };
}
