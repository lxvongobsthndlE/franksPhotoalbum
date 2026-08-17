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
  };
}
