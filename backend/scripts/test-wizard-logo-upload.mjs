// E2E-Test für das Logo-Feld im Wizard (Step 1).
//
// Geprüfte Punkte:
//   1. Feld erscheint, wenn opts.groupId gesetzt ist (Live-Modus mit Admin)
//   2. Picker ist disabled, solange state.tournamentId fehlt
//   3. Mit tournamentId ist Picker aktiv, Klick öffnet File-Picker
//   4. Datei auswählen → POST /api/tournaments/:id/logo → Vorschau erscheint
//   5. Status-Text wechselt sichtbar: hochladen → ok
//   6. Kein Re-Render bei File-Auswahl (andere Inputs behalten Fokus)
//   7. Entfernen klicken → DELETE → Vorschau weg, Picker wieder da
//   8. Fehler-Pfad: Server antwortet 400 → Status rot, Picker wieder aktiv
//
// Wir mocken window.fetch, damit der Test ohne Backend läuft und
// deterministisch ist. fileInput.files[0] wird synthetisch gesetzt,
// da Headless-Browser CDP keine echten File-Dialoge öffnen kann.

import { setTimeout as sleep } from 'node:timers/promises';

async function getTargets() {
  return (await fetch('http://127.0.0.1:9222/json')).json();
}

async function attachToPage() {
  let targets = await getTargets();
  let page = targets.find(t => t.type === 'page' && t.url.includes('screen-b-preview'));
  for (let i = 0 && !page; i < 25; i++) {
    await sleep(200);
    targets = await getTargets();
    page = targets.find(t => t.type === 'page' && t.url.includes('screen-b-preview'));
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
    throw new Error('eval: ' + r.exceptionDetails.text +
                    ' :: ' + (r.result?.description || ''));
  }
  return r.result?.value;
}

function expect(cond, label) {
  const tag = cond ? '✓ PASS' : '✗ FAIL';
  console.log(tag, label);
  if (!cond) process.exitCode = 1;
}

