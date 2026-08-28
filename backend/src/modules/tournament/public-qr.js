/**
 * QR-Code für den Zuschauer-Link.
 *
 * Der Link soll am Tresen hängen. Abtippen wird ihn niemand — 32 zufällige
 * Zeichen sind genau die Sorte Zeichenkette, bei der sich Menschen
 * vertippen. Der QR-Code ist deshalb nicht Zierde, sondern der eigentliche
 * Zugangsweg für einen Zuschauer, der vor dem Aushang steht.
 *
 * Warum SVG und nicht PNG:
 *   - Ein Aushang wird gedruckt, oft groß. SVG bleibt bei jeder Größe scharf.
 *   - Kein Binärpfad, keine Bildbibliothek, keine Zwischenspeicher-Fragen.
 *   - Der Code ist reine Rechnung; das Ergebnis lässt sich als Text prüfen.
 *
 * Fehlerkorrektur M (~15 %): Ein Aushang bekommt Kaffeeflecken und
 * Reißzwecken. H (~30 %) wäre robuster, macht das Muster aber dichter und
 * damit aus größerer Entfernung schlechter lesbar — und Entfernung ist der
 * häufigere Fall als Beschädigung.
 */

import QRCode from 'qrcode-svg';

/** Kantenlänge in SVG-Einheiten. Die Anzeige skaliert über die viewBox. */
const GROESSE = 512;

/**
 * Erzeugt den QR-Code zu einer vollständigen URL.
 *
 * @param {string} url  die komplette Adresse, inklusive Schema und Host
 * @returns {string}    SVG-Markup
 */
export function buildQrSvg(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('QR braucht eine URL');
  }
  return new QRCode({
    content: url,
    width: GROESSE,
    height: GROESSE,
    // Ohne Rand ist ein QR-Code nicht zuverlässig lesbar; die Norm
    // verlangt eine ruhige Zone von vier Modulen. `padding` zählt in
    // Modulen, nicht in Pixeln.
    padding: 4,
    color: '#000000',
    background: '#ffffff',
    ecl: 'M',
    // Verbindet gleichfarbige Module zu einem Pfad. Aus ~1.000 Rechtecken
    // wird ein Element — wichtig, weil das SVG in eine Druckseite geht.
    join: true,
    container: 'svg-viewbox',
  }).svg();
}

/**
 * Welche Adresse gilt gerade — der sprechende Name oder der Zufalls-Token?
 *
 * Es gibt genau eine Antwort darauf, und sie steht hier: Sobald ein Slug
 * gesetzt ist, IST er die Adresse. Der Token bleibt gültig und funktioniert
 * weiter (er ist die Rückfallebene, siehe public-slug.js) — aber gedruckt,
 * angezeigt und in den QR-Code gerechnet wird der Name, den der Betreiber
 * selbst gewählt hat. Alles andere wäre die Frage „welcher von beiden steht
 * jetzt auf dem Aushang?" an drei Stellen unterschiedlich beantwortet.
 *
 * @param {object} tournament  Rohzeile oder DTO mit publicSlug/publicToken
 * @returns {string|null}
 */
export function aktuelleAdresse(tournament) {
  const slug = tournament?.publicSlug;
  if (typeof slug === 'string' && slug.length > 0) return slug;
  const token = tournament?.publicToken;
  if (typeof token === 'string' && token.length > 0) return token;
  return null;
}

/**
 * Baut die öffentliche Adresse eines Zuschauer-Links.
 *
 * Der Host kommt aus dem Request, nicht aus einer Konstante: Die Anwendung
 * läuft in der Entwicklung unter localhost und produktiv unter ihrer
 * Domain, und ein QR-Code mit der falschen Adresse ist schlimmer als
 * keiner — er sieht richtig aus und führt ins Leere.
 *
 * @param {object} request  Fastify-Request
 * @param {string} adresse  Slug oder Token — der Teil hinter /t/
 */
export function buildPublicUrl(request, adresse) {
  // Hinter einem Reverse Proxy trägt der Host-Header die öffentliche
  // Adresse, nicht die interne. x-forwarded-proto sagt, ob davor TLS
  // terminiert wurde.
  const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol ?? 'http')
    .split(',')[0]
    .trim();
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '')
    .split(',')[0]
    .trim();
  return `${proto}://${host}/t/${encodeURIComponent(adresse)}`;
}
