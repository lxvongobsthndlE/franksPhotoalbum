# Render-Funktionen — Turniermodul v3

Reine Code-Sammlung der HTML-erzeugenden Funktionen, mit Dateiname und Zeilennummer. Stand: 2026-08-20, Commit b3ae5f9.

---

## 1. renderMatchCard — Spielplan-Karte (Normal)
`backend/public/script/spielplan-helpers.js:182-259`
```js
export function renderMatchCard(m, isAdmin, isEdit = false, fieldsConfig = null) {
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
```

---

## 2. renderMatchCardCompact — Kontextspalten-Karte ("Als Nächstes")
`backend/public/script/spielplan-helpers.js:328-349`
```js
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
```

---

## 3. renderMatchCardBracket — Turnierbaum-Knoten
`backend/public/script/spielplan-helpers.js:656-708`
```js
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
      ? `${m.scheduledTime} · Platte ${m.field}`
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
```

---

## 4. Gruppentabellen — renderStandingsGroups
`backend/public/script/spielplan-helpers.js:435-484`
```js
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
```

### Gruppentabellen-Mount in `loadStandingsTab`
`backend/public/script/main.js:3246-3278` (nur die Output-Montage)
```js
async function loadStandingsTab(tournamentId) {
  if (!tournamentId) return;
  const mount = document.querySelector('[data-tab-body="gruppen-mount"]');
  if (!mount) return;
  mount.innerHTML = '<div class="t-card"><div class="t-card-body"><p class="t-hint">Lade Tabellen…</p></div></div>';
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/standings`, 'GET');
    const groups = data.groups || [];
    const scoreLabel = data.scoreLabel || 'Punkte';

    if (groups.length === 0) {
      mount.innerHTML = '<div class="t-card"><div class="t-card-body"><p class="t-hint">Keine Gruppen vorhanden.</p></div></div>';
      return;
    }

    const hasAnyRows = groups.some((g) => (g.standings || []).length > 0);
    if (!hasAnyRows) {
      mount.innerHTML = '<div class="t-card"><div class="t-card-body"><p class="t-hint">Noch keine Gruppenspiele absolviert.</p></div></div>';
      return;
    }

    const groupsHtml = renderStandingsGroups(groups, scoreLabel);
    // Beste Dritte (Spec §6.3.1, §13.7). Wird nur gerendert, wenn das
    // Turnier überhaupt welche zulässt (config.bestThirds > 0). Die
    // Render-Funktion gibt einen leeren String zurück, wenn nichts da
    // ist — also unbedenklich, hier zu konkatenieren.
    const bestThirdsHtml = renderBestThirdsTable(data.bestThirds);
    mount.innerHTML = groupsHtml + bestThirdsHtml;
  } catch (e) {
    mount.innerHTML = `<div class="t-card"><div class="t-card-body"><p class="t-hint">Tabellen konnten nicht geladen werden.</p></div></div>`;
    toast(e.serverMessage || 'Tabelle konnte nicht geladen werden', 'error');
  }
}
```

---

## 5. Turnierkarte — `renderTournamentInstanceDetailV3`-Listen-Cards
`backend/public/script/main.js:2384-2395` (innerhalb der Phase-Grouping-Schleife)
```js
return `<article class="tournament-card tournament-instance-card${activeClass}" data-instance-phase="${esc(phase)}">
  <div class="tournament-card-head">
    <h3>${esc(instance.name || 'Turnier')}</h3>
    <span class="tournament-status-badge">${esc(tournamentPhaseLabel(phase))}</span>
  </div>
  <p class="t-instance-stats">${tournamentModeLabel(instance.mode)} · ${teamCount ?? '–'} Teams · ${groupCount ?? '–'} Gruppen · ${matchCount} Spiele</p>
  <div class="tournament-card-actions tournament-instance-actions">
    <button class="btn btn-ghost" onclick="openTournamentInstance('${instance.id}')">Öffnen</button>
    ${canManageInstances ? `<button class="preset-icon-btn danger" type="button" onclick="deleteTournamentInstance('${instance.id}','${esc(instance.name || 'Turnier')}')" title="Löschen" aria-label="Löschen">${ICON_TRASH}</button>` : ''}
  </div>
</article>`;
```

---

## 6. Shell — `renderTournamentInstanceDetailV3` (Header + Tabs + Main-Open)
`backend/public/script/main.js:2748-2757` (nur der `grid.innerHTML`-Block; Variablen darüber in Zeilen 2674-2746)
```js
grid.className = T_DETAIL_HOST_CLASS;
grid.innerHTML = `
  <div class="t-mod" id="tournament-detail" data-tournament-id="${esc(t.id)}">
    <header class="t-mod-header">
      ${logoHtml}
      ${badgeRowHtml}
      ${headerActionsHtml}
    </header>
    <div class="t-mod-tabs" id="t-tabs" role="tablist" aria-label="Turnier-Ansichten (mobil)">
      <button type="button" class="is-active" data-view="spielplan">Spielplan</button>
      <button type="button" data-view="uebersicht">Übersicht</button>
      <button type="button" data-view="gruppen">Gruppen</button>
      <button type="button" data-view="baum">Turnierbaum</button>
      <button type="button" data-view="teams">Teams</button>
      <button type="button" data-view="regeln">Regeln</button>
      <button type="button" data-view="drucken">Drucken</button>
      <button type="button" data-view="einstellungen">Einstellungen</button>
    </div>
    <div class="t-shell">
      <nav class="t-mod-nav" id="t-nav" aria-label="Turnier-Ansichten">
        <button type="button" class="is-active" data-view="spielplan">Spielplan <span class="count" id="cnt-matches"></span></button>
        <button type="button" data-view="uebersicht">Übersicht</button>
        <button type="button" data-view="gruppen">Gruppen</button>
        <button type="button" data-view="baum">Turnierbaum</button>
        <button type="button" data-view="teams">Teams</button>
        <button type="button" data-view="regeln">Regeln</button>
        <button type="button" data-view="drucken">Drucken</button>
        <button type="button" data-view="einstellungen">Einstellungen</button>
      </nav>
      <main class="t-mod-main">
        <section class="t-view is-active" data-view="spielplan" data-tournament-id="${esc(t.id)}">
          <div class="t-view-head">
            <div class="t-view-title">Spielplan</div>
            <div class="spacer"></div>
            ${isAdmin ? '<button type="button" class="t-btn t-btn--ghost" data-action="toggle-schedule-edit" title="Zeit und Platte pro Spiel ändern — Achtung: bei laufenden Spielen gesperrt">Bearbeiten</button>' : ''}
```

