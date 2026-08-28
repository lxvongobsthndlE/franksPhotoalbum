/**
 * Sprechender Zuschauer-Link — Normalisierung und Prüfung des Wunschnamens.
 *
 * Warum diese Datei neben public-access.js steht:
 * ----------------------------------------------
 * public-access.js beantwortet EINE Frage: „Darf dieser Aufrufer dieses
 * Turnier sehen?" Das hier beantwortet eine andere: „Ist dieser Wunschname
 * eine zulässige Adresse?" Zwei Fragen, zwei Dateien — sonst wüchse die
 * Sicherheitsdatei um Zeichensatz-Kleinkram, und der eigentliche Kern
 * (die vier Regeln des Zuschauer-Links) ginge darin unter.
 *
 * DIE ABWÄGUNG, die dieses Feature trägt — hier steht sie, an genau einer
 * Stelle, damit sie beim nächsten Lesen nicht neu erfunden werden muss:
 *
 *     Ein selbst gewählter Link ist ERRATBAR. Das ist Absicht.
 *
 * Der Zufalls-Token hat ~144 Bit Entropie; „sommerfest-2026" hat praktisch
 * keine. Wer den Namen eines Vereins und das Jahr kennt, kommt mit ein paar
 * Versuchen hin. Der Betreiber will genau das: einen Link, den er am Telefon
 * durchgeben und auf ein Plakat drucken kann. Ein Zugang, den man diktieren
 * kann, ist per Definition einer, den man erraten kann — das ist keine
 * Nachlässigkeit, sondern der Preis der Funktion.
 *
 * Bezahlbar ist dieser Preis nur, weil die drei anderen Zusagen NICHT
 * mitverhandelt werden:
 *
 *   - Entwürfe bleiben unsichtbar. Ein Turnier im Status 'draft' liefert
 *     auch mit korrektem Slug 404 (nicht 403) — wer rät, erfährt nicht
 *     einmal, dass es das Turnier gibt.
 *   - Die Nutzlast bleibt eine Allowlist (public-view.js). Wer den Link
 *     errät, sieht Tabellen und Spielplan — keine Spielernamen, keine
 *     Konto-IDs, keine Innereien.
 *   - Über diesen Pfad kommt nie ein Schreibzugriff. Erraten heißt mitlesen,
 *     nicht mitspielen.
 *
 * Deshalb ist der Slug eine ZWEITE Adresse desselben Turniers, nie ein
 * Ersatz für den Token: Wer den engeren Weg will, benutzt weiter den
 * Zufallslink; der bleibt gültig, solange die Freigabe steht.
 */

/**
 * Das Format. Klein geschrieben, a-z, 0-9, Bindestrich — mehr nicht.
 *
 * Kein Punkt (kollidiert mit Dateiendungen wie `/t/name.svg`), kein
 * Unterstrich (in einer vorgelesenen oder handgeschriebenen Adresse nicht
 * von einem Leerzeichen zu unterscheiden), kein Großbuchstabe (ein Mensch,
 * der einen Link abtippt, trifft die Schreibweise sonst nicht).
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MIN_LAENGE = 3;
export const SLUG_MAX_LAENGE = 48;

/**
 * Die Länge, bei der ein Slug wie ein Token AUSSÄHE.
 *
 * Der Token ist `^[A-Za-z0-9_-]{32}$`. Ein normalisierter Slug besteht aus
 * genau diesem Alphabet (nur enger), also erfüllt JEDER 32 Zeichen lange
 * Slug das Token-Muster. Damit die Auflösung von `/t/<wert>` eindeutig
 * bleibt, ist diese eine Länge gesperrt — 31 und 33 Zeichen sind es nicht.
 * Siehe die Begründung der Auflösungsreihenfolge in public-access.js.
 */
const TOKEN_LAENGE = 32;

/**
 * Namen, die nicht vergeben werden dürfen.
 *
 * Zwei Gründe stehen dahinter, und sie sind unterschiedlich zwingend:
 *
 *   (a) Echte Kollision im heutigen Routenbaum. Unter `/t/` liegt genau
 *       eine feste Ressource: `/t/:wert/aushang` (app.js). Ein Turnier mit
 *       dem Slug `aushang` wäre zwar erreichbar, aber `/t/aushang/aushang`
 *       liest sich wie ein Fehler und ist einer, sobald jemand die Route
 *       umbaut.
 *   (b) Vorsorge. `qr`, `api`, `public`, `admin`, `t`, `neu`, `new` sind
 *       die Wörter, die typischerweise als NÄCHSTES unter einem Kurzpfad
 *       landen. Sie jetzt zu sperren kostet nichts; sie später zu räumen
 *       hieße, einem Verein seinen gedruckten Aushang wegzunehmen.
 *
 * Dazu die Wurzelpfade der Anwendung (`auth`, `health`, `script`, `style`,
 * `index`, `live`, `assets`, `static`, `favicon`, `robots`, `sitemap`) —
 * sie liegen heute NICHT unter `/t/`, aber der Zuschauer-Link ist der
 * einzige Kurzpfad des Produkts, und ein `/t/` weniger im Pfad ist eine
 * naheliegende spätere Vereinfachung.
 */
