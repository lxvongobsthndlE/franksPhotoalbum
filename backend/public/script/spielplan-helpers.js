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
 * Reine Deskriptor-Logik für `openConfirmDialog` (Etappe B.7, Anmerkung 1).
 *
 * Kapselt die Backward-Compat-Logik: 5 bestehende Aufrufer (Wizard x3,
 * Wizard-Regenerate, Reschedule) verhalten sich unverändert. Der neue
 * `confirmText`-Parameter ist ein optionaler Hint-Override.
 *
 * @param {{ expectedName?: string, confirmText?: string }} opts
 * @returns {{
 *   needsInput: boolean,
 *   expected: string|null,
 *   hint: string|null,
 *   okInitiallyDisabled: boolean
 * }}
 */
export function resolveConfirmDescriptor({ expectedName, confirmText } = {}) {
  const hasExpected = typeof expectedName === 'string' && expectedName.length > 0;
  const customHint = typeof confirmText === 'string' && confirmText.length > 0;

  if (!hasExpected) {
    // Kein Input, OK sofort aktiv. (confirmText ohne expectedName ist
    // aktuell kein Use-Case — wird ignoriert.)
    return { needsInput: false, expected: null, hint: null, okInitiallyDisabled: false };
  }

  return {
    needsInput: true,
    expected: expectedName,
    hint: customHint ? confirmText : `Erwartet: „${expectedName}"`,
    okInitiallyDisabled: true,
  };
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

  // Beschriftungen nach Vorlage (Abschnitt 03): "Alle", "Offen",
  // "Fertig" — nicht "Nur offene" / "Beendet". Kuerzer ist hier kein
  // Geschmack, sondern Notwendigkeit: die Chips stehen nebeneinander in
  // einer scrollenden Reihe, und jedes Zeichen kostet dort Platz.
  const chips = [
    { id: 'alle', label: 'Alle', count: countAll },
    { id: 'offen', label: 'Offen', count: countOpen },
    { id: 'beendet', label: 'Fertig', count: countDone },
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

  // Beschwerde 4 (2026-08-26): „auch die filter sahen im artefakt
  // wesentlich besser aus".
  //
  // Etappe A2.6 (2026-08-20) hatte hier EINEN Knopf „Filter: Alle ▾" mit
  // Aufklappmenue gebaut, weil bei vielen Gruppen bis zu neun Chips
  // zusammenkamen. Die Vorlage loest dasselbe Problem anders und besser:
  // die Chips bleiben Chips und die REIHE scrollt waagerecht. Damit ist
  // die Anzahl weiter sichtbar, ohne dass man etwas oeffnen muss — und
  // genau das ist der Punkt, den die Vorlage betont: „Wer 'Offen 7'
  // sieht, weiss ohne Tippen, wie weit der Tag ist." Hinter einem
  // Aufklappmenue sieht das niemand.
  //
  // Der aktive Chip wird SCHWARZ gefuellt, nicht orange. Orange ist im
  // ganzen Modul dem Weg zum Titel vorbehalten; ein Filterzustand ist
  // kein Titelweg. Das galt hier bisher nicht — der aktive Chip trug
  // var(--accent).
  return `<div class="t-chips" role="group" aria-label="Spiele filtern">${
    chips.map((c) => {
      const aktiv = c.id === currentFilter;
      return `<button type="button" class="t-chip${aktiv ? ' is-active' : ''}"`
        + ` data-filter="${esc(c.id)}" aria-pressed="${aktiv ? 'true' : 'false'}">`
        + `${esc(c.label)} <span class="count">${c.count}</span></button>`;
    }).join('')
  }</div>`;
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
export function renderMatchCard(m, isAdmin, isEdit = false, fieldsConfig = null) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeColor = m?.home?.color || null;
  const awayColor = m?.away?.color || null;

  const hasScore = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
  const homeIsWinner = !!m?.isFinished && hasScore && m.scoreHome > m.scoreAway;
  const awayIsWinner = !!m?.isFinished && hasScore && m.scoreAway > m.scoreHome;
  const scoreEmpty = !hasScore;
  const homeScoreText = hasScore ? String(m.scoreHome) : '–';
  const awayScoreText = hasScore ? String(m.scoreAway) : '–';

  const timeStr = m?.scheduledTime || '–';
  const tableStr = m?.field != null
    ? resolveFieldName(m.field, fieldsConfig)
    : '–';
  const metaLine1 = `${timeStr} · ${tableStr}`;
  const metaLine2 = m?.label || '';

  // Etappe B.7: Im Edit-Modus Inputs für Zeit (HH:MM) und Platte rendern.
  // KO-Matches bleiben disabled (Slot-Position nicht isoliert editierbar).
  const isKo = !!m?.isKo || m?.stageType === 'ko';
  const editDisabled = !!(isEdit && (isKo || !!m?.isFinished));
  let metaHtml;
  if (isEdit) {
    const hh = m?.scheduledTime && /^\d{2}:\d{2}$/.test(m.scheduledTime)
      ? m.scheduledTime
      : (m?.scheduledAt ? new Date(m.scheduledAt).toISOString().slice(11, 16) : '');
    const fieldVal = m?.field != null ? String(m.field) : '';
    metaHtml = `
      <div class="t-match-meta t-match-meta--edit">
        <input class="t-match-edit-time" type="time" value="${esc(hh)}" ${editDisabled ? 'disabled' : ''} data-role="edit-time">
        <input class="t-match-edit-field" type="number" min="1" max="12" value="${esc(fieldVal)}" ${editDisabled ? 'disabled' : ''} data-role="edit-field">
      </div>
    `;
  } else {
    metaHtml = `
      <div class="t-match-meta">
        <div class="t-match-meta-line t-match-meta-time">${esc(metaLine1)}</div>
        ${metaLine2 ? `<div class="t-match-meta-line t-match-meta-label">${esc(metaLine2)}</div>` : ''}
      </div>
    `;
  }

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
    // Markenuebernahme (2026-08-26): GAR NICHTS statt eines
    // Gedankenstrichs. Der Strich war die ehrliche Antwort, solange die
    // Aktionsspalte rechts neben den Teams lag und sonst leer gewesen
    // waere — eine leere Grid-Spalte sieht nach Fehler aus.
    // Seit die Aktion eine eigene ZEILE unter der Meta ist, kostet ein
    // Strich eine ganze Zeile Hoehe fuer die Aussage "hier steht
    // nichts". Bei sechs offenen Spielen untereinander sind das sechs
    // leere Zeilen. Die Karte laesst die Zeile jetzt weg
    // (.t-match-action:empty { display: none }).
    actionHtml = '';
  }

  // Anzeigetafel-Layout (Redesign Teil 1, A2): Teams UNTEREINANDER,
  // jedes Team bekommt sein eigenes Score-Feld rechts — zwei separate
  // .t-match-score-Elemente mit data-area zur Grid-Positionierung.
  // Der dunkle Hintergrund + helle Ziffern ist die Handschrift des
  // Moduls; "X : Y" als Text war zu generisch.
  //
  // Etappe A2 (2026-08-20): Team+Score-Paare sind in .t-match-rows
  // gewrappt. So bleiben sie im CSS-Grid nebeneinander, während die
  // Meta-Zeile oben und Action unten auf der vollen Karten-Breite
  // liegen. Ohne diesen Wrapper wären die Spalten vom Grid gequetscht
  // worden, weil t-match-team + t-match-score zusammen eine Zeile
  // bilden sollen (Anzeigetafel-Layout: Name — Score).
  return `
    <div class="t-match${m?.isFinished ? ' t-match--done' : ''}${m?.isLive ? ' t-match--live' : ''}" data-match-id="${esc(m?.id)}">
      <div class="t-match-bar"></div>
      ${metaHtml}
      <div class="t-match-rows">
        <div class="t-match-team${homeIsWinner ? ' is-winner' : ''}">${homeDot}<span class="name">${esc(homeName)}</span></div>
        <div class="t-match-score${scoreEmpty ? ' empty' : ''}" data-area="home-score">${esc(homeScoreText)}</div>
        <div class="t-match-team right${awayIsWinner ? ' is-winner' : ''}">${awayDot}<span class="name">${esc(awayName)}</span></div>
        <div class="t-match-score${scoreEmpty ? ' empty' : ''}" data-area="away-score">${esc(awayScoreText)}</div>
      </div>
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
 * Wie die Standard-Karte, aber ohne Meta und Action. Zwei Score-Felder
 * (eines pro Team) im selben Anzeigetafel-Look — kleiner.
 */
export function renderMatchCardCompact(m) {
  const homeName = m?.home?.name || 'offen';
  const awayName = m?.away?.name || 'offen';
  const homeColor = m?.home?.color || null;
  const awayColor = m?.away?.color || null;
  const hasScore = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
  const homeScoreText = hasScore ? String(m.scoreHome) : '–';
  const awayScoreText = hasScore ? String(m.scoreAway) : '–';
  const scoreClass = hasScore ? 't-match-score' : 't-match-score empty';
  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const homeDot = `<i class="t-dot" style="${dotStyle(homeColor)}" aria-hidden="true"></i>`;
  const awayDot = `<i class="t-dot" style="${dotStyle(awayColor)}" aria-hidden="true"></i>`;
  return `
    <div class="t-match t-match--compact${m?.isFinished ? ' t-match--done' : ''}">
      <div class="t-match-bar"></div>
      <div class="t-match-rows">
        <div class="t-match-team">${homeDot}<span class="name">${esc(homeName)}</span></div>
        <div class="${scoreClass}" data-area="home-score">${esc(homeScoreText)}</div>
        <div class="t-match-team right">${awayDot}<span class="name">${esc(awayName)}</span></div>
        <div class="${scoreClass}" data-area="away-score">${esc(awayScoreText)}</div>
      </div>
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

  // Markenuebernahme Etappe 5 (2026-08-26): der Spielplan ist keine
  // Liste von Spielen mehr, sondern ein Tagesablauf.
  //
  // Vorher stand jede Karte fuer sich und trug ihre Uhrzeit selbst. Bei
  // 18 Spielen las man 18 mal dieselbe Zeit — und sah trotzdem nicht,
  // was als Naechstes kommt. Jetzt gliedert die UHRZEIT, und die Karten
  // haengen darunter:
  //
  //     14:30 ───────────── ● ALS NAECHSTES
  //     [Karte] [Karte]
  //     14:00 ───────────── GESPIELT
  //     [Karte] [Karte]
  //
  // Das laufende Spiel steht GANZ OBEN, ausserhalb der Achse. Es hat
  // keine Uhrzeit — es ist jetzt. Wer aufs Handy schaut, waehrend an
  // der Platte gespielt wird, sucht genau diese eine Karte.

  const laufend = matches.filter((m) => m?.isLive);
  const rest = matches.filter((m) => !m?.isLive);

  // Nach Uhrzeit buendeln. Reihenfolge der Gruppen = Reihenfolge des
  // ersten Vorkommens; die Liste kommt bereits sortiert herein
  // (sortMatchesBySchedule), also bleibt die Sortierung erhalten,
  // ohne dass hier ein zweites Mal sortiert wird.
  const bloecke = [];
  const nachZeit = new Map();
  for (const m of rest) {
    const zeit = m?.scheduledTime || '';
    if (!nachZeit.has(zeit)) {
      const b = { zeit, spiele: [] };
      nachZeit.set(zeit, b);
      bloecke.push(b);
    }
    nachZeit.get(zeit).spiele.push(m);
  }

  // Der erste Block, in dem noch nichts gespielt ist, ist "als Naechstes".
  const naechsterIndex = bloecke.findIndex((b) => b.spiele.some((m) => !m?.isFinished));

  const teile = [];
  if (laufend.length) {
    teile.push(laufend.map((m) => renderMatchCard(m, isAdmin)).join(''));
  }

  bloecke.forEach((b, i) => {
    const alleFertig = b.spiele.every((m) => m?.isFinished);
    const istNaechster = i === naechsterIndex;
    const zustand = alleFertig ? 'Gespielt' : istNaechster ? 'Als Nächstes' : 'Geplant';
    teile.push(renderZeitmarke(b.zeit, zustand, istNaechster));
    teile.push(b.spiele.map((m) => renderMatchCard(m, isAdmin)).join(''));
  });

  return teile.join('');
}

/**
 * Eine Marke auf der Zeitachse: Uhrzeit links, Linie, Zustand rechts.
 *
 * Der Zustand ist bewusst Text und kein Symbol — "Als Nächstes",
 * "Gespielt", "Geplant" sagen einem Fremden am Spieltisch mehr als ein
 * Punkt, dessen Farbe man erst lernen muss. Der Punkt kommt dazu, wo es
 * eilig ist, nicht statt der Worte.
 *
 * Ohne Uhrzeit (kommt vor: unverplante Spiele) traegt die Marke einen
 * Gedankenstrich statt einer leeren Stelle. Eine Achse mit Luecke sieht
 * kaputt aus; eine mit "–" sieht nach "noch kein Termin" aus, und genau
 * das ist es.
 */
