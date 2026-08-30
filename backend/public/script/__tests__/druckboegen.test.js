/**
 * Druckbögen — Markenübernahme Etappe 9 (2026-08-26).
 *
 * Der Drucken-Knopf legte bis dahin den Bildschirm graustufig aufs
 * Papier: Filterleiste, Karten mit 90 px Höhe, Rahmen um jede Partie.
 * Achtzehn Spiele füllten drei Seiten. `renderDruckboegen` baut
 * stattdessen Markup, das es nur zum Drucken gibt.
 *
 * Was hier schiefgehen kann, ohne dass man es auf dem Bildschirm sieht:
 *   - Eine Partie fehlt auf dem Bogen. Gruppieren heißt umsortieren.
 *   - Eine offene Partie kommt ohne Eintragefeld — dann ist der Bogen
 *     zum Ausfüllen unbrauchbar, und genau dafür ist er da.
 *   - Ein leerer Bogen wird gedruckt (Turnier ohne K.-o.-Phase).
 *   - Der Zeitstempel fehlt. Ein Blatt ohne Stand ist nach zwei Runden
 *     Müll, weil niemand weiß, ob es noch gilt.
 */

import { describe, it, expect } from 'vitest';
import { renderDruckboegen } from '../spielplan-helpers.js';

const spiel = (o) => ({
  id: o.id,
  isFinished: !!o.fin,
  scheduledTime: o.zeit,
  field: o.platte,
  label: o.gruppe,
  home: { kind: 'team', name: o.h },
  away: { kind: 'team', name: o.a },
  scoreHome: o.hs,
  scoreAway: o.as,
});

const ko = (o) => ({
  ...spiel(o),
  isKo: true,
  stageType: 'ko',
  round: o.runde,
  roundLabel: o.label,
  bracketPos: o.pos,
});

/* Das Fixture traegt die Turnierfelder TOP-LEVEL — so liefert
   openTournamentInstance sie wirklich (id/name/logoUrl/startsAt/...).
   Bis zum 30.08. baute es stattdessen `{ tournament: {...} }`, eine
   Form, die es im echten Aufruf nie gab: druckKopf las genau dieses
   Geisterfeld, jeder Bogen hiess „Turnier" und trug nie ein Logo —
   und die Tests blieben gruen, weil Fixture und Bug dieselbe falsche
   Annahme teilten. Ein Fixture ist eine Behauptung ueber den Aufrufer. */
const turnier = (extra = {}) => ({
  id: 't1',
  name: 'Frühjahrsturnier',
  logoUrl: '/api/tournaments/t1/logo',
  startsAt: '2026-04-18T10:00:00.000Z',
  location: 'Halle 2',
  groups: [
    {
      groupKey: 'A',
      groupName: 'Gruppe A',
      standings: [
        {
          teamId: 'a1',
          name: 'Blaue Hummeln',
          played: 3,
          won: 2,
          drawn: 0,
          lost: 1,
          goalsFor: 12,
          goalsAgainst: 6,
          goalDiff: 6,
          points: 6,
        },
        {
          teamId: 'a2',
          name: 'Netzroller',
          played: 2,
          won: 1,
          drawn: 1,
          lost: 0,
          goalsFor: 8,
          goalsAgainst: 6,
          goalDiff: 2,
          points: 4,
        },
        {
          teamId: 'a3',
          name: 'Tafelrunde',
          played: 3,
          won: 0,
          drawn: 2,
          lost: 1,
          goalsFor: 7,
          goalsAgainst: 8,
          goalDiff: -1,
          points: 2,
        },
      ],
    },
  ],
  matches: [
    spiel({
      id: 'g1',
      fin: true,
      zeit: '14:00',
      platte: 1,
      gruppe: 'Gruppe A',
      h: 'Blaue Hummeln',
      a: 'Kellerkinder',
      hs: 3,
      as: 1,
    }),
    spiel({
      id: 'g2',
      fin: true,
      zeit: '14:00',
      platte: 2,
      gruppe: 'Gruppe A',
      h: 'Netzroller',
      a: 'Tafelrunde',
      hs: 3,
      as: 2,
    }),
    spiel({
      id: 'g3',
      zeit: '14:30',
      platte: 1,
      gruppe: 'Gruppe A',
      h: 'Tafelrunde',
      a: 'Stille Post',
    }),
  ],
  ...extra,
});

const zeilen = (html) => (html.match(/<tr[ >]/g) || []).length;

