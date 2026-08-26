// Edge headless: Bug 2 — Fokus bleibt in jedem Eingabefeld,
// Bug 1 — kein Logo-Drop ohne Funktion.
//
// Wir gehen ALLE Wizard-Felder durch und tippen mehrstellige Werte.
// Nach jeder Tastatureingabe muss das aktive Element weiter das
// Eingabefeld sein (nicht BODY, nicht neu).

import { setTimeout as sleep } from 'node:timers/promises';

async function getTargets() {
  return (await fetch('http://127.0.0.1:9222/json')).json();
}

async function attachToPage() {
  let targets = await getTargets();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
  for (let i = 0; i < 25 && !page; i++) {
    await sleep(200);
    targets = await getTargets();
    page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
  }
  if (!page) throw new Error('kein Edge-Target mit screen-b-preview.html');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return {
    ws,
    send: async (method, params = {}) => {
      const reqId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        ws.send(JSON.stringify({ id: reqId, method, params }));
      });
    },
  };
}

async function evalPage(send, fnStr, arg = null) {
  const expr = `(${fnStr})(${arg === null ? '' : JSON.stringify(arg)})`;
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('eval: ' + r.exceptionDetails.text + ' :: ' + (r.result?.description || ''));
  }
  return r.result?.value;
}

function expect(cond, label) {
  const tag = cond ? '✓ PASS' : '✗ FAIL';
  console.log(tag, label);
  if (!cond) process.exitCode = 1;
}