async function runTests() {
  console.log('=== E2E: Wizard Logo-Feld ===\n');

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
  // Setup: fetch-Mock einbauen. Zwei Endpunkte:
  //   POST   /api/tournaments/:id/logo  → 200 (legt body.logoUrl)
  //   DELETE /api/tournaments/:id/logo  → 200
  //   POST   /api/tournaments/:id/logo  → 400 (Fehler-Pfad)
  // Wir tracken jeden Aufruf in window.__fetchCalls.
  // ----------------------------------------------------------------
  await evalPageFn(() => {
    window.__fetchCalls = [];
    window.__fetchMode = 'ok'; // 'ok' | 'error'
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      const call = { url: String(url), method, ts: Date.now() };
      window.__fetchCalls.push(call);

      // POST /api/tournaments/:id/logo
      if (method === 'POST' && /\/api\/tournaments\/[^/]+\/logo$/.test(call.url)) {
        if (window.__fetchMode === 'error') {
          return new Response(JSON.stringify({
            error: 'Nur PNG, JPEG und WebP sind als Logo erlaubt (du: application/pdf).',
            code: 'unsupported_format',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const m = call.url.match(/\/api\/tournaments\/([^/]+)\/logo$/);
        const tid = m ? m[1] : null;
        return new Response(JSON.stringify({
          logoUrl: `/api/tournaments/${tid}/logo`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // DELETE /api/tournaments/:id/logo
      if (method === 'DELETE' && /\/api\/tournaments\/[^/]+\/logo$/.test(call.url)) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Alles andere: an Original-fetch durchreichen, damit der Wizard
      // seinen Lebenszyklus (Draft anlegen etc.) machen kann.
      return realFetch(url, opts);
    };
  });

  // ----------------------------------------------------------------
  // Test 1: Logo-Feld erscheint, wenn groupId gesetzt ist.
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Logo-Feld mit groupId sichtbar ---');

  const t1 = await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: 'Sommer-Cup 2026' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
    return {
      fieldExists: !!document.querySelector('[data-t-wizard-logo-field="true"]'),
      pickBtn: !!document.querySelector('.t-wizard-logo-picker button'),
      fileInput: !!document.querySelector('[data-t-wizard-logo-file-input="true"]'),
      statusEl: !!document.querySelector('.t-wizard-logo-status'),
      previewHidden: !!document.querySelector('.t-wizard-logo-preview')?.hidden,
    };
  });
  expect(t1.fieldExists, 'Logo-Feld gerendert');
  expect(t1.pickBtn, '"Logo auswählen"-Button vorhanden');
  expect(t1.fileInput, 'Verstecktes <input type="file"> vorhanden');
  expect(t1.statusEl, 'Status-Element vorhanden');
  expect(t1.previewHidden, 'Preview initial versteckt');

  // ----------------------------------------------------------------
  // Test 2: Ohne tournamentId ist Picker disabled.
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Picker disabled ohne tournamentId ---');

  const t2 = await evalPageFn(() => {
    const btn = document.querySelector('.t-wizard-logo-picker button');
    const status = document.querySelector('.t-wizard-logo-status')?.textContent;
    return { disabled: btn?.disabled, status };
  });
  expect(t2.disabled === true, 'Picker-Button disabled');
  expect(/Entwurf/i.test(t2.status),
    `Status zeigt Entwurf-Hinweis (real: „${t2.status?.slice(0, 60)}…")`);

  // ----------------------------------------------------------------
  // Test 3: Mit tournamentId: Picker aktiv, File-Auswahl → Upload.
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Upload + Preview + Status-Text ---');

  // Synthetisches File-Objekt für die Auswahl.
  const uploadResult = await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: 'Sommer-Cup 2026', tournamentId: 't-42' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);

    const fileInput = document.querySelector('[data-t-wizard-logo-file-input="true"]');
    const pickBtn = document.querySelector('.t-wizard-logo-picker button');
    const beforePickerDisabled = pickBtn.disabled;
    const beforeStatus = document.querySelector('.t-wizard-logo-status').textContent;

    // File manuell setzen (Headless-Tests können keinen File-Dialog).
    const fakeFile = new File(['fake-png-bytes'], 'logo.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(fakeFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // change-Handler ist async — Status sofort prüfen.
    const immediateStatus = document.querySelector('.t-wizard-logo-status').textContent;
    const immediateDisabled = pickBtn.disabled;

    return {
      beforePickerDisabled,
      beforeStatus,
      immediateStatus,
      immediateDisabled,
    };
  });

  expect(uploadResult.beforePickerDisabled === false,
    'Picker aktiv, wenn tournamentId gesetzt');
  expect(/Hochladen|Febor/i.test(uploadResult.beforeStatus) ||
         uploadResult.beforeStatus === '',
    `Status initial leer oder harmlos (real: „${uploadResult.beforeStatus?.slice(0, 60)}…")`);
  expect(uploadResult.immediateDisabled === true,
    'Picker wird während Upload sofort disabled');
  expect(/Wird hochgeladen/i.test(uploadResult.immediateStatus),
    `Status zeigt "Wird hochgeladen…" (real: „${uploadResult.immediateStatus?.slice(0, 60)}…")`);

  // Warten, bis der Upload durch ist.
  await sleep(400);

  const afterUpload = await evalPageFn(() => {
    const status = document.querySelector('.t-wizard-logo-status');
    const preview = document.querySelector('.t-wizard-logo-preview');
    const img = document.querySelector('[data-t-wizard-logo-img="true"]');
    const picker = document.querySelector('.t-wizard-logo-picker');
    const removeBtn = document.querySelector('[data-t-wizard-logo-remove="true"]');
    return {
      statusText: status?.textContent,
      statusClass: status?.className,
      previewHidden: preview?.hidden,
      imgSrc: img?.src,
      pickerHidden: picker?.hidden,
      removeBtn: !!removeBtn,
      fetchCalls: window.__fetchCalls.filter(c => c.url.includes('/logo')),
    };
  });

  expect(/hochgeladen/i.test(afterUpload.statusText),
    `Status nach Erfolg: "Logo hochgeladen." (real: „${afterUpload.statusText?.slice(0, 60)}…")`);
  expect(afterUpload.statusClass.includes('is-ok'),
    `Status-Klasse is-ok gesetzt (real: ${afterUpload.statusClass})`);
  expect(afterUpload.previewHidden === false, 'Preview sichtbar nach Upload');
  expect(afterUpload.imgSrc && afterUpload.imgSrc.includes('/api/tournaments/t-42/logo'),
    `<img src> zeigt Proxy-URL (real: ${afterUpload.imgSrc?.slice(0, 80)}…")`);
  expect(afterUpload.pickerHidden === true, 'Picker ausgeblendet, wenn Logo vorhanden');
  expect(afterUpload.removeBtn, '"Entfernen"-Button vorhanden');
  expect(afterUpload.fetchCalls.length === 1,
    `Genau 1 Fetch-Aufruf an /logo (real: ${afterUpload.fetchCalls.length})`);
  expect(afterUpload.fetchCalls[0].method === 'POST',
    'Fetch-Methode ist POST');

  // ----------------------------------------------------------------
  // Test 4: KEIN Re-Render bei File-Auswahl — andere Inputs behalten Fokus.
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Kein Re-Render bei File-Auswahl ---');

  // Wir bauen ein neues Setup mit zwei sichtbaren Inputs, fokussieren
  // das zweite, simulieren eine File-Auswahl und prüfen, dass das
  // fokussierte Input NICHT ersetzt wurde.
  const focusCheck = await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: 'Sommer-Cup 2026', tournamentId: 't-42' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);

    // Input 0: Turniername. Input 1: Datum. Wir nehmen das Datum-Input,
    // weil Step 1 mehrere textuelle Felder hat.
    const inputs = Array.from(document.querySelectorAll('.t-wizard input.t-input, .t-wizard textarea.t-input'));
    const nameInput = inputs[0];
    const dateInput = inputs[1];
    if (!nameInput || !dateInput) return { ok: false, why: 'inputs-not-found', count: inputs.length };

    // identity für "ist es DASSELBE DOM-Element nach dem Upload"
    const nameBefore = nameInput;
    nameInput.focus();
    const focusedBefore = document.activeElement === nameInput;

    // File-Auswahl triggern
    const fileInput = document.querySelector('[data-t-wizard-logo-file-input="true"]');
    const fakeFile = new File(['x'], 'logo.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(fakeFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Sync nach changeEvent — der Refresh passiert nicht vor unserem
    // check, weil uploadAktion async ist und wir KEIN sleep machen.
    const focusedAfterChange = document.activeElement === nameInput;
    const nameIsSame = document.querySelectorAll('.t-wizard input.t-input')[0] === nameBefore;

    return {
      ok: true,
      focusedBefore,
      focusedAfterChange,
      nameIsSame,
      activeTag: document.activeElement?.tagName,
    };
  });

  expect(focusCheck.focusedBefore, 'Fokus auf Name-Input vor Upload');
  expect(focusCheck.focusedAfterChange,
    `Fokus bleibt auf Name-Input direkt nach change-Event (active: ${focusCheck.activeTag})`);
  expect(focusCheck.nameIsSame,
    'Name-Input ist DASSELBE DOM-Element — kein Re-Render');

  // ----------------------------------------------------------------
  // Test 5: Entfernen klicken → DELETE → Vorschau weg, Picker wieder da.
  // ----------------------------------------------------------------
  console.log('\n--- Test 5: Entfernen setzt alles zurück ---');

  // Status zurücksetzen: jetzt existierendes Logo annehmen.
  await evalPageFn(() => {
    window.__fetchCalls = [];
  });

  // Re-Render, damit state.logoUrl = '…' gesetzt ist (initial).
  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: {
        step: 1, name: 'Sommer-Cup 2026', tournamentId: 't-42',
        logoUrl: '/api/tournaments/t-42/logo',
      },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });

  const removeClick = await evalPageFn(() => {
    const removeBtn = document.querySelector('[data-t-wizard-logo-remove="true"]');
    if (!removeBtn) return { ok: false, why: 'no-remove-btn' };
    removeBtn.click();
    return { ok: true, immediateStatus: document.querySelector('.t-wizard-logo-status').textContent };
  });

  await sleep(300);

  const afterRemove = await evalPageFn(() => {
    const preview = document.querySelector('.t-wizard-logo-preview');
    const picker = document.querySelector('.t-wizard-logo-picker');
    const pickBtn = document.querySelector('.t-wizard-logo-picker button');
    const removeBtn = document.querySelector('[data-t-wizard-logo-remove="true"]');
    const fetchCalls = window.__fetchCalls.filter(c => c.url.includes('/logo'));
    return {
      previewHidden: preview?.hidden,
      pickerHidden: picker?.hidden,
      pickBtnDisabled: pickBtn?.disabled,
      removeBtnGone: !removeBtn,
      fetchCalls,
      status: document.querySelector('.t-wizard-logo-status')?.textContent,
    };
  });

  expect(removeClick.ok, 'Entfernen-Button vorhanden');
  expect(afterRemove.fetchCalls.length === 1, 'Genau 1 DELETE-Aufruf');
  expect(afterRemove.fetchCalls[0].method === 'DELETE', 'Methode ist DELETE');
  expect(afterRemove.previewHidden === true, 'Preview ist versteckt');
  expect(afterRemove.pickerHidden === false, 'Picker wieder sichtbar');
  expect(afterRemove.pickBtnDisabled === false, 'Picker wieder aktiv');
  expect(afterRemove.removeBtnGone, 'Entfernen-Button weg');
  expect(afterRemove.status === '' || afterRemove.status === undefined,
    `Status-Text zurückgesetzt (real: „${afterRemove.status?.slice(0, 60)}…")`);

  // ----------------------------------------------------------------
  // Test 6: Fehler-Pfad — Server 400 → Status rot, Picker wieder aktiv.
  // ----------------------------------------------------------------
  console.log('\n--- Test 6: Fehler beim Upload zeigt rote Meldung ---');

  await evalPageFn(() => {
    window.__fetchCalls = [];
    window.__fetchMode = 'error';
  });

  const errResult = await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      initialState: { step: 1, name: 'Sommer-Cup 2026', tournamentId: 't-42' },
      groupId: 'g-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);

    const fileInput = document.querySelector('[data-t-wizard-logo-file-input="true"]');
    const fakeFile = new File(['x'], 'spielplan.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(fakeFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  });

  await sleep(300);

  const afterError = await evalPageFn(() => {
    const status = document.querySelector('.t-wizard-logo-status');
    const pickBtn = document.querySelector('.t-wizard-logo-picker button');
    const fileInput = document.querySelector('[data-t-wizard-logo-file-input="true"]');
    const preview = document.querySelector('.t-wizard-logo-preview');
    return {
      statusText: status?.textContent,
      statusClass: status?.className,
      pickBtnDisabled: pickBtn?.disabled,
      fileInputValue: fileInput?.value,
      previewHidden: preview?.hidden,
    };
  });

  expect(/Fehler/i.test(afterError.statusText),
    `Status zeigt "Fehler: …" (real: „${afterError.statusText?.slice(0, 80)}…")`);
  expect(afterError.statusClass.includes('is-error'),
    `Status-Klasse is-error (real: ${afterError.statusClass})`);
  expect(afterError.pickBtnDisabled === false,
    'Picker-Button wieder aktiv nach Fehler');
  expect(afterError.fileInputValue === '',
    'File-Input zurückgesetzt (sonst kann User dieselbe Datei nicht erneut wählen)');
  expect(afterError.previewHidden === true,
    'Preview weiterhin versteckt');

  // Mock wieder sauber machen
  await evalPageFn(() => {
    window.__fetchMode = 'ok';
    window.__fetchCalls = [];
  });

  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
