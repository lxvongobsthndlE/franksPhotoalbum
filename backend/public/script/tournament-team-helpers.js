// Pure Funktionen für die Wizard-Team-Verwaltung.
// Diese Datei wird sowohl vom Browser (über <script src>) als auch
// von Vitest-Tests geladen — daher ES-Modul-Syntax, kein DOM-Zugriff.
//
// Was hier lebt:
//   - Erkennung von Platzhalternamen ("Team 1", "Team 2", …)
//   - Vergabe der nächsten Platzhalter-Nummer
//   - Parsen einer Copy-Paste-Liste in Einträge
//   - Berechnung der Duplikat-Warnung
//
// Bewusst NICHT hier: alles, was DOM oder State braucht
// (renderTeamRows, DnD-Handler, replaceNames).

export function isPlaceholderName(name) {
  return /^Team \d+$/.test(String(name ?? '').trim());
}

export function nextPlaceholderName(teams) {
  // Nimm die höchste vergebene "Team N"-Nummer + 1, damit
  // "Team 1, Team 2, Team 5" → nächster Platzhalter "Team 6" heißt.
  let max = 0;
  for (const t of teams) {
    const m = /^Team (\d+)$/.exec(String(t?.name ?? '').trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `Team ${max + 1}`;
}

export function parseTeamInput(text) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set();
  const duplicates = [];
  const entries = [];
  for (const name of lines) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(name);
      continue;
    }
    seen.add(key);
    entries.push({ name, color: null, seed: entries.length + 1 });
  }
  return { entries, duplicates };
}

export function duplicateNames(teams) {
  const all = teams.map((t) => t?.name?.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const dupes = [];
  for (const n of all) {
    if (seen.has(n)) dupes.push(n);
    else seen.add(n);
  }
  return [...new Set(dupes)];
}

// Browser-Global-Hook: Falls tournament-team-helpers.js per <script>
// geladen wird (statt als ES-Modul), exponiert es die Helfer unter
// window.tournamentTeamHelpers, damit tournament.js sie findet.
if (typeof window !== 'undefined') {
  window.tournamentTeamHelpers = {
    isPlaceholderName,
    nextPlaceholderName,
    parseTeamInput,
    duplicateNames,
  };
}