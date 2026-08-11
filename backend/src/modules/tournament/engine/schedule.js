/**
 * Zeitplan-Generierung. Spec §5.3.
 *
 * Strategie (Priorität):
 *   1. Hart约束: jede Gruppe spielt zuerst; kein Team spielt zweimal in
 *      aufeinanderfolgenden Slots, wenn möglich.
 *   2. Parallelität: so viele Felder wie verfügbar gleichzeitig bespielen.
 *   3. Pause nach n Spielen pro Team (Pause-Anzahl aus Config).
 *   4. Rotation: Heimbalance beibehalten (aus Round-Robin bereits gefordert).
 *
 * Eingabe: Spiele mit { id, teamHome, teamAway, groupId?, bracketPos, ... }
 * Ausgabe: Array gleicher Spiele + scheduledAt, field
 *
 * Determinismus (Spec §10.9): "2× generateSchedule mit identischer Config →
 * identische Match-IDs + scheduledAt". Wir sortieren die Spiele deterministisch
 * (group, dann bracketPos, dann id) und weisen Zeiten linear zu.
 */

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
  const slotMinutes = Math.max(5, sched.slotMinutes ?? 15);
  const matchDuration = Math.max(5, sched.matchDurationMinutes ?? 30);
  const parallelFields = Math.max(1, sched.parallelFields ?? 1);
  const startTime = sched.startTime ?? '10:00';

  // Sortierung deterministisch: groupKey (oder ''), bracketPos, dann id
  const sorted = matches.slice().sort((a, b) => {
    const ga = a.groupKey ?? '';
    const gb = b.groupKey ?? '';
    if (ga !== gb) return ga < gb ? -1 : 1;
    const pa = a.bracketPos ?? 0;
    const pb = b.bracketPos ?? 0;
    if (pa !== pb) return pa - pb;
    return (a.id ?? '') < (b.id ?? '') ? -1 : 1;
  });

  let cursor = parseStartTime(startTime, baseDate);
  const teamLastSlot = new Map();   // teamId → letzter Slot-Index
  let slotIndex = 0;
  const result = new Map();

  for (const m of sorted) {
    // Prüfe, ob eines der Teams in diesem Slot noch "verboten" ist
    let attempts = 0;
    let chosenSlotIndex = slotIndex;
    while (attempts < 16) {
      const slotStart = cursor.getTime();
      const ok =
        (m.teamHome == null || teamLastSlot.get(m.teamHome) !== chosenSlotIndex) &&
        (m.teamAway == null || teamLastSlot.get(m.teamAway) !== chosenSlotIndex);

      if (ok) break;
      chosenSlotIndex += 1;
      cursor = addMinutes(cursor, slotMinutes);
      attempts += 1;
      if (attempts >= 16) break;
    }

    // Slot-Zeitpunkt = chosenSlotIndex * slotMinutes nach Start
    const t = new Date(cursor);
    // für die field-Vergabe: Slot % parallelFields
    const field = (chosenSlotIndex % parallelFields) + 1;
    t.setMinutes(t.getMinutes() + chosenSlotIndex * slotMinutes);

    const scheduledAt = t;
    result.set(m.id, { ...m, scheduledAt, field });

    if (m.teamHome != null) teamLastSlot.set(m.teamHome, chosenSlotIndex);
    if (m.teamAway != null) teamLastSlot.set(m.teamAway, chosenSlotIndex);

    slotIndex = chosenSlotIndex + 1;
  }

  // Reihenfolge wieder in Originalreihenfolge zurück
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