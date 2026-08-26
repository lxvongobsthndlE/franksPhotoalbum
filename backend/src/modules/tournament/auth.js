/**
 * Auth-Helper für Turnier-Routen.
 *
 * Rollenmodell (Spec §1.2, §13.2):
 *   - "Admin" einer Gruppe = group.createdBy ODER User.role==='admin'
 *     ODER Eintrag in GroupDeputy.
 *   - Nur Admins dürfen Turniere erstellen / Ergebnisse eintragen /
 *     Zeitplan / Auslosung ändern.
 *   - Mitglieder dürfen alles lesen, AUSSER Turniere im Status 'draft'.
 *
 * Entwürfe (status='draft') sind nur für Admins sichtbar — gilt auch
 * für den direkten URL-Zugriff durch ein Mitglied (Backend-Check, nicht
 * nur UI-Hide).
 *
 * Öffentlicher Zugang: Hier gibt es KEINEN Bypass. Der Zuschauer-Link
 * läuft über einen eigenen, über den Token adressierten Pfad — siehe
 * public-access.js. Die ausführliche Begründung steht dort; kurz: der
 * frühere Bypass hat den Token nie mit dem Aufrufer verglichen und stand
 * vor der Draft-Prüfung.
 */

import { canViewTournament } from './access/visibility.js';

/**
 * Liest den JWT, lädt den User und liefert { user } zurück.
 * Wirft 401 wenn kein Token, 401 wenn User nicht (mehr) existiert.
 */
export async function requireAuth(request, prisma) {
  await request.jwtVerify();
  const user = await prisma.user.findUnique({ where: { id: request.user.id } });
  if (!user) {
    const err = new Error('Authentifizierung fehlgeschlagen');
    err.statusCode = 401;
    throw err;
  }
  return { user };
}

/**
 * Lädt das Turnier + Gruppe, prüft Sichtbarkeit.
 *
 *   - 404 wenn Turnier nicht existiert.
 *   - requireAuth → muss Mitglied der Gruppe sein → 403 sonst.
 *   - Wenn Status='draft' und User ist kein Admin der Gruppe: 403.
 *
 * `isPublic` spielt hier bewusst KEINE Rolle: ein freigegebenes Turnier
 * wird über /api/tournaments/public/:token gelesen, nie über seine ID.
 *
 * @returns {Promise<{
 *   tournament: object,
 *   group: { id, createdBy, name },
 *   user: { id, role },
 *   isAdmin: boolean,
 *   public: false,
 * }>}
 */
export async function requireTournamentRead(request, prisma, tournamentId) {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      group: { select: { id: true, createdBy: true, name: true } },
    },
  });
  if (!t) {
    const err = new Error('Turnier nicht gefunden');
    err.statusCode = 404;
    throw err;
  }

  // Hier stand bis 26.08.2026 ein Public-Bypass. Er prüfte, OB ein Token
  // in der DB steht — nie, ob der Aufrufer ihn kennt. Wer die ID hatte,
  // kam rein, und weil der Zweig vor der Draft-Prüfung stand, galt das
  // auch für Entwürfe. Eine Freigabe macht ein Turnier ab jetzt unter
  // seinem TOKEN lesbar, nicht unter seiner ID: public-access.js.

  // Eingeloggter User + Mitgliedschaft.
  const { user } = await requireAuth(request, prisma);
  const isAdmin = await isGroupAdmin(prisma, t.groupId, user);
  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: user.id, groupId: t.groupId } },
  });
  if (!member && !isAdmin) {
    const err = new Error('Kein Mitglied dieser Gruppe');
    err.statusCode = 403;
    throw err;
  }

  // Draft-Sichtbarkeit: nur Admins (Owner, Deputy, global admin).
  if (!canViewTournament(t, user, isAdmin)) {
    const err = new Error('Dieser Entwurf ist nur für Admins sichtbar');
    err.statusCode = 403;
    throw err;
  }

  return { tournament: t, group: t.group, user, isAdmin, public: false };
}

/**
 * Wie requireTournamentRead, ABER zusätzlich: User muss Admin der Gruppe
 * sein. Verwendet für alle schreibenden Aktionen und für das Anlegen
 * neuer Turniere (POST /api/tournaments).
 *
 * 403-Fälle:
 *   - User ist kein Admin der Gruppe. (Anonym schreiben ist gar nicht
 *     erst erreichbar: ohne Bypass endet der Weg schon in requireAuth
 *     mit 401.)
 *   - Turnier ist im Status 'draft' (kommt nicht in Frage, weil dafür
 *     zuerst requireTournamentRead nötig wäre — wir geben hier auch
 *     bei draft einen sauberen 403 wenn nicht Admin).
 */
export async function requireTournamentWrite(request, prisma, tournamentId) {
  const ctx = await requireTournamentRead(request, prisma, tournamentId);
  if (!ctx.isAdmin) {
    const err = new Error('Nur Admins dürfen diese Aktion ausführen');
    err.statusCode = 403;
    throw err;
  }
  return ctx;
}

/**
 * Prüft Admin-Rechte für eine Gruppe (OHNE Turnier-Kontext).
 * Verwendet für POST /api/tournaments, wo das Turnier noch nicht
 * existiert.
 *
 * Admin-Definition: group.createdBy === userId ODER user.role==='admin'
 *   ODER User ist in GroupDeputy-Tabelle.
 */
export async function isGroupAdmin(prisma, groupId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { createdBy: true },
  });
  if (group?.createdBy === user.id) return true;
  const deputy = await prisma.groupDeputy.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  return !!deputy;
}

/**
 * Filter-Helfer für die Turnierliste: entfernt 'draft'-Turniere
 * für Nicht-Admins.
 */
export function buildListWhereClause(prisma, groupId, user, isAdmin) {
  if (isAdmin) {
    return { groupId };
  }
  // Members: keine Drafts sehen.
  return {
    groupId,
    status: { not: 'draft' },
  };
}
