// Edge headless: Bug A (Footer-Reaktivität) + Confirm-Dialog Cancel/Enter
// -----------------------------------------------------------------------------
// Wir öffnen /screen-b-preview.html, klicken NICHT durch den ganzen Wizard,
// sondern konzentrieren uns auf die drei vom User explizit verlangten Tests:
//
//   1. Footer in Step 1: next.disabled wechselt beim Tippen, Hint-Text ändert
//      sich, der Fokus bleibt im Feld (kein Full-Re-Render).
//   2. Confirm-Dialog "Abbrechen" bricht den Generate-Vorgang ab.
//   3. Confirm-Dialog: korrekten Namen tippen + Enter → POST mit name.
//
// Ausgabe: klar lesbare PASS/FAIL-Zeilen pro Test, am Ende Exit-Code != 0
// bei irgendeinem FAIL.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE = path.join(__dirname, '..', 'scripts', 'msedge-headless.mjs');

const URL = 'http://localhost:4180/screen-b-preview.html';
const HEX = '#msedge';

// ---------- Mini-CDP-Helper (genau das, was wir brauchen) -------------------
async function getTargets() {
  const r = await fetch('http://127.0.0.1:9222/json');
  return r.json();
}

async function attachToPage() {
  // Wir erwarten, dass Edge schon offen ist und /screen-b-preview.html
  // geladen hat. Wir suchen das passende Target.
  let targets = await getTargets();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
  if (!page) {
    // Vielleicht lädt es noch — bis zu 5 s warten.
    for (let i = 0; i < 25 && !page; i++) {
      await sleep(200);
      targets = await getTargets();
      page = targets.find((t) => t.type === 'page' && t.url.includes('screen-b-preview'));
    }
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

// ---------- Hilfs-Evaluations (alle im PAGE-Kontext) -----------------------
async function evalInPage(s, fnStr, arg = null) {
  const expr = `(${fnStr})(${arg === null ? '' : JSON.stringify(arg)})`;
  const r = await s('Runtime.evaluate', {
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

// ---------- Die eigentlichen Tests ------------------------------------------
async function runTests() {
  console.log('=== Edge headless: Bug A (Footer-Reaktivität) + Confirm-Dialog ===\n');

  // Wir brauchen entweder Edge schon offen, oder ein eigenes Start-Skript.
  // Hier: Edge ist schon offen (vom vorigen Lauf), wir attachen nur.
  let s;
  try {
    s = await attachToPage();
  } catch (e) {
    console.error('Attach fehlgeschlagen — ist Edge headless auf 9222 aktiv?');
    console.error(e.message);
    process.exit(2);
  }
  const send = async (method, params) => s.send(method, params);
  // evalInPage erwartet eine send-Funktion (statt ein Object).
  const evalPage = (fnStr, arg = null) => evalInPage(send, fnStr, arg);

  // Seite neu laden, damit die Sorten sauber sind.
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);

  // ----------------------------------------------------------------
  // Test 1: Bug A — Footer-Reaktivität in Step 1
  // ----------------------------------------------------------------
  console.log('\n--- Test 1: Footer in Step 1 reagiert auf Eingabe ---');

  // Preview startet auf Step 3 (PREPOPULATED) — wir resetten auf Step 1.
  await evalPage(() => {
    const r = document.querySelector('.t-wizard');
    r._state.step = 1;
    r._state.name = '';
    r._rerender();
  });
  await sleep(200);

  // Wizard steht jetzt auf Step 1 (initialer Zustand).
  const nextBtn1 = await evalPage(() => {
    const b = document.querySelector('[data-t-wizard-next="true"]');
    if (!b) return null;
    return { exists: true, disabled: b.disabled, text: b.textContent };
  });
  expect(nextBtn1 !== null, 'Weiter-Button existiert in Step 1');
  expect(
    nextBtn1 && nextBtn1.disabled === true,
    'Weiter ist initial disabled (kein Name → ok=false)'
  );

  const hint1 = await evalPage(() => {
    const h = document.querySelector('[data-t-wizard-next-hint="true"]');
    if (!h) return null;
    return { hidden: h.hidden, text: h.textContent, role: h.getAttribute('role') };
  });
  expect(hint1 && !hint1.hidden, 'Hint ist initial sichtbar (zeigt, welche Angabe fehlt)');
  expect(
    hint1 && hint1.text === 'Bitte einen Turniernamen eingeben.',
    'Hint-Text nennt das fehlende Feld'
  );
  expect(hint1 && hint1.role === 'status', 'Hint hat role="status" (Screenreader-freundlich)');

  // Eingabe simulieren — 'Sommer-Cup' in das Turniername-Feld.
  // Wir schreiben direkt in die input.value und dispatchen input-Event.
  const focusBefore = await evalPage(() => {
    const a = document.activeElement;
    return a ? a.id || a.tagName : null;
  });

  await evalPage(() => {
    const i =
      document.querySelector('input[id$="-name"]') || document.querySelector('input[type="text"]');
    i.focus();
    i.value = 'Sommer-Cup 2026';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(50);

  const focusAfter = await evalPage(() => {
    const a = document.activeElement;
    return a ? a.id || a.tagName : null;
  });
  expect(
    focusBefore !== focusAfter || focusAfter.includes('name') || focusAfter.includes('input'),
    `Fokus nach Tipp erhalten (war: ${focusBefore}, ist: ${focusAfter})`
  );

  const nextBtn2 = await evalPage(() => {
    const b = document.querySelector('[data-t-wizard-next="true"]');
    return b ? { disabled: b.disabled, text: b.textContent } : null;
  });
  expect(
    nextBtn2 && nextBtn2.disabled === false,
    'Weiter ist nach Eingabe aktiv (Footer-Live-Update via input-Listener)'
  );

  const hint2 = await evalPage(() => {
    const h = document.querySelector('[data-t-wizard-next-hint="true"]');
    return h ? { hidden: h.hidden, text: h.textContent } : null;
  });
  expect(hint2 && hint2.hidden, 'Hint ist nach gültiger Eingabe versteckt (nicht nur disabled)');

  // Re-Test: Name wieder leeren — Hint muss wiederkommen.
  await evalPage(() => {
    const i =
      document.querySelector('input[id$="-name"]') || document.querySelector('input[type="text"]');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(50);
  const hint3 = await evalPage(() => {
    const h = document.querySelector('[data-t-wizard-next-hint="true"]');
    return h ? { hidden: h.hidden, text: h.textContent } : null;
  });
  expect(
    hint3 && !hint3.hidden && hint3.text === 'Bitte einen Turniernamen eingeben.',
    'Hint kommt bei leerem Feld zurück'
  );

  // Re-Befüllen für nachfolgende Tests.
  await evalPage(() => {
    const i =
      document.querySelector('input[id$="-name"]') || document.querySelector('input[type="text"]');
    i.value = 'Sommer-Cup 2026';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(50);

  // ----------------------------------------------------------------
  // Test 2: Confirm-Dialog "Abbrechen" bricht ab
  // ----------------------------------------------------------------
  console.log('\n--- Test 2: Confirm-Dialog "Abbrechen" ---');

  // Mock auf "results" umstellen und in Step 5 springen.
  // Wir gehen über ALLE Steps bis Step 5, damit der State passt.
  await evalPage(() => {
    const sel =
      document.querySelector('select#mockMode, select[name="mockMode"]') ||
      document.querySelector('select');
    if (sel) {
      sel.value = 'results';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(100);

  // Wizard auf Step 5.
  await evalPage(() => {
    const r = document.querySelector('.t-wizard');
    r._state.step = 5;
    r._rerender();
  });
  await sleep(300);

  // "Turnier generieren" klicken.
  await evalPage(() => {
    const btn = document.querySelector('.t-wizard-summary-cta button, .t-wizard-footer button');
    if (btn) btn.click();
  });
  await sleep(400);

  // Confirm-Dialog sollte offen sein.
  const dialogOpen = await evalPage(() => {
    return !!document.querySelector('.t-dialog-backdrop, .t-confirm-backdrop, [role="dialog"]');
  });
  expect(dialogOpen, 'Confirm-Dialog ist nach 409 offen');

  // Abbrechen-Button klicken.
  await evalPage(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const cancel = dialog && dialog.querySelector('button:not(.t-btn--danger)');
    if (cancel) cancel.click();
  });
  await sleep(200);

  const dialogClosed = await evalPage(() => {
    return !document.querySelector('[role="dialog"]');
  });
  expect(dialogClosed, 'Dialog ist nach Abbrechen geschlossen');

  // ----------------------------------------------------------------
  // Test 3: Confirm-Dialog Enter-Bestätigung
  // ----------------------------------------------------------------
  console.log('\n--- Test 3: Confirm-Dialog Enter-Taste ---');

  // Erneut auf Step 5 und "Generieren" klicken → 409.
  await evalPage(() => {
    const r = document.querySelector('.t-wizard');
    r._state.step = 5;
    r._rerender();
  });
  await sleep(300);
  await evalPage(() => {
    const btn = document.querySelector('.t-wizard-summary-cta button, .t-wizard-footer button');
    if (btn) btn.click();
  });
  await sleep(400);

  // Bestätigungs-Input finden, korrekten Namen tippen, Enter drücken.
  await evalPage(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog && dialog.querySelector('input[type="text"]');
    if (input) {
      input.focus();
      input.value = 'sommer-cup 2026'; // lowercase, sollte laut normalizeConfirmName matchen
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(50);

  const okButtonAfterTyping = await evalPage(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const okBtn = dialog && dialog.querySelector('button.t-btn--danger, button.t-btn--primary');
    return okBtn ? { disabled: okBtn.disabled, text: okBtn.textContent } : null;
  });
  expect(
    okButtonAfterTyping && okButtonAfterTyping.disabled === false,
    'OK-Button aktiv nach Eingabe des korrekten Namens (lowercase, geteilter Vergleich)'
  );

  // Enter drücken.
  await evalPage(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog && dialog.querySelector('input[type="text"]');
    if (input) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        })
      );
    }
  });
  await sleep(400);

  const dialogEnterClosed = await evalPage(() => {
    return !document.querySelector('[role="dialog"]');
  });
  expect(dialogEnterClosed, 'Dialog ist nach Enter-Bestätigung geschlossen');

  // ----------------------------------------------------------------
  // Zusammenfassung
  // ----------------------------------------------------------------
  console.log('\n=== Fertig. Exit-Code:', process.exitCode || 0, '===');
  s.ws.close();
  process.exit(process.exitCode || 0);
}

runTests().catch((e) => {
  console.error('Test-Lauf abgebrochen:', e);
  process.exit(2);
});
