/**
 * Turnier-Lock-Logik — Single Source of Truth (Etappe B.8, Architektur-Entscheidung D1.5).
 *
 * "canEdit(tournament, finishedCount, what)" liefert { allowed, reason }.
 * Wird von Backend-Routes (für 409-Prüfung) und Frontend-Renderer (für UI-Hints)
 * aufgerufen. **Eine Wahrheit, zwei Aufrufer** — sonst hat man dieselbe Regel
 * siebenmal und irgendwann sechs davon richtig.
 *
 * Warum Reason-Texte?
 *   User-Anmerkung (2026-08-20): "Wenn ein Bedienelement gesperrt ist, muss die
 *   Begründung DANEBEN stehen — nicht erst nach dem Klick als Fehlermeldung.
 *   Sonst klicke ich am Turniertag auf etwas, das nicht reagiert, und suche
 *   den Fehler bei mir."
 *
 * UMD-Pattern (ESM-Export + window.global):
 *   Die Datei exportiert `canEdit`, `canRevertToDraft`, `canStartTournament`,
 *   `requireConfirmForRedraw`, `requireConfirmForDelete`, `EDITABLE` als
 *   ESM-Export. Zusätzlich hängt sie sich an `window.tournamentLocks`, wenn
 *   `window` definiert ist (Browser-Kontext). Beide Wege liefern dasselbe
 *   Funktionsobjekt — verifiziert durch `locks-parity.test.js`.
 */

export const EDITABLE = Object.freeze([
  'teams',
  'mode',
  'groups',
  'fields',
  'times',
  'draw',
  'results',
]);

/**
 * Hauptfunktion für die meisten Lock-Entscheidungen.
 *
 * @param {{status: string, startedAt: Date|string|null}} t
 * @param {number} finishedCount
 * @param {'teams'|'mode'|'groups'|'fields'|'times'|'draw'|'results'} what
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function canEdit(t, finishedCount, what) {
  if (!EDITABLE.includes(what)) {
    throw new Error(`Unknown lock key: ${what}`);
  }

  // 1) Beendet = read-only, immer.
  if (t.status === 'finished') {
    return { allowed: false, reason: 'Turnier ist beendet — read-only.' };
  }

  // 2) Draw (Redraw/Auslosung) ist auch in LÄUFT prinzipiell erlaubt
  //    (mit Confirm-Handshake wenn finishedCount > 0). Der reine
  //    "darf versuchen"-Check gibt hier true; der Confirm wird separat
  //    per requireConfirmForRedraw(t, finishedCount) geprüft.
  if (what === 'draw') {
    return { allowed: true, reason: null };
  }

  // 3) ENTWURF + BEREIT (startedAt === null) = full edit.
  if (t.startedAt === null || t.startedAt === undefined) {
    return { allowed: true, reason: null };
  }

  // 4) LÄUFT (startedAt !== null, status !== 'finished') = partial edit.
  switch (what) {
    case 'teams':
      // Add/Remove/Reorder gesperrt. Rename ist nicht hier.
      return {
        allowed: false,
        reason: 'Sperrt, solange das Turnier läuft. Nur Umbenennen ist noch möglich.',
      };
    case 'mode':
      return {
        allowed: false,
        reason: 'Sperrt, solange das Turnier läuft. Modus ist jetzt eingefroren.',
      };
    case 'groups':
      return {
        allowed: false,
        reason: 'Sperrt, solange das Turnier läuft. Gruppen sind jetzt eingefroren.',
      };
    case 'fields':
      // Spielfeld-Namen und -Anzahl in LÄUFT noch änderbar.
      return { allowed: true, reason: null };
    case 'times':
      // Per-match schedule, Dauer und Plattenzahl in LÄUFT noch änderbar.
      return { allowed: true, reason: null };
    case 'results':
      return { allowed: true, reason: null };
    default:
      return { allowed: false, reason: 'Unbekannte Aktion.' };
  }
}

/**
 * Darf das Turnier gerade revertiert werden (zurück zu Entwurf)?
 *
 * Bedingungen: startedAt !== null (also lief/läuft gerade), keine
 * abgeschlossenen Spiele, nicht beendet.
 *
 * @param {{status: string, startedAt: Date|string|null}} t
 * @param {number} finishedCount
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function canRevertToDraft(t, finishedCount) {
  if (t.status === 'finished') {
    return { allowed: false, reason: 'Turnier ist beendet — kann nicht zurückgesetzt werden.' };
  }
  if (t.startedAt === null || t.startedAt === undefined) {
    return { allowed: false, reason: 'Turnier wurde noch nicht gestartet.' };
  }
  if (finishedCount > 0) {
    return {
      allowed: false,
      reason:
        'Es liegen bereits Ergebnisse vor. Bestätige mit dem Turniernamen, um sie zu verwerfen.',
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Darf das Turnier gerade gestartet werden (starten-Knopf)?
 *
 * Bedingungen: status === 'generated' UND startedAt === null.
 */