function renderZeitmarke(zeit, zustand, hervor) {
  const z = zeit || '–';
  return `<div class="t-zeitmarke${hervor ? ' is-next' : ''}">
    <span class="t-zeitmarke-zeit">${esc(z)}</span>
    <span class="t-zeitmarke-linie" aria-hidden="true"></span>
    <span class="t-zeitmarke-zustand">${hervor ? '<span class="t-dot-flare" aria-hidden="true"></span>' : ''}${esc(zustand)}</span>
  </div>`;
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
    return `<li><strong>Platte ${esc(m.field)}</strong> · ${esc(time)} · ${esc(home)} vs ${esc(away)}</li>`;
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
 *
 * P5-Truncation 2026-08-25: bei .t-mod ≤600 px wird eine 5er-Colgroup
 * (Standings) bzw. 6er-Colgroup (Beste Dritte) verwendet — je Tabelle
 * genau so viele <col>, wie nach den display:none-Regeln in main.css
 * sichtbar bleiben. Hintergrund:
 * das 9er-Colgroup hatte „Geister-Spalten" (8%/7%/7%/7%), die der Browser
 * bei `display: none` weiterhin für die Spaltenbreite berücksichtigte
 * — die 5 sichtbaren Spalten bekamen dadurch zu wenig Platz und wurden
 * getruncated („BECH…", „+…", „9…"). Mit 5 Spalten summieren sich die
 * Fix-Werte zu 56% + auto-Team 44% → ausreichend für „12:10" + „+12" + „18".
 * Siehe getStandingsColWidths()/getThirdsColWidths() + Compact-Mode-Switch.
 */
const STANDINGS_COL_WIDTHS = ['6%', 'auto', '8%', '7%', '7%', '7%', '12%', '9%', '9%'];
/* User-Punkt 2 (2026-08-25) Folge 2: Pl-Spalte von 8% auf 14%.
   8% = ~24 px bei 374 px Tabellenbreite → "1." passte mit Cell-Padding
   nicht, Header und Body wurden zu "P…" / "1…" getruncated.
   14% = ~52 px → reicht für "10." und für die Überschrift "Pl.".
   Team dafür von 38% auf 36% reduziert — reicht immer noch für lange
   Teamnamen, weil die Spalte eh linksbündig ist und am Rand umbrechen
   darf. Summe 14+36+20+15+15 = 100%, weiter kein auto. */
/* Entscheid Jonas, 2026-08-26: "Becher weglassen" auf dem Handy.
   Die Vorlage zeigt mobil Pl · Team · Sp · Diff · Pkt; bis hierher stand
   an dritter Stelle 'Becher' (gf:ga) und 'Sp' war versteckt. Getauscht,
   nicht ergaenzt — es bleiben fuenf Spalten.
   'Sp' braucht weniger Platz als '12:6', deshalb wandern 6 Punkte an die
   Team-Spalte. Summe weiter genau 100%, kein 'auto'.
   ACHTUNG: Diese Liste und der Ausblendblock in main.css (@container
   max-width:600px) sind EIN Paar. Wer dort eine Spalte anders schaltet
   und hier nicht, verschiebt alle folgenden Breiten um eins — genau so
   ist die Zuordnung schon einmal zerbrochen. */
const STANDINGS_COL_WIDTHS_MOBILE = ['14%', '42%', '14%', '15%', '15%'];
const THIRDS_COL_WIDTHS = ['6%', 'auto', '8%', '8%', '7%', '7%', '7%', '12%', '9%', '9%'];
/* Beste-Dritte-Mobile — korrigiert 2026-08-25.
 *
 * WAS FALSCH WAR: die Liste hatte SIEBEN Eintraege
 *   ['8%','auto','12%','10%','18%','13%','13%']
 * fuer SECHS sichtbare Spalten. Der Kommentar zaehlte "Sp" als sichtbar,
 * main.css blendet data-col="played" auf Mobile aber aus. <col>-Elemente
 * werden bei table-layout: fixed POSITIONSWEISE auf die tatsaechlich
 * gerenderten Spalten gelegt — eine per display:none entfernte Spalte
 * verschiebt alle folgenden Breiten um eins nach links:
 *   Pl->8%  Team->auto  Gruppe->12%  Becher->10%(war fuer "Sp." gedacht!)
 *   Diff->18%  Pkt->13%  und 13% blieben ungenutzt liegen.
 * Becher bekam damit die Breite einer einstelligen Zahlenspalte:
 * ~37px bei 374px Tabellenbreite, "12:10" braucht ~44px -> "12:…".
 * Unter 430px war der Versatz sogar ZWEI Spalten gross, weil dort ein
 * zweiter CSS-Block zusaetzlich "Becher" versteckte.
 *
 * WAS JETZT GILT: dieselbe Machart wie STANDINGS_COL_WIDTHS_MOBILE —
 * exakt so viele Eintraege wie sichtbare Spalten, feste Prozente, kein
 * 'auto', Summe genau 100%. Reihenfolge = DOM-Reihenfolge der sichtbaren
 * Spalten:
 *   Pl. 12% · Team 28% · Gruppe 19% · Becher 19% · Diff 11% · Pkt. 11%
 *
 * BEMESSUNG — im Browser gemessen, nicht geschaetzt (Edge, 2026-08-25).
 * Die erste Fassung dieses Sets rechnete gegen "374px Tabellenbreite" (die
 * Zahl stammt aus dem Standings-Kommentar). Der Messlauf hat sie widerlegt:
 * bei 390px Viewport ist die Tabelle 288px breit. Die Kette dorthin:
 *   390 - 2x14 (#content) - 2x8 (.t-shell) - 2x12 (.t-mod-main)
 *       - 2x16 (.t-card-body) = 288
 * Bei 360px Viewport sind es 258px, bei 430px 328px.
 *
 * Die Eigenart dieser Tabelle: der Platzbedarf der UEBERSCHRIFTEN ist in
 * Pixeln fix, der der Werte nicht. Gemessen (scrollWidth, mobil 10px
 * uppercase ohne Laufweite, Zellpolster 3px):
 *   "GRUPPE" / "BECHER"  je 48px      <- die beiden binden das Layout
 *   "DIFF" / "PKT."      je 28px
 *   "Pl." / "10."            34px
 *   "12:10"                  44px     <- der Wert, um den es im Bug ging
 * Prozente skalieren mit der Tabelle, dieser Bedarf nicht — deshalb ist
 * das Set gegen die SCHMALSTE Breite bemessen (258px @ 360px Viewport),
 * nicht gegen die bequemste.
 *
 * Fuenf Kandidatensets wurden bei 360/390/430px durchgemessen; dieses ist
 * das einzige, das bei allen dreien ohne Kuerzung auskommt UND der
 * Team-Spalte dabei die meiste Breite laesst (72 / 81 / 92px).
 * Team ist die einzige Spalte, die kuerzen DARF — sie traegt Fliesstext,
 * alle anderen tragen Werte, die vollstaendig lesbar sein muessen.
 *
 * WER HIER ETWAS AENDERT: die Anzahl der Eintraege haengt an den
 * display:none-Regeln in main.css (@container max-width: 600px,
 * .t-thirds-table th/td[data-col=...]). Spalte versteckt oder wieder
 * eingeblendet -> diese Liste MUSS mitgezogen werden, sonst rutschen
 * alle Breiten erneut. */
/* FLUCHT MIT DER STANDINGS-TABELLE (2026-08-25, im Browser gemessen).
 * Auf Desktop fluchten beide Tabellen laengst — dort ist die Team-Spalte
 * `auto` und schluckt die Differenz selbst. Auf Mobile wurde `auto`
 * bewusst entfernt (feste Prozente, damit nichts mehr rutscht), damit
 * ging die Flucht verloren: gemeinsame Spalten standen bis zu 25 px
 * auseinander.
 *
 * Der Platz kommt aus der einzigen wirklich ueberdimensionierten Spalte:
 * `Gruppe` hatte 19 % (54,7 px bei 288 px Tabellenbreite) fuer EINEN
 * Buchstaben. Mit 8 % (23 px) fluchten Pl., Becher, Diff und Pkt. exakt
 * mit der Standings-Tabelle, und die Team-Spalte verliert dabei nichts
 * (87 px statt 88 px). Deshalb traegt die Kopfzeile unten "Gr." statt
 * "Gruppe" — sonst kuerzt sie zu "G…".
 *
 * STANDINGS_COL_WIDTHS_MOBILE bleibt unangetastet: das sind die frisch
 * gemessenen 288-px-Werte, an denen sich diese Tabelle ausrichtet.
 *
 * NACHTRAG 2026-08-25 (bei 360 px nachgemessen, nicht nur bei 390):
 * mit 8 % war die Gruppen-Spalte bei 360 px Viewport 21 px breit, die
 * Kopfzeile "GR." braucht 24 px — sie kuerzte zu "G…". Jetzt 10 %.
 *
 * DIE INVARIANTE, an der die Flucht haengt — bitte nicht zerreissen:
 *     Team + Gruppe  ==  36 %   (= die Team-Spalte der Standings-Tabelle)
 * Nur weil beide zusammen genau so breit sind wie dort EINE Spalte,
 * beginnen Becher, Diff und Pkt. in beiden Tabellen an derselben Stelle.
 * Die 2 %, die die Gruppen-Spalte dazubekommt, sind deshalb der
 * Team-Spalte entnommen (28 -> 26) und nicht irgendwoher: 26 + 10 = 36.
 * Wer die Gruppen-Spalte anfasst, muss Team gegenlaeufig mitziehen —
 * sonst rutschen die gemeinsamen Spalten wieder auseinander, und genau
 * das war der Befund, den dieser Block behebt. */
/* Ebenfalls Entscheid Jonas 2026-08-26: Becher faellt auch hier weg.
   Sichtbar bleiben Pl · Team · Gr. · Diff · Pkt — fuenf statt sechs,
   wie die Vorlage (Abschnitt 04) es zeigt.

   FLUCHT-INVARIANTE: Beide Tabellen stehen untereinander in derselben
   Ansicht. Damit Diff und Pkt. an derselben Stelle beginnen, muss hier
   Team + Gr. so breit sein wie dort Team + Sp.:
       Standings  14 | 42 | 14 | 15 | 15
       Dritte     14 | 44 | 12 | 15 | 15
                       ___ 56 ___/   = 42 + 14
   Mein erster Entwurf hatte 34+12=46 gegen 56 — die beiden Tabellen
   waeren um zehn Prozentpunkte gegeneinander verrutscht. Der Test
   best-thirds-render.test.js prueft genau diese Summe. */
const THIRDS_COL_WIDTHS_MOBILE = ['14%', '44%', '12%', '15%', '15%'];

function renderColgroup(widths) {
  return `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>`;
}

// === Compact-Mode-Switch (P5-Truncation 2026-08-25) =====================
// .t-mod ≤600 px → Mobile-Colgroups (5 Spalten Standings, 6 Beste Dritte).
// .t-mod >600 px → Desktop-Colgroups (9 Spalten Standings, 10 Beste Dritte).
//
// Detection: ResizeObserver auf .t-mod, feuert nur beim Crossen der 600-px-
// Grenze (User-Hinweis: nicht bei jedem Pixel). Renderer liest den State
// bei jedem Aufruf → Tab-Wechsel triggert ohnehin ein Re-Render und holt
// den aktuellen Mode.
//
// Reihenfolge der Entscheidung pro Renderer-Aufruf:
//   1. tModCompactMode wurde bereits gesetzt (durch vorherigen Render oder
//      ResizeObserver) → nutze diesen Wert.
//   2. Noch null (= noch nie gemessen) → detectCompactModeFromTMod()
//      misst .t-mod-Breite (oder Viewport-Fallback, wenn .t-mod noch
//      nicht gemounted ist — z. B. in Vitest ohne DOM).

// A5 (2026-08-25): Seit die drei body-Dialoge die Klasse t-mod tragen
// (Token-Vererbung, siehe dialog-host.js), gibt es mehr als ein .t-mod
// im Dokument. Gemessen werden darf nur der Modul-Container — ein
// Dialog ist position:fixed und inset:0 und lieferte hier die
// Viewport-Breite statt der Modulbreite.
const TMOD_MEASURE_SELECTOR = '.t-mod:not(.t-dialog-host)';

let tModCompactMode = null;       // null = noch nicht gemessen
let tModResizeObserver = null;    // ein Observer für die ganze App-Lifetime

function detectCompactModeFromTMod() {
  const mod = typeof document !== 'undefined' ? document.querySelector(TMOD_MEASURE_SELECTOR) : null;
  if (mod) return mod.getBoundingClientRect().width <= 600;
  return typeof window !== 'undefined' && window.innerWidth <= 660;
}

function getStandingsColWidths() {
  if (tModCompactMode === null) tModCompactMode = detectCompactModeFromTMod();
  return tModCompactMode ? STANDINGS_COL_WIDTHS_MOBILE : STANDINGS_COL_WIDTHS;
}

function getThirdsColWidths() {
  if (tModCompactMode === null) tModCompactMode = detectCompactModeFromTMod();
  return tModCompactMode ? THIRDS_COL_WIDTHS_MOBILE : THIRDS_COL_WIDTHS;
}

/** Test-Hook: setzt den Compact-Mode direkt. */
export function setCompactMode(value) {
  tModCompactMode = value;
}

/** Test-Hook: liest den aktuellen Compact-Mode. */
export function getCompactMode() {
  return tModCompactMode;
}

/**
 * Setzt einen ResizeObserver auf .t-mod, der nur beim Crossen der 600-px-
 * Grenze onChange() aufruft. Scroll-Position wird vor dem Re-Render
 * gesichert und nach dem nächsten Paint wiederhergestellt
 * (User-Hinweis: Handy-Drehen darf nicht auf „oben" springen).
 *
 * Idempotent: zweiter Aufruf ist no-op (derselbe Observer bleibt aktiv).
 */
export function ensureTModResizeObserver(onChange) {
  if (tModResizeObserver) return;
  if (typeof ResizeObserver === 'undefined') return;
  tModResizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) {
      const newCompact = e.contentRect.width <= 600;
      if (newCompact === tModCompactMode) continue; // nur Crossings
      // Scroll-Position retten (User-Hinweis: nicht oben landen)
      const content = typeof document !== 'undefined'
        ? document.getElementById('content') : null;
      const savedScroll = content ? content.scrollTop
        : (typeof window !== 'undefined' ? window.scrollY : 0);
      tModCompactMode = newCompact;
      if (typeof onChange === 'function') onChange();
      // Nach Paint: Scroll wiederherstellen
      requestAnimationFrame(() => {
        if (content) content.scrollTop = savedScroll;
        else if (typeof window !== 'undefined') window.scrollTo(0, savedScroll);
      });
    }
  });
  const mod = document.querySelector(TMOD_MEASURE_SELECTOR);
  if (mod) {
    tModResizeObserver.observe(mod);
    tModCompactMode = mod.getBoundingClientRect().width <= 600;
  }
}

