// Prüfstand: der Wizard darf beim Ändern einer Einstellung nicht nach
// oben springen und nicht den Fokus verlieren.
//
// Nutzermeldung (29.08.2026): „Bei Wizard: wenn ich was anpasse also
// eine Einstellung mache, springt er nach oben statt dort zu bleiben."
//
// Warum dieser Prüfstand sich selbst einen Browser startet, statt sich
// wie test-wizard-focus-no-rerender.mjs an ein laufendes Edge auf Port
// 9222 zu hängen: der Befund hängt am LAYOUT (welcher Container scrollt
// bei welcher Breite), also muss die Seite unter kontrollierten
// Viewport-Massen laufen. Playwright liegt auf dieser Maschine nicht im
// Projekt, sondern im npx-Cache, und Browser-Binaries gibt es keine —
// wir nehmen das installierte Edge über `channel: 'msedge'`.
//
// Die Seite ist bewusst nicht screen-b-preview.html: die hängt den
// Wizard in ein #root ohne .t-wizard-host, hat also NICHT den Scroller
// der App. Hier wird die App-Schale nachgebaut — #content (overflow-y:
// auto, siehe main.css) mit #grid.t-wizard-host darin.
//
// Exit-Codes: 0 = grün · 1 = rot · 3 = nicht ausführbar (kein
// Playwright im npx-Cache oder kein Edge). 3 ist ausdrücklich KEIN
// grüner Lauf — ein Prüfstand, der beim Fehlen seines Werkzeugs still
// bestanden meldet, wäre schlimmer als keiner.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HIER, '..', 'public');
const PORT = 8907;

function findePlaywright() {
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
  const kandidaten = [path.join(HIER, '..', 'node_modules', 'playwright')];
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      kandidaten.push(path.join(cache, d, 'node_modules', 'playwright'));
    }
  }
  return kandidaten.find((p) => fs.existsSync(p)) || null;
}

const HARNESS = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="/style/main.css"/>
<link rel="stylesheet" href="/style/tournament.css"/>
<style>
  html, body { margin: 0; height: 100%; }
  /* Nachbau der App-Schale: #content ist der echte Seiten-Scroller. */
  #content { height: 100vh; overflow-y: auto; padding: 30px 28px; box-sizing: border-box; }
</style></head>
<body>
<div id="content"><div id="grid" class="t-wizard-host"></div></div>
<script type="module">
  import { renderWizardView } from '/script/tournament.js';
  const teams = Array.from({ length: 18 }, (_, i) => ({ name: 'Team ' + (i + 1), seed: i + 1 }));
  window.__mount = (step) => {
    const state = { step, name: 'Sommer-Cup', date: '2026-09-05', location: 'Halle',
      teams, numGroups: 3, advancePerGroup: 2, bestThirdsCount: 0, thirdPlaceMatch: false,
      matchDuration: 15, pauseMinutes: 5, startTime: '14:00', numTables: 2, mode: 'groups_ko' };
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    grid.appendChild(renderWizardView({ initialState: state, onStateChange() {}, onCancel() {} }));
  };
  window.__mount(Number(new URLSearchParams(location.search).get('step') || 3));
  window.__ready = true;
