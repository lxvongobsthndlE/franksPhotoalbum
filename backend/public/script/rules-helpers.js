/**
 * Reine Funktionen für die Regeln-Tab (Spec §8.4 Info-Seite).
 *
 * Reines Plain-Text → HTML. Spec verlangt „Paragraphs only, no
 * formatting" — also splitten wir an Leerzeilen in <p>-Tags und
 * escapen alles andere. Kein Markdown, kein HTML, keine Listen.
 *
 * Konvention:
 *   - Eine Leerzeile (\n\n oder mehr) beendet einen Absatz.
 *   - Innerhalb eines Absatzes bleiben einzelne Zeilenumbrüche (\n)
 *     als <br> erhalten — Spec sagt zwar „Paragraphs only", aber ein
 *     längerer Absatz mit hartem Umbruch (z. B. Aufzählung ohne
 *     Sonderzeichen) wäre ohne <br> nicht lesbar.
 *   - Trim auf jeden Absatz, damit „\n\n  \n\nAbsatz" nicht zu einem
 *     leeren ersten Absatz wird.
 *   - Maximale Anzahl Absätze (MAX_PARAGRAPHS) als sanfte Schutz-
 *     kante — Backend hat schon ein Längenlimit (10 KB), aber wenn
 *     jemand trotzdem 1000 Absätze reinpumpt, blenden wir ab Nr. N
 *     den Rest in eine Hinweisbox.
 */

const MAX_PARAGRAPHS = 200;
const MAX_LENGTH_SOFT = 12000;

/**
 * Wandelt einen Plain-Text-Regelwerk in HTML-Paragraphs.
 *
 * @param {string|null|undefined} rules
 * @returns {string} HTML — entweder <p>…</p>-Liste oder leerer String.
 */
export function renderRulesParagraphs(rules) {
  if (typeof rules !== 'string') return '';
  const trimmed = rules.trim();
  if (trimmed === '') return '';

  // Splitten an beliebiger Folge von Zeilenumbrüchen (\n{2,} oder \r\n\r\n).
  // Erst normalisieren (\r\n → \n), dann splitten.
  const normalized = trimmed.replace(/\r\n/g, '\n');
  const rawBlocks = normalized.split(/\n{2,}/);
  const paragraphs = [];
  for (const block of rawBlocks) {
    const t = block.trim();
    if (t === '') continue;
    paragraphs.push(t);
  }
  if (paragraphs.length === 0) return '';

  const visible = paragraphs.slice(0, MAX_PARAGRAPHS);
  const overflow = paragraphs.length - visible.length;

  const body = visible
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const overflowNote = overflow > 0
    ? `<p class="t-rules-overflow-note">+${overflow} weitere Absätze ausgeblendet (Regelwerk zu lang für die Anzeige).</p>`
    : '';

  // Sanity-Warnung, falls jemand nahe am Backend-Limit ist und das
  // Frontend-Rendering langsam werden könnte. Reine UI-Hilfe.
  const lengthNote = trimmed.length > MAX_LENGTH_SOFT
    ? `<p class="t-rules-overflow-note">Hinweis: Das Regelwerk ist sehr lang (${trimmed.length} Zeichen). Ladezeiten können erhöht sein.</p>`
    : '';

  return body + overflowNote + lengthNote;
}

/**
 * HTML-Escape. Lokale Kopie — wir wollen spielplan-helpers.js nicht
 * aufblasen, weil das nur die Anzeige-Escapes bräuchte.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Browser-Global-Hook
if (typeof window !== 'undefined') {
  window.rulesHelpers = { renderRulesParagraphs };
}