describe('renderDruckboegen', () => {
  it('baut drei Bögen, wenn Spielplan, Gruppen und K.-o. da sind', () => {
    const t = turnier();
    t.matches.push(
      ko({ id: 'h1', runde: 'SF', label: 'Halbfinale', pos: 1, h: 'A', a: 'B' }),
      ko({ id: 'f1', runde: 'F', label: 'Finale', pos: 1, h: 'Sieger HF1', a: 'Sieger HF2' })
    );
    const html = renderDruckboegen(t, 2);
    expect((html.match(/class="t-bogen[ "]/g) || []).length).toBe(3);
  });

  it('ohne K.-o.-Phase wird KEIN leerer dritter Bogen gedruckt', () => {
    const html = renderDruckboegen(turnier(), 2);
    expect((html.match(/class="t-bogen[ "]/g) || []).length).toBe(2);
    expect(html).not.toContain('K.-o.-Phase');
  });

  it('ohne alles bleibt ein ehrlicher Hinweis statt eines leeren Blattes', () => {
    const html = renderDruckboegen({ name: 'X', groups: [], matches: [] }, 2);
    expect(html).toContain('Noch nichts zu drucken');
    expect(html).not.toContain('t-bogen');
  });

  it('der Kopf trägt Turniernamen, Datum und Ort — nicht den Fallback „Turnier“', () => {
    const html = renderDruckboegen(turnier(), 2);
    expect(html).toContain('Frühjahrsturnier');
    expect(html).not.toContain('>Turnier</h3>');
    expect(html).toContain('Halle 2');
    expect(html).toContain('18.4.2026');
  });

  it('das Turnierlogo steht im Kopf — und ohne logoUrl kein Platzhalter', () => {
    const mit = renderDruckboegen(turnier(), 2);
    expect(mit).toContain('class="t-bogen-logo"');
    expect(mit).toContain('src="/api/tournaments/t1/logo"');
    const ohne = renderDruckboegen(turnier({ logoUrl: null }), 2);
    expect(ohne).not.toContain('t-bogen-logo');
  });

  it('verliert keine Partie beim Gruppieren nach Uhrzeit', () => {
    const t = turnier();
    t.matches = Array.from({ length: 18 }, (_, i) =>
      spiel({
        id: 'm' + i,
        zeit: ['14:00', '14:30', '15:00'][i % 3],
        platte: (i % 3) + 1,
        gruppe: 'Gruppe A',
        h: 'H' + i,
        a: 'G' + i,
        fin: i < 9,
        hs: 3,
        as: 1,
      })
    );
    const html = renderDruckboegen(t, 2);
    const spielplan = html.slice(0, html.indexOf('Gruppentabellen'));
    // 18 Partien + keine thead-Zeile im Spielplan-Bogen
    expect(zeilen(spielplan)).toBe(18);
  });

  it('jede offene Partie trägt ein Eintragefeld, jede gespielte ihr Ergebnis', () => {
    const html = renderDruckboegen(turnier(), 2);
    expect(html).toContain('3 : 1');
    expect(html).toContain('3 : 2');
    expect(html).toContain('___ : ___');
    // genau EINE offene Partie im Fixture
    expect((html.match(/___ : ___/g) || []).length).toBe(1);
  });

  it('der Bogen trägt einen Zeitstempel — ohne ihn ist er nach zwei Runden Müll', () => {
    const html = renderDruckboegen(turnier(), 2);
    expect(html).toMatch(/Stand \d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}/);
    expect(html).toMatch(/Seite 1 von 3|Seite 1 von 2/);
  });

  it('die Gruppentabelle zeigt auf Papier NEUN Spalten, nicht fünf', () => {
    const html = renderDruckboegen(turnier(), 2);
    const kopf = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    expect(kopf).toBeTruthy();
    expect((kopf[1].match(/<th/g) || []).length).toBe(9);
    expect(kopf[1]).toContain('Becher');
  });

  it('die Legende nennt bei einem Aufsteiger keinen Bereich', () => {
    // "Platz 2–2" waere Unsinn; bei drei Aufsteigern ist der Bereich richtig.
    expect(renderDruckboegen(turnier(), 2)).toContain('Steigt auf (Platz 2)');
    expect(renderDruckboegen(turnier(), 3)).toContain('Plätze 2–3');
  });

  it('der K.-o.-Bogen liegt quer und zeichnet eine Klammer', () => {
    const t = turnier();
    t.matches.push(
      ko({
        id: 'v1',
        runde: 'QF',
        label: 'Viertelfinale',
        pos: 1,
        fin: true,
        h: 'A',
        a: 'B',
        hs: 3,
        as: 1,
      }),
      ko({
        id: 'v2',
        runde: 'QF',
        label: 'Viertelfinale',
        pos: 2,
        fin: true,
        h: 'C',
        a: 'D',
        hs: 2,
        as: 3,
      }),
      ko({ id: 'h1', runde: 'SF', label: 'Halbfinale', pos: 1, h: 'A', a: 'D' })
    );
    const html = renderDruckboegen(t, 2);
    expect(html).toContain('t-bogen--quer');
    expect(html).toContain('<svg');
    // Verbinder zwischen den Runden
    expect(html).toMatch(/<path d="M\d+ [\d.]+H[\d.]+V[\d.]+h20"/);
    expect(html).toContain('SIEGER');
  });

  it('Platzhalter-Namen erscheinen, statt eine Zeile leer zu lassen', () => {
    const t = turnier();
    t.matches.push(
      ko({ id: 'f1', runde: 'F', label: 'Finale', pos: 1, h: 'Sieger HF1', a: 'Sieger HF2' })
    );
    expect(renderDruckboegen(t, 2)).toContain('Sieger HF1');
  });
});

