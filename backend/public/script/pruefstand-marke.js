/* Pruefstand fuer die Markenuebernahme — NICHT Teil der App.
   Baut die echten Renderer in die echte Host-Struktur, damit ein
   Screenshot dasselbe zeigt wie die App. Kein handgetipptes Markup
   ausser der Modul-Schale, die in main.js ein Template-Literal ist. */
import {
  renderMatchList, renderFilterChips, renderStandingsGroups, renderBracket,
  renderTeamsList, renderEinstellungen, renderDruckboegen, renderBestThirdsTable,
  ensureTModResizeObserver,
} from './spielplan-helpers.js';
import {
  renderSpielplanSectionHead, renderRegelnSectionHead, renderEinstellungenSection,
  renderDetailSidebar, renderTournamentListCard, renderModulKopf,
} from './tournament-render.js';
import { renderRulesParagraphs } from './rules-helpers.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'spielplan';
const theme = q.get('theme') || 'none';
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

const team = (id, n, c, seed) => ({ id, name: n, color: c, seed });

const teams = [
  team('t1', 'Blaue Hummeln', '#3B6FB6', 0),
  team('t2', 'Netzroller', '#B6553B', 1),
  team('t3', 'Tafelrunde', '#4E7A50', 2),
  team('t4', 'Kellerkinder', '#7A4E76', 3),
  team('t5', 'Schmetterhand', '#C08A2E', 4),
  team('t6', 'Effet & Co.', '#2E8C8C', 5),
  team('t7', 'Halbdistanz', '#8C2E4E', 6),
  team('t8', 'Randlage', '#5A5A6E', 7),
  team('t9', 'Topspin Bande', '#2E5A8C', 8),
  team('t10', 'Stille Post', '#8C6B2E', 9),
  team('t11', 'Die Unbeugsamen', '#3E7A3E', 10),
  team('t12', 'Kantenglück', '#7A3E3E', 11),
];
const byName = Object.fromEntries(teams.map((t) => [t.name, t]));
const seite = (n) => ({ kind: 'team', teamId: byName[n]?.id, name: n, color: byName[n]?.color });

let mid = 0;
const spiel = (o) => ({
  id: 'm' + (++mid),
  home: seite(o.h), away: seite(o.a),
  scoreHome: o.hs ?? null, scoreAway: o.as ?? null,
  isFinished: !!o.fin, isLive: !!o.live,
  scheduledTime: o.zeit, scheduledAt: '2026-04-18T' + (o.zeit || '14:00') + ':00.000Z',
  field: o.platte ?? 1, label: o.gruppe ?? 'Gruppe A',
  isGroupMatch: !o.ko, isKo: !!o.ko, stageType: o.ko ? 'ko' : 'group',
  round: o.runde, roundLabel: o.rlabel, bracketPos: o.pos,
});

