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
  QF:  3,
  SF:  4,
  '3RD': 5,
  F:   6,
};

// Gruppenphase liegt immer vor KO. Wir verwenden einen Offset, damit die
// Block-Indizes eindeutig bleiben, falls jemand roundNumber=0 oder
// ko-Slots vor Gruppen-Spieltagen erzwingen will.
const GROUP_BLOCK_OFFSET = 0;
const KO_BLOCK_OFFSET = 100_000;

function blockIndex(m) {
  if (m?.stageType === 'ko') {
    const order = KO_ROUND_ORDER[m.round] ?? Number.MAX_SAFE_INTEGER;
    return KO_BLOCK_OFFSET + order;
  }
  // Default: Gruppen-Spiel
  return GROUP_BLOCK_OFFSET + (m?.roundNumber ?? 0);
}

function parseStartTime(startStr, baseDate) {
  const [h, m] = String(startStr ?? '10:00').split(':').map((s) => parseInt(s, 10));
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
  const slotMinutes = Math.max(
    5,
    matchDuration + pauseAfter,
    Math.max(5, sched.slotMinutes ?? 15),
  );
  const parallelFields = Math.max(1, sched.parallelFields ?? 1);
  const startTime = sched.startTime ?? '10:00';

  // Block-Sortierung: alle Spiele in Block N vor allen Spielen in Block N+1.
  // Innerhalb eines Blocks: Gruppe (für Gruppenphase), dann bracketPos, dann id.
  const sorted = matches.slice().sort((a, b) => {
    const ba = blockIndex(a);
    const bb = blockIndex(b);
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
    const idx = blockIndex(m);
    if (currentBlockIdx === null || currentBlockIdx !== idx) {
      currentBlockIdx = idx;
      blocks.push({ idx, matches: [] });
    }
    blocks[blocks.length - 1].matches.push(m);
  }

  const startTimeDt = parseStartTime(startTime, baseDate);
  const teamLastSlot = new Map();   // teamId → letzter Slot-Index
  // Bug 2b (2026-08-17): Pro Slot tracken wir, welche Felder belegt sind.
  // Dadurch können mehrere Spiele im SELBEN Slot auf verschiedenen Feldern
  // stattfinden — vorher hat ein einziger slotIndex-Counter SF1 und SF2
  // zwangsweise auf unterschiedliche Slots gesetzt, obwohl 4 Felder zur
  // Verfügung standen.
  const slotFieldUsed = new Map();   // slotIndex → Set<field>
  let slotIndex = 0;
  const result = new Map();

  for (const block of blocks) {
    for (const m of block.matches) {
      // Suche (Slot, Feld), in dem:
      //   - weder Heim noch Auswärts spielen (Team-Konflikt)
      //   - das Feld in diesem Slot noch frei ist (Field-Konflikt)
      // Wir probieren Felder 1..parallelFields in Reihenfolge durch. Wenn
      // alle belegt oder ein Team blockiert, gehen wir zum nächsten Slot.
      let chosenSlotIndex = slotIndex;
      let chosenField = 1;
      let attempts = 0;
      while (attempts < 64) {
        const usedFields = slotFieldUsed.get(chosenSlotIndex) ?? new Set();
        const homeBusy =
          m.teamHome != null && teamLastSlot.get(m.teamHome) === chosenSlotIndex;
        const awayBusy =
          m.teamAway != null && teamLastSlot.get(m.teamAway) === chosenSlotIndex;

        if (!homeBusy && !awayBusy) {
          // Suche erstes freies Feld in [1..parallelFields].
          let f = 1;
          for (; f <= parallelFields; f++) {
            if (!usedFields.has(f)) {
              chosenField = f;
              break;
            }
          }
          if (f <= parallelFields) break;
        }

        chosenSlotIndex += 1;
        attempts += 1;
        if (attempts >= 64) break;
      }

      const scheduledAt = addMinutes(startTimeDt, chosenSlotIndex * slotMinutes);

      result.set(m.id, { ...m, scheduledAt, field: chosenField });

      if (!slotFieldUsed.has(chosenSlotIndex)) {
        slotFieldUsed.set(chosenSlotIndex, new Set());
      }
      slotFieldUsed.get(chosenSlotIndex).add(chosenField);

      if (m.teamHome != null) teamLastSlot.set(m.teamHome, chosenSlotIndex);
      if (m.teamAway != null) teamLastSlot.set(m.teamAway, chosenSlotIndex);

      // Block-Ende: wenn alle parallelen Felder voll sind, springt der
      // nächste Match automatisch auf den Folge-Slot (chosenSlotIndex+1).
      // Innerhalb desselben Blocks mit freien Feldern bleibt slotIndex
      // unverändert — so laufen SF1 + SF2 parallel.
    }
    // Block-Ende erreicht. Sicherheitshalber slotIndex auf das Maximum
    // aller in diesem Block vergebenen Slot-Indizes setzen, damit der
    // nächste Block garantiert später beginnt (Block-Invariante §5.3).
    let maxSlotInBlock = slotIndex;
    for (const m of block.matches) {
      // result.get ist hier sicher, weil wir gerade in der Schleife sind.
      const r = result.get(m.id);
      if (r && r.scheduledAt) {
        // scheduledAt → slotIndex rückrechnen (kann leicht driften bei
        // manuellen Overrides, aber hier ist alles deterministisch).
        const diffMin = Math.round((r.scheduledAt.getTime() - startTimeDt.getTime()) / 60_000);
        const idx = Math.floor(diffMin / slotMinutes);
        if (idx > maxSlotInBlock) maxSlotInBlock = idx;
      }
    }
    slotIndex = maxSlotInBlock + 1;
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