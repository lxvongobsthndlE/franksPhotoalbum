// Pure Funktionen für den Spielplan-Renderer (Etappe B.3).
//
// Diese Datei wird sowohl vom Browser (über ES-Import in main.js)
// als auch von Vitest-Tests geladen — daher ES-Modul-Syntax, kein
// DOM-Zugriff. Konsistent mit tournament-team-helpers.js.
//
// Was hier lebt:
//   - Sortierung der Matchliste nach Zeitplan (Spec §5.3: scheduledAt
//     asc, Tie field asc, nulls last — der Plan ist ein Plan).
//   - Filter-Logik (alle / offen / beendet / gruppe / ko / g:<id>)
//   - Filter-Chip-Renderer (zählt aus UNGefilterter Liste, nicht aus
//     dem aktuellen Filter — damit der User sieht, was es gibt).
//   - Match-Karten-Renderer (normal + compact) inkl. Winner-Highlight
//   - Aside-Renderer ("Als Nächstes" + "Plattenbelegung")
//
// Bewusst NICHT hier:
//   - DOM-Zugriff (renderSpielplan schreibt in t-filters/t-schedule-
//     list/t-aside-next/t-aside-tables — das ist der einzige Teil, der
//     in main.js bleibt).
//   - Event-Binding (bindSpielplanInteractions bleibt in main.js).

/**
 * HTML-Escape. Lokale Kopie — main.js hat denselben Helfer, aber die
 * hier brauchen ihn in einem Vitest-fähigen Modul ohne 14000 Zeilen
 * Browser-Code drumherum.
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sortiert Matches nach Zeitplan. Strikt scheduledAt asc, Tie field
 * asc, nulls last. Spec §5.3: "Was um 14:00 lief, steht über dem, was
 * um 14:20 kommt." Der Spielplan ist ein Plan.
 */
export function sortMatchesBySchedule(matches) {
  if (!Array.isArray(matches)) return [];
  return [...matches].sort((a, b) => {
    const aHas = !!a?.scheduledAt;
    const bHas = !!b?.scheduledAt;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (!aHas && !bHas) return 0;
    if (a.scheduledAt < b.scheduledAt) return -1;
    if (a.scheduledAt > b.scheduledAt) return 1;
    const af = (typeof a?.field === 'number') ? a.field : Number.POSITIVE_INFINITY;
    const bf = (typeof b?.field === 'number') ? b.field : Number.POSITIVE_INFINITY;
    return af - bf;
  });
}

/**
 * Filtert die Matchliste nach dem aktuellen Chip-Filter.
 *
 * Bekannte Filter:
 *   - 'alle': alles
 *   - 'offen': !isFinished
 *   - 'beendet': isFinished
 *   - 'gruppe': isGroupMatch (Gruppenphase)
 *   - 'ko': isKoMatch (KO-Phase inkl. HF, F, 3RD)
 *   - 'g:<groupId>': nur Spiele dieser Gruppe
 *   - default (= unbekannt): alles
 *
 * Der Filter ist bewusst permissiv: unbekannte IDs liefern ALLE
 * Matches, damit ein kaputter State nicht zu einer leeren Liste
 * führt (Spec §13.10 — keine stillen Annahmen).
 */
export function applySpielplanFilter(matches, filter) {
  if (!Array.isArray(matches)) return [];
  switch (filter) {
    case 'alle': return matches;
    case 'offen': return matches.filter((m) => !m?.isFinished);
    case 'beendet': return matches.filter((m) => m?.isFinished);
    case 'gruppe': return matches.filter((m) => m?.isGroupMatch);
    case 'ko': return matches.filter((m) => m?.isKoMatch);
    default: {
      if (typeof filter === 'string' && filter.startsWith('g:')) {
        const gid = filter.slice(2);
        return matches.filter((m) => m?.groupId === gid);
      }
      return matches;
    }
  }
}

/**
 * Rendert die Filter-Chips als HTML-String. Counts werden IMMER aus
 * der unfiltered-Liste berechnet, damit der User sieht "Beendet: 4"
 * auch wenn er gerade "Nur offene" aktiv hat.
 *
 * Phasen-Filter ("Gruppenphase", "K.O.") und Gruppen-Filter werden
 * nur angezeigt, wenn es in dieser Kategorie mindestens ein Spiel
 * gibt — sonst hätte der User leere Chips, die nichts bewirken.
 */
