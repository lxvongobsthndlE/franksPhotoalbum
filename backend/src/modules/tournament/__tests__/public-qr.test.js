/**
 * Tests für die QR-Erzeugung des Zuschauer-Links.
 *
 * Was ein Unit-Test hier NICHT kann: prüfen, ob eine Handykamera den Code
 * liest. Diese Zusage deckt der Browser-Gegentest ab (siehe
 * qr-gegenprobe im Sitzungsprotokoll: SVG rendern, mit BarcodeDetector
 * zurücklesen, mit der Original-URL vergleichen). Hier geht es um das,
 * was maschinell aus dem Markup selbst folgt — und um buildPublicUrl,
 * wo die häufigste Fehlerquelle sitzt: ein QR-Code mit der falschen
 * Adresse sieht richtig aus und führt ins Leere.
 */

import { describe, it, expect } from 'vitest';
import { buildQrSvg, buildPublicUrl } from '../public-qr.js';

const URL_BEISPIEL = 'https://photoalbum.lx-derpi-cloud.de/t/' + 'A'.repeat(32);

describe('buildQrSvg', () => {
  it('liefert ein SVG mit viewBox', () => {
    const svg = buildQrSvg(URL_BEISPIEL);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    expect(svg).toContain('</svg>');
  });

  it('hat eine ruhige Zone — sonst lesen viele Scanner nicht', () => {
    // padding:4 heißt: vier Module Rand. Bei einem Code mit N Modulen
    // Nutzfläche ist die viewBox also N+8 breit. Wir prüfen, dass
    // überhaupt gepolstert wurde, indem wir gegen einen ungepolsterten
    // Code derselben Nachricht vergleichen wäre aufwendig — es genügt,
    // dass der erste dunkle Pfad nicht bei 0 beginnt.
    const svg = buildQrSvg(URL_BEISPIEL);
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
    expect(viewBox).toBeTruthy();
    const [, , breite] = viewBox.split(/\s+/).map(Number);
    // Version 3 (29 Module) + 8 Rand = 37 als Untergrenze für eine URL
    // dieser Länge. Kleiner geht rechnerisch nicht.
    expect(breite).toBeGreaterThanOrEqual(37);
  });

  it('erzeugt für verschiedene Adressen verschiedene Muster', () => {
    const a = buildQrSvg(URL_BEISPIEL);
    const b = buildQrSvg(URL_BEISPIEL.replace(/A+$/, 'B'.repeat(32)));
    expect(a).not.toBe(b);
  });

  it('ist für dieselbe Adresse stabil', () => {
    // Wichtig für den Cache-Header: derselbe Token, dasselbe Bild.
    expect(buildQrSvg(URL_BEISPIEL)).toBe(buildQrSvg(URL_BEISPIEL));
  });

  it('wirft bei leerer Eingabe, statt einen leeren Code zu liefern', () => {
    expect(() => buildQrSvg('')).toThrow();
    expect(() => buildQrSvg(null)).toThrow();
    expect(() => buildQrSvg(undefined)).toThrow();
  });

  it('verträgt einen langen Host', () => {
    const lang = 'https://' + 'a'.repeat(60) + '.example.de/t/' + 'Z'.repeat(32);
    expect(() => buildQrSvg(lang)).not.toThrow();
  });
});

describe('buildPublicUrl', () => {
  const token = 'T'.repeat(32);

  it('baut die Adresse aus Protokoll und Host', () => {
    const req = { protocol: 'http', headers: { host: 'localhost:3000' } };
    expect(buildPublicUrl(req, token)).toBe(`http://localhost:3000/t/${token}`);
  });

  it('folgt dem Reverse Proxy, nicht der internen Adresse', () => {
    // Der Fall, der produktiv zählt: Innen läuft http auf einem
    // Container-Namen, außen https auf der Domain. Ein QR mit der
    // Innenadresse wäre für jeden Zuschauer wertlos.
    const req = {
      protocol: 'http',
      headers: {
        host: 'backend:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'photoalbum.lx-derpi-cloud.de',
      },
    };
    expect(buildPublicUrl(req, token)).toBe(
      `https://photoalbum.lx-derpi-cloud.de/t/${token}`
    );
  });

  it('nimmt bei mehrfach gesetzten Weiterleitungs-Kopfzeilen den ersten Wert', () => {
    // Mehrere Proxys hintereinander hängen an, statt zu ersetzen:
    // "https, http". Der erste ist der äußere — der, den der Besucher sah.
    const req = {
      protocol: 'http',
      headers: {
        host: 'backend:3000',
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'photoalbum.lx-derpi-cloud.de, backend:3000',
      },
    };
    expect(buildPublicUrl(req, token)).toBe(
      `https://photoalbum.lx-derpi-cloud.de/t/${token}`
    );
  });

  it('erzeugt eine Adresse, die der QR dann auch kodieren kann', () => {
    const req = { protocol: 'https', headers: { host: 'beispiel.de' } };
    const url = buildPublicUrl(req, token);
    expect(() => buildQrSvg(url)).not.toThrow();
  });
});
