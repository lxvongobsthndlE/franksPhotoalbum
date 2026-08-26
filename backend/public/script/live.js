/**
 * Zuschauer-Ansicht — die Seite hinter /t/<token>.
 *
 * Sie ist absichtlich klein und kennt nur einen Verb: lesen. Es gibt hier
 * keinen Zustandsspeicher, kein Routing, keine Anmeldung. Was ankommt,
 * wird gezeichnet; danach wird alle 30 Sekunden neu geholt.
 *
 * Warum eigene Renderer und nicht die aus tournament.js:
 * Der angemeldete Client wiegt über 4.500 Zeilen und ist um das Bearbeiten
 * herum gebaut — Sperren, Rollen, Formulare. Ein Zuschauer am Spielfeldrand
 * lädt davon nichts. Der Preis ist doppelte Darstellungslogik, und das ist
 * ein bewusster Handel: Die Ansichten sind ohnehin verschieden, und die
 * Trennung hält Admin-Code von einer nicht angemeldeten Seite fern.
 */

const REFRESH_MS = 30_000;

const app = document.getElementById('app');

/** Token aus /t/<token>. Geprüft wird er im Backend, nicht hier. */
function tokenAusPfad() {
  const teile = window.location.pathname.split('/').filter(Boolean);
  return teile[0] === 't' ? (teile[1] ?? '') : '';
}

/* ══════════════════════════════════════════════════════════
   Kleine Helfer
   ══════════════════════════════════════════════════════════ */

/**
 * Baut ein Element. Text wird über textContent gesetzt, nie über
 * innerHTML: Teamnamen kommen von Menschen, und diese Seite ist die
 * einzige im Haus, die Unangemeldeten gezeigt wird.
 */
function el(tag, klasse, text) {
  const n = document.createElement(tag);
  if (klasse) n.className = klasse;
  if (text != null) n.textContent = String(text);
  return n;
}

function leer(text) {
  return el('div', 'empty', text);
}

function abschnitt(titel, hinweis) {
  const s = el('section');
  const kopf = el('div', 'sec-head');
  kopf.append(el('h2', null, titel));
  if (hinweis) kopf.append(el('span', 'hint', hinweis));
  s.append(kopf);
  return s;
}

/* ══════════════════════════════════════════════════════════
   Spielkarte
   ══════════════════════════════════════════════════════════ */

function teamZeile(slot, istSieger, istVerlierer) {
  const zeile = el('div', 'team-row');
  if (!slot || slot.kind === 'placeholder') zeile.classList.add('is-ph');
  if (istSieger) zeile.classList.add('is-win');

  const punkt = el('span', 'team-dot');
  if (slot?.color) punkt.style.background = slot.color;
  zeile.append(punkt, el('span', 'team-name', slot?.name ?? 'offen'));
  if (istVerlierer) zeile.dataset.lose = '1';
  return zeile;
}

function spielKarte(m, scoreShort) {
  const karte = el('article', 'match');
  if (m.isLive) karte.classList.add('is-live');

  // Kopfzeile: Zeit, Platte, Runde/Gruppe, Status.
  const sub = el('div', 'match-sub');
  if (m.isLive) {
    const jetzt = el('span', 'live-txt', '● läuft gerade');
    sub.append(jetzt);
  } else if (m.scheduledTime) {
    sub.append(el('span', null, m.scheduledTime));
  }
  if (m.field != null) sub.append(el('span', null, `Platte ${m.field}`));
  if (m.groupKey) sub.append(el('span', null, `Gruppe ${m.groupKey}`));
  else if (m.roundLabel) sub.append(el('span', null, m.roundLabel));

  // Sieger nur markieren, wenn das Spiel entschieden ist.
  let heimSieger = false;
  let gastSieger = false;
  if (m.isFinished && m.scoreHome != null && m.scoreAway != null) {
    heimSieger = m.scoreHome > m.scoreAway;
    gastSieger = m.scoreAway > m.scoreHome;
  }

  const teams = el('div', 'match-teams');
  teams.append(
    teamZeile(m.home, heimSieger, gastSieger),
    teamZeile(m.away, gastSieger, heimSieger)
  );

  const stand = el('div', 'match-score');
  if (m.scoreHome != null && m.scoreAway != null) {
    const oben = el('span', heimSieger ? null : 'score-lose', m.scoreHome);
    const unten = el('span', gastSieger ? null : 'score-lose', m.scoreAway);
    stand.append(oben, unten);
    stand.title = scoreShort ? `${scoreShort}` : '';
  } else {
    stand.append(el('span', 'none', '–'));
  }

  karte.append(sub, teams, stand);
  return karte;
}

/* ══════════════════════════════════════════════════════════
   Tabelle
   ══════════════════════════════════════════════════════════ */

