// Edge headless: Wizard erzeugt Entwurf + räumt bei Abbrechen auf +
//                 Entwurf-Karte in der Liste.
//
// Verifiziert:
//   1. Mock-Modus: Wizard tut KEIN echter POST (groupId fehlt).
//   2. Live-Modus mit gemocktem fetch: Step 1 → 2 löst POST aus,
//      storeId wird in state.tournamentId abgelegt.
//   3. Cancel: löst DELETE auf der gemerkten ID aus.
//   4. RenderTournamentCard mit status='draft' zeigt Status-Badge +
//      Hinweis-Text + Löschen-Button, KEIN Fortsetzen-Button.

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
  async function send(method, params = {}) {
    const reqId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }
  return { ws, send };
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
  console.log('=== Edge headless: Wizard-Entwurf-Lebenszyklus + Entwurf-Karte ===\n');

  let s;
  try {
    s = await attachToPage();
  } catch (e) {
    console.error('Attach fehlgeschlagen:', e.message);
    process.exit(2);
  }
  const send = async (method, params) => s.send(method, params);
  const evalPageFn = (fnStr, arg) => evalPage(send, fnStr, arg);

  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);

  // ----------------------------------------------------------------
  // Test 1: Mock-Modus → KEIN POST, KEIN DELETE.
  //         Voraussetzung: kein opts.groupId, daher kein Auto-Draft.
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Mock-Modus, Wizard tut keinen Auto-POST ---');

  // fetch-Recorder installieren (im PAGE-context, vor allen Wizard-Aktionen).
  await evalPageFn(() => {
    window.__fetchCalls = [];
    window.__mockTournamentId = 'mock-tournament-abc';
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      window.__fetchCalls.push({
        url: String(url),
        method: opts.method || 'GET',
        body: opts.body || null,
      });
      // POST /api/tournaments → gebe Mock-Antwort zurück.
      if (String(url).endsWith('/api/tournaments') && opts.method === 'POST') {
        return new Response(
          JSON.stringify({
            tournament: { id: window.__mockTournamentId, name: 'Test', status: 'draft' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // DELETE /api/tournaments/:id → 200.
      if (String(url).includes('/api/tournaments/') && opts.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Alles andere an reale fetch weiterreichen.
      return origFetch(url, opts);
    };
  });

  // Warten auf den Test-Shim, den screen-b-preview.html selbst beim
  // Laden auf window steckt. (Der Shim wird im <script type="module">-
  // Block oben in der Datei gesetzt.)
  for (let i = 0; i < 50; i++) {
    const ready = await evalPageFn(() => window.__tReady === true);
    if (ready) break;
    await sleep(100);
  }
  const diag = await evalPageFn(() => ({
    ready: window.__tReady,
    hasRWV: typeof window.__renderWizardView,
    hasRTC: typeof window.__renderTournamentCard,
  }));
  console.log('[diag] window state:', JSON.stringify(diag));
  if (diag.ready !== true || diag.hasRWV !== 'function') {
    throw new Error('Test-Shim nicht verfügbar: ' + JSON.stringify(diag));
  }

  // Wizard im Mock-Modus: kein opts.groupId → kein POST.
  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });
  await sleep(200);

  // Step 1 füllen + „Weiter" klicken → KEIN POST (kein groupId).
  await evalPageFn(() => {
    const input = document.querySelector('input[type="text"]');
    input.focus();
    input.value = 'Sommer-Cup 2026';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  await evalPageFn(() => {
    const next = document.querySelector('[data-t-wizard-next="true"]');
    next.click();
  });
  await sleep(300);

  const fetchCalls1 = await evalPageFn(() => window.__fetchCalls);
  const postInMock = fetchCalls1.some(
    (c) => c.method === 'POST' && c.url.endsWith('/api/tournaments')
  );
  expect(!postInMock, 'Mock-Modus (kein groupId): kein POST /api/tournaments');

  // ----------------------------------------------------------------
  // Test 2: Live-Modus mit groupId → POST + ID in state.
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Live-Modus, Step 1→2 löst genau 1 POST aus ---');

  await evalPageFn(() => {
    window.__fetchCalls = [];
  });

  await evalPageFn(() => {
    const ROOT = document.getElementById('root');
    ROOT.innerHTML = '';
    const w = window.__renderWizardView({
      groupId: 'g-test-1',
      onStateChange: () => {},
      onCancel: () => {},
    });
    ROOT.appendChild(w);
  });
  await sleep(200);

  // Step 1 füllen + „Weiter" klicken.
  await evalPageFn(() => {
    const input = document.querySelector('input[type="text"]');
    input.focus();
    input.value = 'Sommer-Cup 2026';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  await evalPageFn(() => {
    const next = document.querySelector('[data-t-wizard-next="true"]');
    next.click();
  });
  await sleep(400);

  const fetchCalls2 = await evalPageFn(() => window.__fetchCalls);
  const posts = fetchCalls2.filter(
    (c) => c.method === 'POST' && c.url.endsWith('/api/tournaments')
  );
  expect(posts.length === 1, `Genau 1 POST /api/tournaments (real: ${posts.length})`);
  if (posts.length === 1) {
    const body = JSON.parse(posts[0].body);
    expect(body.groupId === 'g-test-1', 'POST-Body hat groupId=g-test-1');
    expect(body.name === 'Sommer-Cup 2026', 'POST-Body hat den Turniernamen');
  }

  // Step 2 müsste jetzt aktiv sein.
  const step = await evalPageFn(() => {
    return document.querySelector('.t-wizard')?.dataset?.step;
  });
  expect(step === '2', `Wizard ist in Step 2 (real: ${step})`);

  // state.tournamentId gesetzt?
  const tournamentId = await evalPageFn(() => {
    return document.querySelector('.t-wizard')?._state?.tournamentId;
  });
  expect(
    tournamentId === 'mock-tournament-abc',
    `state.tournamentId = 'mock-tournament-abc' (real: ${tournamentId})`
  );

  // ----------------------------------------------------------------
  // Test 3: Cancel → DELETE auf der gemerkten ID.
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Abbrechen löst DELETE auf der ID aus ---');

  await evalPageFn(() => {
    window.__fetchCalls = [];
  });

  // Cancel-Knopf klicken.
  await evalPageFn(() => {
    const cancel = document.querySelector('.t-wizard-progress-cancel');
    cancel.click();
  });
  await sleep(400);

  const fetchCalls3 = await evalPageFn(() => window.__fetchCalls);
  const deletes = fetchCalls3.filter((c) => c.method === 'DELETE');
  expect(deletes.length === 1, `Genau 1 DELETE /api/tournaments/:id (real: ${deletes.length})`);
  if (deletes.length === 1) {
    expect(
      deletes[0].url.includes('mock-tournament-abc'),
      `DELETE-URL enthält die gemerkte ID (real: ${deletes[0].url})`
    );
  }

  // ----------------------------------------------------------------
  // Test 4: Entwurf-Karte — Status-Badge, Hinweis, Löschen, KEIN Fortsetzen.
  // ----------------------------------------------------------------
  console.log('\n--- Test 4: Entwurf-Karte: Status, Hinweis, Löschen, kein Fortsetzen ---');

  const cardInfo = await evalPageFn(() => {
    const card = window.__renderTournamentCard(
      {
        id: 't-draft-1',
        name: 'Mein Entwurf',
        status: 'draft',
        startsAtShort: '05.09.2026',
      },
      true,
      {
        onMenuAction: (t, action) => {
          window.__lastMenuAction = { id: t.id, action };
        },
      }
    );
    document.body.appendChild(card);
    const has = (sel) => !!card.querySelector(sel);
    const text = (sel) => card.querySelector(sel)?.textContent?.trim();
    return {
      statusBadge: has('.t-list-card-status--draft'),
      statusText: text('.t-list-card-status--draft'),
      hasNote: has('.t-list-card-note'),
      noteText: text('.t-list-card-note'),
      hasDelete: has('button.t-btn--danger'),
      deleteText: text('button.t-btn--danger'),
      // „Fortsetzen"-Button darf NICHT da sein.
      hasResume: card.textContent.includes('Fortsetzen') || card.textContent.includes('Bearbeiten'),
    };
  });

  expect(cardInfo.statusBadge, 'Status-Badge mit --draft-Variante gerendert');
  expect(
    cardInfo.statusText === 'Entwurf',
    `Status-Badge-Text = „Entwurf" (real: „${cardInfo.statusText}")`
  );
  expect(cardInfo.hasNote, 'Hinweis-Element gerendert');
  expect(
    cardInfo.noteText && cardInfo.noteText.includes('nicht fertig eingerichtet'),
    `Hinweis nennt den Status (real: „${cardInfo.noteText}")`
  );
  expect(cardInfo.hasDelete, 'Löschen-Button gerendert');
  expect(
    cardInfo.deleteText === 'Löschen',
    `Button-Text = „Löschen" (real: „${cardInfo.deleteText}")`
  );
  expect(!cardInfo.hasResume, 'KEIN „Fortsetzen" / „Bearbeiten" angezeigt');

  // Klick auf Löschen muss onMenuAction mit action='delete' aufrufen.
  await evalPageFn(() => {
    const card = document.querySelector('.t-list-card--draft');
    card.querySelector('button.t-btn--danger').click();
  });
  const menuAction = await evalPageFn(() => window.__lastMenuAction);
  expect(
    menuAction && menuAction.id === 't-draft-1' && menuAction.action === 'delete',
    `Klick auf Löschen ruft onMenuAction(id, 'delete') (real: ${JSON.stringify(menuAction)})`
  );

  // ----------------------------------------------------------------
  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
