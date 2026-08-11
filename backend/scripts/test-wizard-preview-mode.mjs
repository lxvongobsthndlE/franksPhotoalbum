// E2E-Test: Vorschau respektiert state.mode.
//
// User-Report: "Bei 'Nur K.-o.' zeigt sie:
//   Gruppenspiele 24, K.-o.-Spiele 8, Gesamt 32 Spiele.
//   Bei 'Nur Gruppen' zeigt sie dieselben Zahlen."
//
// Erwartung:
//   Nur Gruppen, 12 Teams, 3 Gruppen → 18 Spiele, keine K.-o.-Zeile
//   Nur K.-o., 16 Teams               → 15 Spiele (16 mit Platz 3)
//   Nur K.-o., 12 Teams               → 11 Spiele (4 Freilose)
//   Gruppen + K.o., 12/3/Top2+2 Dritte → 18 + 8 = 26
//
// Plus: Endzeit-Hochrechnung muss stimmen.

import { setTimeout as sleep } from 'node:timers/promises';

async function getTargets() {
  return (await fetch('http://127.0.0.1:9222/json')).json();
}

async function attachToPage() {
  let targets = await getTargets();
  let page = targets.find((t) => t.type === 'page'
    && t.url.includes('screen-b-preview'));
  for (let i = 0 && !page; i < 25; i++) {
    await sleep(200);
    targets = await getTargets();
    page = targets.find((t) => t.type === 'page'
      && t.url.includes('screen-b-preview'));
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
  return { ws, send: async (method, params = {}) => {
    const reqId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }};
}

async function evalPage(send, fnStr, arg = null) {
  const expr = `(${fnStr})(${arg === null ? '' : JSON.stringify(arg)})`;
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('eval: ' + r.exceptionDetails.text
      + ' :: ' + (r.result?.description || ''));
  }
  return r.result?.value;
}

function expect(cond, label) {
  const tag = cond ? '✓ PASS' : '✗ FAIL';
  console.log(tag, label);
  if (!cond) process.exitCode = 1;
}