const matches = [
  spiel({ h: 'Netzroller', a: 'Kantenglück', hs: 2, as: 1, live: true, zeit: '14:30', platte: 2, gruppe: 'Gruppe C' }),
  spiel({ h: 'Blaue Hummeln', a: 'Kellerkinder', hs: 3, as: 1, fin: true, zeit: '14:00', platte: 1, gruppe: 'Gruppe A' }),
  spiel({ h: 'Halbdistanz', a: 'Schmetterhand', hs: 0, as: 3, fin: true, zeit: '14:00', platte: 3, gruppe: 'Gruppe B' }),
  spiel({ h: 'Topspin Bande', a: 'Die Unbeugsamen', hs: 3, as: 0, fin: true, zeit: '14:00', platte: 2, gruppe: 'Gruppe C' }),
  spiel({ h: 'Tafelrunde', a: 'Stille Post', zeit: '14:30', platte: 1, gruppe: 'Gruppe C' }),
  spiel({ h: 'Effet & Co.', a: 'Randlage', zeit: '14:30', platte: 3, gruppe: 'Gruppe B' }),
  spiel({ h: 'Blaue Hummeln', a: 'Netzroller', zeit: '15:00', platte: 1, gruppe: 'Gruppe A' }),
  spiel({ h: 'Kellerkinder', a: 'Tafelrunde', zeit: '15:00', platte: 2, gruppe: 'Gruppe A' }),
  spiel({ h: 'Schmetterhand', a: 'Effet & Co.', zeit: '15:00', platte: 3, gruppe: 'Gruppe B' }),
];
const koMatches = [
  spiel({ h: 'Blaue Hummeln', a: 'Randlage', hs: 3, as: 1, fin: true, ko: true, runde: 'QF', rlabel: 'Viertelfinale', pos: 1, zeit: '15:00', platte: 1 }),
  spiel({ h: 'Stille Post', a: 'Effet & Co.', hs: 2, as: 3, fin: true, ko: true, runde: 'QF', rlabel: 'Viertelfinale', pos: 2, zeit: '15:00', platte: 2 }),
  spiel({ h: 'Topspin Bande', a: 'Tafelrunde', hs: 3, as: 0, fin: true, ko: true, runde: 'QF', rlabel: 'Viertelfinale', pos: 3, zeit: '15:20', platte: 1 }),
  spiel({ h: 'Schmetterhand', a: 'Halbdistanz', hs: 3, as: 2, fin: true, ko: true, runde: 'QF', rlabel: 'Viertelfinale', pos: 4, zeit: '15:20', platte: 2 }),
  spiel({ h: 'Blaue Hummeln', a: 'Effet & Co.', ko: true, runde: 'SF', rlabel: 'Halbfinale', pos: 1, zeit: '15:45', platte: 1 }),
  spiel({ h: 'Topspin Bande', a: 'Schmetterhand', ko: true, runde: 'SF', rlabel: 'Halbfinale', pos: 2, zeit: '16:10', platte: 2 }),
];
koMatches.push({
  ...spiel({ h: 'Blaue Hummeln', a: 'Topspin Bande', ko: true, runde: 'F', rlabel: 'Finale', pos: 1, zeit: '16:40', platte: 1 }),
  home: { kind: 'placeholder', name: 'Sieger Halbfinale 1' },
  away: { kind: 'placeholder', name: 'Sieger Halbfinale 2' },
});

const st = (n, sp, w, d, l, gf, ga, p) => ({
  teamId: byName[n]?.id, name: n, played: sp, won: w, drawn: d, lost: l,
  goalsFor: gf, goalsAgainst: ga, goalDiff: gf - ga, points: p,
});
const standings = [
  { groupKey: 'A', groupName: 'Gruppe A', standings: [
    st('Blaue Hummeln', 3, 2, 0, 1, 12, 6, 6), st('Netzroller', 2, 1, 1, 0, 8, 6, 4),
    st('Tafelrunde', 3, 0, 2, 1, 7, 8, 2), st('Kellerkinder', 2, 0, 0, 2, 2, 9, 0)] },
  { groupKey: 'B', groupName: 'Gruppe B', standings: [
    st('Schmetterhand', 3, 3, 0, 0, 11, 3, 9), st('Effet & Co.', 2, 1, 0, 1, 6, 5, 3),
    st('Halbdistanz', 3, 1, 0, 2, 5, 7, 3), st('Randlage', 2, 0, 0, 2, 1, 8, 0)] },
  { groupKey: 'C', groupName: 'Gruppe C', standings: [
    st('Topspin Bande', 2, 2, 0, 0, 8, 3, 6), st('Stille Post', 2, 1, 0, 1, 5, 5, 3),
    st('Die Unbeugsamen', 1, 0, 0, 1, 2, 2, 1), st('Kantenglück', 1, 0, 0, 1, 1, 6, 0)] },
];
const bestThirds = [
  { ...st('Die Unbeugsamen', 1, 0, 0, 1, 2, 2, 1), groupKey: 'C', pointsPerGame: 1 },
  { ...st('Halbdistanz', 3, 1, 0, 2, 5, 7, 3), groupKey: 'B', pointsPerGame: 1 },
  { ...st('Tafelrunde', 3, 0, 2, 1, 7, 8, 2), groupKey: 'A', pointsPerGame: 0.67 },
];
const groups = standings.map((g, i) => ({
  id: 'g' + i, key: g.groupKey, name: g.groupName,
  members: g.standings.map((s) => ({ teamId: s.teamId, name: s.name, color: byName[s.name]?.color })),
}));

