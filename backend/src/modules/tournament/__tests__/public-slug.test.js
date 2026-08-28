/**
 * Tests für den sprechenden Zuschauer-Link (28.08.2026).
 *
 * Zwei Dinge werden hier geprüft, und sie hängen zusammen:
 *
 *   1. Die Normalisierung — sie entscheidet, was ein Mensch tippen DARF.
 *      Zu streng heißt: der Betreiber bekommt eine Fehlermeldung für
 *      „Sommerfest 2026". Zu lax heißt: es entsteht eine Adresse, die
 *      kein Browser so wieder hergibt.
 *
 *   2. Die Abgrenzung gegen den Token — sie entscheidet, ob `/t/<wert>`
 *      überhaupt eindeutig auflösbar ist. Bricht sie, ist nicht eine
 *      Anzeige falsch, sondern ein Zugang mehrdeutig.
 */

import { describe, it, expect } from 'vitest';
import {
  normalisiereSlug,
  pruefeSlug,
  istWohlgeformterSlug,
  RESERVIERTE_SLUGS,
  SLUG_MIN_LAENGE,
  SLUG_MAX_LAENGE,
} from '../public-slug.js';
import { bestimmeAdressart, isWellFormedToken, createPublicToken } from '../public-access.js';

describe('normalisiereSlug — was ein Mensch tippt, wird eine Adresse', () => {
  it('macht aus Leerzeichen Bindestriche', () => {
    expect(normalisiereSlug('Sommerfest 2026')).toBe('sommerfest-2026');
  });

  it('schreibt deutsche Umlaute aus, statt sie zu entkernen', () => {
    // „Grün" darf nicht „grun" werden — das liest sich falsch und
    // spricht sich falsch.
    expect(normalisiereSlug('Grün-Weiß')).toBe('gruen-weiss');
    expect(normalisiereSlug('ÄÖÜß')).toBe('aeoeuess');
  });

  it('trägt übrige Akzente ab', () => {
    expect(normalisiereSlug('Café Élan')).toBe('cafe-elan');
  });

  it('behandelt Unterstrich, Punkt und Schrägstrich wie ein Trennzeichen', () => {
    expect(normalisiereSlug('Turnier_Nord.2026')).toBe('turnier-nord-2026');
    expect(normalisiereSlug('a/b')).toBe('a-b');
  });

  it('entdoppelt Bindestriche und schneidet die Ränder ab', () => {
    expect(normalisiereSlug('  --Test--  ')).toBe('test');
    expect(normalisiereSlug('a---b')).toBe('a-b');
  });

  it('wirft alles weg, was keine Adresse sein kann', () => {
    expect(normalisiereSlug('!!!')).toBe('');
    expect(normalisiereSlug('★☆✦')).toBe('');
  });

  it('verträgt Nicht-Zeichenketten', () => {
    for (const wert of [null, undefined, 42, {}, []]) {
      expect(normalisiereSlug(wert)).toBe('');
    }
  });
});

describe('pruefeSlug — das Urteil', () => {
  it('nimmt an, was nach der Behandlung passt', () => {
    const urteil = pruefeSlug('Sommerfest 2026');
    expect(urteil).toEqual({ ok: true, slug: 'sommerfest-2026' });
  });

  it('lehnt Leeres ab', () => {
    expect(pruefeSlug('').code).toBe('slug_leer');
    expect(pruefeSlug('   ').code).toBe('slug_leer');
    expect(pruefeSlug(null).code).toBe('slug_leer');
  });

  it('lehnt ab, was nach der Behandlung nichts übrig lässt', () => {
    expect(pruefeSlug('!!!').code).toBe('slug_ohne_zeichen');
  });

  it(`lehnt weniger als ${SLUG_MIN_LAENGE} Zeichen ab`, () => {
    expect(pruefeSlug('ab').code).toBe('slug_zu_kurz');
    expect(pruefeSlug('abc').ok).toBe(true);
  });

  it(`lehnt mehr als ${SLUG_MAX_LAENGE} Zeichen ab`, () => {
    expect(pruefeSlug('x'.repeat(SLUG_MAX_LAENGE)).ok).toBe(true);
    expect(pruefeSlug('x'.repeat(SLUG_MAX_LAENGE + 1)).code).toBe('slug_zu_lang');
  });

  it('lehnt reservierte Wörter ab — auch groß geschrieben', () => {
    for (const wort of RESERVIERTE_SLUGS) {
      const urteil = pruefeSlug(wort.toUpperCase());
      // 't' ist einbuchstabig und scheitert schon an der Mindestlänge —
      // abgelehnt wird es trotzdem, und darauf kommt es an.
      expect(urteil.ok, `„${wort}" wurde angenommen`).toBe(false);
    }
    expect(pruefeSlug('Aushang').code).toBe('slug_reserviert');
  });

  it('lehnt genau 32 Zeichen ab — das ist die Token-Länge', () => {
    expect(pruefeSlug('a'.repeat(31)).ok).toBe(true);
    expect(pruefeSlug('a'.repeat(32)).code).toBe('slug_wie_token');
    expect(pruefeSlug('a'.repeat(33)).ok).toBe(true);
  });

  it('gibt jede Ablehnung mit einem deutschen Satz zurück', () => {
    for (const eingabe of ['', '!!!', 'ab', 'x'.repeat(99), 'a'.repeat(32), 'aushang']) {
      const urteil = pruefeSlug(eingabe);
      expect(urteil.ok).toBe(false);
      expect(typeof urteil.message).toBe('string');
      expect(urteil.message.length).toBeGreaterThan(10);
      // Keine Fremdzeichen in UI-Texten.
      expect(urteil.message).not.toMatch(/[\u3000-\u9fff]/);
    }
  });
});

