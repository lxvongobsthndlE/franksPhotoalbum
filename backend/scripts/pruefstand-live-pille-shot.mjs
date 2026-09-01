/**
 * Screenshot-Verify fuer die Live-Pille (2026-09-01).
 *
 * Gleiches Muster wie pruefstand-rueckzug-shot.mjs: eigener Statik-Server
 * statt der App (die Frage ist CSS + Renderer, nicht DB), Playwright aus
 * dem npx-Cache ueber `channel: 'msedge'` (Memory screenshot-verify-msedge).
 *
 * Gemessen, nicht angeschaut:
 *   - Seitenleiste: Pille liegt im Knopf, Name „Turniere" nicht
 *     abgeschnitten, Pille nicht abgeschnitten, Kontrast des Pillentexts
 *     gegen seinen zusammengesetzten Grund (Pille ueber Knopf ueber
 *     Seitenleiste) — Ziel >= 4,5:1, weil der Text 10px hat.
 *   - Liste: das gestartete Turnier (status generated + startedAt) traegt
 *     die running-Pille mit „Laeuft" UND den 3px-Streifen; das bereite
 *     traegt ready; das beendete finished.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const ausgabe = process.argv[2] ?? 'C:/Users/Rezo/AppData/Local/Temp/screen-a-shots';
fs.mkdirSync(ausgabe, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const befunde = [];

for (const [etikett, breite] of [
  ['375', 375],
  ['1280', 1280],
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
    page.on('requestfailed', (r) => fehler.push(`request failed: ${r.url()}`));
    page.on(
      'response',
      (r) =>
        r.status() >= 400 &&
        !r.url().endsWith('/favicon.ico') &&
        fehler.push(`${r.status()} ${r.url()}`)
    );
    const url = `http://127.0.0.1:${port}/pruefstand-live-pille.html${thema === 'dark' ? '?theme=dark' : ''}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__pruefstandBereit === true, { timeout: 10_000 });
    // Puls-Animation anhalten, damit die Messung nicht vom Frame abhaengt.
    await page.addStyleTag({ content: '.fb-live-pill::before{animation:none !important}' });
    // Unter 900px ist die Seitenleiste ein Drawer (#sidebar.open, main.js
    // openSidebar) — zu, misst getBoundingClientRect nur Nullen, und
    // „Pille im Knopf" waere trivial wahr. Also aufklappen wie in der App.
    if (breite < 900) {
      await page.evaluate(() => document.getElementById('sidebar').classList.add('open'));
    }

    const mass = await page.evaluate(() => {
      // Chromium liefert color-mix()-Ergebnisse als `color(srgb r g b)` mit
      // Anteilen 0..1 — ohne diese Weiche las die erste Messung 0.19 als
      // 0.19/255 und meldete 14,7:1 fuer eine Farbe, die 4,5:1 traegt.
      const parse = (c) => {
        const m = (c.match(/[\d.]+/g) || []).map(Number);
        const k = c.startsWith('color(srgb') ? 255 : 1;
        return {
          r: (m[0] ?? 0) * k,
          g: (m[1] ?? 0) * k,
          b: (m[2] ?? 0) * k,
          a: m.length > 3 ? m[3] : 1,
        };
      };
      const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const lum = ({ r, g, b }) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };

      const raus = { sidebar: [], liste: {}, querScroll: false };
      const sb = document.getElementById('sidebar');
      const sbBg = parse(getComputedStyle(sb).backgroundColor);
      for (const btn of sb.querySelectorAll('button[data-ps]')) {
        const pille = btn.querySelector('.fb-live-pill');
        const fn = btn.querySelector('.fn');
        const br = btn.getBoundingClientRect();
        const pr = pille.getBoundingClientRect();
        const cs = getComputedStyle(pille);
        const btnBg = over(parse(getComputedStyle(btn).backgroundColor), sbBg);
        const grund = over(parse(cs.backgroundColor), btnBg);
        raus.sidebar.push({
          fall: btn.dataset.ps,
          pilleImKnopf: pr.right <= br.right + 0.5 && pr.left >= br.left - 0.5,
          pilleBreite: Math.round(pr.width),
          pilleHoehe: Math.round(pr.height),
          pilleAbgeschnitten: pille.scrollWidth > Math.ceil(pr.width) + 1,
          nameAbgeschnitten: fn.scrollWidth > Math.ceil(fn.getBoundingClientRect().width) + 1,
          text: pille.textContent.trim(),
          textFarbe: cs.color,
          kontrast: ratio(parse(cs.color), grund),
          rahmenKontrast: ratio(over(parse(cs.borderColor), btnBg), btnBg),
        });
      }
      const karte = (id) => document.querySelector(`.t-list-card[data-instance-id="${id}"]`);
      for (const [id, erwartet] of [
        ['a', 'running'],
        ['b', 'ready'],
        ['c', 'finished'],
      ]) {
        const k = karte(id);
        const badge = k?.querySelector('.t-list-card-status');
        raus.liste[id] = {
          gruppe: k?.closest('.t-list-group')?.dataset.phaseGroup ?? null,
          badgeKlasse: badge ? [...badge.classList].find((c) => c.includes('--')) : null,
          badgeText: badge?.textContent.trim() ?? null,
          erwartet: `t-list-card-status--${erwartet}`,
          streifen: k ? getComputedStyle(k, '::before').width : null,
        };
      }
      raus.querScroll = document.body.scrollWidth > document.body.clientWidth;
      return raus;
    });

    const datei = path.join(ausgabe, `live-pille-${etikett}-${thema}.png`);
    await page.screenshot({ path: datei, fullPage: true });
    befunde.push({ viewport: etikett, thema, datei, fehler, ...mass });
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(JSON.stringify(befunde, null, 2));