</script>
</body></html>`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

let rot = 0;
function pruefe(bedingung, text) {
  console.log(`${bedingung ? '✓ GRUEN' : '✗ ROT  '} ${text}`);
  if (!bedingung) rot++;
}

async function main() {
  const pwPfad = findePlaywright();
  if (!pwPfad) {
    console.error('Playwright nicht gefunden (weder im Projekt noch im npx-Cache).');
    console.error('Nicht ausfuehrbar — das ist KEIN bestandener Lauf.');
    process.exit(3);
  }
  const require = createRequire(import.meta.url);
  const { chromium } = require(pwPfad);

  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '/harness.html') {
      res.setHeader('content-type', MIME['.html']);
      return res.end(HARNESS);
    }
    const datei = path.join(PUBLIC_DIR, p);
    if (!datei.startsWith(path.resolve(PUBLIC_DIR))) {
      res.statusCode = 403;
      return res.end('');
    }
    fs.readFile(datei, (err, buf) => {
      if (err) {
        res.statusCode = 404;
        return res.end('');
      }
      res.setHeader('content-type', MIME[path.extname(datei)] || 'application/octet-stream');
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge' });
  } catch (e) {
    server.close();
    console.error('Edge liess sich nicht starten:', e.message);
    console.error('Nicht ausfuehrbar — das ist KEIN bestandener Lauf.');
    process.exit(3);
  }

  console.log('=== Wizard: Scrollstand + Fokus ueberleben eine Einstellung ===\n');

  // Handy-Mass: hier scrollt #content, weil .t-mod ohne die
  // 768px-Regel mit seinem Inhalt mitwaechst.
  const page = await browser.newPage({ viewport: { width: 390, height: 600 } });
  page.on('pageerror', (e) => {
    console.log('  [Seitenfehler]', e.message);
    rot++;
  });
  await page.goto(`http://127.0.0.1:${PORT}/harness.html?step=3`);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(300);

  const messung = await page.evaluate(async () => {
    const c = document.getElementById('content');
    c.scrollTop = Math.floor((c.scrollHeight - c.clientHeight) * 0.8);
    await new Promise((r) => requestAnimationFrame(r));
    const scrollVorher = c.scrollTop;
    const alt = document.querySelector('.t-mod.t-wizard');
    const plus = Array.from(alt.querySelectorAll('.t-wizard-group-control button')).find(
      (b) => b.textContent.trim() === '+'
    );
    const zahlVorher = alt.querySelector('.t-wizard-group-num')?.textContent;
    plus.focus();
    plus.click();
    await new Promise((r) => setTimeout(r, 200));
    const neu = document.querySelector('.t-mod.t-wizard');
    const aktiv = document.activeElement;
    return {
      scrollbar: c.scrollHeight - c.clientHeight > 0,
      scrollVorher,
      scrollNachher: c.scrollTop,
      zahlVorher,
      zahlNachher: neu.querySelector('.t-wizard-group-num')?.textContent,
      schaleGetauscht: neu !== alt,
      aktivTag: aktiv ? aktiv.tagName : null,
      aktivText: aktiv ? (aktiv.textContent || '').trim() : null,
      aktivInSchale: neu.contains(aktiv),
    };
  });

  pruefe(messung.scrollbar, 'Vorbedingung: die Seite ist ueberhaupt scrollbar');
  pruefe(
    messung.scrollVorher > 0,
    `Vorbedingung: vor dem Klick ist heruntergescrollt (${messung.scrollVorher} px)`
  );
  pruefe(messung.schaleGetauscht, 'Vorbedingung: die Schale wurde wirklich neu gerendert');
  pruefe(
    messung.zahlNachher === String(Number(messung.zahlVorher) + 1),
    `Die Einstellung wirkt: Gruppen ${messung.zahlVorher} → ${messung.zahlNachher}`
  );
  pruefe(
    messung.scrollNachher === messung.scrollVorher,
    `Scrollstand bleibt (vorher ${messung.scrollVorher}, nachher ${messung.scrollNachher})`
  );
  pruefe(
    messung.aktivInSchale && messung.aktivTag === 'BUTTON' && messung.aktivText === '+',
    `Fokus bleibt auf dem gedrueckten Knopf (aktiv: ${messung.aktivTag}/„${messung.aktivText}“)`
  );

  // Zweite Lage: Schritt 4 mit „Beste Dritte" — genau der Knopf aus der
  // Nutzermeldung. Kleineres Fenster, damit die Seite hier ueberhaupt
  // ueberlaeuft; Schritt 4 ist kuerzer als Schritt 3.
  const page4 = await browser.newPage({ viewport: { width: 390, height: 420 } });
  page4.on('pageerror', (e) => {
    console.log('  [Seitenfehler]', e.message);
    rot++;
  });
  await page4.goto(`http://127.0.0.1:${PORT}/harness.html?step=4`);
  await page4.waitForFunction(() => window.__ready === true);
  await page4.waitForTimeout(300);

  const messung4 = await page4.evaluate(async () => {
    const c = document.getElementById('content');
    c.scrollTop = Math.floor((c.scrollHeight - c.clientHeight) * 0.8);
    await new Promise((r) => requestAnimationFrame(r));
    const scrollVorher = c.scrollTop;
    const alt = document.querySelector('.t-mod.t-wizard');
    const plus = Array.from(alt.querySelectorAll('.t-wizard-stepper button')).find(
      (b) =>
        b.textContent.trim() === '+' &&
        /Dritt/.test(b.closest('.t-wizard-field')?.textContent || '')
    );
    const wertVorher = plus.parentNode.querySelector('.t-wizard-stepper-num')?.textContent;
    plus.focus();
    plus.click();
    await new Promise((r) => setTimeout(r, 200));
    const aktiv = document.activeElement;
    const neuSchale = document.querySelector('.t-mod.t-wizard');
    const btFeld = Array.from(neuSchale.querySelectorAll('.t-wizard-field')).find((f) =>
      /Dritt/.test(f.textContent || '')
    );
    return {
      scrollbar: c.scrollHeight - c.clientHeight > 0,
      scrollVorher,
      scrollNachher: c.scrollTop,
      wertVorher,
      wertNachher: btFeld?.querySelector('.t-wizard-stepper-num')?.textContent,
      aktivTag: aktiv ? aktiv.tagName : null,
      aktivText: aktiv ? (aktiv.textContent || '').trim().slice(0, 12) : null,
      aktivInSchale: neuSchale.contains(aktiv),
    };
  });

  pruefe(messung4.scrollbar, 'Vorbedingung Schritt 4: die Seite ist scrollbar');
  pruefe(
    messung4.scrollVorher > 0,
    `Vorbedingung Schritt 4: vor dem Klick ist heruntergescrollt (${messung4.scrollVorher} px)`
  );
  pruefe(
    messung4.wertNachher === String(Number(messung4.wertVorher) + 1),
    `Die Einstellung wirkt: beste Dritte ${messung4.wertVorher} → ${messung4.wertNachher}`
  );
  pruefe(
    messung4.scrollNachher === messung4.scrollVorher,
    `Schritt 4 „Beste Dritte +": Scrollstand bleibt (vorher ${messung4.scrollVorher}, nachher ${messung4.scrollNachher})`
  );
  pruefe(
    messung4.aktivInSchale && messung4.aktivTag === 'BUTTON' && messung4.aktivText === '+',
    `Schritt 4: Fokus bleibt auf dem gedrueckten Knopf (aktiv: ${messung4.aktivTag}/„${messung4.aktivText}“)`
  );

  // Dritte Lage: Schritt 2, ein Team weit unten in der langen Liste
  // per Pfeil verschieben. Das laeuft ueber refreshAfterMutation() —
  // den zweiten Rerender-Pfad des Wizards — und ist der Fall aus der
  // Nutzermeldung, der am meisten weh tut: bei 18 Teams ist die Seite
  // 600 px hoch gescrollt, und frueher war nach jedem Pfeilklick beides
  // weg, Scrollstand UND der gerade gedrueckte Pfeil.
  //
  // Zusaetzlich wird hier geprueft, dass der Fokus dem TEAM folgt und
  // nicht der Position. Ein rein positionsbasiertes Zurueckholen saesse
  // nach dem Tausch auf dem Pfeil des VERDRAENGTEN Teams — der naechste
  // Klick verschoebe dann das falsche.
  const page2 = await browser.newPage({ viewport: { width: 390, height: 600 } });
  page2.on('pageerror', (e) => {
    console.log('  [Seitenfehler]', e.message);
    rot++;
  });
  await page2.goto(`http://127.0.0.1:${PORT}/harness.html?step=2`);
  await page2.waitForFunction(() => window.__ready === true);
  await page2.waitForTimeout(300);

  const messung2 = await page2.evaluate(async () => {
    const zeilen = () => Array.from(document.querySelectorAll('.t-wizard-team-row'));
    const namen = () => zeilen().map((z) => z.querySelector('input')?.value);
    const c = document.getElementById('content');

    const zeilenVorher = zeilen().length;
    const alteReihenfolge = namen();
    const zeile = zeilen()[14]; // weit unten
    zeile.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const scrollVorher = c.scrollTop;
    const teamName = zeile.querySelector('input').value;
    const auf = Array.from(zeile.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === '↑'
    );
    auf.focus();
    auf.click();
    await new Promise((r) => setTimeout(r, 250));

    const aktiv = document.activeElement;
    const zeileDesAktiven = aktiv && aktiv.closest ? aktiv.closest('.t-wizard-team-row') : null;
    const neueReihenfolge = namen();
    return {
      zeilenVorher,
      zeilenNachher: zeilen().length,
      scrollbar: c.scrollHeight - c.clientHeight > 0,
      scrollVorher,
      scrollNachher: c.scrollTop,
      teamName,
      verschoben:
        alteReihenfolge[14] === teamName &&
        neueReihenfolge[13] === teamName &&
        neueReihenfolge[14] === alteReihenfolge[13],
      aktivTag: aktiv ? aktiv.tagName : null,
      // gekuerzt: faellt der Fokus auf <body>, waere das sonst die
      // komplette Seite in der Fehlermeldung.
      aktivText: aktiv ? (aktiv.textContent || '').trim().slice(0, 12) : null,
      aktivTeam: zeileDesAktiven ? zeileDesAktiven.querySelector('input')?.value : null,
    };
  });

  pruefe(
    messung2.zeilenVorher === 18 && messung2.zeilenNachher === 18,
    `Vorbedingung Schritt 2: die Teamliste steht im DOM (vorher ${messung2.zeilenVorher}, nachher ${messung2.zeilenNachher} Zeilen)`
  );
  pruefe(messung2.scrollbar, 'Vorbedingung Schritt 2: die Teamliste ist scrollbar');
  pruefe(
    messung2.scrollVorher > 0,
    `Vorbedingung Schritt 2: vor dem Klick ist heruntergescrollt (${messung2.scrollVorher} px)`
  );
  pruefe(
    messung2.verschoben,
    `Die Anpassung wirkt: „${messung2.teamName}" ist eine Position nach oben gerueckt`
  );
  pruefe(
    messung2.scrollNachher === messung2.scrollVorher,
    `Schritt 2 Team verschieben: Scrollstand bleibt (vorher ${messung2.scrollVorher}, nachher ${messung2.scrollNachher})`
  );
  pruefe(
    messung2.aktivTag === 'BUTTON' && messung2.aktivText === '↑',
    `Schritt 2: Fokus bleibt auf dem gedrueckten Auf-Pfeil (aktiv: ${messung2.aktivTag}/„${messung2.aktivText}“)`
  );
  pruefe(
    messung2.aktivTeam === messung2.teamName,
    `Schritt 2: der Fokus folgt dem TEAM, nicht der Position (Zeile des Fokus: „${messung2.aktivTeam}", erwartet „${messung2.teamName}")`
  );

  await browser.close();
  server.close();

  console.log(`\n=== ${rot === 0 ? 'Alles gruen' : rot + ' rote Pruefungen'} ===`);
  process.exit(rot === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Lauf abgebrochen:', e);
  process.exit(2);
});