// Das Turnierlogo der Vorlage, damit der Kopf mit Bild geprueft werden
// kann. `?logo=0` zeigt den anderen Fall — ohne Logo, ohne Platzhalter.
const LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMUY1RDNBIi8+PGcgZmlsbD0iI0VGRTdEMiI+PGNpcmNsZSBjeD0iMzIiIGN5PSIyMSIgcj0iNy42Ii8+PGNpcmNsZSBjeD0iMjIuNCIgY3k9IjM4IiByPSI3LjYiLz48Y2lyY2xlIGN4PSI0MS42IiBjeT0iMzgiIHI9IjcuNiIvPjwvZz48cmVjdCB4PSIxNCIgeT0iNDkiIHdpZHRoPSIzNiIgaGVpZ2h0PSIzLjYiIHJ4PSIxLjgiIGZpbGw9IiNFRkU3RDIiIG9wYWNpdHk9Ii43MiIvPjwvc3ZnPg==';

const tournament = {
  id: 't-1', name: 'Frühjahrsturnier', status: 'running',
  logoUrl: q.get('logo') === '0' ? null : LOGO,
  startedAt: '2026-04-18T13:00:00.000Z', startsAt: '2026-04-18T13:00:00.000Z',
  location: 'Vereinsheim, Halle 2', mode: 'groups_ko', isAdmin: true,
  rules: 'Wer 15 Minuten nach Ansetzung nicht am Tisch steht, verliert das Spiel 0:3.\n\nGetränke gehen aufs Haus, wenn ihr die Becher selbst wieder einsammelt.',
  config: {
    fields: [
      { id: 'f1', name: 'Platte 1', order: 0 },
      { id: 'f2', name: 'Platte 2', order: 1 },
      { id: 'f3', name: 'Platte 3', order: 2 }],
    // Der Zeitplan gehoert seit dem 2026-08-26 in den Pruefstand: der
    // Block „Spielbetrieb" zeigt Spieldauer, Pause und Platten aus
    // genau diesen Werten. Ohne sie stuenden dort die Rueckfallwerte,
    // und ein Screenshot koennte nicht zeigen, dass der gespeicherte
    // Wert ankommt.
    schedule: {
      slotMinutes: 35,
      matchDurationMinutes: 30,
      pauseAfterMatches: 5,
      parallelFields: 3,
      startTime: '13:00',
    },
  },
};
const alleSpiele = matches.concat(koMatches);
const tDto = { tournament, teams, groups: standings, matches: alleSpiele, stats: null };
const isAdmin = q.get('admin') !== '0';

const grid = document.getElementById('grid');

function detailSchale() {
  const tabs = [
    ['spielplan', 'Spiele'], ['gruppen', 'Gruppen'], ['baum', 'Baum'],
  ].map(([v, l], i) => `<button type="button" class="t-mod-tab${i === 0 ? ' is-active' : ''}" data-view="${v}"><span>${l}</span></button>`).join('');
  return `
    <div class="t-mod" id="tournament-detail" data-tournament-id="t-1">
      <header class="t-mod-header">${renderModulKopf({ t: tournament, titel: 'Spielplan' })}</header>
      <div class="t-mod-tabs" id="t-tabs" role="tablist" aria-label="Turnier-Ansichten (mobil)">
        ${tabs}
        <button type="button" class="t-mod-tab" data-action="open-more-menu"><span>Mehr</span></button>
      </div>
      <div class="t-shell">
        ${renderDetailSidebar({ isAdmin })}
        <main class="t-mod-main">
          <section class="t-view" data-view="spielplan" data-tournament-id="t-1">
            ${renderSpielplanSectionHead({ isAdmin, t: tournament })}
          </section>
          <section class="t-view" data-view="gruppen"><div data-tab-body="gruppen-mount"></div></section>
          <section class="t-view" data-view="baum"><div data-tab-body="baum-mount"></div></section>
          <section class="t-view" data-view="teams"><div data-tab-body="teams-mount"></div></section>
          <section class="t-view" data-view="regeln">${renderRegelnSectionHead({ isAdmin })}</section>
          <section class="t-view" data-view="drucken"><div data-tab-body="drucken-mount"></div></section>
          ${renderEinstellungenSection({ isAdmin })}
        </main>
      </div>
    </div>`;
}

