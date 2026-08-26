/**
 * Der Takt der Zuschauer-Ansicht: Wie alt darf ein Stand werden?
 *
 * Ein fester Wert wäre in beide Richtungen falsch. Während ein Spiel läuft,
 * sind 30 Sekunden zu lang — der Zuschauer am Spielfeldrand sieht das Tor
 * eher als die Seite. Ist das Turnier abgeschlossen, sind 30 Sekunden
 * Verschwendung: Es ändert sich nie wieder etwas, und die Seite läuft oft
 * noch stundenlang in einem vergessenen Tab.
 *
 * Deshalb steht der Takt hier als reine Funktion und nicht als Konstante
 * in live.js: Er ist eine Fachentscheidung mit drei Fällen, und die drei
 * Fälle sind prüfbar, ohne einen Browser zu starten.
 */

/** Ein Spiel läuft — hier wird wirklich zugesehen. */
export const TAKT_LIVE = 10_000;

/** Turniertag, aber gerade kein Anpfiff. */
export const TAKT_TAG = 30_000;

/** Abgeschlossen: Es kommt nichts mehr. */
export const TAKT_RUHE = 120_000;

/**
 * Abstand bis zum nächsten Abruf, in Millisekunden.
 *
 * @param {{tournament?: object, matches?: Array<{isLive?: boolean}>}|null} daten
 *        Die zuletzt erfolgreich geholte Antwort. `null` (noch nie geladen)
 *        gilt als Turniertag — nicht als Ruhe: Wer noch nichts weiß, darf
 *        nicht zwei Minuten warten, bis er es erfährt.
 */
export function naechsterAbstand(daten) {
  const matches = daten?.matches ?? [];
  if (matches.some((m) => m?.isLive)) return TAKT_LIVE;
  if (daten?.tournament?.status === 'finished') return TAKT_RUHE;
  return TAKT_TAG;
}

/**
 * Abstand nach einem Fehlversuch — kurz, dann nachgebend.
 *
 * Der übliche Fehlerfall ist kein kaputter Server, sondern ein Funkloch am
 * Spielfeldrand. Der erste Nachfassversuch kommt deshalb schnell (fünf
 * Sekunden), und erst wenn es wirklich länger klemmt, zieht sich die Seite
 * zurück, statt ein totes Netz im Sekundentakt anzurufen.
 *
 * @param {number} fehlversuche Anzahl der Fehlschläge in Folge (ab 1).
 */
export function abstandNachFehler(fehlversuche) {
  const stufen = [5_000, 10_000, 20_000, 60_000];
  const i = Math.min(Math.max(Math.trunc(fehlversuche) || 1, 1), stufen.length);
  return stufen[i - 1];
}