/* Die Boegen werden VOR dem Turnier gedruckt und mit dem Kuli gefuellt.
   Ein unbesetzter Slot (kind 'placeholder', so baut ihn buildSlot in
   access/match.js wirklich — oder null bei Slot ohne alles) muss deshalb
   eine SCHREIBLINIE drucken, nicht nur Text: auf "Sieger HF1" oder "—"
   kann niemand einen Sieger schreiben. Der sprechende Platzhalter bleibt
   klein erhalten — er sagt, wer auf die Linie gehoert. */
describe('renderDruckboegen — handbeschriftbar vor dem Turnier', () => {
  const phSlot = (name) => ({
    kind: 'placeholder',
    teamId: null,
    name,
    color: null,
    logoUrl: null,
  });

  const mitFinale = (home, away) => {
    const t = turnier();
    const f = ko({ id: 'f1', runde: 'F', label: 'Finale', pos: 1, zeit: '17:00', platte: 1 });
    f.home = home;
    f.away = away;
    t.matches.push(f);
    return t;
  };

  it('unbesetzte Teamzeilen im Baum tragen eine Schreiblinie, der Platzhalter bleibt klein', () => {
    const html = renderDruckboegen(mitFinale(phSlot('Sieger HF1'), phSlot('Sieger HF2')), 2);
    const baum = html.slice(html.indexOf('<svg'));
    expect(baum).toContain('class="wl"');
    expect(baum).toContain('class="ph">Sieger HF1</text>');
    expect(baum).toContain('class="ph">Sieger HF2</text>');
    // kein Platzhalter mehr in Namensgroesse
    expect(baum).not.toMatch(/class="t[np]">Sieger HF/);
  });

  it('ein leerer Slot (null) bekommt die Linie ohne Hinweistext', () => {
    const html = renderDruckboegen(mitFinale(null, phSlot('Sieger HF2')), 2);
    const baum = html.slice(html.indexOf('<svg'));
    const kasten = baum.match(/<g>[\s\S]*?<\/g>/)[0];
    // beide Halbzeilen + beide Score-Felder als Linie = 4 Schreiblinien
    expect((kasten.match(/class="wl"/g) || []).length).toBe(4);
    expect((kasten.match(/class="ph"/g) || []).length).toBe(1);
  });

  it('offene Partien im Baum drucken Score-Schreiblinien statt "___"-Text', () => {
    const t = turnier();
    t.matches.push(ko({ id: 'h1', runde: 'SF', label: 'Halbfinale', pos: 1, h: 'A', a: 'B' }));
    const html = renderDruckboegen(t, 2);
    const baum = html.slice(html.indexOf('<svg'));
    expect(baum).not.toContain('___');
    expect((baum.match(/class="wl"/g) || []).length).toBe(2);
    // die festen Teamnamen bleiben normale Textzeilen
    expect(baum).toContain('class="tn">A</text>');
    expect(baum).toContain('class="tn">B</text>');
  });

  it('gespielte Partien im Baum drucken weiter Zahlen, keine Linien', () => {
    const t = turnier();
    t.matches.push(
      ko({
        id: 'h1',
        runde: 'SF',
        label: 'Halbfinale',
        pos: 1,
        fin: true,
        h: 'A',
        a: 'B',
        hs: 3,
        as: 1,
      })
    );
    const html = renderDruckboegen(t, 2);
    const baum = html.slice(html.indexOf('<svg'));
    expect(baum).toContain('class="sc">3</text>');
    expect(baum).toContain('class="sc">1</text>');
    expect(baum).not.toContain('class="wl"');
  });

  it('im Spielplan bekommt ein unbesetztes Team eine Schreiblinie samt Platzhaltertext', () => {
    const html = renderDruckboegen(mitFinale(phSlot('Sieger HF1'), phSlot('Sieger HF2')), 2);
    const spielplan = html.slice(0, html.indexOf('Gruppentabellen'));
    expect(spielplan).toContain('t-bogen-schreib');
    expect(spielplan).toContain('class="ph">Sieger HF1</span>');
    // der Gedankenstrich-Fallback ist fuer unbesetzte Teams raus
    expect(spielplan).not.toContain('— — —');
  });

  it('jede offene Spielplan-Zeile traegt "___ : ___" — mit und ohne Uhrzeit', () => {
    const t = turnier();
    t.matches = [
      spiel({ id: 'o1', zeit: '14:00', platte: 1, gruppe: 'Gruppe A', h: 'A', a: 'B' }),
      spiel({ id: 'o2', platte: 1, gruppe: 'Gruppe A', h: 'C', a: 'D' }),
    ];
    const html = renderDruckboegen(t, 2);
    const spielplan = html.slice(0, html.indexOf('Gruppentabellen'));
    expect((spielplan.match(/___ : ___/g) || []).length).toBe(2);
    expect(spielplan).toContain('Ohne Termin');
  });
});