const KICKER = {
  spielplan: 'Frühjahrsturnier · Sa 18. April',
  gruppen: '12 Teams · 3 Gruppen · 18 Spiele',
  baum: '8 Teams · Gruppen + K.-o.',
  teams: '12 Teams · 3 Gruppen',
  regeln: 'Frühjahrsturnier',
  drucken: 'Frühjahrsturnier',
  einstellungen: 'Nur du als Organisator siehst diesen Bereich',
};
const TITEL = {
  spielplan: 'Spielplan', gruppen: 'Gruppen', baum: 'K.-o.-Phase', teams: 'Teams',
  regeln: 'Regelwerk', drucken: 'Drucken', einstellungen: 'Einstellungen',
};
const AKTION = {
  spielplan: 'Teams', gruppen: 'Regelwerk', baum: 'Regelwerk', teams: null,
  regeln: 'Bearbeiten', drucken: null, einstellungen: 'Fertig',
};

function gruppenHtml() {
  return renderStandingsGroups(standings, 'Becher', 2)
    + '<div class="t-section-label">Beste Dritte · 2 Plätze frei</div>'
    + renderBestThirdsTable(bestThirds);
}

if (view === 'liste') {
  // Die Feldnamen sind die des ECHTEN Renderers (instance/phase/
  // phaseLabel/modeLabel), nicht selbst ausgedachte. Der erste Anlauf
  // uebergab hier { t, isAdmin, stats } — der Pruefstand zeigte
  // daraufhin dreimal „Turnier · – Teams · 0 Spiele" und haette einen
  // intakten Renderer fuer kaputt erklaert. Genau die Falle, vor der die
  // Uebergabe warnt.
  //
  // Auch die Schachtelung ist die echte (main.js:2807):
  //   #content > #grid.tournaments-grid
  //            > section.tournament-page-shell.t-mod.t-list-host
  //            > section.t-list-group > div.tournament-instance-grid
  const listen = [
    { id: 'a', name: 'Frühjahrsturnier', status: 'group_stage', phase: 'live', phaseLabel: 'Läuft',
      modeLabel: 'Gruppen + K.-o.', startsAt: '2026-04-18T10:00:00.000Z', location: 'Vereinsheim',
      teamCount: 12, groupCount: 3, matchCount: 18, finishedCount: 10 },
    { id: 'b', name: 'Herbstpokal', status: 'draft', phase: 'draft', phaseLabel: 'Entwurf',
      modeLabel: 'Nur K.-o.', startsAt: '2026-10-11T10:00:00.000Z', location: '',
      teamCount: 8, groupCount: 0, matchCount: 0, finishedCount: 0 },
    { id: 'c', name: 'Winterrunde 2025', status: 'finished', phase: 'done', phaseLabel: 'Beendet',
      modeLabel: 'Gruppen + K.-o.', startsAt: '2025-12-07T10:00:00.000Z', location: '',
      teamCount: 16, groupCount: 4, matchCount: 24, finishedCount: 24 },
  ];
  const gruppe = (titel, eintraege) => `<section class="t-list-group" data-phase-group="${eintraege[0].phase}">
      <div class="t-list-group-label">${titel} · ${eintraege.length}</div>
      <div class="tournament-instance-grid">${eintraege.map((instance) => renderTournamentListCard({
        instance, phase: instance.phase, isAdmin,
        phaseLabel: instance.phaseLabel, modeLabel: instance.modeLabel,
        icons: { more: '⋯', trash: '' },
      })).join('')}</div>
    </section>`;
  grid.className = 'tournaments-grid';
  grid.innerHTML = `<section class="tournament-page-shell t-mod t-list-host">${
    gruppe('Läuft', [listen[0]]) + gruppe('Entwurf', [listen[1]]) + gruppe('Beendet', [listen[2]])
  }</section>`;
} else {
  grid.className = 't-detail-host';
  grid.innerHTML = detailSchale();
  const detail = document.getElementById('tournament-detail');
  detail.querySelector('.t-mod-kicker-text').textContent = KICKER[view] || '';
  detail.querySelector('[data-view-title]').textContent = TITEL[view] || '';
  const act = detail.querySelector('[data-view-action]');
  if (AKTION[view]) { act.textContent = AKTION[view]; act.hidden = false; }

  const sec = detail.querySelector(`section.t-view[data-view="${view}"]`);
  if (sec) sec.classList.add('is-active');
  detail.querySelectorAll('.t-mod-nav button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === view);
  });
  detail.querySelectorAll('.t-mod-tabs button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === view);
  });

  detail.querySelector('#t-filters').innerHTML = renderFilterChips(alleSpiele, groups, 'alle');
  detail.querySelector('#t-schedule-list').innerHTML = renderMatchList(matches, isAdmin);
  detail.querySelector('[data-tab-body="gruppen-mount"]').innerHTML = gruppenHtml();
  detail.querySelector('[data-tab-body="baum-mount"]').innerHTML = renderBracket(koMatches);
  detail.querySelector('[data-tab-body="teams-mount"]').innerHTML =
    renderTeamsList(teams, { isAdmin, reorderable: true });
  detail.querySelector('[data-tab-body="regeln-mount"]').innerHTML =
    `<div class="t-card"><div class="t-card-body"><div class="t-rules-paragraphs">${renderRulesParagraphs(tournament.rules)}</div></div></div>`;
  // Die Bogen-Renderer lesen `t.tournament.*` (druckKopf, druckFuss).
  // Ein flaches Objekt lieferte deshalb dreimal „Turnier" statt des
  // echten Namens und nie ein Logo — der Pruefstand haette einen
  // intakten Renderer angeschwaerzt. Dieselbe Form wie das echte DTO.
  detail.querySelector('[data-tab-body="drucken-mount"]').innerHTML =
    renderDruckboegen(tDto, 2);
  const eins = detail.querySelector('[data-tab-body="einstellungen-mount"]');
  if (eins) eins.innerHTML = renderEinstellungen(tDto, { isAdmin, finishedCount: 4 });
  try {
    ensureTModResizeObserver(() => {
      detail.querySelector('[data-tab-body="gruppen-mount"]').innerHTML = gruppenHtml();
    });
  } catch { /* im Pruefstand egal */ }
}

