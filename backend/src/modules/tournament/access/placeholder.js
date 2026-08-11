/**
 * Placeholder → sprechender Text.
 * Spec §4: matches.placeholderHome / placeholderAway ist JSONB.
 *
 * Mögliche Typen (von der Engine gesetzt):
 *   { type: "group_rank",     group: "A", rank: 1 }   → "Sieger Gruppe A"
 *   { type: "group_runner",   group: "B", rank: 2 }   → "Zweiter Gruppe B"
 *   { type: "best_third",     index: 1 }              → "Bester Dritter 1"
 *   { type: "match_winner",   matchLabel: "VF 1" }    → "Sieger VF 1"
 *   { type: "match_loser",    matchLabel: "HF 1" }    → "Verlierer HF 1"
 */

export function resolvePlaceholder(placeholder) {
  if (placeholder == null) return null;
  if (typeof placeholder === 'string') return placeholder;
  const { type, group, rank, index, matchLabel } = placeholder;

  switch (type) {
    case 'group_rank': {
      const grade = rank === 1 ? 'Sieger' : rank === 2 ? 'Zweiter' : `${rank}.`;
      return `${grade} Gruppe ${group}`;
    }
    case 'group_runner': {
      return `Zweiter Gruppe ${group}`;
    }
    case 'best_third': {
      return index ? `Bester Dritter ${index}` : 'Bester Dritter';
    }
    case 'match_winner': {
      return `Sieger ${matchLabel ?? 'des Spiels'}`;
    }
    case 'match_loser': {
      return `Verlierer ${matchLabel ?? 'des Spiels'}`;
    }
    default:
      return '—';
  }
}
