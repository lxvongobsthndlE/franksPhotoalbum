/**
 * Zeitplan-Generierung. Spec §5.3.
 *
 * Strategie (Priorität):
 *   1. BLOCK-ORDNUNG (Spec §5.3, hart): Spiele werden in Blöcken angeordnet.
 *      Ein "Block" ist eine Runde — entweder ein Gruppen-Spieltag
 *      (roundNumber 1..n-1) oder eine KO-Runde (R32 < R16 < QF < SF < 3RD < F).
 *      Innerhalb jedes Blocks wird parallel auf den verfügbaren Feldern
 *      gespielt. Der nächste Block beginnt erst, wenn der vorherige vollständig
 *      eingeplant ist. Niemals darf ein Spiel aus Block N+1 vor einem Spiel
 *      aus Block N liegen.
 *   2. Parallelität: so viele Felder wie verfügbar gleichzeitig bespielen.
 *   3. Hart约束: kein Team spielt zweimal im selben Slot.
 *   4. Rotation: Heimbalance beibehalten (aus Round-Robin bereits gefordert).
 *
 * Eingabe: Spiele mit { id, teamHome, teamAway, stageType, groupKey?, round?,
 *                       roundNumber?, bracketPos, ... }
 * Ausgabe: Array gleicher Spiele + scheduledAt, field
 *
 * Determinismus (Spec §10.9): "2× generateSchedule mit identischer Config →
 * identische Match-IDs + scheduledAt". Wir sortieren die Spiele deterministisch
 * (Block-Index, dann bracketPos, dann id) und weisen Zeiten linear zu.
 */

// Reihenfolge der KO-Runden für den Block-Index. Niedrig = früher.
const KO_ROUND_ORDER = {
  R64: 0,
  R32: 1,
  R16: 2,
  QF: 3,
  SF: 4,
  '3RD': 5,
  F: 6,
};

// Gruppenphase liegt immer vor KO. Wir verwenden einen Offset, damit die
// Block-Indizes eindeutig bleiben, falls jemand roundNumber=0 oder
// ko-Slots vor Gruppen-Spieltagen erzwingen will.
const GROUP_BLOCK_OFFSET = 0;
const KO_BLOCK_OFFSET = 100_000;

/**
 * Ordnet unbekannte K.-o.-Rundenkürzel deterministisch hinter die bekannten.
 *
 * Warum das existiert (2026-08-26): Fällt ein Kürzel aus KO_ROUND_ORDER
 * heraus — ein Tippfehler, ein neuer Modus, ein Aufrufer, der `round`
 * unterwegs zur Zahl macht —, dann hatten vorher ALLE diese Spiele
 * denselben Block-Index. Ein Block heißt für den Planer „darf
 * gleichzeitig laufen": Viertel-, Halbfinale, Spiel um Platz 3 und
 * Finale landeten auf demselben Anstoß, in ID-Reihenfolge, das Finale
 * teils VOR dem Viertelfinale. Ein Datenfehler wurde so zu einem
 * fachlich unmöglichen Spielplan.
 *
 * Jetzt bekommt jedes unbekannte Kürzel seinen eigenen Block. Die
 * Reihenfolge unter ihnen ist geraten, aber sie ist eine Reihenfolge:
 * mehr Spiele = frühere Runde (ein K.-o.-Baum halbiert sich je Runde),
 * bei Gleichstand alphabetisch. Nacheinander in unsicherer Reihenfolge
 * ist immer noch ein Turnier; gleichzeitig ist keines.
 */