export function renderFilterChips(matches, groups, currentFilter) {
  if (!Array.isArray(matches)) matches = [];
  const countAll = matches.length;
  const countOpen = matches.filter((m) => !m?.isFinished).length;
  const countDone = matches.filter((m) => m?.isFinished).length;
  const countGroup = matches.filter((m) => m?.isGroupMatch).length;
  const countKo = matches.filter((m) => m?.isKoMatch).length;

  const chips = [
    { id: 'alle', label: 'Alle', count: countAll },
    { id: 'offen', label: 'Nur offene', count: countOpen },
    { id: 'beendet', label: 'Beendet', count: countDone },
  ];
  if (countGroup > 0) chips.push({ id: 'gruppe', label: 'Gruppenphase', count: countGroup });
  if (countKo > 0) chips.push({ id: 'ko', label: 'K.O.', count: countKo });

  const sortedGroups = (Array.isArray(groups) ? groups : [])
    .slice()
    .sort((a, b) => String(a?.key || '').localeCompare(String(b?.key || '')));
  for (const g of sortedGroups) {
    const c = matches.filter((m) => m?.groupId === g?.id).length;
    if (c > 0) {
      chips.push({
        id: `g:${g?.id}`,
        label: `Gruppe ${g?.key || g?.name || g?.id}`,
        count: c,
      });
    }
  }

  return chips.map((c) => {
    const active = c.id === currentFilter ? ' is-active' : '';
    return `<button type="button" class="t-chip${active}" data-filter="${esc(c.id)}" aria-pressed="${active ? 'true' : 'false'}">${esc(c.label)} <span class="count">${c.count}</span></button>`;
  }).join('');
}

/**
 * Rendert eine Match-Karte in Normal-Größe (Spielplan-Liste).
 * Grid-Children MÜSSEN mit .t-match { grid-template-columns } überein-
 * stimmen. Spec §13.6: Zeit · Tisch · Phase/Gruppe · Heim · Ergebnis ·
 * Gast · Status · Aktion — plus 3px Bar als visueller Anker links.
 *
 *   bar  zeit  tisch  phase  home  score  away  status  action
 *   3px  56px  70px   90px   1fr   88px   1fr   40px    110px
 *
 * Sieger nur aus Score ermitteln — winnerTeamId wird laut DTO NUR
 * für KO-Matches gesetzt. In der Gruppenphase muss der Vergleich
 * über scoreHome > scoreAway laufen.
 */
export function renderMatchCard(m, isAdmin) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeColor = m?.home?.color || null;
  const awayColor = m?.away?.color || null;

  const hasScore = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
  const homeIsWinner = !!m?.isFinished && hasScore && m.scoreHome > m.scoreAway;
  const awayIsWinner = !!m?.isFinished && hasScore && m.scoreAway > m.scoreHome;
  const scoreEmpty = !hasScore;
  const scoreText = scoreEmpty ? '– : –' : `${m.scoreHome} : ${m.scoreAway}`;

  const timeStr = m?.scheduledTime || '–';
  const tableStr = typeof m?.field === 'number' ? `Platte ${m.field}` : '–';
  const metaLine1 = `${timeStr} · ${tableStr}`;
  const metaLine2 = m?.label || '';
  const metaHtml = `
    <div class="t-match-meta">
      <div class="t-match-meta-line t-match-meta-time">${esc(metaLine1)}</div>
      ${metaLine2 ? `<div class="t-match-meta-line t-match-meta-label">${esc(metaLine2)}</div>` : ''}
    </div>
  `;

  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const homeDot = `<i class="t-dot" style="${dotStyle(homeColor)}" aria-hidden="true"></i>`;
  const awayDot = `<i class="t-dot" style="${dotStyle(awayColor)}" aria-hidden="true"></i>`;

  // Aktion-Spalte — NIE leer (das war ein Bug: das Grid wurde nicht
  // "stabil gehalten", sondern es entstand eine sichtbare Lücke).
  //   Admin       &  !beendet → Button "Ergebnis eintragen"
  //   Admin       &  beendet  → Button "Erneut"
  //   Member      &  beendet  → Text "Beendet"
  //   Member      &  !beendet → Text m.sub
  //   kein Admin  &  kein sub → Text "–"
  let actionHtml;
  if (isAdmin) {
    const btnLabel = m?.isFinished ? 'Erneut' : 'Ergebnis';
    actionHtml = `<div class="t-match-action"><button type="button" class="t-btn t-btn--ghost t-btn--sm" data-action="enter-result" data-match-id="${esc(m?.id)}">${btnLabel}</button></div>`;
  } else if (m?.isFinished) {
    actionHtml = '<div class="t-match-action"><span class="t-match-action-text">Beendet</span></div>';
  } else if (m?.sub) {
    actionHtml = `<div class="t-match-action"><span class="t-match-action-text">${esc(m.sub)}</span></div>`;
  } else {
    actionHtml = '<div class="t-match-action"><span class="t-match-action-text">–</span></div>';
  }

  return `
    <div class="t-match${m?.isFinished ? ' t-match--done' : ''}${m?.isLive ? ' t-match--live' : ''}" data-match-id="${esc(m?.id)}">
      <div class="t-match-bar"></div>
      ${metaHtml}
      <div class="t-match-team${homeIsWinner ? ' is-winner' : ''}">${homeDot}<span class="name">${esc(homeName)}</span></div>
      <div class="t-match-score${scoreEmpty ? ' empty' : ''}">${esc(scoreText)}</div>
      <div class="t-match-team right${awayIsWinner ? ' is-winner' : ''}"><span class="name">${esc(awayName)}</span>${awayDot}</div>
      ${actionHtml}
    </div>
  `;
}

