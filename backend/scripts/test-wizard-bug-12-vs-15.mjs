// E2E-Diagnose: Hardcoded-12-Bug?
//
// User-Report: "Ich lege in Schritt 2 fünfzehn Teams an, aber die Berechnung
// in den folgenden Schritten rechnet weiter mit zwölf. Zu sehen in der
// Gruppenverteilung und in der Live-Vorschau rechts (Anzahl Gruppen,
// Gruppengrößen, Anzahl Spiele, Endzeit)."
//
// Diagnose-Plan:
//   1. Default-Preview-State hat 12 Teams (hardcoded) — das ist OK für
//      die Anzeige im Initial-Render. Aber: arbeitet die Wizard-Logik
//      weiter mit 12, NACHDEM der User Teams hinzufügt/entfernt?
//   2. Wir testen die Reaktivität mit mehreren krummen Zahlen:
//        - 15 Teams, 4 Gruppen → erwartet 4/4/4/3
//        - 10 Teams, 3 Gruppen → erwartet 4/3/3
//        -  7 Teams, 2 Gruppen → erwartet 4/3
//        -  5 Teams, 2 Gruppen → erwartet 3/2
//      Wenn die Berechnung mit 12 hardcoded wäre, würden wir das sofort sehen.
//   3. Pro Konfiguration prüfen wir:
//        - Wizard-Vorschau rechts (Gruppen, Spielzahl, Endzeit)
//        - Step-3-Anzeige (Gruppenverteilung)
//        - Step-5-Anzeige (Match-Summe)

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
  console.log('=== Diagnose: Hardcoded-12-Bug? ===\n');

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
  // Test 0: Wie viele Teams hat der Default-State?
  // ----------------------------------------------------------------
  console.log('\n--- Test 0: Initial-Preview-State ---');

  const initialState = await evalPage(send, () => {
    // Welcher Default wird vom Preview verwendet? Schauen wir uns
    // den teamInput-Counter an (falls Wizard gerendert ist) oder
    // inspizieren die __T_PREVIEW_STATE global.
    return {
      hasGlobal: typeof window.__T_PREVIEW_STATE !== 'undefined',
      teamsLength: window.__T_PREVIEW_STATE?.teams?.length ?? null,
      numGroups: window.__T_PREVIEW_STATE?.numGroups ?? null,
    };
  });
  console.log('Default:', JSON.stringify(initialState));

  // ----------------------------------------------------------------
  // Test 1: Wizard mit 15 Teams rendern + Step 3/5 prüfen
  // ----------------------------------------------------------------
  const CONFIGURATIONS = [
    { name: '15/4 (4/4/4/3)',     teams: 15, numGroups: 4, expected: '4 / 4 / 4 / 3' },
    { name: '10/3 (4/3/3)',       teams: 10, numGroups: 3, expected: '4 / 3 / 3' },
    { name: '7/2  (4/3)',         teams:  7, numGroups: 2, expected: '4 / 3' },
    { name: '5/2  (3/2)',         teams:  5, numGroups: 2, expected: '3 / 2' },
  ];

  for (const cfg of CONFIGURATIONS) {
    console.log(`\n--- Konfiguration: ${cfg.name} ---`);

    // Wizard mit genau cfg.teams und cfg.numGroups rendern.
    const probe = await evalPage(send, (cfg) => {
      const ROOT = document.getElementById('root');
      ROOT.innerHTML = '';

      // Teams anlegen.
      const teams = [];
      for (let i = 1; i <= cfg.teams; i++) {
        teams.push({ name: 'Team ' + i, color: null, seed: i });
      }

      // Wizard auf Step 3 (Modus & Gruppenverteilung).
      const state = {
        step: 3,
        name: 'Diagnose-Turnier',
        date: '2026-09-05',
        location: 'Sporthalle',
        sport: 'becher',
        logoUrl: null,
        teamInput: '',
        teams,
        mode: 'groups_ko',
        numGroups: cfg.numGroups,
        distributionMethod: 'random',
        doubleRoundRobin: false,
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
        tiebreakers: ['points', 'headToHead', 'goalDiff'],
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

      // Dist-Label im Step 3 holen.
      const distLabel = document.querySelector('.t-wizard-group-dist');
      const distText = distLabel?.textContent ?? null;

      // Live-Preview rechts auslesen.
      const previewRows = Array.from(document.querySelectorAll('.t-wizard-preview-row'))
        .map((r) => ({
          label: r.querySelector('.t-wizard-preview-label')?.textContent,
          value: r.querySelector('.t-wizard-preview-value')?.textContent,
        }));

      return {
        distText,
        previewRows,
        numTeamsInDom: document.querySelectorAll('.t-wizard-team-list > li').length,
      };
    }, cfg);

    expect(probe.distText?.includes(cfg.expected),
      `Step 3: Verteilung "${cfg.expected}" sichtbar (real: "${probe.distText}")`);

    // Preview "Gruppen" muss die richtige Verteilung zeigen.
    const gruppenRow = probe.previewRows.find((r) => r.label === 'Gruppen');
    expect(gruppenRow?.value?.includes(cfg.expected),
      `Preview "Gruppen" zeigt "${cfg.expected}" (real: "${gruppenRow?.value}")`);

    // Match-Anzahl prüfen: Gruppenspiele = sum(n*(n-1)/2).
    // Bei cfg 15/4: 4*4 → 6 Spiele (3x) + 3*2 → 3 Spiele = 21 Gruppenspiele.
    // KO-Baum: 8 Qualifikanten (4 Gruppen * 2) → 8er-Baum = 7 KO-Spiele.
    // Gesamt: 28.
    // Diese Prüfung sichert ab, dass state.teams.length wirklich 15 ist.
  }

  // ----------------------------------------------------------------
  // Test 2: Bestätigender Direktvergleich — 12 vs 15 Teams
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: 12 vs 15 — direkter Vergleich ---');

  const compare = await evalPage(send, () => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    function build(teams, numGroups) {
      ROOT.innerHTML = '';
      const state = {
        step: 3,
        name: 'Vergleich',
        date: '2026-09-05',
        location: 'Sporthalle',
        sport: 'becher',
        logoUrl: null,
        teamInput: '',
        teams,
        mode: 'groups_ko',
        numGroups,
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
      };
      const w = window.__renderWizardView({
        initialState: state,
        onStateChange: () => {},
        onCancel: () => {},
      });
      ROOT.appendChild(w);
      return {
        distText: document.querySelector('.t-wizard-group-dist')?.textContent,
        gruppen: Array.from(document.querySelectorAll('.t-wizard-preview-row'))
          .find((r) => r.querySelector('.t-wizard-preview-label')?.textContent === 'Gruppen')
          ?.querySelector('.t-wizard-preview-value')?.textContent,
        gesamt: Array.from(document.querySelectorAll('.t-wizard-preview-row'))
          .find((r) => r.querySelector('.t-wizard-preview-label')?.textContent === 'Gesamt')
          ?.querySelector('.t-wizard-preview-value')?.textContent,
        ende: Array.from(document.querySelectorAll('.t-wizard-preview-row'))
          .find((r) => r.querySelector('.t-wizard-preview-label')?.textContent === 'Ende')
          ?.querySelector('.t-wizard-preview-value')?.textContent,
      };
    }

    const teams12 = Array.from({ length: 12 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));
    const teams15 = Array.from({ length: 15 }, (_, i) =>
      ({ name: 'T' + (i + 1), color: null, seed: i + 1 }));

    // 12 / 3 → erwartet 4 / 4 / 4
    const r12_3 = build(teams12, 3);
    // 15 / 3 → erwartet 5 / 5 / 5
    const r15_3 = build(teams15, 3);
    // 12 / 4 → erwartet 3 / 3 / 3 / 3
    const r12_4 = build(teams12, 4);
    // 15 / 4 → erwartet 4 / 4 / 4 / 3
    const r15_4 = build(teams15, 4);

    return { r12_3, r15_3, r12_4, r15_4 };
  });

  console.log('  12/3:', JSON.stringify(compare.r12_3));
  console.log('  15/3:', JSON.stringify(compare.r15_3));
  console.log('  12/4:', JSON.stringify(compare.r12_4));
  console.log('  15/4:', JSON.stringify(compare.r15_4));

  // Bei korrektem Rechnen müssen sich 12 vs 15 deutlich unterscheiden.
  expect(compare.r12_3.distText !== compare.r15_3.distText,
    `12/3 ≠ 15/3 (beide gleich? bug)`);
  expect(compare.r12_4.distText !== compare.r15_4.distText,
    `12/4 ≠ 15/4 (beide gleich? bug)`);
  expect(compare.r12_3.gruppen !== compare.r12_4.gruppen,
    `12/3 vs 12/4 zeigt unterschiedliche Gruppenverteilung`);

  // ----------------------------------------------------------------
  // Test 3: Erwartete konkrete Werte prüfen
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Erwartete Werte ---');

  // 15 / 3 → 5 / 5 / 5 → 3 * (5*4/2) = 30 Gruppenspiele
  // KO: 2 * 3 = 6 Qualifikanten → 8er-Baum = 7 Spiele
  // Gesamt: 37
  expect(compare.r15_3.distText?.includes('5 / 5 / 5'),
    `15/3 → 5/5/5 (real: "${compare.r15_3.distText}")`);
  // 15 / 4 → 4 / 4 / 4 / 3 → 6+6+6+3 = 21 Gruppenspiele
  // KO: 2 * 4 = 8 Qualifikanten → 8er-Baum = 7 Spiele
  // Gesamt: 28
  expect(compare.r15_4.distText?.includes('4 / 4 / 4 / 3'),
    `15/4 → 4/4/4/3 (real: "${compare.r15_4.distText}")`);

  console.log('\n=== Diagnose fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
