/**
 * Sichtbarkeits-Logik für Turniere (Spec §13.2).
 *
 * Ein Turnier ist sichtbar für:
 *   - Admins (group.createdBy, GroupDeputy, user.role==='admin')
 *     in JEDEM Status, inkl. 'draft'.
 *   - Alle anderen Mitglieder NUR wenn status !== 'draft'.
 *
 * Öffentliche Turniere (isPublic=true) sind für jeden zugänglich —
 * das wird aber NICHT hier entschieden, sondern im Route-Layer
 * via Public-Bypass (siehe auth.js). canViewTournament betrachtet
 * daher den eingeloggten Fall.
 */

/**
 * @param {object} tournament  hat mindestens .status
 * @param {object} user        eingeloggter User mit .id und optional .role
 * @param {boolean} isAdmin    Ergebnis von isGroupAdmin()
 * @returns {boolean}
 */
export function canViewTournament(tournament, user, isAdmin) {
  if (!tournament) return false;
  if (isAdmin) return true;
  return tournament.status !== 'draft';
}

/**
 * Sortier-Reihenfolge für die Turnierliste (Spec §13.2):
 *   - laufende Turniere zuerst (group_stage, ko_stage)
 *   - dann kommende (generated)
 *   - dann beendete (finished)
 *   - drafts NIE (außer für Admins, dann aber ganz unten)
 */
export function compareTournaments(a, b) {
  const order = (status) => {
    switch (status) {
      case 'group_stage': return 0;
      case 'ko_stage': return 1;
      case 'generated': return 2;
      case 'finished': return 3;
      case 'draft': return 4;
      default: return 5;
    }
  };
  const oa = order(a.status);
  const ob = order(b.status);
  if (oa !== ob) return oa - ob;
  // Innerhalb gleicher Klasse: nach createdAt desc (neueste oben).
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