/**
 * In-place-Update für KO-Folgespiele nach einem Ergebnis-Save.
 *
 * Hintergrund (Bug 2026-08-17): Vorher bekam das Frontend nur die
 * Liste der propagierten Match-IDs und musste die ganze Tournament-
 * View neu laden (komplettes GET + Re-Render). Das war 200-500ms
 * spürbare Verzögerung, und der User-Vermerk "Gewinner muss direkt
 * im Finale stehen" war nur durch den vollen Re-Fetch erfüllt.
 *
 * Diese Funktion patcht die existierenden `.t-match[data-match-id]`
 * Cards direkt: Teamnamen + Color-Dots + ggf. Winner-Klasse. Kein
 * Re-Render, keine Netzwerk-Round-Trip.
 *
 * Annahmen:
 *   - Die Cards sind bereits im DOM (renderMatchList wurde gerufen).
 *   - propagatedMatches sind vollständige Match-DTOs (gleiche Form wie
 *     die, mit denen die Cards gerendert wurden — home/away Objekte).
 *   - Status der propagierten Matches bleibt "open" (nur teamHome/
 *     teamAway haben sich geändert). Wenn ein Folgespiel schon vorher
 *     beendet war, lassen wir's in Ruhe — der User hat das nicht
 *     angefragt.
 */
export function applyPropagatedMatches(propagatedMatches) {
  if (!Array.isArray(propagatedMatches) || !propagatedMatches.length) return 0;
  if (typeof document === 'undefined') return 0;
  let patched = 0;
  for (const m of propagatedMatches) {
    if (!m?.id) continue;
    const card = document.querySelector(
      `.t-match[data-match-id="${cssEscape(String(m.id))}"]`
    );
    if (!card) continue; // Match ist im aktuellen Filter nicht sichtbar
                        // → kein Patch nötig, Re-Render würde es auch
                        // nicht zeigen (Filter exkludiert es).
    // Teamnamen + Dots.
    const homeTeam = card.querySelector('.t-match-team:not(.right)');
    const awayTeam = card.querySelector('.t-match-team.right');
    if (homeTeam) {
      const nameEl = homeTeam.querySelector('.name');
      if (nameEl) nameEl.textContent = m.home?.name || 'offen';
      const dotEl = homeTeam.querySelector('.t-dot');
      if (dotEl && m.home?.color) dotEl.style.background = m.home.color;
    }
    if (awayTeam) {
      const nameEl = awayTeam.querySelector('.name');
      if (nameEl) nameEl.textContent = m.away?.name || 'offen';
      const dotEl = awayTeam.querySelector('.t-dot');
      if (dotEl && m.away?.color) dotEl.style.background = m.away.color;
    }
    patched++;
  }
  return patched;
}

// Kleines CSS.escape-Polyfill (nicht alle Browser haben es in querySelector
// integriert, jsdom-Tests brauchen es aber).
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
}

/**
 * Kompakte Match-Karte für die Kontextspalte ("Als Nächstes").
 * Anderes Markup: 3-spaltig (bar · teams · score), ohne Meta und Action.
 */