### Header-Bausteine davor (Variablen)
`backend/public/script/main.js:2684-2741`
```js
const logoHtml = t.logoUrl
  ? `<img class="t-logo" src="${esc(t.logoUrl)}" alt="Logo">`
  : '<span class="t-logo t-logo--placeholder" aria-hidden="true"></span>';

const publicBadge = t.isPublic
  ? '<span class="t-badge t-badge--phase">Öffentlich</span>'
  : '';

// Bug 15 (2026-08-18, User-Punkt 3): Auf Mobile (390px) ist Logo +
// Titel + Badge zu breit für eine Reihe. Wir umhüllen Titel-Text
// + Badges in einer eigenen Zeile (.t-mod-header-info), damit
// der Titel bei Bedarf schrumpfen kann und die Badges darunter
// umbrechen. Auf Desktop (≥768px) bleiben sie nebeneinander.
const badgeRowHtml = `<div class="t-mod-header-info">
  <div class="t-mod-header-text">
    <h1 class="t-title">${esc(t.name || 'Turnier')}</h1>
    <div class="t-sub">${esc(modeLabel)} · ${teamCount} Teams</div>
  </div>
  <div class="t-mod-header-badges">
    <span class="t-badge t-badge--phase">${esc(tournamentPhaseLabel(phase))}</span>
    ${publicBadge}
  </div>