if (q.get('dialog') === '1') {
  const dlg = document.createElement('div');
  dlg.id = 'result-entry-modal';
  dlg.className = 't-mod t-dialog-host t-dialog-host--sheet';
  dlg.innerHTML = `
    <div class="t-dialog" role="dialog" aria-modal="true">
      <div class="t-dialog-head">
        <div class="t-dialog-head-text">
          <div class="t-dialog-subline">Halbfinale 1 · 15:45 · Platte 1</div>
          <h3 class="t-dialog-title">Ergebnis eintragen</h3>
        </div>
        <button type="button" class="t-dialog-close" data-action="close" aria-label="Schließen">✕</button>
      </div>
      <form class="t-dialog-body">
        <div class="t-score-entry">
          <div class="t-score-entry-row">
            <span class="t-score-entry-team"><i class="t-dot" style="background:#3B6FB6"></i><span class="name">Blaue Hummeln</span></span>
            <input type="number" min="0" inputmode="numeric" class="t-score-entry-input" value="3" aria-label="Punkte Heimteam">
          </div>
          <div class="t-score-entry-row">
            <span class="t-score-entry-team"><i class="t-dot" style="background:#2E8C8C"></i><span class="name">Effet &amp; Co.</span></span>
            <input type="number" min="0" inputmode="numeric" class="t-score-entry-input" placeholder="–" aria-label="Punkte Gastteam">
          </div>
        </div>
      </form>
      <div class="t-dialog-foot">
        <button type="button" class="t-btn" data-action="close">Abbrechen</button>
        <button type="submit" class="t-btn t-btn--primary">Speichern</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
}