export function renderMatchCardCompact(m) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeColor = m?.home?.color || null;
  const awayColor = m?.away?.color || null;
  const hasScore = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
  const scoreText = hasScore ? `${m.scoreHome} : ${m.scoreAway}` : '– : –';
  const scoreClass = hasScore ? 't-match-score' : 't-match-score empty';
  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const homeDot = `<i class="t-dot" style="${dotStyle(homeColor)}" aria-hidden="true"></i>`;
  const awayDot = `<i class="t-dot" style="${dotStyle(awayColor)}" aria-hidden="true"></i>`;
  return `
    <div class="t-match t-match--compact${m?.isFinished ? ' t-match--done' : ''}">
      <div class="t-match-bar"></div>
      <div class="t-match-teams">
        <div class="t-match-team">${homeDot}<span class="name">${esc(homeName)}</span></div>
        <div class="t-match-team right"><span class="name">${esc(awayName)}</span>${awayDot}</div>
      </div>
      <div class="${scoreClass}">${esc(scoreText)}</div>
    </div>
  `;
}

/**
 * Wrapper: Map → joined HTML. Liefert einen ehrlichen Platzhalter bei
 * leerer Liste, statt eine leere Section zu rendern.
 */
export function renderMatchList(matches, isAdmin) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '<p class="t-hint">Keine Spiele in dieser Auswahl.</p>';
  }
  return matches.map((m) => renderMatchCard(m, isAdmin)).join('');
}

/**
 * Aside: Die nächsten 3 offenen Spiele (Member-Perspektive: was muss
 * ich als Nächstes spielen / wo muss ich hinschauen).
 */
export function renderAsideNext(matches, limit = 3) {
  if (!Array.isArray(matches)) return '<p class="t-hint">Alle Spiele beendet.</p>';
  const next = matches.filter((m) => !m?.isFinished).slice(0, limit);
  if (!next.length) {
    return '<p class="t-hint">Alle Spiele beendet.</p>';
  }
  return next.map((m) => renderMatchCardCompact(m)).join('');
}

/**
 * Aside: Plattenbelegung — die nächsten 6 offenen Spiele mit Tisch-
 * Nummer (Member-Perspektive: welche Platte ist wann belegt?).
 */
export function renderAsideTables(matches, limit = 6) {
  if (!Array.isArray(matches)) return '<p class="t-hint">Keine Platten verplant.</p>';
  const upcoming = matches
    .filter((m) => !m?.isFinished && typeof m?.field === 'number')
    .slice(0, limit);
  if (!upcoming.length) {
    return '<p class="t-hint">Keine Platten verplant.</p>';
  }
  const items = upcoming.map((m) => {
    const home = m?.home?.name || 'offen';
    const away = m?.away?.name || 'offen';
    const time = m?.scheduledTime || '–';
    return `<li><strong>Platte ${esc(m.field)}</strong> · ${esc(time)} · ${esc(home)} vs ${esc(away)}</li>`;
  }).join('');
  return `<ul class="t-aside-list">${items}</ul>`;
}

/**
 * Spaltenbreiten für Standings- und Dritte-Wertung-Tabellen.
 *
 * Bug 14 (2026-08-18, „Tabellen-Spalten fluchten nicht"): Vorher
 * hatte jede Tabelle ihre Breiten aus dem Inhalt berechnet — bei
 * drei Gruppen neben­einander sah das unruhig aus. Jetzt: feste
 * Prozentbreiten über ein <colgroup> für alle Tabellen identisch.
 * Pl. + Mark fix, Team bekommt den großen Rest, Zahlenspalten
 * gleichmäßig. Wird per renderColgroup() als <col>-Liste eingesetzt.
 */
const STANDINGS_COL_WIDTHS = ['6%', 'auto', '8%', '7%', '7%', '7%', '12%', '9%', '9%'];
const THIRDS_COL_WIDTHS = ['6%', 'auto', '8%', '8%', '7%', '7%', '7%', '12%', '9%', '9%'];

function renderColgroup(widths) {
  return `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>`;
}

/**
 * Renderer für die Gruppentabellen (Spec §13.7).
 *
 * Spalten in fester Reihenfolge: Pl · Team · Sp · S · U · N · Becher · Diff · Pkt.
 *
 * Regressionsschutz für Bug 8 (2026-08-18): Vorher wurden `s.wins` /
 * `s.draws` / `s.losses` / `s.goalDifference` gelesen — die Engine
 * liefert aber `won` / `drawn` / `lost` / `goalDiff`. Folge: alle Werte
 * 0 außer Pkt. Die Pure-Function hier liest die korrekten Felder und
 * formt „Becher" als Doppelwert (erzielt:kassiert) — nicht als Score-
 * Label in Spalte 3.
 *
 * Top-2 bekommen `is-first` / `is-second`-Klassen für den Qualifikations-
 * Marker (CSS-Hook für den Haken in derselben Zelle wie die Rank-Zahl).
 *
 * Bug 14: <th> bekommen `is-rank` / `is-team` / `is-num`-Klassen, damit
 * Header-Zellen dieselbe Ausrichtung haben wie ihre <td>-Gegenstücke.
 *
 * @param {Array<{groupName?,groupKey?,standings:Array}>} groups
 * @param {string} scoreLabel   "Becher" | "Tore" | "Punkte" (sport-abhängig)
 * @returns {string} HTML
 */