async function runTests() {
  console.log('=== Edge headless: Wizard-Fokus + keine Logo-Attrappe ===\n');

  const s = await attachToPage();
  const send = s.send;
  const evalPageFn = (fnStr, arg) => evalPage(send, fnStr, arg);

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);

  // Shim verfügbar?
  for (let i = 0; i < 50; i++) {
    const ready = await evalPageFn(() => window.__tReady === true);
    if (ready) break;
    await sleep(100);
  }
  const shim = await evalPageFn(() => ({
    ready: window.__tReady,
    hasRWV: typeof window.__renderWizardView,
  }));
  if (shim.ready !== true || shim.hasRWV !== 'function') {
    console.error('Test-Shim nicht verfügbar:', JSON.stringify(shim));
    process.exit(2);
  }

  // ----------------------------------------------------------------
  // BUG 1: Logo-Drop-Zone darf nirgends im Wizard vorkommen.
  // ----------------------------------------------------------------
  console.log('\n--- BUG 1: keine Logo-Drop-Attrappe ---');

  const logoProbe = await evalPageFn(() => {
    // Wizard mit kompletter State-Vorlage rendern und schauen, ob
    // .t-wizard-drop auftaucht.
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: 'X' },
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
    return {
      dropCount: document.querySelectorAll('.t-wizard-drop').length,
      fileInputCount: document.querySelectorAll('input[type=file]').length,
      logoLabels: Array.from(document.querySelectorAll('.t-wizard-field-label'))
        .map((l) => l.textContent)
        .filter((t) => /logo/i.test(t)),
    };
  });

  expect(
    logoProbe.dropCount === 0,
    `Kein .t-wizard-drop mehr im DOM (real: ${logoProbe.dropCount})`
  );
  expect(
    logoProbe.fileInputCount === 0,
    `Kein <input type="file"> (real: ${logoProbe.fileInputCount})`
  );
  expect(
    logoProbe.logoLabels.length === 0,
    `Kein Label mit „Logo" mehr (real: ${JSON.stringify(logoProbe.logoLabels)})`
  );

  // ----------------------------------------------------------------
  // BUG 2: Für jedes Feld prüfen, dass nach 2 Eingaben der Fokus
  // noch im Feld ist. Wir nutzen den URL-?step= Hook, um die
  // Schritte sauber einzeln zu laden.
  // ----------------------------------------------------------------
  console.log('\n--- BUG 2: Fokus bleibt in jedem Eingabefeld ---');

  async function loadStep(stepNum) {
    await evalPageFn((n) => {
      const params = new URLSearchParams(location.search);
      params.set('step', String(n));
      history.replaceState(null, '', '?' + params.toString());
      const ROOT = document.getElementById('root');
      ROOT.innerHTML = '';
    }, stepNum);
    await sleep(300);
  }

  // Pro Step durch alle <input>/<textarea> gehen, Fokus setzen,
  // 2 Eingaben simulieren, prüfen dass aktives Element = Eingabefeld.
  async function checkFocusOnStep(stepNum) {
    // Jedes Feld bekommt einen Index im DOM, damit wir es später
    // wiederfinden — auch wenn es kein id-Attribut hat.
    const fieldCount = await evalPageFn((n) => {
      const ROOT = document.getElementById('root');
      const w = window.__renderWizardView({
        initialState: {
          step: n,
          name: 'Sommer-Cup 2026',
          date: '2026-09-05',
          location: 'Sporthalle Süd',
          teams: [
            { name: 'A', seed: 1 },
            { name: 'B', seed: 2 },
            { name: 'C', seed: 3 },
            { name: 'D', seed: 4 },
            { name: 'E', seed: 5 },
            { name: 'F', seed: 6 },
          ],
          numGroups: 3,
          advancePerGroup: 2,
          bestThirdsCount: 2,
          matchDuration: 15,
          pauseMinutes: 5,
          startTime: '14:00',
          teamInput: 'A\nB\nC\nD\nE\nF',
        },
        onStateChange: () => {},
        onCancel: () => {},
      });
      ROOT.innerHTML = '';
      ROOT.appendChild(w);
      const inputs = Array.from(
        w.querySelectorAll(
          'input:not([type=button]):not([type=submit]):not([type=radio]):not([type=checkbox]), textarea'
        )
      );
      return inputs.map((i, idx) => ({
        idx,
        type: i.type,
        label:
          i.closest('.t-wizard-field')?.querySelector('.t-wizard-field-label')?.textContent ||
          i.closest('.t-wizard-points-cell')?.querySelector('span')?.textContent ||
          i.tagName,
      }));
    }, stepNum);

    const failed = [];
    for (const f of fieldCount) {
      const result = await evalPageFn(
        ({ step, idx }) => {
          // Erneut rendern, damit das Feld frisch da ist (kein Zustand
          // vom letzten Feld übrig).
          const ROOT = document.getElementById('root');
          const w = window.__renderWizardView({
            initialState: {
              step,
              name: 'Sommer-Cup 2026',
              date: '2026-09-05',
              location: 'Sporthalle Süd',
              teams: [
                { name: 'A', seed: 1 },
                { name: 'B', seed: 2 },
                { name: 'C', seed: 3 },
                { name: 'D', seed: 4 },
                { name: 'E', seed: 5 },
                { name: 'F', seed: 6 },
              ],
              numGroups: 3,
              advancePerGroup: 2,
              bestThirdsCount: 2,
              matchDuration: 15,
              pauseMinutes: 5,
              startTime: '14:00',
              teamInput: 'A\nB\nC\nD\nE\nF',
            },
            onStateChange: () => {},
            onCancel: () => {},
          });
          ROOT.innerHTML = '';
          ROOT.appendChild(w);
          const inputs = Array.from(
            w.querySelectorAll(
              'input:not([type=button]):not([type=submit]):not([type=radio]):not([type=checkbox]), textarea'
            )
          );
          const input = inputs[idx];
          if (!input) return { ok: false, why: 'not-found', total: inputs.length };
          input.focus();
          const before = document.activeElement === input;
          const v1 = input.type === 'number' ? '5' : input.type === 'time' ? '14:30' : 'X';
          input.value = v1;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const after1 = document.activeElement === input;
          const v2 = input.type === 'number' ? '52' : input.type === 'time' ? '14:35' : 'XY';
          input.value = v2;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const after2 = document.activeElement === input;
          return {
            before,
            after1,
            after2,
            activeTag: document.activeElement?.tagName,
            activeType: document.activeElement?.type,
          };
        },
        { step: stepNum, idx: f.idx }
      );

      const ok = result.before && result.after1 && result.after2;
      const tag = ok ? '✓ PASS' : '✗ FAIL';
      console.log(`  ${tag} [step ${stepNum}] ${f.type}/${f.label || '(ohne Label)'}`);
      if (!ok) {
        console.log(`        Detail: ${JSON.stringify(result)}`);
        failed.push({ step: stepNum, field: f, result });
      }
    }
    return failed;
  }

  // Wir testen Step 1, 3 und 4 (Step 2 ist Teams-Paste; Step 5 ist Live-Vorschau).
  const allFailed = [];
  for (const step of [1, 3, 4]) {
    await loadStep(step);
    const failed = await checkFocusOnStep(step);
    allFailed.push(...failed);
  }

  expect(
    allFailed.length === 0,
    `Fokus bleibt in allen Eingabefeldern (verloren: ${allFailed.length})`
  );

  // ----------------------------------------------------------------
  // Sanity: Live-Preview reagiert ohne Re-Render (BUG 2 Begleit-Check).
  // ----------------------------------------------------------------
  console.log('\n--- Live-Preview reagiert auf Spieldauer-Eingabe ---');

  await loadStep(4);
  const liveCheck = await evalPageFn(() => {
    const w = window.__renderWizardView({
      initialState: {
        step: 4,
        name: 'X',
        teams: [
          { name: 'A', seed: 1 },
          { name: 'B', seed: 2 },
          { name: 'C', seed: 3 },
          { name: 'D', seed: 4 },
          { name: 'E', seed: 5 },
          { name: 'F', seed: 6 },
        ],
        numGroups: 3,
        matchDuration: 15,
        pauseMinutes: 5,
        startTime: '14:00',
      },
      onStateChange: () => {},
      onCancel: () => {},
    });
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    ROOT.appendChild(w);
    const inputs = Array.from(w.querySelectorAll('input[type=number]'));
    const durInput = inputs[0]; // Spieldauer
    durInput.focus();
    const before = document.querySelector('[data-t-wizard-end-info="true"]')?.textContent;
    durInput.value = '30';
    durInput.dispatchEvent(new Event('input', { bubbles: true }));
    const after = document.querySelector('[data-t-wizard-end-info="true"]')?.textContent;
    return {
      focusStayed: document.activeElement === durInput,
      before,
      after,
      changed: before !== after,
    };
  });
  expect(liveCheck.focusStayed, 'Fokus bleibt nach Spieldauer-Eingabe');
  expect(
    liveCheck.changed,
    `Live-Preview-Text ändert sich (vor: „${liveCheck.before?.slice(0, 60)}…", nach: „${liveCheck.after?.slice(0, 60)}…")`
  );

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
