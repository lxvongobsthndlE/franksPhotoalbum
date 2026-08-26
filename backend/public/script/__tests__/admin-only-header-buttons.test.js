/**
 * Rechte-Prüfung der Kopfleisten-Knöpfe — die Lücke, die der P1-Scan lässt.
 *
 * read-only.test.js prüft jedes mutierende `data-action` daraufhin, ob es
 * isAdmin-gegated ist. Das deckt 99 von 105 Emissionen ab. Es deckt NICHT
 * ab, was ohne data-action verdrahtet wird:
 *
 *     { id: 'tournament-new-instance-btn', label: 'Turnier erstellen',
 *       onClick: openTournamentWizard }
 *
 * Genau dieser Knopf hing bis zum 26.08.2026 allein an `isInstancesView`.
 * Ein Gruppenmitglied sah „Turnier erstellen", durfte den Wizard öffnen,
 * Teams eintippen — und lief erst beim Abschicken in den 403 aus
 * `POST /api/tournaments`. Die Datenlage war nie in Gefahr; die Zusage
 * „Mitglieder sehen nur" war es.
 *
 * Diese Datei prüft deshalb die andere Verdrahtungsart: Knopf-Objekte mit
 * `onClick`. Sie ist bewusst ein Quelltext-Scan — der Aufbau der Leiste
 * hängt an DOM und Modul-Zustand, und ein Scan fängt den Fehler dort,
 * wo er entsteht, statt eine halbe Anwendung nachzubauen.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));

/**
 * Knöpfe der Turnier-Kopfleiste, die eine Rolle voraussetzen.
 * Der Wert ist der Bezeichner, der im Quelltext neben der id stehen muss.
 */
const ADMIN_KNOEPFE = [
  { id: 'tournament-new-instance-btn', grund: 'POST /api/tournaments ist Admin-only' },
];

/** Knöpfe, die jeder sehen darf — als Gegenprobe, damit der Test nicht alles verbietet. */
const OFFENE_KNOEPFE = ['tournament-refresh-btn'];

/**
 * Streicht Kommentare heraus.
 *
 * Ohne diesen Schritt ist der ganze Test wertlos, und zwar auf eine Art,
 * die niemand bemerkt: Der Kommentar, der den Schutz ERKLÄRT, steht direkt
 * über dem Knopf und enthält die Wörter „currentTournamentListIsAdmin"
 * und „isAdmin". Eine Suche über den Rohtext findet sie dort und meldet
 * grün — auch dann, wenn die Prüfung im Code entfernt wurde.
 *
 * Genau das ist in der ersten Fassung passiert: Die Mutationsprobe (Fix
 * herausnehmen, Test muss rot werden) blieb grün. Ein Wächter, der nie
 * rot war, bewacht nichts.
 */
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let quelle;
let leiste;

beforeAll(() => {
  const roh = readFileSync(join(hier, '..', 'main.js'), 'utf8');
  quelle = ohneKommentare(roh);
  const start = quelle.indexOf('function renderTournamentHeaderActions');
  expect(start, 'renderTournamentHeaderActions nicht gefunden').toBeGreaterThan(-1);
  // Der Funktionsrumpf reicht für die Prüfung; 4000 Zeichen decken ihn ab.
  leiste = quelle.slice(start, start + 4000);
});

/**
 * Findet die DEFINITION eines Knopfes, nicht seine erste Erwähnung.
 *
 * Der Funktionsrumpf beginnt mit einer Aufräum-Liste, die dieselben ids
 * als blanke Zeichenketten enthält („alte Knöpfe entfernen"). Ein
 * indexOf(id) landet dort — und damit vor jeder Rollenprüfung, was den
 * Test scheinbar rot färbt, obwohl der Code stimmt. Gesucht ist die
 * Stelle mit `id: '…'`.
 */
function definitionsStelle(id) {
  return leiste.indexOf(`id: '${id}'`);
}

/**
 * Der Abschnitt, in dem die Knopf-Liste WIRKLICH gebaut wird.
 *
 * Anker ist `const actionButtons`, nicht der Funktionsanfang. Der Grund
 * ist derselbe wie beim Kommentar-Filter, nur subtiler: Die Zeile
 * `const darfErstellen = currentTournamentListIsAdmin === true;` steht
 * weiter oben und bleibt auch dann stehen, wenn ihre VERWENDUNG am Knopf
 * entfernt wird. Eine Suche ab Funktionsanfang findet dann eine
 * Rollenprüfung, die niemanden mehr schützt.
 *
 * Die zweite Mutationsprobe ist genau daran gescheitert. Erst der Anker
 * am Gebrauch macht den Test scharf.
 */