export function canStartTournament(t) {
  if (t.status !== 'generated') {
    return {
      allowed: false,
      reason: 'Turnier ist nicht generiert. Erst „Spielplan generieren" aufrufen.',
    };
  }
  if (t.startedAt !== null && t.startedAt !== undefined) {
    return { allowed: false, reason: 'Turnier läuft bereits.' };
  }
  return { allowed: true, reason: null };
}

/**
 * Bestätigungs-Handshake für redraw in LÄUFT mit Ergebnissen (§13.10).
 * Liefert true, wenn die Aktion `confirmTournamentName` erzwingt.
 */
export function requireConfirmForRedraw(t, finishedCount) {
  return t.startedAt !== null && t.startedAt !== undefined && finishedCount > 0;
}

/**
 * Bestätigungs-Handshake für delete in LÄUFT/Beendet mit Ergebnissen (§13.10).
 */
export function requireConfirmForDelete(t, finishedCount) {
  return finishedCount > 0;
}

/**
 * Hilfsfunktion: Baut ein flaches lockState-Objekt für den Renderer.
 * Ruft canEdit für jeden what-Wert einmal auf und legt die Ergebnisse
 * unter sprechenden Namen ab.
 */
export function lockStateFor(t, finishedCount) {
  const teams = canEdit(t, finishedCount, 'teams');
  const mode = canEdit(t, finishedCount, 'mode');
  const groups = canEdit(t, finishedCount, 'groups');
  const fields = canEdit(t, finishedCount, 'fields');
  const times = canEdit(t, finishedCount, 'times');
  const draw = canEdit(t, finishedCount, 'draw');
  const results = canEdit(t, finishedCount, 'results');
  const revert = canRevertToDraft(t, finishedCount);
  const start = canStartTournament(t);
  return {
    canEditTeams: teams,
    canEditMode: mode,
    canEditGroups: groups,
    canEditFields: fields,
    canEditTimes: times,
    canRedraw: draw,
    canEditResults: results,
    canRevertToDraft: revert,
    canStart: start,
    canDelete:
      t.status !== 'finished'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Turnier ist beendet.' },
    canFinish:
      t.status !== 'finished'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Turnier ist bereits beendet.' },
    canShiftMatches:
      t.status !== 'finished'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Turnier ist beendet.' },
    canReschedule:
      t.status !== 'finished'
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Turnier ist beendet.' },
    requireConfirmForRedraw: requireConfirmForRedraw(t, finishedCount),
    requireConfirmForDelete: requireConfirmForDelete(t, finishedCount),
  };
}

/**
 * Phase des Turniers — die EINE Ableitung aus (status, startedAt).
 *
 * Warum nicht `status` allein: POST /:id/start setzt NUR `startedAt`, der
 * Status bleibt 'generated' (Etappe B.8: die Lock-Tabelle oben liest
 * startedAt, nicht den Status). Wer die Phase aus dem Status liest, sieht
 * ein laufendes Turnier als „Bereit" — so stand es bis zum 01.09.2026 in
 * der Turnierliste, und die Seitenleiste konnte „läuft" gar nicht wissen.
 *
 * Rangfolge wie in canEdit: beendet schlägt gestartet, gestartet schlägt
 * jeden Status. Unbekannt/leer → 'other', nicht 'draft' (Spec §13.5:
 * keine stillen Annahmen).
 *
 * @param {{status?: string, startedAt?: Date|string|null}|null} t
 * @returns {'draft'|'ready'|'live'|'finished'|'other'}
 */
export function tournamentPhase(t) {
  if (!t || typeof t !== 'object') return 'other';
  if (t.status === 'finished' || t.status === 'cancelled') return 'finished';
  if (t.startedAt !== null && t.startedAt !== undefined) return 'live';
  // Altbestand: Status-Werte, die einmal „läuft" bedeuteten, ohne startedAt.
  if (t.status === 'group_stage' || t.status === 'ko_stage') return 'live';
  if (t.status === 'generated') return 'ready';
  if (t.status === 'draft') return 'draft';
  return 'other';
}

// UMD-Lite: Im Browser-Kontext an window hängen, damit sowohl die
// ESM- als auch die Browser-Nutzung dieselbe Logik trifft.
if (typeof window !== 'undefined') {
  window.tournamentLocks = {
    canEdit,
    tournamentPhase,
    canStartTournament,
    canRevertToDraft,
    requireConfirmForRedraw,
    requireConfirmForDelete,
    lockStateFor,
    EDITABLE,
  };
}
