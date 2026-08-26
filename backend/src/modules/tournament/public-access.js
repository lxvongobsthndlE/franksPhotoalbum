/**
 * Zuschauer-Link — öffentlicher, tokenbasierter Lesezugriff (Spec §11, Stufe B).
 *
 * Warum diese Datei existiert:
 * ---------------------------
 * Die Stufe-B-Felder (isPublic, publicToken, publicEnabledAt, publicRevokedAt)
 * lagen seit dem Schema-Entwurf im Modell, und `auth.js` hatte dazu einen
 * Bypass-Zweig. Der Zweig prüfte aber NUR, ob ein Token in der DB steht —
 * er hat nie verglichen, ob der Aufrufer ihn kennt. Solange keine Route
 * `isPublic` setzen konnte, war das folgenlos. Mit der Freigabe-Route wäre
 * es ein Loch geworden: jeder, der die Turnier-ID kennt, hätte
 * `GET /api/tournaments/:id` anonym lesen können — inklusive Entwürfen,
 * denn der Bypass stand VOR der Draft-Prüfung.
 *
 * Deshalb gilt ab hier: es gibt genau EINEN öffentlichen Pfad, und der ist
 * über den Token adressiert, nicht über die ID. `requireTournamentRead`
 * kennt keinen Bypass mehr.
 *
 * Die vier Regeln des Zuschauer-Links:
 *
 *   1. Der Token IST die Adresse. Wer ihn nicht hat, kommt nicht rein —
 *      die Turnier-ID öffnet nichts.
 *   2. Entwürfe sind nie öffentlich. Ein Turnier im Status 'draft' wird
 *      auch mit gültigem Token nicht ausgeliefert (404, nicht 403 — ein
 *      Anonymer erfährt nicht, dass es das Turnier gibt).
 *   3. Widerruf ist endgültig. Beim Widerruf wird der Token gelöscht, nicht
 *      nur `isPublic` umgelegt. Sonst würde eine spätere zweite Freigabe
 *      jeden alten, längst weitergereichten Link wieder scharf schalten.
 *   4. Lesen heißt lesen. Über diesen Pfad kommt nie ein Schreibzugriff,
 *      und die Antwort ist datensparsamer als die interne (siehe
 *      buildPublicPayload in view.js).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Zeichenvorrat und Länge des Tokens.
 *
 * 24 Zufalls-Bytes → 32 Zeichen base64url. Das ist deutlich mehr Entropie,
 * als ein Aushang am Tresen braucht, kostet aber nichts: der Link wird
 * gescannt oder angetippt, nicht abgetippt. Bewusst NICHT cuid() wie die
 * IDs — cuid ist auf Kollisionsfreiheit und Sortierbarkeit ausgelegt, nicht
 * auf Unratbarkeit. Ein Zugangstoken braucht das Gegenteil.
 */
const TOKEN_BYTES = 24;

/** Format, das ein Token haben MUSS, damit wir überhaupt die DB fragen. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function createPublicToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Prüft das Format, bevor ein Token die Datenbank erreicht.
 *
 * Kein Sicherheitsgewinn gegen Erraten (das erledigt die Entropie), sondern
 * gegen sinnlose Last: ein Bot, der `/t/<irgendwas>` durchprobiert, soll
 * keinen Index-Lookup je Versuch auslösen.
 */
export function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * Vergleicht zwei Token ohne verwertbares Zeitprofil.
 *
 * Bei 32 zufälligen Zeichen ist ein Timing-Angriff praktisch aussichtslos —
 * aber der Vergleich ist an genau einer Stelle, kostet nichts, und die
 * Alternative wäre, sich diese Begründung bei jeder späteren Änderung
 * erneut zurechtzulegen.
 */
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Lädt ein Turnier über seinen Zuschauer-Token.
 *
 * Wirft 404 in JEDEM Ablehnungsfall — unbekannter Token, widerrufener Link,
 * Entwurf, Freigabe zurückgenommen. Ein Anonymer soll aus dem Statuscode
 * nicht ablesen können, ob es die Adresse mal gab.
 *
 * @returns {Promise<{ tournament: object, group: object, isAdmin: false, public: true }>}
 */
export async function requirePublicTournament(prisma, token) {
  const notFound = () => {
    const err = new Error('Dieser Link ist nicht (mehr) gültig');
    err.statusCode = 404;
    return err;
  };

  if (!isWellFormedToken(token)) throw notFound();

  const t = await prisma.tournament.findUnique({
    where: { publicToken: token },
    include: { group: { select: { id: true, createdBy: true, name: true } } },
  });

  // Regel 1: kein Treffer, oder der gespeicherte Token passt nicht exakt.
  if (!t || !tokensMatch(t.publicToken ?? '', token)) throw notFound();

  // Regel 3: Freigabe zurückgenommen.
  if (!t.isPublic || t.publicRevokedAt) throw notFound();

  // Regel 2: Entwürfe nie. Das ist die Prüfung, die im alten Bypass fehlte.
  if (t.status === 'draft') throw notFound();

  return { tournament: t, group: t.group, isAdmin: false, public: true };
}