function tabelle(gruppe, scoreShort) {
  const box = el('div', 'grp');
  box.append(el('h3', null, gruppe.name || `Gruppe ${gruppe.key}`));

  if (!gruppe.standings?.length) {
    box.append(leer('Noch keine Ergebnisse.'));
    return box;
  }

  const wrap = el('div', 'tbl-wrap');
  const t = el('table');

  const kopfZeile = el('tr');
  const spalten = [
    { text: '', klasse: null },
    { text: 'Team', klasse: null },
    { text: 'Sp', klasse: null },
    { text: 'S', klasse: 'opt' },
    { text: 'U', klasse: 'opt' },
    { text: 'N', klasse: 'opt' },
    { text: scoreShort || 'Pkt', klasse: null },
    { text: '+/−', klasse: null },
    { text: 'Pkt', klasse: null },
  ];
  for (const s of spalten) kopfZeile.append(el('th', s.klasse, s.text));
  const thead = el('thead');
  thead.append(kopfZeile);

  const tbody = el('tbody');
  for (const r of gruppe.standings) {
    const tr = el('tr');
    if (r.qualifies) tr.classList.add('is-qual');

    tr.append(el('td', 't-rank', r.rank));

    const tdTeam = el('td');
    const name = el('div', 't-team');
    name.append(el('span', null, r.name ?? '—'));
    tdTeam.append(name);
    tr.append(tdTeam);

    tr.append(el('td', null, r.played ?? 0));
    tr.append(el('td', 'opt', r.won ?? 0));
    tr.append(el('td', 'opt', r.drawn ?? 0));
    tr.append(el('td', 'opt', r.lost ?? 0));
    tr.append(el('td', null, `${r.goalsFor ?? 0}:${r.goalsAgainst ?? 0}`));

    const diff = r.goalDiff ?? 0;
    tr.append(el('td', null, diff > 0 ? `+${diff}` : String(diff)));
    tr.append(el('td', 't-pts', r.points ?? 0));

    tbody.append(tr);
  }

  t.append(thead, tbody);
  wrap.append(t);
  box.append(wrap);
  return box;
}

/* ══════════════════════════════════════════════════════════
   Seite
   ══════════════════════════════════════════════════════════ */

function kopf(t) {
  const h = el('header', 'head');
  const oben = el('div', 'head-top');

  if (t.logoUrl) {
    const img = el('img', 'head-logo');
    img.src = t.logoUrl;
    img.alt = '';
    oben.append(img);
  }
  oben.append(el('h1', null, t.name || 'Turnier'));
  h.append(oben);

  const meta = el('div', 'head-meta');

  const laeuft = t.status === 'group_stage' || t.status === 'ko_stage';
  const fertig = t.status === 'finished';
  const pille = el('span', `pill${laeuft ? ' is-live' : ''}${fertig ? ' is-done' : ''}`);
  pille.append(el('span', 'dot'));
  pille.append(el('span', null, t.statusLabel || t.status || ''));
  meta.append(pille);

  if (t.location) meta.append(el('span', null, t.location));
  if (t.startsAtShort) {
    const datum = t.singleDay || !t.endsAtShort
      ? t.startsAtShort
      : `${t.startsAtShort} – ${t.endsAtShort}`;
    meta.append(el('span', 'mono', datum));
  }
  if (t.teamCount != null) {
    meta.append(el('span', null, `${t.teamCount} Teams`));
  }

  h.append(meta);
  return h;
}

/**
 * Laufende Spiele zuerst, sonst die nächsten drei ohne Ergebnis.
 *
 * Ein Spiel, dessen beide Plätze noch leer sind, gehört hier nicht hin:
 * „13:00, Platte 1, offen gegen offen" beantwortet keine Frage. Solche
 * Paarungen entstehen im K.-o.-Baum, solange die Gruppenphase läuft —
 * sie stehen weiter unten in der Runden-Übersicht, wo der Platzhalter
 * („Sieger HF 1") die eigentliche Auskunft ist.
 */
function jetztUndGleich(matches) {
  const live = matches.filter((m) => m.isLive);
  if (live.length) return { titel: 'Läuft gerade', spiele: live };

  const offen = matches
    .filter((m) => !m.isFinished && (m.home?.kind === 'team' || m.away?.kind === 'team'))
    .sort((a, b) => {
      const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : Number.MAX_SAFE_INTEGER;
      const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })
    .slice(0, 3);

  return offen.length ? { titel: 'Als Nächstes', spiele: offen } : null;
}