export function renderStandingsGroups(groups, scoreLabel) {
  const fmtDiff = (n) => (n > 0 ? `+${n}` : `${n}`);
  return groups
    .map((g) => {
      const rows = (g.standings || [])
        .map((s, i) => {
          const gf = s.goalsFor ?? 0;
          const ga = s.goalsAgainst ?? 0;
          const gd = s.goalDiff ?? (gf - ga);
          const isFirst = i === 0;
          const isSecond = i === 1;
          return `<tr class="t-standings-row${isFirst ? ' is-first' : ''}${isSecond ? ' is-second' : ''}">
            <td class="t-standings-rank">${i + 1}.</td>
            <td class="t-standings-team">${esc(s.name || s.teamId || '—')}</td>
            <td class="t-standings-num">${s.played ?? 0}</td>
            <td class="t-standings-num">${s.won ?? 0}</td>
            <td class="t-standings-num">${s.drawn ?? 0}</td>
            <td class="t-standings-num">${s.lost ?? 0}</td>
            <td class="t-standings-num">${gf}:${ga}</td>
            <td class="t-standings-num${gd > 0 ? ' is-positive' : gd < 0 ? ' is-negative' : ''}">${fmtDiff(gd)}</td>
            <td class="t-standings-num is-points">${s.points ?? 0}</td>
          </tr>`;
        })
        .join('');
      const title = esc(g.groupName || g.groupKey || 'Gruppe');
      return `<div class="t-card">
        <div class="t-card-body">
          <h3 class="t-standings-group-title">${title}</h3>
          <table class="t-standings-table">
            ${renderColgroup(STANDINGS_COL_WIDTHS)}
            <thead>
              <tr>
                <th class="is-rank">Pl.</th>
                <th class="is-team">Team</th>
                <th class="is-num">Sp.</th>
                <th class="is-num">S</th>
                <th class="is-num">U</th>
                <th class="is-num">N</th>
                <th class="is-num">${esc(scoreLabel)}</th>
                <th class="is-num">Diff</th>
                <th class="is-num">Pkt.</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join('');
}

/**
 * Renderer für die „Beste Dritte"-Tabelle (Spec §6.3.1, §13.7).
 *
 * Bug #13 (2026-08-18, User-Punkt 2): Der vorherige Renderer zeigte
 * nur Pkt/Sp und Diff/Sp — das wirkte auf den User wie „eine ganz
 * andere Sportart". Die Sortierung der Drittplatzierten BERUHTE weiter
 * auf den pro-Spiel-normalisierten Werten (Spec §10.4 verlangt das),
 * aber die ANZEIGE folgt jetzt der normalen Gruppentabelle: Pl. · Team
 * · Gruppe · Sp. · S · U · N · Becher · Diff · Pkt. — plus ein Haken
 * bei den qualifizierten Top-N.
 *
 * Der Hinweis „pro Spiel" erscheint nur, wenn die zugrundeliegenden
 * Gruppen tatsächlich unterschiedlich groß sind (3er vs. 4er), damit
 * der User versteht, warum die Rangfolge nicht mit den Absolut-Zahlen
 * 1:1 übereinstimmt. Bei gleich großen Gruppen ist die Hinweis-Box
 * unnötig.
 *
 * Top-N aus config.bestThirds bekommen `is-qualified` (grüner Hin-
 * tergrund + Haken). Der Rest bekommt `is-out`.
 *
 * @param {{qualifyCount:number,rows:Array}|null} bestThirds
 * @returns {string} HTML
 */
export function renderBestThirdsTable(bestThirds) {
  if (!bestThirds || !Array.isArray(bestThirds.rows) || bestThirds.rows.length === 0) {
    return '';
  }
  const { qualifyCount, rows } = bestThirds;
  const fmtDiff = (n) => (n > 0 ? `+${n}` : `${n}`);

  // Hinweis nur einblenden, wenn die Drittplatzierten aus unter-
  // schiedlich großen Gruppen kommen. Sonst wäre der Rank mit den
  // absoluten Zahlen identisch und der Hinweis wäre verwirrend.
  const playedSet = new Set(rows.map((r) => r.played ?? 0));
  const mixedGroupSizes = playedSet.size > 1;

  const body = rows
    .map((r, i) => {
      const qualifies = r.qualifies === true;
      const gf = r.goalsFor ?? 0;
      const ga = r.goalsAgainst ?? 0;
      const gd = r.goalDiff ?? (gf - ga);
      return `<tr class="t-thirds-row${qualifies ? ' is-qualified' : ' is-out'}">
        <td class="t-thirds-rank">${i + 1}.</td>
        <td class="t-thirds-team">${esc(r.name || r.teamId || '—')}</td>
        <td class="t-thirds-group">${esc(r.groupKey || '—')}</td>
        <td class="t-thirds-num">${r.played ?? 0}</td>
        <td class="t-thirds-num">${r.won ?? 0}</td>
        <td class="t-thirds-num">${r.drawn ?? 0}</td>
        <td class="t-thirds-num">${r.lost ?? 0}</td>
        <td class="t-thirds-num">${gf}:${ga}</td>
        <td class="t-thirds-num${gd > 0 ? ' is-positive' : gd < 0 ? ' is-negative' : ''}">${fmtDiff(gd)}</td>
        <td class="t-thirds-num is-points">${r.points ?? 0}</td>
      </tr>`;
    })
    .join('');

  const mixedNote = mixedGroupSizes
    ? `<p class="t-hint">Rangfolge nach Punkten pro Spiel (Spec §10.4) — die Gruppen sind unterschiedlich groß, daher sind die absoluten Zahlen nicht direkt vergleichbar.</p>`
    : '';

  return `<div class="t-card t-thirds-card">
    <div class="t-card-body">
      <h3 class="t-thirds-title">Beste Dritte <span class="t-thirds-meta-inline">(Top ${qualifyCount} qualifizieren sich)</span></h3>
      ${mixedNote}
      <table class="t-thirds-table">
        ${renderColgroup(THIRDS_COL_WIDTHS)}
        <thead>
          <tr>
            <th class="is-rank">Pl.</th>
            <th class="is-team">Team</th>
            <th class="is-group">Gruppe</th>
            <th class="is-num">Sp.</th>
            <th class="is-num">S</th>
            <th class="is-num">U</th>
            <th class="is-num">N</th>
            <th class="is-num">Becher</th>
            <th class="is-num">Diff</th>
            <th class="is-num">Pkt.</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

// === Turnierbaum (Etappe B.4) ============================================
//
// Verbindungslinien zwischen den Spielen sind der Kern des Bracket-Tabs:
// "Wer kommt gegen wen?" muss auf einen Blick erkennbar sein. Der reine
// Spaltenansatz ohne Linien wäre nur eine Liste.
//
// DTO-Hinweise (verifiziert via bracket.js / access/match.js):
//   - 3RD-Match hat round='3RD' (NICHT bracketType='loser' — die ist
//     fälschlich 'winner', siehe bracket.js:407).
//   - home.name / away.name sind bei Placeholder-Slots BEREITS durch
//     resolvePlaceholder() in aufgelösten Text umgewandelt
//     ("Sieger VF 1", "Verlierer HF 1"). winnerLabel/loserLabel im DTO
//     meinen hingegen "der Sieger DIESES Spiels spielt in <label>" —
//     das ist das Folge-Match-Label, NICHT der aktuelle Slot-Text.
//   - Runden-Reihenfolge kommt aus KO_ROUND_ORDER (siehe
//     backend/src/modules/tournament/engine/schedule.js:26-34). Damit
//     sind Freilose (Runde mit weniger Spielen als erwartet) korrekt
//     sortiert.

// Muss identisch sein mit backend/src/modules/tournament/engine/schedule.js
// Falls das Backend weitere Runden hinzufügt → hier ergänzen + Test anpassen.
const KO_ROUND_ORDER = {
  R64: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3RD': 5, F: 6,
};

/**
 * Gruppiert KO-Matches in Winner-Bracket-Runden (sortiert LINKS nach
 * RECHTS: niedrigste Runde zuerst) und trennt das Spiel um Platz 3 ab.
 *
 * Erkennung 3RD: `m.round === '3RD'` (bracketType ist im DTO
 * fälschlich 'winner', siehe bracket.js:407 — daher NICHT darauf
 * verlassen).
 *
 * Erkennung Winner-Bracket-Runde: alles ohne 3RD, gruppiert nach
 * roundLabel, sortiert nach KO_ROUND_ORDER über das erste Match.
 *
 * @param {Array} matches   KO-Match-DTOs (aus GET /:id/bracket)
 * @returns {{winnerBracket: Array<{label:string, matches: Array}>, thirdPlace: object|null}}
 */
export function groupMatchesByRound(matches) {
  if (!Array.isArray(matches)) return { winnerBracket: [], thirdPlace: null };

  const thirdPlace = matches.find((m) => m && m.round === '3RD') || null;

  // Reihenfolge der Winner-Bracket-Runden ableiten:
  // distinct roundLabel → erste Runde = niedrigster KO_ROUND_ORDER-Wert.
  const byLabel = new Map();
  for (const m of matches) {
    if (!m || m.round === '3RD') continue;
    if (!byLabel.has(m.roundLabel)) byLabel.set(m.roundLabel, []);
    byLabel.get(m.roundLabel).push(m);
  }
  const winnerBracket = [...byLabel.entries()]
    .map(([label, list]) => ({
      label,
      matches: list.slice().sort((a, b) => (a?.bracketPos ?? 0) - (b?.bracketPos ?? 0)),
    }))
    .sort((a, b) => {
      const aKey = a.matches[0]?.round ?? 'F';
      const bKey = b.matches[0]?.round ?? 'F';
      return (KO_ROUND_ORDER[aKey] ?? 99) - (KO_ROUND_ORDER[bKey] ?? 99);
    });

  return { winnerBracket, thirdPlace };
}

/**
 * Match-Karte für einen Bracket-Knoten.
 *
 * Eigene Komponente (NICHT renderMatchCardCompact), weil Spec §13.8
 * Z.872 eine eigene Meta-Zeile verlangt (Zeit · Platte oder "Beendet").
 * Erbt die .t-match-Klassen für Winner-Highlighting + Score-Layout
 * + Dots, ergänzt die Meta-Zeile und einen Placeholder-Modifier.
 *
 * WICHTIG: home.name / away.name sind bereits resolved. Bei einem
 * offenen Halbfinale steht im away-Slot "Sieger VF 2" (NICHT
 * "Verlierer" — Verlierer kommen nur im 3RD-Match vor). Wir greifen
 * daher NICHT auf m.winnerLabel/m.loserLabel zu — die meinen das
 * Folge-Match, nicht den aktuellen Slot.
 *
 * @param {object} m   Match-DTO
 * @returns {string}   HTML
 */
export function renderMatchCardBracket(m, extraStyle = '') {
  const homeName = esc(m?.home?.name ?? '—');
  const awayName = esc(m?.away?.name ?? '—');

  // Kartenlayout: Teams UNTEREINANDER (User-Korrektur 2026-08-18 —
  // Wimbledon-/Champions-League-Pattern). Score wird aufgespalten:
  // homeScore und awayScore stehen rechtsbündig untereinander, damit
  // man das Ergebnis senkrecht ablesen kann.
  const homeHasScore = typeof m?.scoreHome === 'number';
  const awayHasScore = typeof m?.scoreAway === 'number';
  const homeScore = homeHasScore ? `${m.scoreHome}` : '–';
  const awayScore = awayHasScore ? `${m.scoreAway}` : '–';

  const meta = m?.isFinished
    ? 'Beendet'
    : (m?.scheduledTime && typeof m?.field === 'number')
      ? `${m.scheduledTime} · Platte ${m.field}`
      : '–';

  const homeIsPlaceholder = m?.home?.kind === 'placeholder';
  const awayIsPlaceholder = m?.away?.kind === 'placeholder';
  const isPlaceholder = homeIsPlaceholder || awayIsPlaceholder;

  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const homeDot = `<i class="t-dot${homeIsPlaceholder ? ' t-dot--placeholder' : ''}" style="${dotStyle(m?.home?.color)}" aria-hidden="true"></i>`;
  const awayDot = `<i class="t-dot${awayIsPlaceholder ? ' t-dot--placeholder' : ''}" style="${dotStyle(m?.away?.color)}" aria-hidden="true"></i>`;

  const classes = ['t-match', 't-match--bracket'];
  if (isPlaceholder) classes.push('t-match--placeholder');
  if (m?.isFinished) classes.push('t-match--done');

  return `<div class="${classes.join(' ')}" data-match-id="${esc(m?.id ?? '')}"${extraStyle}>
    <div class="t-match-bar" data-area="bar"></div>
    <div class="t-match-team" data-area="home">${homeDot}<span class="name">${homeName}</span></div>
    <div class="t-match-score${homeHasScore ? '' : ' empty'}" data-area="home-score">${esc(homeScore)}</div>
    <div class="t-match-team" data-area="away">${awayDot}<span class="name">${awayName}</span></div>
    <div class="t-match-score${awayHasScore ? '' : ' empty'}" data-area="away-score">${esc(awayScore)}</div>
    <div class="t-match-meta-line" data-area="meta">${esc(meta)}</div>
  </div>`;
}

/**
 * Top-Level-Renderer für den Turnierbaum-Tab.
 *
 * Erzeugt `.bracket-wrap` mit Grid pro Runde (LINKS = früheste Runde,
 * RECHTS = Finale) plus separate `.bracket-3rd-row` für das Spiel um
 * Platz 3. Verbindungslinien zwischen den Knoten kommen aus CSS
 * (::before/::after auf .t-match--bracket).
 *
 * @param {Array} matches   KO-Match-DTOs
 * @returns {string}        HTML
 */
export function renderBracket(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '<div class="t-card"><div class="t-card-body"><p class="t-hint">Der Turnierbaum erscheint, sobald die KO-Phase generiert wurde.</p></div></div>';
  }
  const { winnerBracket, thirdPlace } = groupMatchesByRound(matches);
  const cols = winnerBracket.length;
  const rows = winnerBracket[0]?.matches?.length ?? 0;

  // Mobile-Tab-Leiste: ein Button pro Runde (nur sinnvoll wenn > 1 Spalte).
  // Auf Desktop via CSS ausgeblendet, Listener werden trotzdem angehängt.
  const tabsHtml = cols > 1
    ? `<div class="bracket-tabs">
        ${winnerBracket.map((r) =>
          `<button type="button" class="bracket-tab" data-bracket-tab="${esc(r.label)}">${esc(r.label)}</button>`
        ).join('')}
      </div>`
    : '';

  // Architektur (Etappe B.4 Bug-16-Nachschlag, 2026-08-19):
  //   .bracket-wrap ist Flex, .bracket-col sind echte Flex-Column-Container.
  //   Karten stapeln sich einfach per gap — KEINE Konvergenz-Rechnung,
  //   KEIN margin-top, KEIN grid-row span. Verbindungslinien sind auch weg:
  //   User-Korrektur 2026-08-19: "Vier normale Spalten nebeneinander, jede
  //   mit ihren Karten. Fertig. Das ist übersichtlicher als ein Baum mit
  //   falsch platzierten Karten."
  //   3RD-Match (Spiel um Platz 3) liegt INNERHALB der Finale-Spalte als
  //   unterste Card mit kleinem Label darüber. Vorteil: auf Mobile wird
  //   3RD automatisch mit dem F-Tab sichtbar, keine eigene Tab-Bar-Spalte.
  const colsHtml = winnerBracket.map((r, colIdx) => {
    const cardsHtml = r.matches.map((m) => renderMatchCardBracket(m)).join('');
    const isFinalCol = colIdx === winnerBracket.length - 1;
    const thirdHtml = (isFinalCol && thirdPlace)
      ? `<div class="bracket-3rd">
          <div class="bracket-3rd-label">Spiel um Platz 3</div>
          ${renderMatchCardBracket(thirdPlace)}
        </div>`
      : '';
    return `<div class="bracket-col" data-bracket-col="${esc(r.label)}">
      <div class="bracket-col-label">${esc(r.label)}</div>
      ${cardsHtml}${thirdHtml}
    </div>`;
  }).join('');

  return `${tabsHtml}
    <div class="bracket-wrap" style="--bracket-cols:${cols}">
      ${colsHtml}
    </div>`;
}

/**
 * Bündelt die drei Bracket-Funktionen unter einem Namespace.
 * Wird sowohl als ES-Modul-Export (`import { bracket } from ...`)
 * als auch als Property auf window.spielplanHelpers verwendet.
 */
export const bracket = {
  groupMatchesByRound,
  renderMatchCardBracket,
  renderBracket,
};

// Browser-Global-Hook: Falls spielplan-helpers.js per <script>
// geladen wird (statt als ES-Modul), exponiert es die Helfer unter
// window.spielplanHelpers, damit main.js sie findet.
if (typeof window !== 'undefined') {
  window.spielplanHelpers = {
    esc,
    sortMatchesBySchedule,
    applySpielplanFilter,
    renderFilterChips,
    renderMatchCard,
    renderMatchCardCompact,
    renderMatchList,
    renderAsideNext,
    renderAsideTables,
    applyPropagatedMatches,
    renderStandingsGroups,
    renderBestThirdsTable,
    bracket: {
      groupMatchesByRound,
      renderMatchCardBracket,
      renderBracket,
    },
  };
}
