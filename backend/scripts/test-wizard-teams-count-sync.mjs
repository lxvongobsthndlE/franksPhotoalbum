// E2E-Test: Zahlenfeld oben spiegelt die Listen-Länge.
//
// User-Report: "In Schritt 2 gibt es oben ein Zahlenfeld und unten die
// Liste mit '+ Team hinzufügen'. Wenn ich unten Teams ergänze, zeigt das
// Feld oben noch die alte Zahl — zwei Angaben auf einem Bildschirm, die
// sich widersprechen."
//
// Erwartung nach Fix:
//   - Initial: Zahlenfeld == Listen-Länge.
//   - addBtn-Klick → Zahlenfeld erhöht sich um 1.
//   - removeTeam-Aufruf → refreshAfterMutation() → Zahlenfeld folgt.
//   - applyCount(15) über "Anzahl übernehmen" → Zahlenfeld == 15.

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
  console.log('=== E2E: Zahlenfeld-Sync in Schritt 2 ===\n');

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

  // ----------------------------------------------------------------
  // Test 1: Wizard Step 2 rendern, Initial-Sync prüfen
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Initial-Sync ---');

  const initial = await evalPage(send, () => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const teams = [];
    for (let i = 1; i <= 12; i++) {
      teams.push({ name: 'Team ' + i, color: null, seed: i });
    }
    const state = {
      step: 2,
      name: 'Sync-Test',
      teams,
      teamInput: '',
      mode: 'groups_ko',
      numGroups: 3,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    };
    const w = window.__renderWizardView({
      initialState: state,
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);

    return {
      numberInputValue: document.querySelector('.t-wizard-stepper-input')?.value,
      rowsCount: document.querySelectorAll('.t-wizard-team-row').length,
    };
  });

  expect(
    initial.numberInputValue === '12',
    `Zahlenfeld zeigt 12 (real: "${initial.numberInputValue}")`
  );
  expect(initial.rowsCount === 12, `Liste hat 12 Zeilen (real: ${initial.rowsCount})`);

  // ----------------------------------------------------------------
  // Test 2: addBtn-Klick → Zahlenfeld folgt auf 13
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: addBtn → Zahlenfeld 12 → 13 ---');

  await evalPage(send, () => {
    document.querySelector('.t-wizard-teams-cta + * + * + button:last-of-type')?.click();
    // Sicherer: alle t-wizard-ghost Buttons durchgehen.
  });

  // Klicke den "Team hinzufügen" Button (genauer Selector).
  await evalPage(send, () => {
    const buttons = Array.from(document.querySelectorAll('.t-wizard-field button.t-btn--ghost'));
    const addBtn = buttons.find((b) => b.textContent.trim() === '+ Team hinzufügen');
    if (addBtn) addBtn.click();
  });
  await sleep(150);

  const afterAdd = await evalPage(send, () => ({
    numberInputValue: document.querySelector('.t-wizard-stepper-input')?.value,
    rowsCount: document.querySelectorAll('.t-wizard-team-row').length,
  }));

  expect(
    afterAdd.numberInputValue === '13',
    `Zahlenfeld spiegelt 13 nach addBtn (real: "${afterAdd.numberInputValue}")`
  );
  expect(afterAdd.rowsCount === 13, `Liste hat 13 Zeilen (real: ${afterAdd.rowsCount})`);

  // ----------------------------------------------------------------
  // Test 3: zwei weitere addBtn-Klicks → 15
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: zwei weitere Klicks → 15 ---');

  for (let i = 0; i < 2; i++) {
    await evalPage(send, () => {
      const buttons = Array.from(document.querySelectorAll('.t-wizard-field button.t-btn--ghost'));
      const addBtn = buttons.find((b) => b.textContent.trim() === '+ Team hinzufügen');
      if (addBtn) addBtn.click();
    });
    await sleep(80);
  }

  const afterMore = await evalPage(send, () => ({
    numberInputValue: document.querySelector('.t-wizard-stepper-input')?.value,
    rowsCount: document.querySelectorAll('.t-wizard-team-row').length,
  }));

  expect(
    afterMore.numberInputValue === '15',
    `Zahlenfeld = 15 nach 3 addBtn (real: "${afterMore.numberInputValue}")`
  );
  expect(afterMore.rowsCount === 15, `Liste hat 15 Zeilen (real: ${afterMore.rowsCount})`);

  // ----------------------------------------------------------------
  // Test 4: Feld oben darf weiterhin Bedienelement sein — Tippen
  // einer Zahl + "Anzahl übernehmen" muss die Liste auf genau diese
  // Zahl setzen.
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Feld ist weiterhin Bedienelement ---');

  await evalPage(send, () => {
    const input = document.querySelector('.t-wizard-stepper-input');
    input.value = '5';
    const applyBtn = Array.from(
      document.querySelectorAll('.t-wizard-teams-path button.t-btn--primary')
    ).find((b) => b.textContent.trim() === 'Anzahl übernehmen');
    if (applyBtn) applyBtn.click();
  });
  await sleep(300);

  const afterApply = await evalPage(send, () => ({
    numberInputValue: document.querySelector('.t-wizard-stepper-input')?.value,
    rowsCount: document.querySelectorAll('.t-wizard-team-row').length,
  }));

  expect(
    afterApply.numberInputValue === '5',
    `Nach applyCount(5): Feld = 5 (real: "${afterApply.numberInputValue}")`
  );
  expect(
    afterApply.rowsCount === 5,
    `Nach applyCount(5): Liste = 5 Zeilen (real: ${afterApply.rowsCount})`
  );

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