/** Detacht den Observer (z. B. beim Verlassen der Detail-View). */
export function detachTModResizeObserver() {
  if (tModResizeObserver) {
    tModResizeObserver.disconnect();
    tModResizeObserver = null;
  }
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
 * A3 (Redesign Teil 1, 2026-08-25): die Zeilenklassen sagen jetzt, was
 * gemeint ist, statt nur zu zaehlen. Vorher `is-first`/`is-second` — das
 * kodierte die Annahme "immer genau zwei steigen auf" im Renderer und war
 * bei `qualifyPerGroup: 1` oder `: 3` schlicht falsch eingefaerbt.
 * Jetzt drei Zustaende, abgeleitet aus der Turnier-Konfiguration:
 *   is-qualified  Platz <= qualifyPerGroup      (gruen hinterlegt)
 *   is-cutoff     der LETZTE qualifizierte Platz (Trennlinie darunter)
 *   is-pending    der erste Platz darunter       (bernstein hinterlegt)
 * `is-cutoff` liegt zusaetzlich auf einer `is-qualified`-Zeile — die Linie
 * markiert die Grenze, die Flaeche den Status. Zwei Signale, kein drittes:
 * der Haken ist mit A3 entfallen (Plan: "Kein Stern, kein Pfeil, kein
 * Haekchen — nur Hinterlegung und Trennlinie").
 *
 * Bug 14: <th> bekommen `is-rank` / `is-team` / `is-num`-Klassen, damit
 * Header-Zellen dieselbe Ausrichtung haben wie ihre <td>-Gegenstücke.
 *
 * @param {Array<{groupName?,groupKey?,standings:Array}>} groups
 * @param {string} scoreLabel   "Becher" | "Tore" | "Punkte" (sport-abhängig)
 * @param {number} [qualifyPerGroup=2]  Wie viele pro Gruppe aufsteigen.
 *   Default 2 ist der haeufigste Fall UND das bisherige Verhalten — ohne
 *   den Wert faerbt die Tabelle also genau wie vorher, statt leer zu bleiben.
 * @returns {string} HTML
 */
export function renderStandingsGroups(groups, scoreLabel, qualifyPerGroup = 2) {
  // Defensiv: kaputte/fehlende Konfiguration darf die Tabelle nicht
  // unbrauchbar machen — im Zweifel faerben wir wie bisher zwei Plaetze.
  const advance = Number.isInteger(qualifyPerGroup) && qualifyPerGroup > 0
    ? qualifyPerGroup
    : 2;
  const fmtDiff = (n) => (n > 0 ? `+${n}` : `${n}`);
  // Beschwerde 2 (2026-08-26) und ihre RUECKNAHME am selben Tag.
  //
  // Erst hiess es "bei tabellen: wieso sind die untereinander" — daraufhin
  // stand hier ein Segment-Umschalter mit genau EINER sichtbaren Tabelle,
  // wie die Vorlage ihn zeigt. Nach dem Blick im Browser hat Jonas anders
  // entschieden: "es sieht zwar schoen aus aber ich glaube wenn die gruppen
  // mit etwas abstand alle untereinander waeren, waere ich gluecklicher."
  //
  // Das ist kein Rueckschritt auf den Ausgangszustand. Der war: Tabellen
  // ohne Luft dazwischen, ohne Kopfzeile mit Spielstand, ohne Fusszeile mit
  // der Aufstiegsregel. Geblieben ist alles, was die Markenuebernahme
  // gebracht hat — es faellt nur die Regel "genau eine sichtbar". Den
  // Schnitt zwischen zwei Gruppen macht jetzt der Abstand statt des
  // Umschalters.
  //
  // ABWEICHUNG VON DER VORLAGE, ausdruecklich so entschieden.
  return groups
    .map((g) => {
      const rows = (g.standings || [])
        .map((s, i) => {
          const gf = s.goalsFor ?? 0;
          const ga = s.goalsAgainst ?? 0;
          const gd = s.goalDiff ?? (gf - ga);
          const rank = i + 1;
          // Markenuebernahme (2026-08-26): zwei Zustaende statt drei.
          //
          // A3 hatte is-qualified / is-cutoff / is-pending — Flaeche fuer
          // "steigt auf", Linie fuer die Grenze, Bernstein fuer den
          // Anwaerter darunter. Der Marken-Entwurf schneidet das anders:
          //   Platz 1              -> is-lead       (Orange, Weg zum Titel)
          //   Platz 2..N           -> is-qualified  (Gruen, qualifiziert)
          //   alles darunter       -> nichts
          //
          // Die Grenze braucht keine eigene Linie mehr: sie ist da, wo das
          // FARBBAND links aufhoert. Das Band ist ausserdem das Signal, das
          // ohne Farbe funktioniert — bei Rot-Gruen-Schwaeche unterscheidet
          // man Orange und Gruen nicht, aber "Band da" von "Band nicht da"
          // sehr wohl. Deshalb ersetzt es die Trennlinie, statt sie zu
          // ergaenzen.
          //
          // is-pending faellt weg: wer als Dritter noch Chancen hat, steht
          // in der Beste-Dritte-Tabelle, und dort mit eigener Wertung. Ein
          // zweiter Ort fuer dieselbe Aussage war eine Wiederholung.
          const cls = [
            rank === 1 ? 'is-lead' : '',
            rank > 1 && rank <= advance ? 'is-qualified' : '',
          ].filter(Boolean).join(' ');
          return `<tr class="t-standings-row${cls ? ' ' + cls : ''}">
            <td class="t-standings-rank" data-col="pl">${i + 1}.</td>
            <td class="t-standings-team">${esc(s.name || s.teamId || '—')}</td>
            <td class="t-standings-num" data-col="played">${s.played ?? 0}</td>
            <td class="t-standings-num" data-col="won">${s.won ?? 0}</td>
            <td class="t-standings-num" data-col="drawn">${s.drawn ?? 0}</td>
            <td class="t-standings-num" data-col="lost">${s.lost ?? 0}</td>
            <td class="t-standings-num" data-col="score">${gf}:${ga}</td>
            <td class="t-standings-num${gd > 0 ? ' is-positive' : gd < 0 ? ' is-negative' : ''}" data-col="diff">${fmtDiff(gd)}</td>
            <td class="t-standings-num is-points" data-col="points">${s.points ?? 0}</td>
          </tr>`;
        })
        .join('');
      const title = esc(g.groupName || g.groupKey || 'Gruppe');
      // Der Stand wandert in den Tabellenkopf, wie in der Vorlage
      // (Abschnitt 04: <h5>Gruppe A</h5><span class="sub">4 von 6 Spielen</span>).
      // In der Fusszeile steht dafuer die REGEL — zwei verschiedene
      // Aussagen an zwei Orten, statt beide unten nebeneinander.
      const zeilenG = Array.isArray(g.standings) ? g.standings : [];
      const gespielt = Math.round(zeilenG.reduce((n, s) => n + (s.played ?? 0), 0) / 2);
      const gesamt = (zeilenG.length * (zeilenG.length - 1)) / 2;
      const stand = gesamt > 0 ? `${gespielt} von ${gesamt} Spielen` : '';
      return `<div class="t-card t-standings-karte">
        <div class="t-card-body">
          <div class="t-standings-head">
            <h3 class="t-standings-group-title">${title}</h3>
            ${stand ? `<span class="t-standings-sub">${esc(stand)}</span>` : ''}
          </div>
          <table class="t-standings-table">
            ${renderColgroup(getStandingsColWidths())}
            <thead>
              <tr>
                <th class="is-rank"  data-col="pl">Pl.</th>
                <th class="is-team">Team</th>
                <th class="is-num"   data-col="played">Sp.</th>
                <th class="is-num"   data-col="won">S</th>
                <th class="is-num"   data-col="drawn">U</th>
                <th class="is-num"   data-col="lost">N</th>
                <th class="is-num"   data-col="score">${esc(scoreLabel)}</th>
                <th class="is-num"   data-col="diff">Diff</th>
                <th class="is-num"   data-col="points">Pkt.</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${renderStandingsFoot(g, advance)}
        </div>
      </div>`;
    })
    .join('');
}

/**
 * Fusszeile unter einer Gruppentabelle — Markenuebernahme 2026-08-26.
 *
 * Zwei Angaben, links die Regel und rechts der Stand:
 *   "■ Plaetze 1-2 ziehen direkt ein"      2 von 6 Spielen
 *
 * Die Regel steht damit unter der Tabelle, auf die sie sich bezieht,
 * statt in einem Hilfetext, den niemand oeffnet. Das Quadrat links
 * traegt dieselbe Farbe wie das Band der Aufstiegsplaetze — es ist die
 * Legende zu dem, was daneben zu sehen ist.
 *
 * Der Spielstand kommt aus den Zeilen selbst (Summe der `played` durch
 * zwei, weil jedes Spiel bei beiden Teams zaehlt) und nicht aus einer
 * separaten Zahl: so kann er nicht von der Tabelle abweichen.
 */
function renderStandingsFoot(g, advance) {
  const zeilen = Array.isArray(g?.standings) ? g.standings : [];
  if (!zeilen.length) return '';

  const teams = zeilen.length;
  const gespielt = Math.round(zeilen.reduce((n, s) => n + (s.played ?? 0), 0) / 2);
  // Jeder gegen jeden, einfach: n*(n-1)/2.
  const gesamt = (teams * (teams - 1)) / 2;

  // Kurz halten: die Zeile steht in Mono mit Sperrung, und bei 390px hat
  // die Karte innen rund 290px. "Plaetze 1-2 ziehen direkt ein" plus
  // "6 von 6 Spielen" sind zusammen 44 Zeichen und brechen um — im
  // Screenshot ueber zwei Zeilen, was nach Fehler aussieht statt nach
  // Absicht. "steigen auf" sagt dasselbe in acht Zeichen weniger.
  const regel = advance >= teams
    ? 'Alle steigen auf'
    : advance === 1
      ? 'Platz 1 steigt auf'
      : `Plätze 1–${advance} steigen auf`;

  // Der Stand steht seit 2026-08-26 im Tabellenkopf, nicht mehr hier —
  // die Vorlage trennt das: oben WIE WEIT, unten NACH WELCHER REGEL.
  // Rechts steht stattdessen der Streifen: ein Segment je Gruppenspiel.
  //
  // ABWEICHUNG von der Vorlage, bewusst: dort sind die Segmente gruen
  // (gewonnen) und rot (verloren). Auf Gruppenebene hat das keine
  // Bedeutung — jedes Spiel hat einen Sieger UND einen Verlierer, die
  // Gruppe als ganze gewinnt nichts. Hier zeigt der Streifen deshalb
  // gespielt gegen offen. Lieber eine ehrliche Aussage als eine
  // huebsche, die keine ist.
  const segmente = gesamt > 0
    ? `<span class="t-standings-prog" aria-hidden="true">${
        Array.from({ length: gesamt }, (_, i) =>
          `<i${i < gespielt ? ' class="is-done"' : ''}></i>`).join('')
      }</span>`
    : '';

  return `<div class="t-standings-foot">
    <span><span class="t-foot-mark" aria-hidden="true"></span>${esc(regel)}</span>
    ${segmente}
  </div>`;
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
 * P6 (2026-08-24, User-Liste): Hinweis ist IMMER sichtbar
 * („Gewertet wird nach Punkten pro Spiel."). Vorher conditional bei
 * mixedGroupSizes — User fand das verwirrend.
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

  // P6 (2026-08-24): Hinweis wurde vorher conditional eingeblendet
  // (mixedGroupSizes). User-Forderung: unconditional. mixedGroupSizes
  // wird nicht mehr berechnet.

  const body = rows
    .map((r, i) => {
      const qualifies = r.qualifies === true;
      const gf = r.goalsFor ?? 0;
      const ga = r.goalsAgainst ?? 0;
      const gd = r.goalDiff ?? (gf - ga);
      return `<tr class="t-thirds-row${qualifies ? ' is-qualified' : ' is-out'}">
        <td class="t-thirds-rank"  data-col="pl">${i + 1}.</td>
        <td class="t-thirds-team">${esc(r.name || r.teamId || '—')}</td>
        <td class="t-thirds-group" data-col="group">${esc(r.groupKey || '—')}</td>
        <td class="t-thirds-num"   data-col="played">${r.played ?? 0}</td>
        <td class="t-thirds-num"   data-col="won">${r.won ?? 0}</td>
        <td class="t-thirds-num"   data-col="drawn">${r.drawn ?? 0}</td>
        <td class="t-thirds-num"   data-col="lost">${r.lost ?? 0}</td>
        <td class="t-thirds-num"   data-col="score">${gf}:${ga}</td>
        <td class="t-thirds-num${gd > 0 ? ' is-positive' : gd < 0 ? ' is-negative' : ''}" data-col="diff">${fmtDiff(gd)}</td>
        <td class="t-thirds-num is-points" data-col="points">${r.points ?? 0}</td>
      </tr>`;
    })
    .join('');

  // P6 (2026-08-24, User-Liste): Hinweis IMMER anzeigen, nicht nur bei
  // mixedGroupSizes. Vorher tauchte der Hinweis nur bei unterschiedlich
  // großen Gruppen auf — der User fand das verwirrend. Jetzt konstanter
  // Einzeiler, der die Normierung generell erklärt.
  const hint = `<p class="t-hint t-hint--compact">Gewertet wird nach Punkten pro Spiel.</p>`;

  return `<div class="t-card t-thirds-card">
    <div class="t-card-body">
      <h3 class="t-thirds-title">Beste Dritte <span class="t-thirds-meta-inline">(Top ${qualifyCount} qualifizieren sich)</span></h3>
      ${hint}
      <table class="t-thirds-table">
        ${renderColgroup(getThirdsColWidths())}
        <thead>
          <tr>
            <th class="is-rank"  data-col="pl">Pl.</th>
            <th class="is-team">Team</th>
            <th class="is-group" data-col="group">${tModCompactMode ? 'Gr.' : 'Gruppe'}</th>
            <th class="is-num"   data-col="played">Sp.</th>
            <th class="is-num"   data-col="won">S</th>
            <th class="is-num"   data-col="drawn">U</th>
            <th class="is-num"   data-col="lost">N</th>
            <th class="is-num"   data-col="score">Becher</th>
            <th class="is-num"   data-col="diff">Diff</th>
            <th class="is-num"   data-col="points">Pkt.</th>
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

  // Kartenlayout: VERTIKAL — Teams UNTEREINANDER, Name + Score in
  // einer Zeile jeweils (Team-Score Zeile, Team-Score Zeile, Meta).
  // User-Korrektur 2026-08-19: "ich will es wie davor, also untereinander
  // die namen und ergebnisse. so wie es davor war. nur eben etwas schmaler".
  // Horizontal-Layout (Bug-16-Nachschlag-2) wurde verworfen weil auf
  // Desktop "schrecklich". Vertikal ist der gewohnte Turnierplakat-Stil.
  const homeHasScore = typeof m?.scoreHome === 'number';
  const awayHasScore = typeof m?.scoreAway === 'number';
  const homeScore = homeHasScore ? `${m.scoreHome}` : '–';
  const awayScore = awayHasScore ? `${m.scoreAway}` : '–';

  const meta = m?.isFinished
    ? 'Beendet'
    : (m?.scheduledTime && typeof m?.field === 'number')
      ? `${m.scheduledTime} · Platte ${m.field}`
      : '';

  const homeIsPlaceholder = m?.home?.kind === 'placeholder';
  const awayIsPlaceholder = m?.away?.kind === 'placeholder';
  const isPlaceholder = homeIsPlaceholder || awayIsPlaceholder;

  // Sieger-Hervorhebung: bei beendeten Matches wird der Name des
  // Gewinners fett, der Verlierer grau. Das ist der Turnierplakat-Stil.
  const homeIsWinner = homeHasScore && awayHasScore && m.scoreHome > m.scoreAway && m.isFinished;
  const awayIsWinner = homeHasScore && awayHasScore && m.scoreAway > m.scoreHome && m.isFinished;

  const dotStyle = (color) => color ? `background:${esc(color)}` : 'background:var(--line)';
  const homeDot = `<i class="t-dot${homeIsPlaceholder ? ' t-dot--placeholder' : ''}" style="${dotStyle(m?.home?.color)}" aria-hidden="true"></i>`;
  const awayDot = `<i class="t-dot${awayIsPlaceholder ? ' t-dot--placeholder' : ''}" style="${dotStyle(m?.away?.color)}" aria-hidden="true"></i>`;

  const classes = ['t-match', 't-match--bracket'];
  if (isPlaceholder) classes.push('t-match--placeholder');
  if (m?.isFinished) classes.push('t-match--done');
  if (homeIsWinner) classes.push('t-match--home-wins');
  if (awayIsWinner) classes.push('t-match--away-wins');

  const metaHtml = meta
    ? `<div class="t-match-meta-line" data-area="meta">${esc(meta)}</div>`
    : '';

  return `<div class="${classes.join(' ')}" data-match-id="${esc(m?.id ?? '')}"${extraStyle}>
    <div class="t-match-bar" data-area="bar"></div>
    <div class="t-match-team${homeIsWinner ? ' is-winner' : ''}" data-area="home">${homeDot}<span class="name">${homeName}</span></div>
    <div class="t-match-score${homeHasScore ? '' : ' empty'}" data-area="home-score">${esc(homeScore)}</div>
    <div class="t-match-team${awayIsWinner ? ' is-winner' : ''}" data-area="away">${awayDot}<span class="name">${awayName}</span></div>
    <div class="t-match-score${awayHasScore ? '' : ' empty'}" data-area="away-score">${esc(awayScore)}</div>
    ${metaHtml}
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
  // Markenuebernahme Etappe 6 (2026-08-26): die Runden-Reiter tragen
  // ihren Stand. "Halbfinale 0/2" sagt mehr als "Halbfinale" — man sieht
  // ohne Klick, wo das Turnier steht. Die aktive Runde ist SCHWARZ
  // gefuellt, nicht orange: Orange gehoert dem Weg zum Titel, ein
  // Reiter ist ein Ort.
  const rundenStand = winnerBracket.map((r) => {
    const spiele = Array.isArray(r.matches) ? r.matches : [];
    return {
      label: r.label,
      fertig: spiele.filter((m) => m?.isFinished).length,
      gesamt: spiele.length,
    };
  });
  // Die aktuelle Runde ist die erste, in der noch etwas offen ist.
  const aktuelleRunde = rundenStand.findIndex((r) => r.fertig < r.gesamt);

  const tabsHtml = cols > 1
    ? `<div class="bracket-tabs">
        ${rundenStand.map((r, i) =>
          `<button type="button" class="bracket-tab${i === aktuelleRunde ? ' is-active' : ''}" data-bracket-tab="${esc(r.label)}">${esc(r.label)}<span class="bracket-tab-stand">${r.fertig}/${r.gesamt}</span></button>`
        ).join('')}
      </div>`
    : '';

  // Die Miniatur "Der Weg zum Titel" ist am 26.08. auf Entscheid von Jonas
  // entfallen ("das sieht nicht schoen aus"). ABWEICHUNG VON DER VORLAGE:
  // das Artefakt zeigt sie in Abschnitt 05 ausdruecklich. Was sie leisten
  // sollte — zeigen, wie weit es noch ist — leisten die Runden-Reiter
  // darunter ohnehin, und zwar mit Zahlen statt mit Kreisen.
  const wegHtml = '';

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

  return `${wegHtml}${tabsHtml}
    <div class="bracket-wrap" style="--bracket-cols:${cols}">
      ${colsHtml}
    </div>`;
}


/**
 * Rundennamen fuer die Miniatur kuerzen. "Viertelfinale" braucht unter
 * einem 5px-Punkt zu viel Platz; VF/HF/F ist am Spieltisch ohnehin die
 * gesprochene Form. Unbekannte Namen werden nicht geraten, sondern auf
 * die ersten zwei Zeichen gekuerzt — falsch abgekuerzt ist schlimmer
 * als knapp.
 */
function kurzRunde(label) {
  const l = String(label || '');
  if (/^achtel/i.test(l)) return 'AF';
  if (/^viertel/i.test(l)) return 'VF';
  if (/^halb|^semi/i.test(l)) return 'HF';
  if (/^finale$|^final$/i.test(l)) return 'F';
  return l.slice(0, 2).toUpperCase();
}

/**
 * Bündelt die drei Bracket-Funktionen unter einem Namespace.
 * Wird sowohl als ES-Modul-Export (`import { bracket } from ...`)
 * als auch als Property auf window.spielplanHelpers verwendet.
 */
/**
 * Statuskarte am Kopf des Einstellungen-Tabs — Markenuebernahme 2026-08-26.
 *
 * Sie beantwortet die Frage, mit der ein Organisator den Tab oeffnet:
 * laeuft das Ding, und wie weit ist es? Vorher musste man sich das aus
 * den Knoepfen zusammenreimen — "Turnier starten" ist aktiv, also laeuft
 * es noch nicht.
 *
 *   TURNIER LAEUFT SEIT 13:00
 *   10          8         3
 *   GESPIELT    OFFEN     PLATTEN
 *
 * Das Band links ist Teal, dieselbe Farbe wie am Rand der laufenden
 * Match-Karte — gleiche Bedeutung, gleiche Farbe. Bei einem Entwurf oder
 * einem beendeten Turnier waere "laeuft" falsch, deshalb traegt die
 * Karte dann eine andere Kopfzeile und ein neutrales Band.
 *
 * Die Zahlen kommen aus den Spielen selbst, nicht aus einem
 * Statistik-Feld: so koennen sie nicht von dem abweichen, was der
 * Spielplan daneben zeigt.
 */
function renderStatusKarte({ t, status, isStarted, isFinished, matches, fields }) {
  const spiele = Array.isArray(matches) ? matches : [];
  const gespielt = spiele.filter((m) => m?.isFinished).length;
  const offen = spiele.length - gespielt;
  const platten = Array.isArray(fields) && fields.length ? fields.length : null;

  let kopf;
  let modifikator = '';
  if (isFinished) {
    kopf = 'Turnier beendet';
    modifikator = ' t-status-card--done';
  } else if (isStarted) {
    const seit = t?.tournament?.startedAt
      ? new Date(t.tournament.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : null;
    kopf = seit ? 'Turnier läuft seit ' + seit : 'Turnier läuft';
  } else if (status === 'draft') {
    kopf = 'Entwurf \u2014 noch kein Spielplan';
    modifikator = ' t-status-card--draft';
  } else {
    kopf = 'Bereit zum Start';
    modifikator = ' t-status-card--draft';
  }

  // Bei einem Entwurf gibt es nichts zu zaehlen. Drei Nullen waeren eine
  // Statistik ueber nichts \u2014 dann lieber nur die Kopfzeile.
  const zahlen = spiele.length
    ? '<div class="t-status-card-nums">'
      + '<div><b>' + gespielt + '</b><span>Gespielt</span></div>'
      + '<div><b>' + offen + '</b><span>Offen</span></div>'
      + (platten ? '<div><b>' + platten + '</b><span>' + (platten === 1 ? 'Platte' : 'Platten') + '</span></div>' : '')
      + '</div>'
    : '';

  return '<div class="t-status-card' + modifikator + '">'
    + '<div class="t-status-card-head">' + esc(kopf) + '</div>'
    + zahlen
    + '</div>';
}

/* ================================================================
   DRUCKBOEGEN — Markenuebernahme Etappe 9 (2026-08-26)
   ================================================================
   Der Drucken-Knopf rief bis zum 25.08. blank window.print(); seither
   gibt es ein @media-print-Layout, das den BILDSCHIRM graustufig aufs
   Papier legt. Das ist besser als nichts, aber es ist immer noch ein
   Bildschirmfoto: Filterleiste, Karten mit 90px Hoehe, Rahmen um jede
   Partie. Achtzehn Spiele fuellen so drei Seiten.

   Diese Funktionen bauen stattdessen BOEGEN — Markup, das es nur zum
   Drucken gibt:

     Bogen 1  Spielplan     A4 hoch,  nach Uhrzeit gegliedert,
                            offene Partien mit Eintragefeld
     Bogen 2  Gruppen       A4 hoch,  alle Tabellen auf einem Blatt
     Bogen 3  K.-o.-Phase   A4 quer,  echte Klammer mit Verbindern

   DREI REGELN, die den Unterschied ausmachen:

   1. PLATZ ZUM EINTRAGEN. Jede offene Partie hat "___ : ___", kein
      leeres Nichts. Das Blatt wird waehrend des Turniers mit dem Kuli
      ausgefuellt, nicht danach gelesen.
   2. KEIN TONER FUER FLAECHEN. Rangfarben werden zu Grauwerten und
      einer Legende. Auf einem Schwarz-Weiss-Drucker ist eine oranger
      und eine gruene Zeile dasselbe Grau — die Information waere weg.
   3. KOPF UND FUSS TRAGEN DEN STAND. Turniername, Datum, Ort und die
      Uhrzeit des Ausdrucks. Ein Blatt ohne Zeitstempel ist nach zwei
      Runden Muell, weil niemand weiss, ob es noch gilt.

   Die Boegen werden im Drucken-Tab als Vorschau gezeigt und beim
   Drucken als einziges ausgegeben. Was man sieht, kommt aus dem
   Drucker — sonst prueft niemand, ob der Ausdruck stimmt.
   ================================================================ */

/** Kopfzeile eines Bogens. */
function druckKopf(bogen, t, rechts) {
  const tour = t?.tournament ?? {};
  return `<div class="t-bogen-kopf">
    <div>
      <div class="t-bogen-marke">[kru:]nest · ${esc(bogen)}</div>
      <h3 class="t-bogen-titel">${esc(tour.name || 'Turnier')}</h3>
    </div>
    <div class="t-bogen-meta">${rechts}</div>
  </div>`;
}

/** Fusszeile: Stand und Herkunft. Ohne Zeitstempel ist ein Bogen wertlos. */
function druckFuss(t, seite, vonSeiten) {
  const jetzt = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const tag = new Date().toLocaleDateString('de-DE');
  return `<div class="t-bogen-fuss">
    <span>Stand ${esc(tag)} ${esc(jetzt)} · Seite ${seite} von ${vonSeiten}</span>
    <span>${esc(t?.tournament?.name || '')}</span>
  </div>`;
}

/**
 * Bogen 1 — Spielplan, nach Uhrzeit gegliedert.
 *
 * Eine Zeile je Partie statt einer Karte: achtzehn Spiele passen so auf
 * ein Blatt statt auf drei. Die Uhrzeit steht als Zwischenueberschrift,
 * damit sie nicht achtzehnmal wiederholt wird.
 */
function renderDruckSpielplan(t) {
  const spiele = Array.isArray(t?.matches) ? t.matches : [];
  if (!spiele.length) return '';

  const bloecke = [];
  const nachZeit = new Map();
  for (const m of spiele) {
    const zeit = m?.scheduledTime || '';
    if (!nachZeit.has(zeit)) { const b = { zeit, spiele: [] }; nachZeit.set(zeit, b); bloecke.push(b); }
    nachZeit.get(zeit).spiele.push(m);
  }

  const abschnitte = bloecke.map((b) => {
    const zeilen = b.spiele.map((m) => {
      const heim = m?.home?.name || '—';
      const gast = m?.away?.name || '—';
      const hat = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
      const ergebnis = hat ? `${m.scoreHome} : ${m.scoreAway}` : '___ : ___';
      return `<tr>
        <td class="l">${esc(m?.scheduledTime || '–')}</td>
        <td class="l">${m?.field != null ? esc(String(m.field)) : '–'}</td>
        <td class="l nm">${esc(heim)} — ${esc(gast)}</td>
        <td class="l">${esc(m?.label || '')}</td>
        <td class="r${hat ? '' : ' offen'}">${esc(ergebnis)}</td>
      </tr>`;
    }).join('');
    return `<div class="t-bogen-abschnitt">${esc(b.zeit || 'Ohne Termin')}${b.zeit ? ' Uhr' : ''}</div>
      <table class="t-bogen-tab">
        <colgroup><col style="width:12%"><col style="width:10%"><col><col style="width:12%"><col style="width:18%"></colgroup>
        <tbody>${zeilen}</tbody>
      </table>`;
  }).join('');

  const tour = t?.tournament ?? {};
  const rechts = [
    tour.startsAt ? new Date(tour.startsAt).toLocaleDateString('de-DE') : '',
    tour.location || '',
    `${spiele.length} Spiele`,
  ].filter(Boolean).join('<br>');

  return `<article class="t-bogen">
    ${druckKopf('Spielplan', t, rechts)}
    <div class="t-bogen-koerper">${abschnitte}</div>
    ${druckFuss(t, 1, 3)}
  </article>`;
}

/**
 * Bogen 2 — alle Gruppentabellen auf einem Blatt.
 *
 * Neun Spalten statt fuenf: auf Papier ist Platz, und wer den Aushang
 * liest, will die vollstaendige Bilanz sehen. Die Rangfarben werden zu
 * Grauwerten plus Legende, weil ein Schwarz-Weiss-Drucker Orange und
 * Gruen zum selben Grau macht.
 */
function renderDruckGruppen(t, qualifyPerGroup) {
  const gruppen = Array.isArray(t?.groups) ? t.groups : [];
  if (!gruppen.length) return '';
  const advance = Number.isInteger(qualifyPerGroup) && qualifyPerGroup > 0 ? qualifyPerGroup : 2;
  const fmtDiff = (n) => (n > 0 ? `+${n}` : `${n}`);

  const tabellen = gruppen.map((g) => {
    const zeilen = (g.standings || []).map((s, i) => {
      const rang = i + 1;
      const kl = rang === 1 ? ' class="lead"' : rang <= advance ? ' class="qual"' : '';
      const gf = s.goalsFor ?? 0, ga = s.goalsAgainst ?? 0;
      const gd = s.goalDiff ?? (gf - ga);
      return `<tr${kl}>
        <td class="l pl">${rang}</td>
        <td class="l nm">${esc(s.name || s.teamId || '—')}</td>
        <td class="r">${s.played ?? 0}</td>
        <td class="r">${s.won ?? 0}</td>
        <td class="r">${s.drawn ?? 0}</td>
        <td class="r">${s.lost ?? 0}</td>
        <td class="r">${gf}:${ga}</td>
        <td class="r">${fmtDiff(gd)}</td>
        <td class="r"><b>${s.points ?? 0}</b></td>
      </tr>`;
    }).join('');
    return `<div class="t-bogen-gruppe">
      <div class="t-bogen-abschnitt">${esc(g.groupName || g.groupKey || 'Gruppe')}</div>
      <table class="t-bogen-tab">
        <thead><tr>
          <th class="l">Pl</th><th class="l">Team</th><th class="r">Sp</th><th class="r">S</th>
          <th class="r">U</th><th class="r">N</th><th class="r">Becher</th><th class="r">Diff</th><th class="r">Pkt</th>
        </tr></thead>
        <tbody>${zeilen}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<article class="t-bogen">
    ${druckKopf('Gruppentabellen', t, `${gruppen.length} Gruppen`)}
    <div class="t-bogen-koerper t-bogen-raster">${tabellen}</div>
    <div class="t-bogen-legende">
      <span><b class="voll"></b>Platz 1</span>
      <span><b></b>${advance <= 2 ? 'Steigt auf (Platz 2)' : `Steigt auf (Plätze 2–${advance})`}</span>
      <span>Offene Partien tragen ein Eintragefeld</span>
    </div>
    ${druckFuss(t, 2, 3)}
  </article>`;
}

/**
 * Bogen 3 — der K.-o.-Baum als echte Klammer, quer.
 *
 * Das ist der Bogen, den es am Bildschirm bewusst NICHT gibt: dort ist
 * ein vollstaendiger Baum auf 390px unlesbar, deshalb zeigt die App
 * Runden nacheinander. Auf A4 quer ist der Platz da, und ein Aushang
 * ohne Klammer waere kein Turnierbaum.
 *
 * Geometrie: jede Runde ist eine Spalte, die Kaesten der naechsten
 * Runde sitzen mittig zwischen ihren beiden Vorgaengern. Der Abstand
 * verdoppelt sich pro Runde — das ist die ganze Rechnung.
 */
function renderDruckBaum(t) {
  const spiele = (Array.isArray(t?.matches) ? t.matches : []).filter((m) => m?.isKo || m?.stageType === 'ko');
  if (!spiele.length) return '';
  const { winnerBracket } = groupMatchesByRound(spiele);
  if (!winnerBracket.length) return '';

  const KB = 190, KH = 34, SPALTE = 232, RAND_X = 8, RAND_Y = 26;
  const ersteAnzahl = winnerBracket[0]?.matches?.length || 1;
  const ABST = 52 + KH;                    // Mittenabstand in Runde 1
  const hoehe = RAND_Y + ersteAnzahl * ABST + 20;
  const breite = RAND_X + winnerBracket.length * SPALTE + 150;

  const mittey = (runde, i) => RAND_Y + KH / 2 + (i * ABST * Math.pow(2, runde)) + (Math.pow(2, runde) - 1) * ABST / 2;

  const teile = [];
  winnerBracket.forEach((r, ri) => {
    const x = RAND_X + ri * SPALTE;
    teile.push(`<text x="${x}" y="16" class="rl">${esc(String(r.label || '').toUpperCase())}</text>`);
    (r.matches || []).forEach((m, mi) => {
      const cy = mittey(ri, mi);
      const y = cy - KH / 2;
      const hat = typeof m?.scoreHome === 'number' && typeof m?.scoreAway === 'number';
      const heim = m?.home?.name || '—';
      const gast = m?.away?.name || '—';
      const hs = hat ? String(m.scoreHome) : '___';
      const as = hat ? String(m.scoreAway) : '___';
      const heimSieger = hat && m.scoreHome > m.scoreAway;
      const offen = !hat;
      teile.push(`<g>
        <rect x="${x}" y="${y}" width="${KB}" height="${KH}" rx="2" class="${offen ? 'bxo' : 'bx'}"/>
        <line x1="${x}" y1="${cy}" x2="${x + KB}" y2="${cy}" class="cn"/>
        <text x="${x + 7}" y="${cy - 4}" class="${heimSieger || offen ? 'tn' : 'tp'}">${esc(heim)}</text>
        <text x="${x + KB - 7}" y="${cy - 4}" text-anchor="end" class="sc">${esc(hs)}</text>
        <text x="${x + 7}" y="${cy + 13}" class="${!heimSieger || offen ? 'tn' : 'tp'}">${esc(gast)}</text>
        <text x="${x + KB - 7}" y="${cy + 13}" text-anchor="end" class="sc">${esc(as)}</text>
      </g>`);
      // Verbinder zur naechsten Runde
      if (ri < winnerBracket.length - 1) {
        const zielY = mittey(ri + 1, Math.floor(mi / 2));
        const xm = x + KB + 20;
        teile.push(`<path d="M${x + KB} ${cy}H${xm}V${zielY}h20" class="cn" fill="none"/>`);
      }
    });
  });

  // Titel-Kasten
  const letzteX = RAND_X + (winnerBracket.length - 1) * SPALTE;
  const titelY = mittey(winnerBracket.length - 1, 0);
  teile.push(`<path d="M${letzteX + KB} ${titelY}h30" class="flare" fill="none" stroke-dasharray="7 5"/>`);
  teile.push(`<rect x="${letzteX + KB + 34}" y="${titelY - KH / 2}" width="130" height="${KH}" rx="2" class="flare" fill="none"/>`);
  teile.push(`<text x="${letzteX + KB + 42}" y="${titelY - 4}" class="rl flare-t">SIEGER</text>`);
  teile.push(`<line x1="${letzteX + KB + 42}" y1="${titelY + 10}" x2="${letzteX + KB + 156}" y2="${titelY + 10}" class="flare"/>`);

  return `<article class="t-bogen t-bogen--quer">
    ${druckKopf('K.-o.-Phase', t, `${winnerBracket.length} Runden`)}
    <div class="t-bogen-koerper t-bogen-baum">
      <svg viewBox="0 0 ${breite} ${hoehe}" role="img" aria-label="Turnierbaum">${teile.join('')}</svg>
    </div>
    <div class="t-bogen-legende">
      <span>Durchgezogener Rahmen: gespielt · gestrichelter: offen</span>
      <span>Offene Partien tragen ein Eintragefeld</span>
    </div>
    ${druckFuss(t, 3, 3)}
  </article>`;
}

/**
 * Alle drei Boegen. Leere Boegen fallen weg — ein Turnier ohne
 * K.-o.-Phase soll kein leeres Blatt drucken.
 */
export function renderDruckboegen(t, qualifyPerGroup) {
  const teile = [
    renderDruckSpielplan(t),
    renderDruckGruppen(t, qualifyPerGroup),
    renderDruckBaum(t),
  ].filter(Boolean);
  if (!teile.length) {
    return '<p class="t-hint">Noch nichts zu drucken — der Spielplan wird erst erzeugt.</p>';
  }
  return `<div class="t-druck">${teile.join('')}</div>`;
}

export const bracket = {
  groupMatchesByRound,
  renderMatchCardBracket,
  renderBracket,
  serializeTeamsList,
  renderTeamsList,
};

// ───────────────────────────────────────────────────────────────
// Teams-Tab (Etappe B.5)
// Reine Render- und Sanitize-Funktionen. DnD-/Inline-Rename-Logik
// lebt in main.js, weil sie DOM + State braucht. Diese Pure-Functions
// werden vom Frontend-Renderer UND vom DnD-Save-Branch gerufen, um
// den `order`-Array aus der gerenderten Liste zu lesen.
// ───────────────────────────────────────────────────────────────

/**
 * Sanitize Team-DTOs für den Teams-Tab.
 *
 *   - wirft `null`/`undefined`-Items raus
 *   - trimmed den Namen
 *   - ersetzt leere Namen durch "Team" (Render-Fallback, kein User-Input)
 *   - normalisiert color zu String oder null
 *   - seed: null → Index im Array (Fallback, falls Backend noch keinen
 *     seed vergeben hat — z.B. ganz frisches Turnier)
 *   - sortiert nach seed asc (oder bei null nach Index-Reihenfolge)
 *
 * @param {Array} teams — TeamDTO[] aus `prepareTeamList()`.
 * @returns {Array} — bereinigte Liste, sortiert.
 */
export function serializeTeamsList(teams) {
  if (!Array.isArray(teams)) return [];
  const out = [];
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    if (t == null) continue;
    const name = String(t.name ?? '').trim() || 'Team';
    const color = (typeof t.color === 'string' && t.color.trim()) ? t.color.trim() : null;
    const seed = (typeof t.seed === 'number' && Number.isFinite(t.seed)) ? t.seed : i;
    out.push({
      id: String(t.id ?? ''),
      name,
      color,
      logoUrl: (typeof t.logoUrl === 'string' && t.logoUrl) ? t.logoUrl : null,
      players: Array.isArray(t.players) ? t.players : null,
      seed,
    });
  }
  // Stabil nach seed asc sortieren. Bei gleichem seed (alle null→Index)
  // bleibt die Reihenfolge via stable sort erhalten.
  return out.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
}

/**
 * Teams-Tab Renderer (Etappe B.5).
 *
 * Liefert ein `<ul class="t-teams-list">` mit einem `<li>` pro Team.
 * Jede Row hat:
 *   - data-team-id, data-team-name, data-seed
 *   - Drag-Handle (☰) für DnD (nur sichtbar wenn Admin + reorderable)
 *   - Logo/Initial als visueller Marker
 *   - Name (Editier-Hint bei Admin: "Klicken zum Bearbeiten")
 *
 * Wenn `opts.isAdmin === false`: DnD-Handle + Edit-Hint weg, Liste ist read-only.
 * Wenn `opts.reorderable === false`: DnD disabled (z.B. Status !== 'draft').
 *
 * @param {Array} teams — rohe TeamDTO[] (wird intern serialisiert)
 * @param {Object} [opts]
 * @param {boolean} [opts.isAdmin=false]
 * @param {boolean} [opts.reorderable=false]
 * @returns {string} HTML-String
 */
export function renderTeamsList(teams, opts = {}) {
  const items = serializeTeamsList(teams);
  const { isAdmin = false, reorderable = false } = opts;
  const canEdit = isAdmin && reorderable;

  if (items.length === 0) {
    return '<p class="t-hint">Noch keine Teams angelegt. Lege sie im Wizard unter „Teams" an.</p>';
  }

  const editHint = canEdit
    ? '<span class="t-team-edit-hint">Klicken zum Umbenennen</span>'
    : '';

  const rows = items.map((t, idx) => {
    const initial = String(t.name).trim().charAt(0).toUpperCase() || '?';
    const colorStyle = t.color ? `background:${esc(t.color)};color:#fff;` : '';
    const seedLabel = (typeof t.seed === 'number') ? `#${t.seed + 1}` : '';
    const handle = canEdit
      ? '<span class="t-team-drag-handle" aria-label="Verschieben" title="Ziehen zum Sortieren">☰</span>'
      : '<span class="t-team-drag-handle is-readonly" aria-hidden="true"></span>';
    const row = `<li class="t-team-row${canEdit ? ' is-draggable' : ''}" data-team-id="${esc(t.id)}" data-team-name="${esc(t.name)}" data-seed="${idx}">
      ${handle}
      <span class="t-team-marker" style="${colorStyle}" aria-hidden="true">${esc(initial)}</span>
      <span class="t-team-name" data-role="team-name">${esc(t.name)}</span>
      <span class="t-team-seed">${esc(seedLabel)}</span>
      ${editHint}
    </li>`;
    return row;
  }).join('');

  const hint = !reorderable && isAdmin
    ? '<p class="t-hint t-hint--info">Die Reihenfolge ist gesperrt, weil der Spielplan bereits generiert wurde.</p>'
    : (!isAdmin
      ? '<p class="t-hint t-hint--info">Nur Admins können die Reihenfolge ändern.</p>'
      : '');

  return `${hint}<ul class="t-teams-list${canEdit ? ' is-draggable' : ''}" data-role="teams-list">${rows}</ul>`;
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
    applyPropagatedMatches,
    renderStandingsGroups,
    renderBestThirdsTable,
    setCompactMode,
    getCompactMode,
    ensureTModResizeObserver,
    detachTModResizeObserver,
    bracket: {
      groupMatchesByRound,
      renderMatchCardBracket,
      renderBracket,
    },
    serializeTeamsList,
    renderTeamsList,
    resolveConfirmDescriptor,
    renderEinstellungen,
    // Die Druckboegen laufen ueber window, weil main.js sie im
    // Tab-Side-Effect braucht und dort kein ES-Import steht.
    renderDruckboegen,
    renderGroupsBoard,
    serializeGroupsInput,
    renderFieldsEditor,
    serializeFieldsInput,
    resolveFieldName,
    serializeScheduleInput,
  };
}

// ─────────────────────────────────────────────────────────────────
// Etappe B.8 — Einstellungen-Tab Renderer (klappbar + status-aware)
// ─────────────────────────────────────────────────────────────────

/**
 * Etappe B.8: Einstellungen-Tab-Renderer mit klappbaren Blöcken.
 *
 * - Lock-Logik via `window.tournamentLocks` (UMD-Export aus
 *   backend/src/modules/tournament/locks.js) — eine Wahrheit, zwei
 *   Aufrufer.
 * - Status-aware Default-Block offen:
 *     draft: Aktionen + Spielfelder + Gefahrenzone
 *     generated + startedAt null (BEREIT): Aktionen + Gruppen + Seeding + Felder + Gefahr
 *     startedAt != null (LÄUFT): Aktionen (mit Zurück) + Felder + Gefahr
 *     finished: nur Gefahrenzone
 * - Revert-Banner (D8): wenn startedAt === null && status === 'draft'
 *   und matches existieren → Hinweis: „Spielplan aus letztem Durchlauf
 *   noch da".
 * - Reason-Texte aus canEdit werden inline neben gesperrten Feldern
 *   angezeigt (User-Anmerkung 2026-08-20).
 *
 * @param {Object} t  Tournament-View-Context (aus /api/tournaments/:id)
 * @param {Object} opts
 *   - isAdmin: boolean
 *   - finishedCount: number
 * @returns {string} HTML
 */
export function renderEinstellungen(t, opts = {}) {
  const { isAdmin = false, finishedCount = 0 } = opts;
  const status = t?.tournament?.status ?? 'draft';
  const startedAt = t?.tournament?.startedAt ?? null;
  const isFinished = status === 'finished';
  const isStarted = startedAt !== null;
  const groups = t?.groups ?? [];
  const teams = t?.teams ?? [];
  const fields = t?.tournament?.config?.fields ?? [];
  const matches = t?.matches ?? [];

  // Lock-Status aus dem UMD-Single-Source-of-Truth.
  // Fallback: einfache Inline-Logik, falls locks.js noch nicht geladen
  // ist (z.B. in Tests).
  const locks = (typeof window !== 'undefined' && window.tournamentLocks)
    ? window.tournamentLocks
    : null;
  const lockState = locks
    ? locks.lockStateFor({ status, startedAt }, finishedCount)
    : null;
  // canEditTeams.allowed ist false wenn Sperre, dann .reason zeigen.
  const canEditGroups = lockState ? lockState.canEditGroups : { allowed: !isFinished && !isStarted, reason: null };
  const canEditFields = lockState ? lockState.canEditFields : { allowed: !isFinished, reason: null };
  const canEditTimes = lockState ? lockState.canEditTimes : { allowed: !isFinished, reason: null };
  const canRedraw = lockState ? lockState.canRedraw : { allowed: !isFinished, reason: null };
  const canStart = lockState ? lockState.canStart : { allowed: status === 'generated' && !isStarted, reason: null };
  const canRevert = lockState ? lockState.canRevertToDraft : { allowed: false, reason: null };
  const canEditResults = lockState ? lockState.canEditResults : { allowed: !isFinished, reason: null };
  const canShift = lockState ? lockState.canShiftMatches : { allowed: !isFinished, reason: null };
  const canReschedule = lockState ? lockState.canReschedule : { allowed: !isFinished, reason: null };

  // Status-aware Default-offen (D6).
  const isDraft = status === 'draft';
  const isGenerated = status === 'generated' && !isStarted;
  const isRunning = isStarted && !isFinished;
  const defaultOpen = {
    actions: true, // Aktionen immer sichtbar (Knöpfe sind der Hauptzweck)
    groups: isGenerated,
    seeding: isGenerated,
    fields: true, // Felder bleiben in BEREIT + LÄUFT offen
    'danger-zone': !isDraft, // Gefahrenzone read-only-Indikator
  };
  if (isFinished) {
    // Beendet: nur Gefahrenzone offen.
    defaultOpen.actions = true;
    defaultOpen.groups = false;
    defaultOpen.seeding = false;
    defaultOpen.fields = false;
  }
  if (isRunning) {
    defaultOpen.groups = false;
    defaultOpen.seeding = false;
  }

  // Block 1 — Aktionen
  const actionsBlock = renderActionsBlock({
    t, isAdmin, isDraft, isGenerated, isRunning, isFinished,
    canStart, canRevert, canShift, canReschedule, canEditResults,
    finishedCount, matches,
  });

  // Block 2 — Gruppeneinteilung
  //
  // Etappe B.8 (User-Feedback 2026-08-20): DnD mit beliebigem Move
  // verletzt die User-Anforderung „Teams tauschen, Gruppengröße gleich".
  // Daher ist die Board-Read-Only — die Mischung läuft über den Button
  // „Zufällig verteilen" (Backend: balance-shuffle-groups).
  const groupsBoard = renderGroupsBoard(groups, teams, {
    isAdmin,
    reorderable: false,
  });

  // Block 3 — Setzreihenfolge
  const teamsList = renderTeamsList(teams, {
    isAdmin,
    reorderable: isAdmin && canRedraw.allowed,
  });
  const redrawButton = isAdmin && canRedraw.allowed
    ? `<div class="t-settings-actions">
         <button class="t-btn t-btn--ghost" data-action="redraw-seeding" type="button">Neu auslosen</button>
       </div>
       <div class="t-hint t-hint--info">Mischt nur die Setzreihenfolge (KO-Seed). Die Gruppenzuordnung bleibt unverändert — dafür gibt es „Zufällig verteilen" weiter oben.</div>`
    : '';
  const redrawReason = isAdmin && !canRedraw.allowed
    ? `<div class="t-hint t-hint--info">${esc(canRedraw.reason ?? 'Sperrt, solange das Turnier läuft.')}</div>`
    : '';

  // Block 4 — Spielfelder
  const fieldsEditor = renderFieldsEditor(fields, {
    locked: !canEditFields.allowed,
    isAdmin,
  });
  const fieldsReason = isAdmin && !canEditFields.allowed
    ? `<div class="t-hint t-hint--info">${esc(canEditFields.reason ?? 'Spielfelder sind gesperrt.')}</div>`
    : '';

  // Block 5 — Notfall (2026-08-26, Entscheid Jonas)
  //
  // "ko phase starten sollte ja automatisch passieren, wenn gruppenphase
  //  durch ist. daher mach den gruppenphase starten button lieber in
  //  einstellungen, als notfallknopf wenns nicht geht aus irgendeinem grund."
  //
  // Der Knopf stand bis hierher als grosser Aufruf UNTER den
  // Gruppentabellen — an der Stelle, an der man Ergebnisse liest, nicht
  // an der man Dinge repariert. Und er stand da nur dann, wenn der
  // Automatik-Weg versagt hatte, also ausgerechnet in dem Moment, in dem
  // niemand mit einer Aufforderung rechnet.
  //
  // Hier ist er dauerhaft und klein. Das ist Absicht: ein Notfallknopf,
  // den man nur im Notfall SIEHT, findet man im Notfall nicht. Ist nichts
  // zu tun, antwortet die Route mit "bereits gefuellt" — die Wahrheit
  // darueber liegt im Server, nicht in einer Bedingung im Frontend, die
  // hier ohnehin nur geraten waere.
  // Einstieg in den Spielplan-Edit-Modus (Zeit und Platte je Spiel).
  // Entscheid Jonas 2026-08-26: "bearbeiten kann auch weg das mach ich
  // als admin ja in den einstellungen." Der Knopf ist aus dem
  // Spielplan-Kopf verschwunden — und der Selektor-Drift-Detektor hat
  // sofort gemeldet, dass die Handler ihn noch suchen. Ohne diesen
  // Einstieg hier waere der Edit-Modus unerreichbar geworden: die Funktion
  // haette weiter existiert, nur haette sie niemand mehr aufrufen koennen.
  const spielplanEdit = isAdmin
    ? `
      <div class="t-settings-actions">
        <button class="t-btn t-btn--ghost t-btn--klein" data-action="toggle-schedule-edit" type="button">Spielzeiten bearbeiten</button>
      </div>
      <div class="t-hint t-hint--info">Zeit und Platte einzelner Spiele ändern. Öffnet den Spielplan im Bearbeiten-Modus.</div>
    `
    : '';

  const notfallZone = isAdmin
    ? `
      <section class="t-settings-section" data-section="notfall" data-collapsed="true">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="false">
          <span class="t-settings-section-title">Notfall</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">
          <div class="t-settings-actions">
            <button class="t-btn t-btn--ghost t-btn--klein" data-action="start-ko-phase" type="button">K.-o.-Phase aus den Gruppen füllen</button>
          </div>
          <div class="t-hint t-hint--info">Passiert normalerweise von selbst, sobald das letzte Gruppenspiel eingetragen ist. Dieser Knopf ist für den Fall, dass es das nicht getan hat.</div>
        </div>
      </section>
    `
    : '';

  // Block 6 — Gefahrenzone
  const dangerZone = isAdmin
    ? `
      <section class="t-settings-section t-danger-zone" data-section="danger-zone" data-collapsed="${!defaultOpen['danger-zone']}">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="${defaultOpen['danger-zone']}">
          <span class="t-settings-section-title">Gefahrenzone</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">
          <div class="t-danger-zone-actions">
            <button class="t-btn t-btn--danger" data-action="reset-results" type="button" ${isFinished ? '' : 'disabled'}>Alle Ergebnisse löschen</button>
            <button class="t-btn t-btn--danger" data-action="delete-tournament" type="button">Turnier löschen</button>
          </div>
          <div class="t-hint t-hint--info">Diese Aktionen verlangen die Eingabe des Turniernamens zur Bestätigung.</div>
        </div>
      </section>
    `
    : '';

  return `
    <div class="t-settings-grid">
      ${renderStatusKarte({ t, status, isStarted, isFinished, matches, fields })}
      ${actionsBlock}
      <section class="t-settings-section" data-section="groups" data-collapsed="${!defaultOpen.groups}">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="${defaultOpen.groups}">
          <span class="t-settings-section-title">Gruppeneinteilung</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">
          ${groupsBoard}
          ${isAdmin && canEditGroups.allowed
            ? '<div class="t-hint t-hint--info">Achtung: Die Match-Paarungen wurden bei der Generierung festgelegt. DnD ändert nur die Anzeige der Gruppentabellen — die Spielpaarungen bleiben gleich.</div>'
            : ''}
          ${isAdmin && !canEditGroups.allowed
            ? `<div class="t-hint t-hint--info">${esc(canEditGroups.reason ?? 'Gruppeneinteilung ist gesperrt.')}</div>`
            : ''}
        </div>
      </section>
      <section class="t-settings-section" data-section="seeding" data-collapsed="${!defaultOpen.seeding}">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="${defaultOpen.seeding}">
          <span class="t-settings-section-title">Setzreihenfolge</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">
          ${teamsList}
          ${redrawButton ? `<div class="t-settings-actions">${redrawButton}</div>` : ''}
          ${redrawReason}
        </div>
      </section>
      <section class="t-settings-section" data-section="fields" data-collapsed="${!defaultOpen.fields}">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="${defaultOpen.fields}">
          <span class="t-settings-section-title">Spielfelder</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">
          ${fieldsEditor}
          ${canEditFields.allowed
            ? '<div class="t-hint t-hint--info">Spielfeld-Namen erscheinen auf Ausdruck und Beamer. Auch in laufenden Turnieren noch änderbar (z.B. „Platte 3" → „Beach Court").</div>'
            : ''}
          ${fieldsReason}
        </div>
      </section>
      ${renderLogoBlock({ t, isAdmin })}
      ${renderZuschauerLinkBlock({ t, isAdmin, isDraft, defaultOpen: !isDraft })}
      ${spielplanEdit ? `
      <section class="t-settings-section" data-section="spielbetrieb" data-collapsed="true">
        <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="false">
          <span class="t-settings-section-title">Spielbetrieb</span>
          <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
        </button>
        <div class="t-settings-section-body">${spielplanEdit}</div>
      </section>` : ''}
      ${notfallZone}
      ${dangerZone}
    </div>
  `;
}

/**
 * Block — Turnierlogo.
 *
 * Bis zum 26.08.2026 ließ sich ein Logo NUR im Wizard setzen. Wer nach dem
 * Erstellen eines nachreichen oder tauschen wollte, hatte keinen Weg —
 * die Route gab es, den Einstieg nicht.
 *
 * Anders als beim Zuschauer-Link gibt es hier keinen Entwurfs-Sonderfall:
 * Ein Logo darf in jedem Status gesetzt werden, auch im laufenden Turnier.
 * Es ändert keine Paarung und kein Ergebnis — es steht auf dem Ausdruck
 * und im Kopf der Ansicht.
 *
 * Der Server nimmt PNG, JPEG und WebP, verkleinert selbst auf 512 px und
 * schreibt immer PNG. Das `accept` unten spiegelt seine Allowlist; SVG ist
 * dort bewusst gesperrt, weil eine Vektordatei Skripte tragen kann.
 */
function renderLogoBlock({ t, isAdmin }) {
  if (!isAdmin) return '';

  const tour = t?.tournament ?? {};
  const hatLogo = typeof tour.logoUrl === 'string' && tour.logoUrl.length > 0;

  // Der Dateiname am Server ist für alle Turniere gleich („logo"), die
  // Adresse also auch. Nach einem Austausch zeigt der Browser sonst das
  // alte Bild aus seinem Zwischenspeicher. Der Zeitstempel wird beim
  // Rendern gesetzt und ändert sich mit jedem Neuaufbau nach dem Upload.
  const bildUrl = hatLogo
    ? `${esc(tour.logoUrl)}${tour.logoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
    : '';

  const body = hatLogo
    ? `
      <div class="t-settings-actions" style="align-items:center">
        <img src="${bildUrl}" alt="Aktuelles Turnierlogo"
             style="width:72px;height:72px;object-fit:contain;background:var(--panel,#fff);border:1px solid var(--line);border-radius:8px;padding:5px;flex:none">
        <button class="t-btn t-btn--ghost" data-action="upload-logo" type="button">Logo austauschen</button>
        <button class="t-btn t-btn--danger" data-action="remove-logo" type="button">Entfernen</button>
      </div>
      <div class="t-hint t-hint--info">
        Erscheint im Kopf des Turniers, auf dem Ausdruck und auf der
        Zuschauer-Seite.
      </div>
    `
    : `
      <div class="t-settings-actions">
        <button class="t-btn t-btn--primary" data-action="upload-logo" type="button">Logo hochladen</button>
      </div>
      <div class="t-hint t-hint--info">
        PNG, JPEG oder WebP, bis 5 MB. Größere Bilder werden automatisch auf
        512 Pixel verkleinert.
      </div>
    `;

  return `
    <section class="t-settings-section" data-section="logo" data-collapsed="true">
      <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="false">
        <span class="t-settings-section-title">Turnierlogo</span>
        <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
      </button>
      <div class="t-settings-section-body">
        ${body}
        <input type="file" hidden data-logo-file-input
               accept="image/png,image/jpeg,image/webp">
      </div>
    </section>
  `;
}

/**
 * Block — Zuschauer-Link (Spec §11, Stufe B).
 *
 * Zeigt genau einen der drei Zustände:
 *
 *   Entwurf   → erklärt, warum es noch nicht geht (statt einen toten Knopf)
 *   aus       → ein Knopf, der ihn erteilt
 *   an        → der Link zum Kopieren, plus Widerruf
 *
 * Der Widerruf steht bewusst NICHT in der Gefahrenzone: Er löscht keine
 * Daten, und wer einen Link zurücknehmen will, soll ihn dort finden, wo
 * er ihn erteilt hat.
 */
function renderZuschauerLinkBlock({ t, isAdmin, isDraft, defaultOpen }) {
  if (!isAdmin) return '';

  const tour = t?.tournament ?? {};
  const istOeffentlich = tour.isPublic === true && !!tour.publicToken;
  const linkPfad = istOeffentlich ? `/t/${tour.publicToken}` : '';
  // `typeof window` allein genügt nicht: In einer Testumgebung kann ein
  // window-Objekt ohne `location` stehen, und ein Griff auf .origin würde
  // dann den GESAMTEN Einstellungen-Tab mitreißen — für eine Zeile, die
  // notfalls auch als Pfad ohne Host brauchbar ist.
  const herkunft =
    typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : '';
  const volleUrl = istOeffentlich ? `${herkunft}${linkPfad}` : '';

  let body;
  if (isDraft) {
    body = `
      <div class="t-hint t-hint--info">
        Solange das Turnier ein Entwurf ist, gibt es keinen Zuschauer-Link.
        Generiere zuerst den Spielplan.
      </div>
    `;
  } else if (istOeffentlich) {
    body = `
      <div class="t-settings-actions">
        <!-- Bewusst mit vorhandenen Klassen und einem Inline-Flex statt
             einer eigenen Regel: tournament.css wird parallel umgebaut
             (Markenübernahme), und ein Block, der ohne neues CSS
             auskommt, kann dort nicht kollidieren. -->
        <input class="t-input" type="text" readonly
               style="flex:1;min-width:0"
               value="${esc(volleUrl)}" data-public-url
               aria-label="Zuschauer-Link">
        <button class="t-btn t-btn--ghost" data-action="copy-public-link" type="button">Kopieren</button>
      </div>
      <div class="t-hint t-hint--info">
        Wer diesen Link hat, sieht Tabellen, Spielplan und Ergebnisse —
        ohne Konto und ohne etwas ändern zu können. Spielernamen werden
        nicht mit veröffentlicht.
      </div>
      <div class="t-settings-actions" style="align-items:center">
        <img src="/api/tournaments/public/${encodeURIComponent(tour.publicToken)}/qr.svg"
             alt="QR-Code zum Zuschauer-Link"
             width="104" height="104"
             style="width:104px;height:104px;background:#fff;border-radius:6px;padding:5px;flex:none">
        <button class="t-btn t-btn--ghost" data-action="open-aushang" type="button">Aushang zum Drucken</button>
      </div>
      <div class="t-hint t-hint--info">
        Der Aushang ist ein Blatt mit großem QR-Code für den Tresen.
      </div>
      <div class="t-settings-actions">
        <button class="t-btn t-btn--danger" data-action="revoke-public-link" type="button">Link widerrufen</button>
      </div>
      <div class="t-hint t-hint--info">
        Ein Widerruf macht den Link sofort ungültig — endgültig. Eine
        spätere Freigabe erzeugt einen neuen Link, der alte bleibt tot.
      </div>
    `;
  } else {
    body = `
      <div class="t-settings-actions">
        <button class="t-btn t-btn--primary" data-action="create-public-link" type="button">Zuschauer-Link erstellen</button>
      </div>
      <div class="t-hint t-hint--info">
        Erzeugt eine Adresse, unter der jeder den Turnierstand mitlesen
        kann — für den Aushang am Tresen oder die Gruppe im Messenger.
      </div>
    `;
  }

  return `
    <section class="t-settings-section" data-section="public-link" data-collapsed="${!defaultOpen}">
      <button class="t-settings-section-header" type="button" data-action="toggle-section" aria-expanded="${!!defaultOpen}">
        <span class="t-settings-section-title">Zuschauer-Link</span>
        <span class="t-settings-section-toggle" aria-hidden="true">▾</span>
      </button>
      <div class="t-settings-section-body">
        ${body}
      </div>
    </section>
  `;
}

/**
 * Block 1 — Aktionen. Enthält: Turnier starten / Zurück zu Entwurf /
 * Turnier abschließen / Offene Spiele verschieben / Zeitplan neu
 * berechnen.
 */
function renderActionsBlock(ctx) {
  const {
    t, isAdmin, isDraft, isGenerated, isRunning, isFinished,
    canStart, canRevert, canShift, canReschedule, canEditResults,
    finishedCount, matches,
  } = ctx;
  if (!isAdmin) {
    return `
      <section class="t-settings-section" data-section="actions" data-collapsed="false">
        <div class="t-settings-section-title">Aktionen</div>
        <div class="t-hint t-hint--info">Nur Admins dürfen Aktionen ausführen.</div>
      </section>
    `;
  }

  // Revert-Banner (D8): wenn draft + matches existieren, war das Turnier
  // schon mal im LÄUFT und wurde zurückgesetzt.
  const hasMatches = Array.isArray(matches) && matches.length > 0;
  const showRevertBanner = isDraft && hasMatches;
  const banner = showRevertBanner
    ? `<div class="t-banner t-banner--warning">
        <strong>Spielplan aus dem letzten Durchlauf noch da.</strong>
        Du kannst Teams und Gruppen ändern. Klicke „Zeitplan neu berechnen", wenn du die Zeiten anpassen willst, oder „Turnier starten", wenn die alten Zeiten passen.
      </div>`
    : '';

  // Knöpfe nach Status.
  let buttons = '';

  if (canStart.allowed) {
    buttons += '<button class="t-btn t-btn--primary" data-action="start-tournament" type="button">Turnier starten</button>';
  } else if (isGenerated && !canStart.allowed) {
    buttons += `<button class="t-btn t-btn--primary" data-action="start-tournament" type="button" disabled>Turnier starten</button>`;
  }

  if (canRevert.allowed) {
    buttons += '<button class="t-btn t-btn--ghost" data-action="revert-to-draft" type="button">Zurück zu Entwurf</button>';
  }

  // Offene Spiele verschieben (turnier-day use case).
  if (canShift.allowed && (isRunning || isGenerated || isDraft && hasMatches)) {
    buttons += `
      <div class="t-shift-form">
        <label class="t-shift-form-label">
          Offene Spiele verschieben:
          <input class="t-shift-minutes" type="number" value="0" step="5" data-shift-minutes>
          min
        </label>
        <button class="t-btn t-btn--ghost" data-action="shift-open" type="button">Verschieben</button>
        <div class="t-hint t-hint--info">Funktioniert nur für Spiele mit Status „geplant".</div>
      </div>
    `;
  }

  // Spieldauer + Plattenzahl → auto-reschedule.
  if (canReschedule.allowed && (isRunning || isGenerated)) {
    const duration = t?.tournament?.config?.schedule?.matchDurationMinutes ?? 30;
    const parallelFields = t?.tournament?.config?.schedule?.parallelFields ?? 4;
    buttons += `
      <div class="t-reschedule-form">
        <label class="t-reschedule-row">Spieldauer:
          <input class="t-reschedule-duration" type="number" min="5" max="240" value="${duration}" data-reschedule-duration> min
        </label>
        <label class="t-reschedule-row">Platten:
          <input class="t-reschedule-fields" type="number" min="1" max="12" value="${parallelFields}" data-reschedule-fields>
        </label>
        <button class="t-btn t-btn--primary" data-action="reschedule-auto" type="button">Zeitplan neu berechnen</button>
        <div class="t-hint t-hint--info">Ändert alle Spielzeiten automatisch gemäß Dauer und Plattenanzahl. Bei vorhandenen Ergebnissen werden Zeiten verschoben, Scores bleiben erhalten.</div>
      </div>
    `;
  }

  if (!isFinished) {
    buttons += '<button class="t-btn t-btn--ghost" data-action="finish-tournament" type="button">Turnier abschließen</button>';
  }

  // Status-Hint (Anzahl beendete Spiele).
  const statusHint = finishedCount > 0
    ? `<div class="t-hint t-hint--info">${finishedCount} Spiel${finishedCount === 1 ? '' : 'e'} bereits beendet.</div>`
    : '';

  return `
    <section class="t-settings-section" data-section="actions" data-collapsed="false">
      <div class="t-settings-section-title">Aktionen</div>
      <div class="t-settings-actions">
        ${banner}
        ${buttons}
        ${statusHint}
      </div>
    </section>
  `;
}

/**
 * Etappe B.7 Block 2: Groups-Board.
 *
 * Etappe B.8.1 (2026-08-20): User-Forderung „Ich will nur einen Teamtausch
 * ermöglichen. Wenn drag and drop dafür nicht gut ist, schlag mir eine
 * andere Option vor." — Paar-Klick-Tausch. Teams sind KEINE Drag-Source
 * mehr, sondern Klick-Targets. Erstes Klick → blau markiert, zweites
 * Klick (zwingend aus anderer Gruppe) → Tausch-Bar mit „X ↔ Y tauschen".
 * DnD ist entfernt. `reorderable` bleibt für Abwärtskompatibilität im
 * Parameter, wird aber ignoriert.
 *
 * @param {Array} groups - [{ id, key, name, members: [{ teamId, name, color }] }]
 * @param {Array} teams - flat Team-Liste (Fallback)
 * @param {Object} opts
 * @returns {string} HTML
 */
export function renderGroupsBoard(groups, teams, opts = {}) {
  const { isAdmin = false } = opts;
  const groupCount = Array.isArray(groups) ? groups.length : 0;
  if (groupCount === 0) {
    return '<div class="t-hint">Noch keine Gruppen — Turnier muss generiert sein.</div>';
  }
  const columns = groups
    .map((g) => {
      const members = (g?.members ?? []).map((m) => {
        const dotColor = m.color || '#999';
        // Etappe B.8.1: data-action="select-for-swap" nur für Admin.
        // Member sehen das Board read-only (kein Action-Attribut).
        const actionAttr = isAdmin ? 'data-action="select-for-swap"' : '';
        return `
          <li class="t-group-team-card" data-team-id="${esc(m.teamId)}" data-team-name="${esc(m.name ?? '')}" data-team-color="${esc(dotColor)}" data-group-key="${esc(g.key)}" ${actionAttr}>
            <span class="t-group-team-card-dot" style="background:${esc(dotColor)};"></span>
            <span class="t-group-team-card-name">${esc(m.name ?? 'Team')}</span>
          </li>
        `;
      }).join('');
      return `
        <div class="t-groups-column" data-group-key="${esc(g.key)}" data-group-id="${esc(g.id)}">
          <div class="t-groups-column-header">
            <span>${esc(g.name ?? g.key ?? 'Gruppe')}</span>
            <span class="t-group-count">${g.members?.length ?? 0}</span>
          </div>
          <ul class="t-groups-column-list" data-role="groups-column-list">${members}</ul>
        </div>
      `;
    })
    .join('');

  return `
    <div class="t-groups-board" data-role="groups-board" data-group-count="${groupCount}" style="--group-count:${groupCount};">
      ${columns}
    </div>
    ${isAdmin ? `<div class="t-swap-bar" data-role="swap-bar" hidden>
      <span class="t-swap-bar-label" data-role="swap-bar-label">Tausch:</span>
      <button class="t-btn t-btn--primary" data-action="confirm-swap" type="button" disabled>Tauschen</button>
      <button class="t-btn t-btn--ghost" data-action="cancel-swap" type="button">Abbrechen</button>
    </div>` : ''}
    <div class="t-hint t-hint--info">
      ${isAdmin
        ? 'Klicke auf zwei Teams aus verschiedenen Gruppen, um sie zu tauschen — Gruppengrößen bleiben gleich. „Zufällig verteilen" mischt alle neu.'
        : 'Die Gruppeneinteilung wird vom Turnier verwaltet. „Zufällig verteilen" mischt die Teams neu — Gruppengrößen bleiben gleich.'}
    </div>
    ${isAdmin ? `<div class="t-settings-actions">
      <button class="t-btn t-btn--primary" data-action="randomize-groups" type="button">Zufällig verteilen</button>
    </div>` : ''}
  `;
}

/**
 * Etappe B.7: Liest den DOM-State des Groups-Boards und baut den
 * PATCH /:id/groups-Body. Sanitize: leere Gruppen + fehlende Teams +
 * doppelte Teams werden abgelehnt (Pre-Validation, damit das Frontend
 * nicht in einen 400er läuft).
 *
 * @param {HTMLElement} boardEl
 * @returns {{ ok: true, groups: [{ key, teamIds: string[] }] } | { ok: false, error: string }}
 */
export function serializeGroupsInput(boardEl) {
  if (!boardEl) return { ok: false, error: 'board fehlt' };
  const columns = Array.from(boardEl.querySelectorAll('[data-group-key]'));
  if (columns.length === 0) return { ok: false, error: 'keine Spalten' };
  const seen = new Set();
  const out = [];
  for (const col of columns) {
    const key = col.getAttribute('data-group-key');
    const teamIds = Array.from(col.querySelectorAll('.t-group-team-card')).map(
      (card) => card.getAttribute('data-team-id')
    );
    if (teamIds.length === 0) {
      return { ok: false, error: `Gruppe "${key}" hat keine Teams` };
    }
    for (const id of teamIds) {
      if (seen.has(id)) {
        return { ok: false, error: `Team "${id}" ist in mehreren Gruppen` };
      }
      seen.add(id);
    }
    out.push({ key, teamIds });
  }
  return { ok: true, groups: out };
}

/**
 * Etappe B.7 (A4) Block 4: Spielfelder-Editor.
 * @param {Array} fields - [{ id, name, order }]
 * @param {Object} opts
 *   - locked: boolean (status !== 'draft')
 *   - isAdmin: boolean
 * @returns {string} HTML
 */
export function renderFieldsEditor(fields, opts = {}) {
  const { locked = false, isAdmin = false } = opts;
  const arr = Array.isArray(fields) && fields.length > 0
    ? [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : Array.from({ length: 4 }, (_, i) => ({ name: `Platte ${i + 1}`, order: i }));

  const count = arr.length;
  const rows = arr
    .map(
      (f, idx) => `
        <li class="t-field-row" data-field-idx="${idx}">
          <span class="t-field-order">#${idx + 1}</span>
          <input class="t-field-name" type="text" maxlength="32" value="${esc(f.name)}" ${locked || !isAdmin ? 'disabled' : ''}>
        </li>
      `
    )
    .join('');

  const actions = isAdmin && !locked
    ? '<div class="t-fields-editor-actions"><button class="t-btn t-btn--primary" data-action="save-fields" type="button">Speichern</button><button class="t-btn t-btn--ghost" data-action="reset-fields" type="button">Abbrechen</button></div>'
    : '';

  const lockHint = locked
    ? '<div class="t-fields-locked-hint">Spielfelder sind nach der Generierung gesperrt — der Ausdruck zeigt die aktuelle Konfiguration.</div>'
    : '';

  return `
    <div class="t-fields-editor" data-fields-count="${count}">
      <div class="t-fields-editor-row">
        <label>
          Anzahl Spielfelder
          <input class="t-fields-count" type="number" min="1" max="12" value="${count}" ${locked || !isAdmin ? 'disabled' : ''}>
        </label>
      </div>
      <ul class="t-fields-list">${rows}</ul>
      ${actions}
      ${lockHint}
    </div>
  `;
}

/**
 * Etappe B.7 (A4): Liest den DOM-State des Spielfelder-Editors und
 * baut den PATCH /:id/fields-Body.
 *
 * @param {HTMLElement} editorEl
 * @returns {{ ok: true, fields: [{ name, order }] } | { ok: false, error: string }}
 */
export function serializeFieldsInput(editorEl) {
  if (!editorEl) return { ok: false, error: 'editor fehlt' };
  const countInput = editorEl.querySelector('.t-fields-count');
  const count = countInput ? parseInt(countInput.value, 10) : 0;
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    return { ok: false, error: 'Anzahl muss zwischen 1 und 12 sein' };
  }
  const nameInputs = Array.from(editorEl.querySelectorAll('.t-field-name'));
  if (nameInputs.length !== count) {
    return { ok: false, error: 'Anzahl-Feld und Zeilen passen nicht zusammen' };
  }
  const seen = new Set();
  const out = [];
  for (let i = 0; i < nameInputs.length; i++) {
    const name = (nameInputs[i].value ?? '').trim();
    if (name.length === 0) {
      return { ok: false, error: `Feld #${i + 1} hat keinen Namen` };
    }
    if (name.length > 32) {
      return { ok: false, error: `Feld "${name}" hat mehr als 32 Zeichen` };
    }
    if (seen.has(name)) {
      return { ok: false, error: `Feld-Name "${name}" ist doppelt` };
    }
    seen.add(name);
    out.push({ name, order: i });
  }
  return { ok: true, fields: out };
}

/**
 * Etappe B.7 (A4) Block 4-Print: Mappt eine field-ID auf den
 * benutzerdefinierten Feld-Namen. Fallback „Platte N" für unbekannte
 * IDs (Migrationsschutz).
 *
 * @param {string|null|number} fieldId
 * @param {Array} fieldsConfig - [{ id, name, order }]
 * @returns {string}
 */
export function resolveFieldName(fieldId, fieldsConfig) {
  if (fieldId == null) return '';
  const cfg = Array.isArray(fieldsConfig) ? fieldsConfig : [];
  const hit = cfg.find((f) => f.id === fieldId);
  if (hit) return hit.name;
  // Numeric fallback: z.B. altes field=1 → „Platte 1"
  if (typeof fieldId === 'number') {
    // Geschuetztes Leerzeichen (2026-08-26, Fund von Jonas am iPhone SE):
    // Die Meta-Zeile der Spielkarte darf umbrechen (white-space: normal),
    // weil lange Feldnamen sonst abgeschnitten werden. Bei "Platte 1" hat
    // sie das genutzt und die 1 auf die naechste Zeile geschoben — dort
    // steht sie linksbuendig unter der Uhrzeit statt unter "Platte", und
    // das sieht nach Fehler aus. Ein normales Leerzeichen ist die einzige
    // Stelle, an der die Zeile hier brechen KANN; ein geschuetztes nimmt
    // ihr genau diese Moeglichkeit, ohne den Umbruch woanders zu verbieten.
    return `Platte ${fieldId}`;
  }
  return String(fieldId);
}

/**
 * Etappe B.7: Pure-Funktion — konvertiert einen State-Array (vom DOM
 * in main.js gesammelt) in den PATCH /:id/schedule-Body.
 *
 * @param {Array<{ matchId: string, scheduledAt?: string, field?: number|null }>} state
 * @param {string|null} baseDate - ISO-Date des Turniers (für HH:MM → ISO Konvertierung)
 * @returns {{ ok: true, updates: [{ matchId, scheduledAt?, field? }] } | { ok: false, error: string }}
 */
export function serializeScheduleInput(state, baseDate = null) {
  if (!Array.isArray(state) || state.length === 0) {
    return { ok: false, error: 'State-Array fehlt' };
  }
  const updates = [];
  for (const item of state) {
    if (!item || typeof item.matchId !== 'string') {
      return { ok: false, error: 'matchId fehlt' };
    }
    const update = { matchId: item.matchId };
    if (item.scheduledAt !== undefined) {
      const v = item.scheduledAt;
      if (v === null || v === '') {
        update.scheduledAt = null;
      } else if (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) && baseDate) {
        // HH:MM → ISO mit baseDate
        const iso = `${baseDate.slice(0, 10)}T${v}:00Z`;
        const ts = Date.parse(iso);
        if (Number.isNaN(ts)) {
          return { ok: false, error: `Ungültige Zeit "${v}"` };
        }
        update.scheduledAt = new Date(ts).toISOString();
      } else if (typeof v === 'string') {
        const ts = Date.parse(v);
        if (Number.isNaN(ts)) {
          return { ok: false, error: `Ungültiges ISO "${v}"` };
        }
        update.scheduledAt = new Date(ts).toISOString();
      } else {
        return { ok: false, error: 'scheduledAt muss string oder null sein' };
      }
    }
    if (item.field !== undefined) {
      const f = item.field;
      if (f === null) {
        update.field = null;
      } else if (typeof f === 'number' && Number.isInteger(f) && f >= 1) {
        update.field = f;
      } else {
        return { ok: false, error: 'field muss integer ≥ 1 oder null sein' };
      }
    }
    updates.push(update);
  }
  return { ok: true, updates };
}
