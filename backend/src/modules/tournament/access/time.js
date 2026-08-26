/**
 * Zeitformatierung — Spec §7, §8.6.
 *
 * Spielzeiten werden in der DB als TIMESTAMP gespeichert. Hier werden sie in
 * lesbare deutsche Form gebracht:
 *   - "14:20"           für eintägige Turniere
 *   - "Sa, 05.09. · 14:20"   für mehrtägige
 *
 * Niemals ein ISO-String im UI.
 */

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * "14:20" — Stunde:Minute, 24-h.
 * Akzeptiert Date, ISO-String, oder null.
 */
export function formatTime(input) {
  if (input == null) return '';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Tag.Monat. — "05.09." (immer mit Punkt, da wir kein Jahr im UI zeigen wollen).
 */
export function formatDateShort(input) {
  if (input == null) return '';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${MONTHS[d.getMonth()]}.`;
}

/**
 * Wochentag-Kürzel + Datum — "Sa, 05.09.".
 */
export function formatWeekdayDate(input) {
  if (input == null) return '';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]}, ${formatDateShort(d)}`;
}

/**
 * Spec §7: "Bei einem eintägigen Turnier nur die Uhrzeit, bei mehrtägigen
 * zusätzlich das Datum."
 *
 * Beispiel: { singleDay: true }  → "14:20"
 *           { singleDay: false } → "Sa, 05.09. · 14:20"
 */
export function formatMatchTime(input, opts = {}) {
  const { singleDay = true } = opts;
  if (input == null) return '';
  const time = formatTime(input);
  if (singleDay) return time;
  if (time === '') return '';
  return `${formatWeekdayDate(input)} · ${time}`;
}

/**
 * Dauer in Minuten → "1:30 h" / "45 min".
 */
export function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(minutes)) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h}:${pad2(m)} h`;
}

/**
 * Akzeptiert Date, number (Unix-ms), ISO-String.
 */
function toDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') return new Date(input);
  return new Date(NaN);
}