async function runTests() {
  console.log('=== E2E: Vorschau respektiert state.mode ===\n');

  const s = await attachToPage();
  const send = s.send;

  await send('Page.enable');
  await send('Page.navigate', {
    url: 'http://localhost:4180/screen-b-preview.html?view=wizard',
  });
  await sleep(800);

  for (let i = 0; i < 50; i++) {
    const ready = (await evalPage(send, () => window.__tReady === true));
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
  // Helper: Wizard mit gegebenem State rendern, Preview-Zeilen lesen.
  // ----------------------------------------------------------------
  async function renderWith(stateIn) {
    return await evalPage(send, (cfg) => {
      const ROOT = document.getElementById('root');
      ROOT.innerHTML = '';
      const state = cfg.state;
      const w = window.__renderWizardView({
        initialState: state,
        onStateChange: () => {},
        onCancel: () => {},
      });
      ROOT.appendChild(w);
      const rows = Array.from(document.querySelectorAll('.t-wizard-preview-row'));
      const result = {};
      for (const r of rows) {
        const label = r.querySelector('.t-wizard-preview-label')?.textContent;
        const value = r.querySelector('.t-wizard-preview-value')?.textContent;
        if (label) result[label] = value;
      }
      return {
        rows: result,
        // Eindeutige Schlüsselzählung für ASSERT.
        hasGroupGames: result['Gruppenspiele'] !== undefined,
        hasKoGames: result['K.-o.-Spiele'] !== undefined,
        hasQualifiers: result['Qualifikanten'] !== undefined,
        hasRound: result['Runde'] !== undefined,
        hasGroups: result['Gruppen'] !== undefined,
        hasTeams: result['Teams'] !== undefined,
      };
    }, { state: stateIn });
  }

  // ----------------------------------------------------------------
  // Test 1: "Nur Gruppen", 12 Teams / 3 Gruppen → 18 Spiele
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Nur Gruppen, 12 / 3 → 18 Spiele ---');
  {
    const teams = Array.from({ length: 12 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'Nur Gruppen',
      teams,
      mode: 'groups_only',
      numGroups: 3,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(r.hasGroupGames,
      `Gruppenspiele-Zeile vorhanden (Nur Gruppen)`);
    expect(!r.hasKoGames,
      `K.-o.-Spiele-Zeile NICHT vorhanden (Nur Gruppen)`);
    expect(!r.hasQualifiers,
      `Qualifikanten-Zeile NICHT vorhanden (Nur Gruppen)`);
    expect(r.rows['Gruppenspiele'] === '18',
      `Gruppenspiele = 18 (real: "${r.rows['Gruppenspiele']}")`);
    expect(r.rows['Gesamt']?.startsWith('18 Spiele'),
      `Gesamt = "18 Spiele ..." (real: "${r.rows['Gesamt']}")`);
  }

  // ----------------------------------------------------------------
  // Test 2: "Nur K.-o.", 16 Teams → 15 Spiele
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Nur K.-o., 16 Teams → 15 Spiele ---');
  {
    const teams = Array.from({ length: 16 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'Nur K.o.',
      teams,
      mode: 'ko_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(!r.hasGroupGames,
      `Gruppenspiele-Zeile NICHT vorhanden (Nur K.-o.)`);
    expect(r.hasKoGames,
      `K.-o.-Spiele-Zeile vorhanden (Nur K.-o.)`);
    expect(!r.hasGroups,
      `Gruppen-Zeile NICHT vorhanden (Nur K.-o.)`);
    expect(!r.hasQualifiers,
      `Qualifikanten-Zeile NICHT vorhanden (Nur K.-o.)`);
    expect(r.rows['K.-o.-Spiele'] === '15',
      `K.-o.-Spiele = 15 (real: "${r.rows['K.-o.-Spiele']}")`);
    expect(r.rows['Gesamt']?.startsWith('15 Spiele'),
      `Gesamt = "15 Spiele ..." (real: "${r.rows['Gesamt']}")`);
    expect(r.rows['Runde'] === 'Achtelfinale',
      `Runde = Achtelfinale (real: "${r.rows['Runde']}")`);
  }

  // ----------------------------------------------------------------
  // Test 3: "Nur K.-o.", 16 Teams + Spiel um Platz 3 → 16 Spiele
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Nur K.-o., 16 Teams + Platz 3 → 16 ---');
  {
    const teams = Array.from({ length: 16 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'K.o. mit Platz 3',
      teams,
      mode: 'ko_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: true,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    expect(r.rows['K.-o.-Spiele'] === '16',
      `K.-o.-Spiele = 16 (real: "${r.rows['K.-o.-Spiele']}")`);
  }

  // ----------------------------------------------------------------
  // Test 4: "Nur K.-o.", 12 Teams → 11 Spiele, 4 Freilose
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Nur K.-o., 12 Teams → 11 Spiele ---');
  {
    const teams = Array.from({ length: 12 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'K.o. 12',
      teams,
      mode: 'ko_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(r.rows['K.-o.-Spiele'] === '11',
      `K.-o.-Spiele = 11 (real: "${r.rows['K.-o.-Spiele']}")`);
    expect(r.rows['Runde'] === 'Achtelfinale',
      `Runde = Achtelfinale (12 Teams → 16 Slots, real: "${r.rows['Runde']}")`);
  }

  // ----------------------------------------------------------------
  // Test 5: "Gruppen + K.o.", 12/3/Top2+2 Dritte → 18 + 8 = 26
  // ----------------------------------------------------------------
  console.log('\n--- Test 5: Gruppen + K.o., 12/3/Top2+2 → 26 ---');
  {
    const teams = Array.from({ length: 12 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'Gruppen + K.o.',
      teams,
      mode: 'groups_ko',
      numGroups: 3,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 2,
      thirdPlaceMatch: true,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(r.rows['Gruppenspiele'] === '18',
      `Gruppenspiele = 18 (real: "${r.rows['Gruppenspiele']}")`);
    // 6 + 2 = 8 Qualifikanten → 8er-Baum = 7 KO + 1 Platz 3 = 8
    expect(r.rows['K.-o.-Spiele'] === '8',
      `K.-o.-Spiele = 8 (real: "${r.rows['K.-o.-Spiele']}")`);
    expect(r.rows['Gesamt']?.startsWith('26 Spiele'),
      `Gesamt = "26 Spiele ..." (real: "${r.rows['Gesamt']}")`);
    expect(r.rows['Qualifikanten'] === '8',
      `Qualifikanten = 8 (real: "${r.rows['Qualifikanten']}")`);
  }

  // ----------------------------------------------------------------
  // Test 6: "Gruppen + K.o." Kontrollwert — User-Bestätigung
  // "16 Teams, 4 Gruppen à 4 → 24 + 8 = 32"
  // ----------------------------------------------------------------
  console.log('\n--- Test 6: 16/4/Top2 → 24 + 8 = 32 (User-Kontrolle) ---');
  {
    const teams = Array.from({ length: 16 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'User-Kontrolle',
      teams,
      mode: 'groups_ko',
      numGroups: 4,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(r.rows['Gruppenspiele'] === '24',
      `Gruppenspiele = 24 (real: "${r.rows['Gruppenspiele']}")`);
    // 4*2 = 8 Qualifikanten → 8er-Baum = 7 + 0 = 7
    expect(r.rows['K.-o.-Spiele'] === '7',
      `K.-o.-Spiele = 7 (real: "${r.rows['K.-o.-Spiele']}")`);
    expect(r.rows['Gesamt']?.startsWith('31 Spiele'),
      `Gesamt = "31 Spiele ..." (real: "${r.rows['Gesamt']}")`);
    expect(r.rows['Runde'] === 'Viertelfinale',
      `Runde = Viertelfinale (real: "${r.rows['Runde']}")`);
  }

  // ----------------------------------------------------------------
  // Test 7: Endzeit-Hochrechnung für "Nur K.-o." 16 Teams / 4 Tische
  // 15 Spiele / 4 Tische = ceil(3.75) = 4 Slots à 20 Min = 80 Min.
  // 14:00 + 80 = 15:20
  // ----------------------------------------------------------------
  console.log('\n--- Test 7: Endzeit "Nur K.-o.", 16 / 4 Tische ---');
  {
    const teams = Array.from({ length: 16 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const r = await renderWith({
      step: 3,
      name: 'Endzeit K.o.',
      teams,
      mode: 'ko_only',
      numGroups: 2,
      distributionMethod: 'random',
      doubleRoundRobin: false,
      pointsWin: 3, pointsDraw: 1, pointsLoss: 0,
      tiebreakers: ['points', 'headToHead'],
      advancePerGroup: 2,
      bestThirdsCount: 0,
      thirdPlaceMatch: false,
      numTables: 4,
      tableNames: [],
      startTime: '14:00',
      matchDuration: 15,
      pauseMinutes: 5,
    });
    console.log('  rows:', JSON.stringify(r.rows));
    expect(r.rows['Ende'] === 'ca. 15:20 Uhr',
      `Ende = ca. 15:20 Uhr (real: "${r.rows['Ende']}")`);
  }

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});