function zeichne(daten) {
  const t = daten.tournament ?? {};
  const matches = daten.matches ?? [];
  const scoreShort = t.scoreShort || 'Pkt';

  const neu = document.createDocumentFragment();
  neu.append(kopf(t));

  // 1. Was gerade zählt.
  const naechstes = jetztUndGleich(matches);
  if (naechstes) {
    const s = abschnitt(naechstes.titel);
    for (const m of naechstes.spiele) s.append(spielKarte(m, scoreShort));
    neu.append(s);
  }

  // 2. Tabellen.
  const gruppen = daten.groups ?? [];
  if (gruppen.length) {
    const s = abschnitt('Tabellen', t.scoreLabel || null);
    for (const g of gruppen) s.append(tabelle(g, scoreShort));
    neu.append(s);
  }

  // 3. K.-o.-Runden, nach Runde gebündelt.
  const ko = matches.filter((m) => m.isKoMatch);
  if (ko.length) {
    const s = abschnitt('K.-o.-Runde');
    const nachRunde = new Map();
    for (const m of ko) {
      const schluessel = m.roundLabel || m.round || '—';
      if (!nachRunde.has(schluessel)) nachRunde.set(schluessel, []);
      nachRunde.get(schluessel).push(m);
    }
    for (const [name, spiele] of nachRunde) {
      const block = el('div', 'round');
      block.append(el('h3', null, name));
      spiele.sort((a, b) => (a.bracketPos ?? 0) - (b.bracketPos ?? 0));
      for (const m of spiele) block.append(spielKarte(m, scoreShort));
      s.append(block);
    }
    neu.append(s);
  }

  // 4. Der ganze Spielplan.
  const gruppenSpiele = matches.filter((m) => m.isGroupMatch);
  if (gruppenSpiele.length) {
    const s = abschnitt('Spielplan');
    gruppenSpiele.sort((a, b) => {
      const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : 0;
      const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : 0;
      if (ta !== tb) return ta - tb;
      return (a.field ?? 0) - (b.field ?? 0);
    });
    for (const m of gruppenSpiele) s.append(spielKarte(m, scoreShort));
    neu.append(s);
  }

  if (!gruppen.length && !matches.length) {
    neu.append(leer('Für dieses Turnier steht noch kein Spielplan.'));
  }

  // 5. Fuß.
  const fuss = el('div', 'foot');
  fuss.append(el('span', 'mark', '[kru:]nest'));
  fuss.append(el('span', null, 'Nur zum Ansehen — Ergebnisse trägt die Turnierleitung ein.'));
  const stempel = el('span', 'stamp');
  stempel.id = 'stamp';
  fuss.append(stempel);
  neu.append(fuss);

  app.replaceChildren(neu);
  aktualisiereStempel();
}

function aktualisiereStempel() {
  const s = document.getElementById('stamp');
  if (!s) return;
  const jetzt = new Date();
  const hh = String(jetzt.getHours()).padStart(2, '0');
  const mm = String(jetzt.getMinutes()).padStart(2, '0');
  s.textContent = `Stand ${hh}:${mm}`;
}

function zeigeZustand(titel, text) {
  const box = el('div', 'state');
  box.append(el('div', 'mark', '[kru:]nest'));
  box.append(el('h2', null, titel));
  box.append(el('p', null, text));
  app.replaceChildren(box);
}

/* ══════════════════════════════════════════════════════════
   Laden
   ══════════════════════════════════════════════════════════ */

let letzterErfolg = null;

async function laden() {
  const token = tokenAusPfad();
  if (!token) {
    zeigeZustand('Kein Turnier angegeben', 'Der Link scheint unvollständig zu sein.');
    return;
  }

  try {
    const antwort = await fetch(`/api/tournaments/public/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
    });

    if (antwort.status === 404) {
      zeigeZustand(
        'Dieser Link ist nicht mehr gültig',
        'Die Turnierleitung hat die Freigabe zurückgenommen, oder der Link war nie richtig. Frag am besten dort nach.'
      );
      return;
    }
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);

    const daten = await antwort.json();
    letzterErfolg = daten;
    document.title = daten.tournament?.name
      ? `${daten.tournament.name} — Turnier`
      : 'Turnier';
    zeichne(daten);
  } catch (err) {
    // Ein Aussetzer im Mobilfunknetz darf keine gefüllte Seite leeren —
    // am Spielfeldrand ist ein Stand von vor einer Minute mehr wert als
    // eine Fehlermeldung.
    if (letzterErfolg) {
      const s = document.getElementById('stamp');
      if (s) s.textContent = 'Stand konnte nicht aktualisiert werden';
      return;
    }
    zeigeZustand(
      'Turnier konnte nicht geladen werden',
      'Die Verbindung hat nicht geklappt. Versuch es in einem Moment noch einmal.'
    );
  }
}

laden();
setInterval(laden, REFRESH_MS);

// Wer das Handy wieder aus der Tasche holt, will den aktuellen Stand
// sehen und nicht bis zum nächsten Intervall warten.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') laden();
});