</div>`;

// Spielplan-View-Inhalt: kommt in Schritt 3.
// Platzhalter zeigt ehrlich, was sie noch nicht können — vgl. Module-Scope
// `placeholder`-Helper direkt vor `handleTournamentTabSideEffects`.
const groupsViewHtml = `<div data-tab-body="gruppen-mount"></div>`;

// Bug 15 (2026-08-18, User-Punkt: „Mobile ist der Hauptfall"):
// „Zeitplan neu" gehört in die Spielplan-View, nicht in den
// globalen Header. Auf Mobile frisst der Header sonst ein
// Drittel des Bildschirms mit drei Buttons untereinander.
// Außerdem wandern alle zeitplan-relevanten Aktionen dort hin,
// wo der User das Turnier sieht. Admin-only.
const showReschedule = isAdmin && t.status !== 'finished';

// Bug 15 Politur (2026-08-18, User-Punkt 2): „Zurück" und „Drucken"
// werden auf Mobile in einem Kontextmenü (drei-Punkte-Button rechts
// oben) gebündelt. Auf Desktop/Tablet bleiben sie als inline-Buttons
// sichtbar — die `.t-mod-header-actions-btn`-Klasse wird per
// @container-Querie ein-/ausgeblendet. Die Menü-Items tragen
// dieselben data-action-Werte wie die Buttons, damit die Handler
// unverändert funktionieren.
const headerActionsHtml = `
  <div class="t-mod-header-actions">
    <button type="button" class="t-btn t-btn--ghost t-mod-header-actions-btn" data-action="back" title="Zurück zur Liste">Zurück</button>
    <button type="button" class="t-btn t-btn--ghost t-mod-header-actions-btn" data-action="print" title="Drucken">Drucken</button>
    <div class="t-mod-menu" data-open="false">
      <button type="button" class="t-mod-menu-toggle" aria-label="Aktionen" aria-haspopup="true" aria-expanded="false">
        <span class="t-mod-menu-toggle-icon" aria-hidden="true">⋮</span>
      </button>
      <div class="t-mod-menu-list" role="menu">
        <button type="button" data-action="back" role="menuitem">Zurück zur Liste</button>
        <button type="button" data-action="print" role="menuitem">Drucken</button>
      </div>
    </div>
  </div>`;
```

---

## 7. Einstellungs-Block — Beispiel `data-section="groups"` aus `renderEinstellungen`
`backend/public/script/spielplan-helpers.js:1066-1080` (innerhalb der `renderEinstellungen`-Return)
```js
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
```

### Geschwister-Sections (Seeding + Fields) — selbe Datei, Zeile 1081-1104
```js
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
```

---

## 8. Ergebnis-Dialog — `openResultEntryModal` Markup
`backend/public/script/main.js:4825-4872` (nur der `dlg.innerHTML`-Block; Variablen `matches`, `labelFor`, `sublineFor` darüber in Zeilen 4786-4823)
```js
const dlg = document.createElement('div');
dlg.id = 'result-entry-modal';
dlg.className = 'dlg-bg';
dlg.innerHTML = `
  <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
    <div class="tournament-detail-dlg-head">
      <h3>Ergebnis eintragen</h3>
      <button type="button" class="modal-x" data-action="close">✕</button>
    </div>
    <form id="result-entry-form" class="tournament-detail-form">
      ${initialMatch
        ? `<input type="hidden" id="re-match-id" value="${esc(initialMatch.id)}">`
        : (openSorted.length
            ? `<label class="tournament-detail-field">
                <span class="tournament-detail-label">Match <span class="t-required">*</span></span>
                <select id="re-match-id" required>
                  <option value="">— offenes Match wählen —</option>
                  ${openSorted.map(({ id, m }) => (
                    `<option value="${esc(id)}">${esc(labelFor(m))}</option>`
                  )).join('')}
                </select>
              </label>`
            : `<p class="t-hint">Keine offenen Matches vorhanden — bitte zuerst Spiele generieren.</p>`
          )}
      <div id="re-subline" class="re-subline" aria-live="polite"></div>
      <div class="re-score-row">
        <span class="re-team">
          <i class="t-dot re-dot" id="re-home-dot"></i>
          <span class="re-team-name" id="re-home-name">–</span>
        </span>
        <input id="re-home" type="number" min="0" value="0" required
               class="re-score-input" aria-label="Ergebnis Heim">
    </div>
    <div class="re-score-row">
      <span class="re-team">
        <i class="t-dot re-dot" id="re-away-dot"></i>
        <span class="re-team-name" id="re-away-name">–</span>
      </span>
      <input id="re-away" type="number" min="0" value="0" required
             class="re-score-input" aria-label="Ergebnis Gast">
  </div>
  <div class="tournament-card-actions">
    <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
    <button type="submit" class="btn btn-primary">Speichern</button>
  </div>
</form>
  </div>`;
document.body.appendChild(dlg);
```
