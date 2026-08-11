// E2E-Test: Logo-Feld ist im Mock-Modus von Anfang an sichtbar und
// aktiv (kein Blur nötig, kein Backend).
//
// Realität (Stand 2026-08-11):
//   buildLogoField wird IMMER gerufen, auch im Mock-Modus. Im Mock
//   (kein opts.groupId) ist der Picker direkt aktiv und nutzt
//   FileReader/dataURL statt MinIO-Upload. Im Live-Modus ohne
//   Entwurf ist der Picker disabled mit Hinweis-Text; nach blur
//   des Namens + erfolgreichem POST wird er aktiv.

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
  console.log('=== E2E: Logo-Feld im Mock-Modus ===\n');

  const s = await attachToPage();
  const send = s.send;

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(700);

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
  // Test 1: Mock-Modus (kein groupId) → Logo-Feld direkt sichtbar,
  // Picker aktiv, KEIN Hinweis-Text.
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Mock → Picker von Anfang an aktiv ---');

  await evalPage(send, () => {
    window.__postCalls = [];
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      // KEIN groupId — Mock-Modus
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  const initial = await evalPage(send, () => ({
    pickBtn: document.querySelector('.t-wizard-logo-picker button'),
    pickBtnDisabled:
      document.querySelector('.t-wizard-logo-picker button')?.disabled,
    statusText: document.querySelector('.t-wizard-logo-status')?.textContent,
    fileInputExists: !!document.querySelector('.t-wizard-logo-file-input'),
    previewHidden:
      document.querySelector('.t-wizard-logo-preview')?.hidden,
    postCount: window.__postCalls.length,
  }));
  expect(initial.pickBtnDisabled === false,
    `Mock: Picker initial aktiv (real: disabled=${initial.pickBtnDisabled})`);
  expect(initial.fileInputExists === true,
    'Mock: fileInput im DOM');
  expect(initial.previewHidden === true,
    'Mock: Vorschau-Box initial versteckt');
  expect(initial.postCount === 0,
    `Mock: kein POST beim Render (real: ${initial.postCount})`);
  const isMockHinweis = initial.statusText?.includes('Hinweis');
  expect(isMockHinweis !== true,
    `Mock: kein Hinweis-Text (real: "${initial.statusText}")`);

  // ----------------------------------------------------------------
  // Test 2: Mock-Upload erzeugt dataURL-Vorschau.
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Mock-Upload erzeugt dataURL-Vorschau ---');

  const uploadResult = await evalPage(send, async () => {
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108020000009077'
      + '53de0000000c4944415478da6300010000000500010d0a2db40000000049454e44ae426082';
    const bytes = new Uint8Array(pngHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(pngHex.slice(i * 2, i * 2 + 2), 16);
    }
    const file = new File([bytes], 'logo.png', { type: 'image/png' });
    const input = document.querySelector('input.t-wizard-logo-file-input');
    if (!input) return { ok: false, reason: 'kein file-input' };

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 400));
    const img = document.querySelector('img.t-wizard-logo-img');
    const status = document.querySelector('.t-wizard-logo-status');
    return {
      ok: true,
      hasImg: !!img,
      srcStarts: img?.src?.slice(0, 22) ?? null,
      statusText: status?.textContent ?? null,
      statusClass: status?.className ?? '',
      pickerHidden: document.querySelector('.t-wizard-logo-picker')?.hidden,
    };
  });

  expect(uploadResult.ok, 'Upload-Versuch gelaufen');
  expect(uploadResult.hasImg === true,
    'Mock: Bild-Vorschau gerendert');
  expect(uploadResult.srcStarts === 'data:image/png;base',
    `Mock: dataURL-Start (real: ${uploadResult.srcStarts})`);
  expect(/Mock-Vorschau/i.test(uploadResult.statusText ?? ''),
    `Mock: Status-Text "Mock-Vorschau" (real: "${uploadResult.statusText}")`);
  expect(uploadResult.statusClass.includes('is-ok'),
    'Mock: Status-Text hat is-ok-Klasse');
  expect(uploadResult.pickerHidden === true,
    'Mock: Picker ausgeblendet nach Upload');

  // ----------------------------------------------------------------
  // Test 3: Mock-Entfernen räumt Vorschau + Picker wieder sichtbar.
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Mock-Entfernen räumt Vorschau ---');

  await evalPage(send, () => {
    const removeBtn = document.querySelector('[data-t-wizard-logo-remove="true"]');
    if (removeBtn) removeBtn.click();
  });
  await sleep(200);

  const afterRemove = await evalPage(send, () => ({
    hasImg: !!document.querySelector('img.t-wizard-logo-img'),
    pickerHidden: document.querySelector('.t-wizard-logo-picker')?.hidden,
    pickBtnDisabled:
      document.querySelector('.t-wizard-logo-picker button')?.disabled,
    postCount: window.__postCalls.length,
  }));
  expect(afterRemove.hasImg === false,
    'Mock: Vorschau-Bild entfernt');
  expect(afterRemove.pickerHidden === false,
    'Mock: Picker wieder sichtbar');
  expect(afterRemove.pickBtnDisabled === false,
    'Mock: Picker wieder aktiv');
  expect(afterRemove.postCount === 0,
    `Mock: kein POST (real: ${afterRemove.postCount})`);

  // ----------------------------------------------------------------
  // Test 4: Live-Modus ohne Entwurf → Picker disabled + Hinweis-Text.
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Live ohne Entwurf → Picker disabled + Hinweis ---');

  await evalPage(send, () => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      groupId: 'g-live-demo',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  const liveInitial = await evalPage(send, () => ({
    pickBtnDisabled:
      document.querySelector('.t-wizard-logo-picker button')?.disabled,
    statusText: document.querySelector('.t-wizard-logo-status')?.textContent,
  }));
  expect(liveInitial.pickBtnDisabled === true,
    'Live: Picker initial disabled (Draft-Gate aktiv)');
  expect(/Hinweis/i.test(liveInitial.statusText ?? ''),
    `Live: Hinweis-Text sichtbar (real: "${liveInitial.statusText}")`);

  // ----------------------------------------------------------------
  // Test 5: Live + blur des Namens + Fake-Draft → Picker aktiv.
  // Hier ohne Backend-POST: wir setzen state.tournamentId manuell.
  // ----------------------------------------------------------------
  console.log('\n--- Test 5: Live mit Entwurf → Picker aktiv ---');

  await evalPage(send, () => {
    const root = document.querySelector('.t-mod.t-wizard');
    if (root && root._state) root._state.tournamentId = 'live-fake-draft';
    // Re-Render über den existierenden root._opts-Pfad.
    const fresh = window.__renderWizardView({
      initialState: { step: 1, name: 'Live-Cup', tournamentId: 'live-fake-draft' },
      groupId: 'g-live-demo',
      onStateChange: () => {},
      onCancel: () => {},
    });
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    ROOT.appendChild(fresh);
  });

  const liveActive = await evalPage(send, () => ({
    pickBtnDisabled:
      document.querySelector('.t-wizard-logo-picker button')?.disabled,
    statusText: document.querySelector('.t-wizard-logo-status')?.textContent,
  }));
  expect(liveActive.pickBtnDisabled === false,
    'Live mit Entwurf: Picker aktiv');
  expect(/Hinweis/i.test(liveActive.statusText ?? '') !== true,
    'Live mit Entwurf: kein Hinweis-Text mehr');

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});