describe('istWohlgeformterSlug', () => {
  it('urteilt über einen bereits normalisierten Wert', () => {
    expect(istWohlgeformterSlug('sommerfest-2026')).toBe(true);
    expect(istWohlgeformterSlug('Sommerfest')).toBe(false);
    expect(istWohlgeformterSlug('-abc')).toBe(false);
    expect(istWohlgeformterSlug('abc-')).toBe(false);
    expect(istWohlgeformterSlug('a--b')).toBe(false);
    expect(istWohlgeformterSlug('aushang')).toBe(false);
    expect(istWohlgeformterSlug('a'.repeat(32))).toBe(false);
  });
});

describe('Token und Slug sind disjunkt — die Zusage, an der die Auflösung hängt', () => {
  it('kein gültiger Slug erfüllt jemals das Token-Muster', () => {
    // Der Beweis in Stichproben: alles, was pruefeSlug durchlässt,
    // muss von isWellFormedToken abgelehnt werden. Ginge beides, wäre
    // `/t/<wert>` mehrdeutig.
    const kandidaten = [
      'abc',
      'sommerfest-2026',
      'a'.repeat(31),
      'a'.repeat(33),
      'x'.repeat(SLUG_MAX_LAENGE),
      'turnier-nord',
    ];
    for (const k of kandidaten) {
      const urteil = pruefeSlug(k);
      expect(urteil.ok, k).toBe(true);
      expect(isWellFormedToken(urteil.slug), k).toBe(false);
    }
  });

  it('ein Token als Wunschname ergibt nie einen Slug, der wie ein Token aussieht', () => {
    // Die Zusage ist genauer, als sie zuerst klingt — und das ist wichtig:
    // Ein Token darf durchaus als Wunschname DURCHGEHEN. base64url kennt
    // `_` und `-`; die Normalisierung macht daraus Bindestriche, kürzt
    // Doppelungen und schneidet die Ränder ab, sodass gelegentlich 31
    // oder weniger Zeichen übrig bleiben — ein zulässiger Name.
    //
    // Was NICHT passieren darf: dass der GESPEICHERTE Wert danach das
    // Token-Muster erfüllt. Genau das ist die Bedingung, an der die
    // eindeutige Auflösung von `/t/<wert>` hängt, und genau die wird
    // hier über tausend echte Token geprüft.
    for (let i = 0; i < 1000; i += 1) {
      const token = createPublicToken();
      const urteil = pruefeSlug(token);
      if (urteil.ok) {
        expect(isWellFormedToken(urteil.slug), `${token} → ${urteil.slug}`).toBe(false);
        expect(urteil.slug).not.toBe(token);
      }
    }
  });
});

describe('bestimmeAdressart — Token zuerst, Slug danach', () => {
  it('erkennt einen echten Token und lässt ihn UNBERÜHRT', () => {
    const token = createPublicToken();
    expect(bestimmeAdressart(token)).toEqual({ art: 'token', wert: token });
  });

  it('zerstört keine Großschreibung im Token', () => {
    // Genau das wäre passiert, wenn die Normalisierung zuerst liefe.
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    expect(token).toHaveLength(32);
    expect(bestimmeAdressart(token)).toEqual({ art: 'token', wert: token });
  });

  it('behandelt alles andere als Slug — und normalisiert es', () => {
    expect(bestimmeAdressart('Sommerfest-2026')).toEqual({
      art: 'slug',
      wert: 'sommerfest-2026',
    });
  });

  it('liefert null, wo keine Adresse übrig bleibt', () => {
    expect(bestimmeAdressart('!!!')).toBeNull();
    expect(bestimmeAdressart('')).toBeNull();
    expect(bestimmeAdressart(null)).toBeNull();
    expect(bestimmeAdressart(undefined)).toBeNull();
    expect(bestimmeAdressart(123)).toBeNull();
  });
});