function unknownRoundOrder(matches) {
  const counts = new Map();
  for (const m of matches) {
    if (m?.stageType !== 'ko') continue;
    const key = String(m.round ?? '');
    if (KO_ROUND_ORDER[key] !== undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...counts.keys()].sort((a, b) => {
    const d = counts.get(b) - counts.get(a);
    if (d !== 0) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const order = new Map();
  const nachBekannt = Math.max(...Object.values(KO_ROUND_ORDER)) + 1;
  keys.forEach((k, i) => order.set(k, nachBekannt + i));
  return order;
}

function blockIndex(m, unknownOrder) {
  if (m?.stageType === 'ko') {
    const key = String(m?.round ?? '');
    const known = KO_ROUND_ORDER[key];
    const order = known !== undefined ? known : (unknownOrder?.get(key) ?? Number.MAX_SAFE_INTEGER);
    return KO_BLOCK_OFFSET + order;
  }
  // Default: Gruppen-Spiel
  return GROUP_BLOCK_OFFSET + (m?.roundNumber ?? 0);
}

function parseStartTime(startStr, baseDate) {
  const [h, m] = String(startStr ?? '10:00')
    .split(':')
    .map((s) => parseInt(s, 10));
  const d = new Date(baseDate);
  d.setHours(Number.isFinite(h) ? h : 10, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function addMinutes(d, minutes) {
  return new Date(d.getTime() + minutes * 60_000);
}

/**
 * Weist Spielen scheduledAt + field zu.
 *
 * @param {Array} matches
 * @param {object} config    { schedule: { slotMinutes, matchDurationMinutes, parallelFields, startTime, pauseAfterMatches } }
 * @param {Date}   baseDate  Bezugstag für die Startzeit
 * @returns {Array}          Kopien der Spiele mit scheduledAt + field gesetzt
 */
export function generateSchedule(matches, config, baseDate = new Date('2026-09-05')) {
  const sched = config?.schedule ?? {};

  // Bug 2 (2026-08-17): Die Engine berechnet den tatsächlichen Zeitabstand
  // zwischen zwei Slots aus matchDurationMinutes + pauseAfterMatches. Vorher
  // wurde nur slotMinutes (Wizard sendet 15 als Hardcode) verwendet —
  // Resultat: 35 Min Spieldauer → trotzdem 15-Minuten-Slots.
  //
  // matchDurationMinutes hat Vorrang vor slotMinutes (Legacy-Kompat).
  // Wenn matchDurationMinutes fehlt, fallen wir auf slotMinutes zurück.
  const matchDuration = Math.max(5, sched.matchDurationMinutes ?? 30);
  const pauseAfter = Math.max(0, sched.pauseAfterMatches ?? 0);
  const slotMinutes = Math.max(5, matchDuration + pauseAfter, Math.max(5, sched.slotMinutes ?? 15));
  const parallelFields = Math.max(1, sched.parallelFields ?? 1);
  const startTime = sched.startTime ?? '10:00';

  // Block-Sortierung: alle Spiele in Block N vor allen Spielen in Block N+1.
  // Innerhalb eines Blocks: Gruppe (für Gruppenphase), dann bracketPos, dann id.
  // Muss VOR der Sortierung stehen: die Ordnung unbekannter Runden wird
  // aus dem gesamten Spielsatz abgeleitet, nicht aus einem Paar.
  const unknownOrder = unknownRoundOrder(matches);

  const sorted = matches.slice().sort((a, b) => {
    const ba = blockIndex(a, unknownOrder);
    const bb = blockIndex(b, unknownOrder);
    if (ba !== bb) return ba - bb;

    // Innerhalb KO: bracketPos, dann id
    if (a.stageType === 'ko' && b.stageType === 'ko') {
      const pa = a.bracketPos ?? 0;
      const pb = b.bracketPos ?? 0;
      if (pa !== pb) return pa - pb;
      return (a.id ?? '') < (b.id ?? '') ? -1 : 1;
    }

    // Innerhalb Gruppe: groupKey, bracketPos, id
    const ga = a.groupKey ?? '';
    const gb = b.groupKey ?? '';
    if (ga !== gb) return ga < gb ? -1 : 1;
    const pa = a.bracketPos ?? 0;
    const pb = b.bracketPos ?? 0;
    if (pa !== pb) return pa - pb;
    return (a.id ?? '') < (b.id ?? '') ? -1 : 1;
  });

  // Blöcke sammeln (in Reihenfolge ihrer ersten Begegnung in `sorted`).
  const blocks = [];
  let currentBlockIdx = null;
  for (const m of sorted) {
    const idx = blockIndex(m, unknownOrder);
    if (currentBlockIdx === null || currentBlockIdx !== idx) {
      currentBlockIdx = idx;
      blocks.push({ idx, matches: [] });
    }
    blocks[blocks.length - 1].matches.push(m);
  }

  const startTimeDt = parseStartTime(startTime, baseDate);

  // Wartezeit-Steuerung (2026-08-26), neu gewichtet am 2026-08-28.
  //
  // Vorher kannte der Planer nur eine Regel: „ein Team spielt nicht
  // zweimal im selben Slot". Das ist eine Aussage über Ressourcen, keine
  // über Menschen. Wer um 10:15 spielt und um 10:30 wieder, hat keine
  // Pause gehabt; wer um 10:15 spielt und um 12:00 wieder, steht
  // anderthalb Stunden herum. Deshalb kam die Mindestruhe dazu.
  //
  // Sie war zuerst HART: ein Puffer-Slot je Spieltag durfte Felder leer
  // lassen, damit ein Team Pause bekommt. Genau das ist der Fehler, den
  // der Betreiber am 2026-08-28 gemeldet hat — im Spielplan lief zu
  // jeder Anstoßzeit EIN Spiel, während die Platten daneben leer
  // standen. Die neue Rangordnung in der Gruppenphase lautet:
  //
  //   H1  Kein Team spielt zweimal im selben Zeitfenster.        (hart)
  //   H2  Die Gruppenphase liegt vollständig vor der K.-o.-Phase. (hart)
  //   W0  AUSLASTUNG: Ein Feld bleibt nur leer, wenn KEIN offenes
  //       Gruppenspiel dort platzierbar ist, ohne H1 zu brechen.
  //       Auslastung schlägt jede weiche Regel — auch die Pause.
  //   W1  Spieltag-Treue: bevorzugt wird der kleinste offene Spieltag
  //       (plus `vorlauf`, siehe unten), und je Team der Spieltag, der
  //       als nächster dran ist. Weich: wo sie ein Feld leer ließe,
  //       tritt sie zurück.
  //   W2  Mindestruhe: nach einem Spiel in Slot s frühestens wieder in
  //       s + 1 + minRest. Weich: sie entscheidet nur noch, WELCHES der
  //       platzierbaren Spiele genommen wird, nie mehr OB gespielt wird.
  //   W3  Determinismus: Vorsortierung (Spieltag, Gruppe, bracketPos,
  //       id) — §10.9 bleibt gültig.
  const minRest = Math.max(0, Math.min(4, sched.minRestSlots ?? 1));

  // Vorlauf: wie viele Spieltage darf ein sonst halbleeres Zeitfenster
  // vorziehen? (Fach-Entscheidung 2026-08-28.)
  //
  // Ein Block war bisher ein Spieltag, und ein Spieltag begann erst,
  // wenn der vorige komplett verplant war. Hat eine Runde weniger
  // Spiele als Felder — 8 Spiele auf 3 Platten sind 3+3+2 —, dann
  // blieben am Ende JEDES Spieltags Platten leer. Bei 4 Gruppen à 4
  // Teams auf 3 Platten waren das drei halbleere Zeitfenster, und die
  // Gruppenphase zog sich über 9 statt 8 Fenster.
  //
  // Deshalb darf ein Zeitfenster, das aus dem laufenden Spieltag nicht
  // mehr voll wird, Spiele des NÄCHSTEN Spieltags vorziehen — höchstens
  // einen. Die Abwägung:
  //   dafür   — der Betreiber will volle Platten („möglichst alle Tische
  //             sollen zu jeder Spielzeit belegt sein"), und ein
  //             Spieltag ist im Gruppenmodus ohnehin nur eine Rechenhilfe
  //             für die Paarungen, kein Ereignis für die Zuschauer.
  //   dagegen — Fairness: kein Team soll schon Spieltag 3 spielen,
  //             während ein anderes bei Spieltag 1 steht (Kenntnis der
  //             Tabelle, ungleiche Erholung).
  // Ein Spieltag Vorlauf hält beides zusammen: Der Abstand zwischen dem
  // weitesten und dem am weitesten zurückliegenden Team bleibt auf einen
  // Spieltag begrenzt, und zusätzlich spielt jedes Team seine Spiele in
  // Spieltag-Reihenfolge (kein Team überspringt seinen eigenen nächsten
  // Spieltag). Unbegrenztes Mischen wäre kein Turnier mehr, sondern eine
  // Warteschlange.
  //
  // Beides ist WEICH: Wo die Spieltag-Treue ein Feld leer ließe, wird sie
  // fallengelassen (W0). Hart bleiben nur H1 und H2.
  const vorlauf = Math.max(0, Math.min(3, sched.groupLookaheadRounds ?? 1));

  const teamLastSlot = new Map(); // teamId → letzter belegter Slot
  const slotTeams = new Map(); // slotIndex → Set<teamId>
  const slotFieldUsed = new Map(); // slotIndex → Set<field>
  const result = new Map();

  const rundeVon = (m) => m?.roundNumber ?? 0;

  function passtH1(m, belegteTeams) {
    if (m.teamHome != null && belegteTeams.has(m.teamHome)) return false;
    if (m.teamAway != null && belegteTeams.has(m.teamAway)) return false;
    return true;
  }

  // Ruhe = Slots seit dem letzten Spiel des kürzer erholten Teams.
  // Das MINIMUM beider Teams, nicht die Summe — sonst schleppt ein sehr
  // ausgeruhtes Team ein gerade fertiges mit in den nächsten Slot.
  function ruhe(m, slot) {
    const rh =
      m.teamHome != null && teamLastSlot.has(m.teamHome)
        ? slot - teamLastSlot.get(m.teamHome)
        : Infinity;
    const ra =
      m.teamAway != null && teamLastSlot.has(m.teamAway)
        ? slot - teamLastSlot.get(m.teamAway)
        : Infinity;
    return Math.min(rh, ra);
  }

  /**
   * Wählt aus `kandidaten` das nächste Spiel für diesen Slot — oder null,
   * wenn H1 alle blockiert.
   *
   * Zwei Stufen, und ihre Reihenfolge ist der Kern:
   *
   *   1. Das ERSTE Spiel der Vorsortierung, das H1 erfüllt UND die
   *      Mindestruhe hält. Dass hier nicht nach „wer hat am längsten
   *      pausiert" gesucht wird, ist das Ergebnis einer Messung und kein
   *      Versäumnis: In einer Runde spielt jedes Team genau einmal, und
   *      weil die Vorsortierung (Spieltag, groupKey, bracketPos) in jeder
   *      Runde dieselbe Reihenfolge herstellt, behält jedes Team über
   *      alle Runden hinweg seine relative Position. Der Abstand zwischen
   *      zwei Spielen eines Teams bleibt dadurch konstant — der
   *      bestmögliche Wert überhaupt. Eine Auswahl nach längster Pause
   *      klingt besser und ist es nicht: Sie mischt die Reihenfolge
   *      zwischen den Runden und zerstört genau diesen Positionserhalt.
   *      Gemessen am 2026-08-26 über 16 Konstellationen fiel die Spanne
   *      dadurch von 4..4 auf 2..6 (4 Gruppen à 4 Teams, 2 Felder).
   *
   *   2. Hält KEINES der Spiele die Mindestruhe, wird trotzdem gespielt —
   *      und zwar das mit der längsten Ruhe (Tiebreak: Vorsortierung).
   *      Vorher blieb das Feld in diesem Fall leer. Das ist die Umkehrung
   *      vom 2026-08-28: Die Pause entscheidet nur noch, WER spielt, nicht
   *      mehr, OB gespielt wird.
   */
  function waehle(kandidaten, slot) {
    const belegteTeams = slotTeams.get(slot) ?? new Set();
    let bester = null;
    let besteRuhe = -Infinity;
    for (const m of kandidaten) {
      if (!passtH1(m, belegteTeams)) continue;
      const r = ruhe(m, slot);
      if (r > minRest) return m; // Stufe 1: Positionserhalt
      if (r > besteRuhe) {
        besteRuhe = r;
        bester = m;
      }
    }
    return bester; // Stufe 2 — oder null, wenn H1 alles blockiert
  }

  function platziere(m, slot, feld) {
    result.set(m.id, {
      ...m,
      scheduledAt: addMinutes(startTimeDt, slot * slotMinutes),
      field: feld,
    });
    if (!slotFieldUsed.has(slot)) slotFieldUsed.set(slot, new Set());
    slotFieldUsed.get(slot).add(feld);
    if (!slotTeams.has(slot)) slotTeams.set(slot, new Set());
    const ts = slotTeams.get(slot);
    if (m.teamHome != null) {
      ts.add(m.teamHome);
      teamLastSlot.set(m.teamHome, slot);
    }
    if (m.teamAway != null) {
      ts.add(m.teamAway);
      teamLastSlot.set(m.teamAway, slot);
    }
  }

  // Gruppenphase und K.-o.-Phase werden VERSCHIEDEN geplant — das ist die
  // zweite Hälfte des Fixes:
  //
  //   Gruppenphase — EIN Durchgang über alle Spieltage. Der Spieltag ist
  //     nur noch eine Vorliebe (W1), keine Wand mehr. Dadurch kann ein
  //     Zeitfenster, das der laufende Spieltag nicht mehr füllt, aus dem
  //     nächsten auffüllen.
  //   K.-o.-Phase — Block für Block, streng nacheinander: R64 → R32 →
  //     R16 → VF → HF → Spiel um Platz 3 → Finale. Zwei verschiedene
  //     Runden dürfen NIE im selben Zeitfenster liegen — die Halbfinal-
  //     Teilnehmer stehen erst fest, wenn das Viertelfinale gespielt ist.
  //     Mehrere Spiele DERSELBEN Runde laufen weiter parallel; das ist
  //     gewollt.
  const gruppenSpiele = blocks.filter((b) => b.idx < KO_BLOCK_OFFSET).flatMap((b) => b.matches);
  const koBloecke = blocks.filter((b) => b.idx >= KO_BLOCK_OFFSET);

  let slot = 0;

  if (gruppenSpiele.length > 0) {
    const offen = gruppenSpiele.slice();
    // Sicherung gegen eine nicht terminierende Suche: In einem leeren Slot
    // ist immer mindestens ein Spiel platzierbar (H1 kann nichts
    // blockieren, solange kein Team belegt ist), also reicht die
    // Spielanzahl als obere Schranke.
    let wachhund = 0;
    while (offen.length > 0 && wachhund <= gruppenSpiele.length) {
      wachhund += 1;

      // Einmal je Slot: kleinster offener Spieltag, und je Team der
      // Spieltag, der bei ihm als nächster ansteht.
      let minRunde = Infinity;
      const naechsteRunde = new Map();
      for (const m of offen) {
        const r = rundeVon(m);
        if (r < minRunde) minRunde = r;
        for (const t of [m.teamHome, m.teamAway]) {
          if (t == null) continue;
          const bisher = naechsteRunde.get(t);
          if (bisher === undefined || r < bisher) naechsteRunde.set(t, r);
        }
      }
      const grenze = minRunde + vorlauf;
      // W1: höchstens `vorlauf` Spieltage voraus, und kein Team
      // überspringt seinen eigenen nächsten Spieltag.
      const bevorzugt = offen.filter(
        (m) =>
          rundeVon(m) <= grenze &&
          (m.teamHome == null || naechsteRunde.get(m.teamHome) === rundeVon(m)) &&
          (m.teamAway == null || naechsteRunde.get(m.teamAway) === rundeVon(m))
      );

      for (let feld = 1; feld <= parallelFields && offen.length > 0; feld++) {
        // W0: erst die bevorzugten Spiele — und bevor ein Feld leer
        // bleibt, ALLE offenen. Leer bleibt ein Feld nur, wenn H1 wirklich
        // jedes offene Spiel blockiert.
        const m = waehle(bevorzugt, slot) ?? waehle(offen, slot);
        if (!m) break;
        platziere(m, slot, feld);
        offen.splice(offen.indexOf(m), 1);
        const bi = bevorzugt.indexOf(m);
        if (bi >= 0) bevorzugt.splice(bi, 1);
      }

      slot += 1;
    }
  }

  for (const block of koBloecke) {
    const offen = block.matches.slice();
    let wachhund = 0;
    while (offen.length > 0 && wachhund <= block.matches.length) {
      wachhund += 1;
      for (let feld = 1; feld <= parallelFields && offen.length > 0; feld++) {
        const m = waehle(offen, slot);
        if (!m) break;
        platziere(m, slot, feld);
        offen.splice(offen.indexOf(m), 1);
      }
      slot += 1;
    }
    // Block-Invariante §5.3: die nächste K.-o.-Runde beginnt garantiert
    // später — `slot` steht bereits hinter dem letzten belegten Fenster.
  }

  // Reihenfolge wieder in Originalreihenfolge zurück.
  return matches.map((m) => result.get(m.id) ?? m);
}

/**
 * Erkennt Konflikte im fertigen Plan.
 * Konflikt: zwei Spiele desselben Felds überlappen sich zeitlich.
 *
 * @param {Array} matches  Spiele mit scheduledAt + field
 * @returns {Array<{ matchA, matchB, reason }>}
 */
export function detectScheduleConflicts(matches) {
  const conflicts = [];
  const n = matches.length;
  for (let i = 0; i < n; i++) {
    const a = matches[i];
    if (a.scheduledAt == null || a.field == null) continue;
    for (let j = i + 1; j < n; j++) {
      const b = matches[j];
      if (b.scheduledAt == null || b.field == null) continue;
      if (a.field !== b.field) continue;
      if (Math.abs(a.scheduledAt.getTime() - b.scheduledAt.getTime()) < 60_000) {
        conflicts.push({
          matchA: a.id,
          matchB: b.id,
          reason: 'same_field_overlap',
        });
      }
    }
  }
  return conflicts;
}

/**
 * Prüft die fachliche Reihenfolge der Runden — Spec §5.3, Block-Invariante.
 *
 * `detectScheduleConflicts` beantwortet „belegt zwei Spiele dieselbe
 * Platte zur selben Zeit". Das ist eine Frage über Ressourcen. Die Frage
 * über das Turnier ist eine andere: läuft das Halbfinale, bevor das
 * Viertelfinale entschieden ist? Ein Plan kann ressourcenfrei und
 * trotzdem unmöglich sein, und genau dieser Fall stand am 2026-08-26 im
 * Spielplan (Finale 12:15, Viertelfinale 12:30).
 *
 * Zwei Verstöße werden gemeldet:
 *   - `round_overlap`     zwei verschiedene Runden zur selben Zeit
 *   - `round_out_of_order` eine spätere Runde beginnt vor einer früheren
 *
 * Nur bekannte K.-o.-Kürzel werden beurteilt; über unbekannte gibt es
 * kein Urteil, also auch keinen Vorwurf (fail-open).
 *
 * @param {Array} matches  Spiele mit scheduledAt, stageType, round
 * @returns {Array<{ round, otherRound, at, otherAt, reason }>}
 */
export function detectRoundOverlaps(matches) {
  // Je bekannter Runde: früheste und späteste Anstoßzeit.
  const spans = new Map();
  for (const m of matches ?? []) {
    if (m?.stageType !== 'ko' || m?.scheduledAt == null) continue;
    const key = String(m.round ?? '');
    const order = KO_ROUND_ORDER[key];
    if (order === undefined) continue;
    const t = new Date(m.scheduledAt).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = spans.get(key);
    if (!cur) spans.set(key, { order, min: t, max: t });
    else {
      if (t < cur.min) cur.min = t;
      if (t > cur.max) cur.max = t;
    }
  }

  const rounds = [...spans.entries()]
    .map(([round, v]) => ({ round, ...v }))
    .sort((a, b) => a.order - b.order);

  const verstoesse = [];
  for (let i = 0; i < rounds.length; i++) {
    for (let j = i + 1; j < rounds.length; j++) {
      const frueh = rounds[i];
      const spaet = rounds[j];
      const gleichzeitig = spaet.min <= frueh.max && frueh.min <= spaet.max;
      if (gleichzeitig) {
        verstoesse.push({
          round: frueh.round,
          otherRound: spaet.round,
          at: new Date(frueh.max),
          otherAt: new Date(spaet.min),
          reason: 'round_overlap',
        });
      } else if (spaet.min < frueh.min) {
        verstoesse.push({
          round: frueh.round,
          otherRound: spaet.round,
          at: new Date(frueh.min),
          otherAt: new Date(spaet.min),
          reason: 'round_out_of_order',
        });
      }
    }
  }
  return verstoesse;
}

/**
 * Kennzahlen eines fertigen Plans — die vier Zahlen, an denen sich ein
 * Spielplan messen lassen muss.
 *
 * `detectScheduleConflicts` beantwortet „ist der Plan überhaupt spielbar",
 * `detectRoundOverlaps` „ist er fachlich möglich". Diese Funktion
 * beantwortet die dritte Frage, die vorher niemand stellte: „ist er für
 * die Leute auf dem Platz zumutbar". Ein Plan kann konfliktfrei und
 * fachlich korrekt sein und trotzdem ein Team dreimal so lang warten
 * lassen wie ein anderes.
 *
 * Zielkorridor: `backToBack === 0` und alle Abstände in S±1, wobei
 * S = ceil(Spiele je Runde / Felder) die Slots pro Runde sind. Dass ein
 * Team, das in Runde r spielt, auch in Runde r+1 spielt, macht S zum
 * natürlichen Abstand — jede Abweichung ist Positionsdrift zwischen den
 * Runden.
 *
 * Zwei Werte sind KEIN Mangel, auch wenn sie den Korridor sprengen:
 *   - Bei ungerader Teamzahl pausiert je Runde ein Team (BYE) → Abstand 2S.
 *   - Bei sehr kleinen Gruppen auf einem Feld ist Back-to-Back beweisbar
 *     unvermeidbar (4 Teams / 1 Feld: Minimum sind 2 Fälle).
 *
 * @param {Array}  matches  Spiele mit scheduledAt + field
 * @param {object} [opts]   { slotMinutes } — das Zeitraster aus der Config.
 *   Ohne Angabe wird es aus dem Plan geschätzt; siehe unten, warum die
 *   Schätzung gut genug, aber nicht sicher ist.
 * @returns {{ spiele, slots, leerSlots, backToBack, betroffeneTeams,
 *             abstandMin, abstandMax, maxPauseMinuten, slotMinuten }}
 */
export function scheduleMetrics(matches, opts = {}) {
  const geplant = (matches ?? []).filter(
    (m) => m?.scheduledAt != null && Number.isFinite(new Date(m.scheduledAt).getTime())
  );
  const leer = {
    spiele: geplant.length,
    slots: 0,
    leerSlots: 0,
    backToBack: 0,
    betroffeneTeams: [],
    abstandMin: null,
    abstandMax: null,
    maxPauseMinuten: null,
    slotMinuten: null,
  };
  if (geplant.length === 0) return leer;

  const zeiten = [...new Set(geplant.map((m) => new Date(m.scheduledAt).getTime()))].sort(
    (a, b) => a - b
  );

  // Das Slot-Raster wird aus den ZEITABSTÄNDEN abgeleitet, nicht aus der
  // Aufzählung der belegten Anstoßzeiten.
  //
  // Der Unterschied ist nicht kosmetisch (Messfehler 2026-08-26): Lässt der
  // Planer einen Slot bewusst leer, damit alle Teams Pause bekommen, dann
  // kommt diese Uhrzeit im Plan gar nicht vor. Wer die belegten Zeiten
  // durchnummeriert, rückt die beiden Spiele davor und danach auf
  // benachbarte Indizes zusammen — und meldet ausgerechnet die Pause, die
  // der Planer erkämpft hat, als „direkt hintereinander". Der ggT aller
  // Abstände zur ersten Anstoßzeit trifft das Raster auch dann, wenn ganze
  // Slots fehlen.
  // Vorrang hat das Raster aus der Config: Der Aufrufer WEISS, wie lang ein
  // Slot ist, während der Plan es nur verrät, solange irgendwo zwei
  // benachbarte Slots belegt sind. Sind in einem Plan alle Abstände gerade
  // Vielfache — etwa weil jeder Blockübergang einen Slot überspringt —, dann
  // schätzt der ggT das Raster doppelt so groß und meldet echte Pausen als
  // Back-to-Back. Deshalb ist die Schätzung der Rückfall, nicht die Regel.
  const t0 = zeiten[0];
  let slotMinuten = 0;
  const ausConfig = Number(opts?.slotMinutes);
  if (Number.isFinite(ausConfig) && ausConfig > 0) {
    slotMinuten = Math.round(ausConfig);
  } else {
    for (const z of zeiten) {
      let a = Math.round((z - t0) / 60_000);
      let b = slotMinuten;
      while (a) {
        const t = b % a;
        b = a;
        a = t;
      }
      slotMinuten = b;
    }
  }
  const raster = slotMinuten > 0 ? slotMinuten : 1;
  const slotVon = new Map(zeiten.map((z) => [z, Math.round((z - t0) / 60_000 / raster)]));
  if (slotMinuten === 0) slotMinuten = null;

  const proTeam = new Map();
  const felder = new Set();
  for (const m of geplant) {
    const s = slotVon.get(new Date(m.scheduledAt).getTime());
    if (m.field != null) felder.add(m.field);
    for (const t of [m.teamHome, m.teamAway]) {
      if (t == null) continue;
      if (!proTeam.has(t)) proTeam.set(t, []);
      proTeam.get(t).push(s);
    }
  }

  let backToBack = 0;
  const betroffene = new Set();
  let abstandMin = null;
  let abstandMax = null;
  for (const [team, slots] of proTeam) {
    slots.sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      const d = slots[i] - slots[i - 1];
      if (d === 1) {
        backToBack += 1;
        betroffene.add(team);
      }
      if (abstandMin === null || d < abstandMin) abstandMin = d;
      if (abstandMax === null || d > abstandMax) abstandMax = d;
    }
  }

  const feldZahl = Math.max(1, felder.size);
  const noetigeSlots = Math.ceil(geplant.length / feldZahl);
  // Gesamtlänge des Plans in Slots — inklusive der leeren.
  const laenge = Math.max(...[...slotVon.values()]) + 1;

  return {
    spiele: geplant.length,
    slots: laenge,
    // Slots, die der Plan über die volle Feldauslastung hinaus braucht.
    leerSlots: Math.max(0, laenge - noetigeSlots),
    backToBack,
    betroffeneTeams: [...betroffene].sort(),
    abstandMin,
    abstandMax,
    maxPauseMinuten: slotMinuten != null && abstandMax != null ? abstandMax * slotMinuten : null,
    slotMinuten,
  };
}