function knopfListe() {
  const start = leiste.indexOf('const actionButtons');
  expect(start, 'const actionButtons nicht gefunden').toBeGreaterThan(-1);
  return leiste.slice(start);
}

describe('Kopfleiste: Admin-Knöpfe sind an die Rolle gebunden', () => {
  it.each(ADMIN_KNOEPFE)('$id ist isAdmin-gegated ($grund)', ({ id }) => {
    expect(definitionsStelle(id), `${id} wird in der Kopfleiste nicht definiert`).toBeGreaterThan(
      -1
    );

    // Innerhalb der Knopf-Liste muss VOR diesem Knopf eine Rollenprüfung
    // stehen. Die Form ist offen — geprüft wird die Tatsache, nicht die
    // Schreibweise.
    const liste = knopfListe();
    const bisKnopf = liste.slice(0, liste.indexOf(`id: '${id}'`));
    const hatRollenpruefung = /currentTournamentListIsAdmin|darfErstellen|\bisAdmin\b/.test(
      bisKnopf
    );
    expect(
      hatRollenpruefung,
      `In der Knopf-Liste steht vor "${id}" keine Rollenprüfung. Ein ` +
        'Mitglied sähe den Knopf. Der P1-Scan fängt das nicht, weil der ' +
        'Knopf kein data-action trägt, sondern über onClick hängt.'
    ).toBe(true);
  });

  it('der Erstellen-Knopf hängt nicht allein an der Ansicht', () => {
    // Der konkrete Fehler von damals: `isInstancesView ? [ …Knopf… ] : []`
    // ohne jede Rolle — der Knopf stand ohne Bedingung im Array.
    const liste = knopfListe();
    const zumKnopf = liste.indexOf(`id: 'tournament-new-instance-btn'`);
    expect(zumKnopf).toBeGreaterThan(-1);

    const dazwischen = liste.slice(0, zumKnopf);
    expect(
      /currentTournamentListIsAdmin|darfErstellen|\bisAdmin\b/.test(dazwischen),
      'Zwischen dem Beginn der Knopf-Liste und "Turnier erstellen" steht ' +
        'keine Rolle — der Knopf hängt wieder allein an der Ansicht.'
    ).toBe(true);
  });

  it('harmlose Knöpfe bleiben für alle sichtbar', () => {
    // Gegenprobe: Der Test darf nicht dazu verleiten, einfach alles
    // hinter isAdmin zu schieben. Aktualisieren ist read-only.
    for (const id of OFFENE_KNOEPFE) {
      expect(leiste).toContain(id);
    }
  });
});

describe('Der Rollenwert wird nachgezogen, sonst fehlt Admins der Knopf', () => {
  it('nach dem Setzen von currentTournamentListIsAdmin wird die Leiste neu gebaut', () => {
    // Die Leiste entsteht, BEVOR die Liste geladen ist. Ohne ein
    // Nachziehen bliebe der Knopf auch für Admins weg — der Fix wäre
    // dann schlimmer als der Fehler.
    // Die Zuweisung AUS DER ANTWORT, nicht die Deklaration weiter oben.
    const setzen = quelle.indexOf('currentTournamentListIsAdmin = instanceData');
    expect(
      setzen,
      'Zuweisung aus instanceData nicht gefunden — heißt die Quelle jetzt anders?'
    ).toBeGreaterThan(-1);
    const danach = quelle.slice(setzen, setzen + 900);
    expect(
      danach.includes('renderTournamentHeaderActions()'),
      'Nach dem Setzen der Rolle wird die Kopfleiste nicht neu gebaut — ' +
        'Admins sähen "Turnier erstellen" dann gar nicht mehr.'
    ).toBe(true);
  });
});

describe('Bestandsaufnahme: alle onClick-Knöpfe sind bekannt', () => {
  it('in der Turnier-Kopfleiste gibt es keine unbeachteten onClick-Knöpfe', () => {
    // Wächter gegen das Wiederauftauchen derselben Fehlerklasse an einer
    // neuen Stelle: Kommt ein dritter Knopf dazu, fällt dieser Test und
    // zwingt zu der Frage, wer ihn sehen darf.
    const ids = [...leiste.matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
    const bekannt = new Set([...ADMIN_KNOEPFE.map((k) => k.id), ...OFFENE_KNOEPFE]);
    const neue = ids.filter((id) => !bekannt.has(id));
    expect(
      neue,
      'Neuer Knopf in der Turnier-Kopfleiste. Trag ihn oben ein — als ' +
        'ADMIN_KNOEPFE, wenn er etwas verändert, sonst als OFFENE_KNOEPFE.'
    ).toEqual([]);
  });
});