export const RESERVIERTE_SLUGS = Object.freeze([
  'aushang',
  'qr',
  'api',
  'public',
  'admin',
  't',
  'neu',
  'new',
  'auth',
  'health',
  'script',
  'style',
  'index',
  'live',
  'assets',
  'static',
  'favicon',
  'robots',
  'sitemap',
]);

/** Umlaute und ß zuerst — sie haben eine feste deutsche Ersatzschreibung. */
const UMLAUT_ERSATZ = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
];

/**
 * Macht aus einer Eingabe einen Kandidaten für das Slug-Format.
 *
 * Normalisieren statt ablehnen: Wer „Sommerfest 2026" tippt, hat keinen
 * Fehler gemacht — er hat nur nicht an Bindestriche gedacht. Eine
 * Fehlermeldung dafür wäre Schikane. Abgelehnt wird erst, was auch nach
 * dieser Behandlung keine brauchbare Adresse ergibt (siehe pruefeSlug).
 *
 * Reihenfolge ist wichtig:
 *   1. Kleinschreibung — sonst wird aus „Ärger" ein „AErger".
 *   2. Deutsche Umlaute ausschreiben (ä→ae), NICHT bloß entakzentuieren:
 *      „Grün" soll „gruen" werden, nicht „grun".
 *   3. Übrige Akzente abtragen (é→e) über die Unicode-Zerlegung.
 *   4. Trennendes zu Bindestrichen, alles Übrige weg.
 *   5. Bindestriche entdoppeln und an den Rändern abschneiden.
 *
 * @param {unknown} eingabe
 * @returns {string} normalisierter Kandidat (kann leer sein)
 */
export function normalisiereSlug(eingabe) {
  if (typeof eingabe !== 'string') return '';
  let s = eingabe.trim().toLowerCase();
  for (const [muster, ersatz] of UMLAUT_ERSATZ) s = s.replace(muster, ersatz);
  // NFD zerlegt „é" in „e" + Akzentzeichen; die Zeichenklasse entfernt
  // dann nur den Akzent. Ohne Schritt 2 hätte das auch die Umlaute
  // getroffen — mit dem falschen Ergebnis.
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[\s_.+/\\]+/g, '-');
  s = s.replace(/[^a-z0-9-]/g, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

/** Reines Formaturteil über einen bereits normalisierten Wert. */
export function istWohlgeformterSlug(wert) {
  return (
    typeof wert === 'string' &&
    wert.length >= SLUG_MIN_LAENGE &&
    wert.length <= SLUG_MAX_LAENGE &&
    wert.length !== TOKEN_LAENGE &&
    SLUG_PATTERN.test(wert) &&
    !RESERVIERTE_SLUGS.includes(wert)
  );
}

/**
 * Normalisiert und prüft in einem Zug — das, was die Route aufruft.
 *
 * Liefert IMMER ein Urteil, wirft nie. Die Meldungen sind für einen
 * Menschen geschrieben, nicht für ein Log: sie stehen im Frontend direkt
 * unter dem Eingabefeld.
 *
 * @param {unknown} eingabe
 * @returns {{ok: true, slug: string} | {ok: false, code: string, message: string}}
 */
export function pruefeSlug(eingabe) {
  if (typeof eingabe !== 'string' || eingabe.trim() === '') {
    return {
      ok: false,
      code: 'slug_leer',
      message: 'Gib dem Link einen Namen — zum Beispiel „sommerfest-2026".',
    };
  }

  const slug = normalisiereSlug(eingabe);

  if (slug === '') {
    return {
      ok: false,
      code: 'slug_ohne_zeichen',
      message:
        'Aus dieser Eingabe lässt sich keine Adresse bauen. Erlaubt sind ' +
        'Buchstaben, Zahlen und Bindestriche.',
    };
  }

  if (slug.length < SLUG_MIN_LAENGE) {
    return {
      ok: false,
      code: 'slug_zu_kurz',
      message: `Der Name braucht mindestens ${SLUG_MIN_LAENGE} Zeichen.`,
    };
  }

  if (slug.length > SLUG_MAX_LAENGE) {
    return {
      ok: false,
      code: 'slug_zu_lang',
      message: `Der Name darf höchstens ${SLUG_MAX_LAENGE} Zeichen haben.`,
    };
  }

  if (slug.length === TOKEN_LAENGE) {
    return {
      ok: false,
      code: 'slug_wie_token',
      message:
        `Ein Name mit genau ${TOKEN_LAENGE} Zeichen sieht aus wie der ` +
        'Zufallslink und wäre nicht mehr von ihm zu unterscheiden. Nimm ' +
        'einen kürzeren oder längeren Namen.',
    };
  }

  if (RESERVIERTE_SLUGS.includes(slug)) {
    return {
      ok: false,
      code: 'slug_reserviert',
      message: `„${slug}" ist für die Anwendung reserviert. Wähl einen anderen Namen.`,
    };
  }

  // Kann nach der Normalisierung eigentlich nicht mehr scheitern; die
  // Prüfung bleibt, weil sie den Vertrag dieser Funktion festhält und
  // nicht davon abhängt, dass normalisiereSlug fehlerfrei bleibt.
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      code: 'slug_format',
      message:
        'Erlaubt sind Kleinbuchstaben, Zahlen und einzelne Bindestriche ' + 'zwischen den Wörtern.',
    };
  }

  return { ok: true, slug };
}
