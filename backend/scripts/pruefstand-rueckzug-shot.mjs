/**
 * Screenshot-Verify fuer den Rueckzugs-Knopf (2026-09-01).
 *
 * Warum ein eigener Statik-Server statt der App: die Frage ist eine reine
 * CSS-/Layout-Frage (traegt die neue fuenfte Grid-Spalte?), und die App
 * dafuer hochzufahren braucht DB, MinIO und einen Login. Der Pruefstand
 * rendert dieselbe Renderer-Ausgabe mit denselben Stylesheets.
 *
 * Playwright kommt aus dem npx-Cache und faehrt ueber `channel: 'msedge'`,
 * weil auf dieser Maschine keine eigenen Browser-Binaries liegen
 * (Memory screenshot-verify-msedge).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// pathToFileURL, weil der ESM-Loader unter Windows kein `C:/...` frisst.
const PW = pathToFileURL(
  'C:/Users/Rezo/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
).href;
const { chromium } = await import(PW);

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const typen = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const rein = decodeURIComponent(req.url.split('?')[0]);
  const datei = path.join(wurzel, rein);
  if (!datei.startsWith(wurzel) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) {
    res.writeHead(404);
    return res.end('nicht gefunden');
  }
  res.writeHead(200, { 'content-type': typen[path.extname(datei)] ?? 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/pruefstand-rueckzug.html`;

const ausgabe = process.argv[2] ?? 'C:/Users/Rezo/AppData/Local/Temp/screen-a-shots';
fs.mkdirSync(ausgabe, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const befunde = [];

for (const [etikett, breite] of [
  ['375', 375],
  ['430', 430],
  ['900', 900],
]) {
  for (const thema of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: breite, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: thema,
    });
    const page = await ctx.newPage();
    const fehler = [];
    page.on('pageerror', (e) => fehler.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && fehler.push(m.text()));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__pruefstandBereit === true, { timeout: 10_000 });

    // Messung statt Augenschein: schneidet etwas ab, ueberlappt etwas,
    // steht der Knopf ueberhaupt in der Zeile?
    const mass = await page.evaluate(() => {
      const raus = { knoepfe: 0, abgeschnitten: [], ueberlappt: [], gruende: 0, ausserhalb: [] };
      raus.gruende = document.querySelectorAll('[data-role="withdraw-lock-reason"]').length;
      for (const zeile of document.querySelectorAll('.t-team-row')) {
        const name = zeile.querySelector('[data-role="team-name"]');
        const knopf = zeile.querySelector('[data-action="withdraw-team"]');
        const zr = zeile.getBoundingClientRect();
        if (name && name.scrollWidth > Math.ceil(name.getBoundingClientRect().width) + 1) {
          raus.abgeschnitten.push(name.textContent.trim());
        }
        if (!knopf) continue;
        raus.knoepfe += 1;
        const kr = knopf.getBoundingClientRect();
        const nr = name.getBoundingClientRect();
        if (kr.left < nr.right - 1) raus.ueberlappt.push(name.textContent.trim());
        if (kr.right > zr.right + 1 || kr.left < zr.left - 1 || kr.width < 44 || kr.height < 28) {
          raus.ausserhalb.push(
            `${name.textContent.trim()}: ${Math.round(kr.width)}x${Math.round(kr.height)} px`
          );
        }
      }
      const b = document.body;
      raus.querScroll = b.scrollWidth > b.clientWidth;
      // Wer genau ist breiter als der Viewport? Ohne den Namen ist
      // „scrollt horizontal" nur ein Symptom.
      raus.ueberbreit = [];
      if (raus.querScroll) {
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.right > b.clientWidth + 1) {
            raus.ueberbreit.push(
              `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}=${Math.round(r.right)}`
            );
          }
        }
        // Entscheidend: liegt es an den Zeilen MIT Knopf, oder an allen?
        const alle = [...document.querySelectorAll('.t-team-row')];
        const ueber = alle.filter((z) => z.getBoundingClientRect().right > b.clientWidth + 1);
        raus.zeilenGesamt = alle.length;
        raus.zeilenUeber = ueber.length;
        raus.zeilenUeberMitKnopf = ueber.filter((z) =>
          z.querySelector('[data-action="withdraw-team"]')
        ).length;
        // Und wer ist der breiteste Vorfahr? Der erklaert die Ursache.
        {
          const z = alle[0];
          const kette = [];
          for (let e = z; e && e !== document.documentElement; e = e.parentElement) {
            const r2 = e.getBoundingClientRect();
            kette.push(
              `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0] || '-'}:${Math.round(r2.width)}`
            );
          }
          raus.kette = kette;
        }
        raus.ueberbreit = raus.ueberbreit.slice(0, 5);
      }
      // Kuerzung getrennt nach „Zeile hat einen Knopf" — der Kontrollfall
      // beantwortet, ob der Knopf schuld ist.
      raus.kurzMitKnopf = [];
      raus.kurzOhneKnopf = [];
      for (const zeile of document.querySelectorAll('.t-team-row')) {
        const name = zeile.querySelector('[data-role="team-name"]');
        if (!name) continue;
        const eng = name.scrollWidth > Math.ceil(name.getBoundingClientRect().width) + 1;
        if (!eng) continue;
        const ziel = zeile.querySelector('[data-action="withdraw-team"]')
          ? raus.kurzMitKnopf
          : raus.kurzOhneKnopf;
        ziel.push(`${name.textContent.trim().slice(0, 22)}… ${Math.round(name.getBoundingClientRect().width)}px`);
      }
      return raus;
    });

    const datei = path.join(ausgabe, `rueckzug-${etikett}-${thema}.png`);
    await page.screenshot({ path: datei, fullPage: true });
    befunde.push({ breite: etikett, thema, ...mass, fehler, datei });
    await ctx.close();
  }
}

await browser.close();
server.close();

let rot = 0;
for (const b of befunde) {
  const probleme = [
    b.kurzMitKnopf.length && `gekuerzt MIT Knopf: ${b.kurzMitKnopf.join(' | ')}`,
    b.kurzOhneKnopf.length && `gekuerzt OHNE Knopf: ${b.kurzOhneKnopf.join(' | ')}`,
    b.ueberbreit?.length &&
      `ueberbreit: ${b.zeilenUeber}/${b.zeilenGesamt} Zeilen, davon ${b.zeilenUeberMitKnopf} mit Knopf | Kette: ${b.kette.join(' < ')}`,
    b.ueberlappt.length && `ueberlappt: ${b.ueberlappt.join(', ')}`,
    b.ausserhalb.length && `Knopfmass: ${b.ausserhalb.join(' | ')}`,
    b.querScroll && 'Seite scrollt horizontal',
    b.fehler.length && `JS-Fehler: ${b.fehler.join(' | ')}`,
  ].filter(Boolean);
  if (probleme.length) rot += 1;
  console.log(
    `${b.breite}px ${b.thema}: ${b.knoepfe} Knoepfe, ${b.gruende} Sperrgruende — ` +
      (probleme.length ? `PROBLEM ${probleme.join(' ;; ')}` : 'in Ordnung')
  );
}
console.log(rot === 0 ? '\nAlle Laeufe sauber.' : `\n${rot} Lauf/Laeufe mit Befund.`);
process.exit(rot === 0 ? 0 : 1);
