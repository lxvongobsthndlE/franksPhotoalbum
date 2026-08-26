// E2E-Test: Auto-Draft bei Blur des Turniernamen-Felds.
//
// Sobald der User in Step 1 einen gültigen Namen eingegeben hat und
// das Feld verlässt (Tab/Click), wird der Entwurf in der DB angelegt.
// Vorteil: das Logo-Feld aktiviert sich, ohne dass der User erst
// "Weiter" und dann "Zurück" klicken muss.
//
// Invarianten:
//   1. Genau ein POST /api/tournaments pro Wizard-Leben
//   2. Mock-Modus (kein groupId) feuert KEINEN POST
//   3. Leerer Name → kein POST
//   4. Zweites Blur (nach Änderung) → kein weiterer POST
//   5. "Weiter" nach Blur → kein zweiter POST
//   6. Logo-Picker wird aktiviert, OHNE dass der Wizard re-rendert
//      (Fokus in einem anderen Feld bleibt erhalten)

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
  console.log('=== E2E: Auto-Draft bei Blur ===\n');

  const s = await attachToPage();
  const send = s.send;
  const evalPageFn = (fnStr, arg) => evalPage(send, fnStr, arg);

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(700);

  // Auf shim warten
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
  // fetch-Mock: fängt POST /api/tournaments ab. Alle anderen gehen
  // durch zum Real-Fetch (für den ist das egal, weil wir ohne Backend
  // arbeiten).
  // ----------------------------------------------------------------
  await evalPageFn(() => {
    window.__postCalls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST' && /\/api\/tournaments$/.test(String(url))) {
        window.__postCalls.push({ url: String(url), name: opts.body, ts: Date.now() });
        return new Response(
          JSON.stringify({
            tournament: {
              id: 't-blur-1',
              groupId: 'g-1',
              name: 'Auto-Draft Test',
              status: 'draft',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (method === 'POST' && /\/api\/tournaments\/[^/]+\/logo$/.test(String(url))) {
        return new Response(JSON.stringify({ logoUrl: '/api/tournaments/t-blur-1/logo' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, opts);
    };
  });

  // ----------------------------------------------------------------
  // Test 1: Mock-Modus (kein groupId) → kein POST bei blur.
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Mock-Modus (kein groupId) ---');

  await evalPageFn(() => {
    window.__postCalls = [];
  });
  await evalPageFn(() => {
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

  const mockBlur = await evalPageFn(() => {
    const nameInput = document.querySelector('.t-wizard input.t-input');
    nameInput.value = 'Mock-Turnier';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
    return { ok: true };
  });
  await sleep(300);
  const mockPost = await evalPageFn(() => window.__postCalls.length);
  expect(mockBlur.ok, 'Mock-Setup gelaufen');
  expect(mockPost === 0, `Mock-Modus: kein POST /api/tournaments (real: ${mockPost})`);

  // ----------------------------------------------------------------
  // Test 2: Live-Modus, leerer Name → blur → kein POST.
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Leerer Name → kein POST ---');

  await evalPageFn(() => {
    window.__postCalls = [];
  });
  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });
  await evalPageFn(() => {
    const nameInput = document.querySelector('.t-wizard input.t-input');
    nameInput.focus();
    nameInput.value = '';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
  });
  await sleep(300);
  const emptyPost = await evalPageFn(() => window.__postCalls.length);
  expect(emptyPost === 0, `Leerer Name: kein POST (real: ${emptyPost})`);

  // ----------------------------------------------------------------
  // Test 3: Live-Modus, Name gefüllt + blur → genau 1 POST,
  // Logo-Picker wird aktiviert.
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Name + blur → 1 POST, Picker aktiviert ---');

  await evalPageFn(() => {
    window.__postCalls = [];
  });
  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  // Vor-Zustand: Picker disabled.
  const beforeBlur = await evalPageFn(() => ({
    pickBtnDisabled: document.querySelector('.t-wizard-logo-picker button')?.disabled,
    statusText: document.querySelector('.t-wizard-logo-status')?.textContent,
  }));
  expect(beforeBlur.pickBtnDisabled === true, 'Picker initial disabled (kein tournamentId)');
  expect(/Hinweis/i.test(beforeBlur.statusText), 'Status zeigt Entwurf-Hinweis vor blur');

  // Blur mit gültigem Namen.
  await evalPageFn(() => {
    const nameInput = document.querySelector('.t-wizard input.t-input');
    nameInput.focus();
    nameInput.value = 'Sommer-Cup 2026';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
  });
  await sleep(400);

  const afterBlur = await evalPageFn(() => ({
    pickBtnDisabled: document.querySelector('.t-wizard-logo-picker button')?.disabled,
    statusText: document.querySelector('.t-wizard-logo-status')?.textContent,
    postCount: window.__postCalls.length,
    lastName: window.__postCalls[0]?.name,
  }));

  expect(afterBlur.postCount === 1, `Genau 1 POST /api/tournaments (real: ${afterBlur.postCount})`);
  expect(
    /Sommer-Cup 2026/.test(afterBlur.lastName),
    `POST-Body enthält Turniername (real: ${afterBlur.lastName?.slice(0, 80)}…)`
  );
  expect(afterBlur.pickBtnDisabled === false, 'Picker nach Auto-Draft aktiviert');
  expect(
    afterBlur.statusText === '' || afterBlur.statusText === undefined,
    'Entwurf-Hinweis nach Auto-Draft entfernt'
  );

  // ----------------------------------------------------------------
  // Test 4: Zweites Blur (z. B. User ändert Name nochmal) →
  // KEIN weiterer POST (idempotent).
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Zweites Blur → kein weiterer POST ---');

  await evalPageFn(() => {
    const nameInput = document.querySelector('.t-wizard input.t-input');
    nameInput.focus();
    nameInput.value = 'Sommer-Cup 2026 — ACTUALISIERT';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
  });
  await sleep(300);
  const post4 = await evalPageFn(() => window.__postCalls.length);
  expect(post4 === 1, `Nach 2. Blur: weiterhin nur 1 POST (real: ${post4})`);

  // ----------------------------------------------------------------
  // Test 5: "Weiter" klicken nach Auto-Draft → kein zweiter POST.
  // ----------------------------------------------------------------
  console.log('\n--- Test 5: "Weiter" ohne zweiten POST ---');

  await evalPageFn(() => {
    const nextBtn = document.querySelector('[data-t-wizard-next="true"]');
    nextBtn.click();
  });
  await sleep(400);
  const post5 = await evalPageFn(() => window.__postCalls.length);
  expect(post5 === 1, `"Weiter" feuert keinen neuen POST (real: ${post5})`);

  // ----------------------------------------------------------------
  // Test 6: Logo-Picker aktiviert sich OHNE Re-Render.
  // Fokus im Datumsfeld bleibt erhalten.
  // ----------------------------------------------------------------
  console.log('\n--- Test 6: Picker aktiviert ohne Re-Render ---');

  await evalPageFn(() => {
    window.__postCalls = [];
  });
  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  const focusRef = await evalPageFn(() => {
    const inputs = document.querySelectorAll('.t-wizard input.t-input');
    const nameInput = inputs[0];
    const dateInput = inputs[1];
    dateInput.focus();
    const before = {
      activeTag: document.activeElement?.tagName,
      nameInputRef: nameInput,
    };
    // Name setzen + blur
    nameInput.value = 'Test Cup';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
    return before;
  });

  await sleep(400);

  const afterBlurFocus = await evalPageFn((ref) => {
    const inputs = document.querySelectorAll('.t-wizard input.t-input');
    return {
      sameNameInput: inputs[0] === ref.nameInputRef,
      activeTag: document.activeElement?.tagName,
      pickBtnDisabled: document.querySelector('.t-wizard-logo-picker button')?.disabled,
      postCount: window.__postCalls.length,
    };
  }, focusRef);

  expect(afterBlurFocus.sameNameInput, 'Name-Input ist DASSELBE DOM-Element (kein Re-Render)');
  expect(afterBlurFocus.pickBtnDisabled === false, 'Picker nach Auto-Draft aktiviert');
  expect(afterBlurFocus.postCount === 1, `Genau 1 POST (real: ${afterBlurFocus.postCount})`);

  // ----------------------------------------------------------------
  // Test 7: Server-Fehler beim Auto-Draft → Wizard läuft weiter,
  // User kann weiter tippen. Kein roter Inline-Fehler im Formular.
  // ----------------------------------------------------------------
  console.log('\n--- Test 7: Server-Fehler beim Auto-Draft ---');

  await evalPageFn(() => {
    // fetch-Mock umschalten: nächster POST gibt 500 zurück.
    window.__postCalls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST' && /\/api\/tournaments$/.test(String(url))) {
        window.__postCalls.push({ url: String(url), ts: Date.now() });
        return new Response(
          JSON.stringify({
            error: 'server_error',
            message: 'Datenbank streikt',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return realFetch(url, opts);
    };
  });

  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: '' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  await evalPageFn(() => {
    const nameInput = document.querySelector('.t-wizard input.t-input');
    nameInput.focus();
    nameInput.value = 'Failure Turnier';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameInput.blur();
  });
  await sleep(400);

  const errState = await evalPageFn(() => ({
    postCount: window.__postCalls.length,
    pickBtnDisabled: document.querySelector('.t-wizard-logo-picker button')?.disabled,
    // Form ist noch aktiv: User kann Name korrigieren.
    nameInputValue: document.querySelector('.t-wizard input.t-input')?.value,
  }));

  expect(errState.postCount === 1, 'POST wurde versucht (1)');
  expect(errState.pickBtnDisabled === true, 'Picker bleibt disabled, weil Draft fehlgeschlagen');
  expect(
    errState.nameInputValue === 'Failure Turnier',
    'Turniername bleibt im Input — User kann weiter tippen'
  );

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
