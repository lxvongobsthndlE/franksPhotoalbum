/**
 * PWA-naher Test OHNE Geraet und OHNE Deploy.
 *
 * Was hier ECHT ist (und in der Variablen-Injektion vorher simuliert war):
 *   - die echte index.html ueber echtes HTTP (Meta-Viewport viewport-fit=cover,
 *     Stylesheet-Reihenfolge, Theme-Boot-Schnipsel im <head>)
 *   - echtes env(safe-area-inset-*) per CDP Emulation.setSafeAreaInsetsOverride
 *     -> beweist die GANZE Kette: Meta -> env() -> --sat -> calc() in der Regel
 *   - display-mode: standalone, also die Medienabfrage der installierten PWA
 *
 * Was weiterhin NICHT beweisbar ist: iOS-Safari selbst (WebKit, eigene
 * 100dvh-Mechanik mit ein-/ausfahrenden Leisten). Dafuer braucht es das Geraet.
 */
const PW = 'C:/Users/Rezo/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright';
const { chromium } = require(PW);
const path = require('path');

const BASIS = process.argv[2];
const MARKE = process.argv[3];
const GERAETE = [
  { name: 'iPhone 15',      w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'iPhone SE',      w: 375, h: 667, top: 20, bottom: 0 },
  { name: 'Pixel 8',        w: 412, h: 915, top: 24, bottom: 24 },
  { name: 'iPhone 15 quer', w: 852, h: 393, top: 0,  bottom: 21 },
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const zeilen = [];
  for (const g of GERAETE) {
    const ctx = await browser.newContext({ viewport: { width: g.w, height: g.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    // ECHTE Insets — nicht als CSS-Variable, sondern als das, was env() liest.
    await cdp.send('Emulation.setSafeAreaInsetsOverride',
      { insets: { top: g.top, bottom: g.bottom, left: 0, right: 0 } });
    // Die installierte PWA laeuft standalone, nicht im Browser-Tab.
    await cdp.send('Emulation.setEmulatedMedia',
      { features: [{ name: 'display-mode', value: 'standalone' }] });

    await page.goto(BASIS + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    // Nach der Navigation erneut setzen — Playwright setzt die Medien-
    // Emulation beim Seitenwechsel zurueck.
    await cdp.send('Emulation.setEmulatedMedia',
      { features: [{ name: 'display-mode', value: 'standalone' }] });

    const m = await page.evaluate(({ top, bottom, h }) => {
      // Modal oeffnen wie die App es tut (openModal setzt .hidden ab).
      // Angemeldete Schale herstellen: die App zeigt #app erst mit .show,
      // vorher liegt der Login-Schirm davor. Ohne das ist das Modal 0 hoch.
      document.getElementById('app').classList.add('show');
      const auth = document.getElementById('auth-page');
      if (auth) auth.classList.add('hidden');
      const bg = document.getElementById('up-modal');
      bg.classList.remove('hidden');
      // Schlimmster Fall: Feed-Teilen an, Upload-Knopf sichtbar.
      document.getElementById('upload-share-feed').checked = true;
      document.getElementById('upload-share-feed-fields').classList.remove('hidden');
      document.getElementById('do-upload-btn').style.display = 'flex';
      document.documentElement.setAttribute('data-theme', 'dark');

      // ALLES innerhalb von #up-modal suchen: die Seite traegt mehrere
      // .modal-Instanzen (Changelog, Broadcast, ...), und document.querySelector
      // trifft die erste im DOM — nicht die gemeinte.
      const cs = getComputedStyle(bg);
      const mo = bg.querySelector('.modal').getBoundingClientRect();
      const hd = bg.querySelector('.modal-hdr').getBoundingClientRect();
      const x = bg.querySelector('.modal-x').getBoundingClientRect();
      const body = bg.querySelector('.modal-body');
      body.scrollTop = body.scrollHeight;
      const xNach = bg.querySelector('.modal-x').getBoundingClientRect();
      return {
        standalone: matchMedia('(display-mode: standalone)').matches,
        // Der Kettenbeweis: kommt das Inset wirklich im Padding an?
        padTop: cs.paddingTop, padBottom: cs.paddingBottom,
        modalH: Math.round(mo.height), modalTop: Math.round(mo.top), modalBottom: Math.round(mo.bottom),
        hdrTop: Math.round(hd.top),
        x: [Math.round(x.top), Math.round(x.bottom), Math.round(x.width), Math.round(x.height)],
        xBleibt: Math.round(xNach.top) === Math.round(x.top),
        overlayScrollt: bg.scrollHeight > bg.clientHeight,
        inSafeArea: mo.top >= top && mo.bottom <= h - bottom,
        xTrefferOk: x.top >= top && x.bottom <= h - bottom && x.width >= 40 && x.height >= 40,
      };
    }, g);

    // display-mode geht NICHT ins Verdikt: die Medienabfrage kommt im ganzen
    // CSS nicht vor (geprueft per grep), standalone aendert an der Geometrie
    // also nichts ausser den Insets — und die sind hier echt gesetzt.
    const ok = m.inSafeArea && !m.overlayScrollt && m.xBleibt &&
               (g.w > 900 ? true : m.xTrefferOk);
    zeilen.push({ geraet: g.name, ...m, VERDIKT: ok ? 'gruen' : 'ROT' });
    await page.screenshot({ path: path.join(__dirname, MARKE + '-' + g.name.replace(/ /g, '_') + '.png') });
    await ctx.close();
  }
  console.table(zeilen.map(z => ({
    Geraet: z.geraet, standalone: z.standalone, 'padding-top': z.padTop, 'padding-bottom': z.padBottom,
    Hoehe: z.modalH, Oberkante: z.modalTop, Unterkante: z.modalBottom,
    'X (t/b/w/h)': z.x.join('/'), 'X bleibt': z.xBleibt, 'Overlay scrollt': z.overlayScrollt,
    'in Safe Area': z.inSafeArea, VERDIKT: z.VERDIKT,
  })));
  await browser.close();
})();
