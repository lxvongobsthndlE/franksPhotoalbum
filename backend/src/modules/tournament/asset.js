/**
 * Asset-Verarbeitung für Turnier-Logos.
 *
 * Wir spiegeln das Avatar-Muster: Multipart-Upload kommt rein, wir
 * prüfen Format + Größe, resize, schreiben das Resultat nach MinIO.
 * Das Original wird verworfen — der Server legt fest, welche Pixeldichte
 * nötig ist (Spec §3: Logo „kompakt", max. 512 px Kantenlänge).
 */

import sharp from 'sharp';

// Max. 5 MB roher Upload — Logos sind klein, alles darüber ist verdächtig.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// Max. Kantenlänge nach Resize (längste Seite).
export const LOGO_MAX_DIM = 512;

// Erlaubte Eingabeformate (PNG, JPEG, WebP). Andere Mimetypes lehnen wir
// mit 400 ab. SVG wird bewusst nicht akzeptiert: nicht resize-bar ohne
// Rendering, und Spec sagt „Bild", nicht „Vektor".
export const ALLOWED_LOGO_MIMETYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Mimetype → sharp-Input-Identifier. PNG bleibt PNG (transparenz-
// erhaltend); JPEG/WebP werden zu PNG konvertiert für einheitliche
// Ausgabe.
function inputFor(mimetype) {
  switch (mimetype) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

/**
 * Nimmt einen rohen Image-Buffer, prüft Format + Größe und liefert
 * einen serverseitig verkleinerten PNG-Buffer (max. LOGO_MAX_DIM).
 *
 * Wirft Error mit statusCode für saubere HTTP-Antworten.
 *
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
export async function resizeLogoImage(buffer, mimetype) {
  if (!ALLOWED_LOGO_MIMETYPES.includes(mimetype)) {
    const err = new Error(`Nur PNG, JPEG und WebP sind als Logo erlaubt (du: ${mimetype}).`);
    err.statusCode = 400;
    err.code = 'unsupported_format';
    throw err;
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    const err = new Error(
      `Logo zu groß (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max. ${MAX_LOGO_BYTES / 1024 / 1024} MB).`
    );
    err.statusCode = 413;
    err.code = 'logo_too_large';
    throw err;
  }

  // .rotate() entfernt EXIF-Orientierung. .resize({ withoutEnlargement: true })
  // lässt winzige Bilder winzig (kein Hochskalieren).
  const resized = await sharp(buffer, { failOn: 'truncated' })
    .rotate()
    .resize({
      width: LOGO_MAX_DIM,
      height: LOGO_MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: resized.data,
    mimetype: 'image/png',
    info: resized.info,
  };
}
