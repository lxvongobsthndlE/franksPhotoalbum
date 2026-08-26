// E2E-Test: Step 5 (Zusammenfassung) respektiert state.mode.
//
// Sicherstellen, dass die Mindest-Team-Anzahl für die Endzeit-Anzeige
// modusspezifisch ist:
//   ko_only      → 2 Teams reichen
//   groups_*     → numGroups * 2 Teams nötig

import { setTimeout as sleep } from 'node:timers/promises';

async function getTargets() {
  return (await fetch('http://127.0.0.1:9222/json')).json();
}

async function attachToPage() {
  let targets = await getTargets();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
  for (let i = 0 && !page; i < 25; i++) {
    await sleep(200);
    targets = await getTargets();
    page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
  }
  if (!page) throw new Error('kein Edge-Target');
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
  console.log('=== E2E: Step 5 modus-aware Endzeit ===\n');

  const s = await attachToPage();
  const send = s.send;

  await send('Page.enable');
  await send('Page.navigate', {
    url: 'http://localhost:4180/screen-b-preview.html?view=wizard',
  });
  await sleep(800);

  for (let i = 0; i < 50; i++) {
    const ready = await evalPage(send, () => window.__tReady === true);
    if (ready) break;
    await sleep(100);
  }
  const shim = await evalPage(send, () => ({
    ready: window.__tReady,
    hasRWV: typeof window.__renderWizardView,
  }));
  if (shim.ready !== true || shim.hasRWV !== 'function') {
    console.error('Test-Shim nicht verfügbar:', JSON.stringify(shim));
    process.exit(2);
  }

  async function renderWith(stateIn) {
    return await evalPage(
      send,
      (cfg) => {
        const ROOT = document.getElementById('root');
        ROOT.innerHTML = '';
        const state = cfg.state;
        const w = window.__renderWizardView({
          initialState: state,
          onStateChange: () => {},
          onCancel: () => {},
        });
        ROOT.appendChild(w);
        const rows = Array.from(document.querySelectorAll('.t-wizard-summary-row, dt'));
        const out = {};
        for (const r of rows) {
          // Step 5 nutzt <dl> mit <dt>/<dd> via appendSummaryRow.
          if (r.tagName === 'DT') {
            const dd = r.nextElementSibling;
            out[r.textContent] = dd?.textContent;
          }
        }
        return {
          rows: out,
          hasEnde: out['Voraussichtliches Ende'] !== undefined,
        };
      },
      { state: stateIn }
    );
  }

  // ----------------------------------------------------------------
  // Test 1: ko_only mit 2 Teams → Endzeit vorhanden
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: ko_only, 2 Teams → Endzeit vorhanden ---');
  {
    const teams = Array.from({ length: 2 }, (_, i) => ({
      name: 'T' + (i + 1),
      color: null,
      seed: i + 1,
    }));
    const r = await renderWith({
      step: 5,
      name: 'K.o. mini',
      teams,
      mode: 'ko_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 1,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    expect(r.hasEnde, `Endzeit angezeigt (real: hasEnde=${r.hasEnde})`);
  }

  // ----------------------------------------------------------------
  // Test 2: groups_only mit 4 Teams / 1 Gruppe → zu wenig → keine Endzeit
  // (4 Teams, 1 Gruppe: 4 >= 1*2 = 2 → reicht, sollte da sein)
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: groups_only, 4 / 1 Gruppe → Endzeit vorhanden ---');
  {
    const teams = Array.from({ length: 4 }, (_, i) => ({
      name: 'T' + (i + 1),
      color: null,
      seed: i + 1,
    }));
    const r = await renderWith({
      step: 5,
      name: 'groups mini',
      teams,
      mode: 'groups_only',
      numGroups: 1,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 1,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    expect(r.hasEnde, `Endzeit angezeigt (real: hasEnde=${r.hasEnde})`);
  }

  // ----------------------------------------------------------------
  // Test 3: groups_only mit 2 Teams / 2 Gruppen → zu wenig → keine Endzeit
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: groups_only, 2 / 2 Gruppen → KEINE Endzeit ---');
  {
    const teams = Array.from({ length: 2 }, (_, i) => ({
      name: 'T' + (i + 1),
      color: null,
      seed: i + 1,
    }));
    const r = await renderWith({
      step: 5,
      name: 'groups zu wenig',
      teams,
      mode: 'groups_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 1,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    expect(!r.hasEnde, `Endzeit NICHT angezeigt (real: hasEnde=${r.hasEnde})`);
  }

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
