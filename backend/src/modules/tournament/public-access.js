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
 *
 * Nachtrag 28.08.2026 — der sprechende Zweitname:
 * ----------------------------------------------
 * Ein Turnier kann seit heute zusätzlich unter einem selbst gewählten
 * Namen erreichbar sein (`/t/sommerfest-2026`). Das ändert Regel 1 in
 * ihrem Wortlaut, nicht in ihrer Wirkung: die ADRESSE öffnet, nicht die
 * Turnier-ID. Regeln 2 bis 4 gelten unverändert und für beide Adressen.
 *
 * Was sich sehr wohl ändert, ist die Entropie: ein diktierbarer Link ist
 * ein erratbarer Link. Diese Abwägung ist an EINER Stelle aufgeschrieben,
 * und zwar in public-slug.js — hier steht sie nicht noch einmal, damit
 * es keine zweite, driftende Fassung gibt.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { normalisiereSlug } from './public-slug.js';

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
 * Entscheidet, WIE eine Adresse aus `/t/<wert>` aufzulösen ist.
 *
 * Die Reihenfolge ist Token zuerst, Slug danach — und zwar aus diesem
 * Grund, nicht aus Gewohnheit:
 *
 *   Die beiden Wertebereiche sind disjunkt gemacht, nicht bloß
 *   vorgefunden. Ein Token ist `^[A-Za-z0-9_-]{32}$`; ein Slug darf
 *   deshalb NIE genau 32 Zeichen lang sein (public-slug.js sperrt
 *   diese eine Länge). Es kann also gar kein Wert existieren, der
 *   beides erfüllt — die Reihenfolge entscheidet keinen Konflikt,
 *   weil es keinen gibt.
 *
 *   Sie entscheidet etwas anderes: Der Token-Weg ist der engere und der
 *   ältere. Er wird zuerst und ohne jede Vorbehandlung geprüft — der
 *   rohe Wert geht unverändert in den Formattest. Damit hängt der
 *   sicherheitsrelevante Pfad an keiner Zeile Slug-Code; eine spätere
 *   Änderung an der Normalisierung kann ihn nicht verbiegen. Wäre es
 *   andersherum, liefe jeder Token erst durch `normalisiereSlug` — und
 *   die Kleinschreibung dort würde ihn zerstören.
 *
 * @param {unknown} wert  der rohe Pfad-Bestandteil
 * @returns {{art: 'token', wert: string} | {art: 'slug', wert: string} | null}
 */
export function bestimmeAdressart(wert) {
  if (typeof wert !== 'string') return null;
  if (isWellFormedToken(wert)) return { art: 'token', wert };
  const slug = normalisiereSlug(wert);
  // Die Normalisierung beim LESEN ist bewusst großzügiger als beim
  // Setzen: Wer „Sommerfest-2026" von einem Plakat abtippt, soll nicht
  // an der Großschreibung scheitern. Ein Wert, aus dem nichts übrig
  // bleibt, ist keine Adresse.
  if (slug === '') return null;
  return { art: 'slug', wert: slug };
}

/**
 * Lädt ein Turnier über seine öffentliche Adresse — Token ODER Slug.
 *
 * Wirft 404 in JEDEM Ablehnungsfall — unbekannte Adresse, widerrufener
 * Link, Entwurf, Freigabe zurückgenommen, umbenannter Link unter seinem
 * alten Namen. Ein Anonymer soll aus dem Statuscode nicht ablesen können,
 * ob es die Adresse mal gab.
 *
 * @param {object} prisma
 * @param {string} adresse  Token oder Slug, roh aus dem Pfad
 * @returns {Promise<{ tournament: object, group: object, isAdmin: false, public: true }>}
 */
export async function requirePublicTournament(prisma, adresse) {
  const notFound = () => {
    const err = new Error('Dieser Link ist nicht (mehr) gültig');
    err.statusCode = 404;
    return err;
  };

  const art = bestimmeAdressart(adresse);
  if (!art) throw notFound();

  const t = await prisma.tournament.findUnique({
    where: art.art === 'token' ? { publicToken: art.wert } : { publicSlug: art.wert },
    include: { group: { select: { id: true, createdBy: true, name: true } } },
  });

  // Regel 1: kein Treffer, oder der gespeicherte Wert passt nicht exakt.
  //
  // Beim Token bleibt der zeitkonstante Vergleich; beim Slug wäre er
  // Theater — ein Name, den der Betreiber auf ein Plakat druckt, ist
  // kein Geheimnis, das ein Zeitprofil verraten könnte.
  if (!t) throw notFound();
  if (art.art === 'token') {
    if (!tokensMatch(t.publicToken ?? '', art.wert)) throw notFound();
  } else if ((t.publicSlug ?? '') !== art.wert) {
    throw notFound();
  }

  // Regel 3: Freigabe zurückgenommen.
  if (!t.isPublic || t.publicRevokedAt) throw notFound();

  // Regel 2: Entwürfe nie. Das ist die Prüfung, die im alten Bypass fehlte.
  if (t.status === 'draft') throw notFound();

  return { tournament: t, group: t.group, isAdmin: false, public: true };
}
