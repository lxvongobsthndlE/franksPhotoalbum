/**
 * Tests für den deutschen Fehler-Übersetzer im Wizard.
 *
 * Spec §13.5: "Keine stillen Annahmen" — das schließt ein, dass
 * Fehlermeldungen für den End-User verständlich sind. Wir testen
 * hier die häufigsten Fehlerquellen beim Anlegen des Entwurfs in
 * Schritt 1 (POST /api/tournaments):
 *
 *   - Netzwerkfehler (Backend nicht erreichbar)
 *   - HTTP 401 / 403 / 404 / 409 / 500 mit Status-only-Message
 *   - Server hat eine lesbare Message geschickt (z. B. "Nur Owner
 *     …") — die wird durchgereicht
 *
 * NICHT erlaubt: Strings wie "POST /api/tournaments → 500",
 * englische Status-Reason-Phrases, HTTP-Codes als sichtbarer Text.
 */

import { describe, it, expect } from 'vitest';
import { translateDraftError } from '../tournament.js';

function errWithMessage(message) {
  return { message };
}

describe('translateDraftError — Netzwerk', () => {
  it('Failed to fetch → verständlicher Netzwerk-Hinweis', () => {
    const msg = translateDraftError(errWithMessage('Failed to fetch'));
    expect(msg).toMatch(/Keine Verbindung zum Server/);
    expect(msg).toMatch(/Internetverbindung/);
    expect(msg).not.toMatch(/Failed/);
  });

  it('NetworkError → gleiche Übersetzung', () => {
    const msg = translateDraftError(errWithMessage('NetworkError when attempting to fetch resource'));
    expect(msg).toMatch(/Keine Verbindung/);
  });
});

describe('translateDraftError — HTTP-Status-only', () => {
  it('401 → Anmeldung-Hinweis', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 401'));
    expect(msg).toMatch(/nicht angemeldet/i);
    expect(msg).not.toMatch(/401/);
    expect(msg).not.toMatch(/POST \/api/);
  });

  it('403 → Berechtigung-Hinweis', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 403'));
    expect(msg).toMatch(/Berechtigung/);
    expect(msg).not.toMatch(/403/);
  });

  it('404 → Gruppe nicht gefunden', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 404'));
    expect(msg).toMatch(/Gruppe/);
    expect(msg).not.toMatch(/404/);
  });

  it('409 → Name bereits vergeben', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 409'));
    expect(msg).toMatch(/Turnier mit diesem Namen/i);
    expect(msg).not.toMatch(/409/);
  });

  it('500 → Server-Hinweis, nicht der Status-Code', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 500'));
    expect(msg).toMatch(/Turnier konnte nicht gespeichert werden/);
    expect(msg).not.toMatch(/500/);
    expect(msg).not.toMatch(/POST \/api/);
  });

  it('503 → gleiche Server-Klasse wie 500', () => {
    const msg = translateDraftError(errWithMessage('POST /api/tournaments → 503'));
    expect(msg).toMatch(/Turnier konnte nicht gespeichert werden/);
  });
});

describe('translateDraftError — Server-message durchreichen', () => {
  it('"Nur Gruppen-Owner…" wird 1:1 durchgereicht', () => {
    const serverMsg = 'Nur Gruppen-Owner / Admins dürfen Turniere anlegen';
    const msg = translateDraftError(errWithMessage(serverMsg));
    expect(msg).toBe(serverMsg);
  });

  it('beliebige deutsche Server-Message kommt durch', () => {
    const serverMsg = 'groupId erforderlich';
    const msg = translateDraftError(errWithMessage(serverMsg));
    expect(msg).toBe(serverMsg);
  });
});

describe('translateDraftError — Defensiv', () => {
  it('undefined err → generischer Fallback', () => {
    const msg = translateDraftError(undefined);
    expect(msg).toMatch(/Entwurf konnte nicht angelegt werden/);
  });

  it('err ohne message → generischer Fallback', () => {
    const msg = translateDraftError({});
    expect(msg).toMatch(/Entwurf konnte nicht angelegt werden/);
  });

  it('"Error: …"-Prefix wird nicht 1:1 durchgereicht', () => {
    // Falls ein Bibliotheks-Wrapper "Error: " voranstellt, soll
    // trotzdem der generische Fallback greifen, nicht der rohe String.
    const msg = translateDraftError(errWithMessage('Error: POST /api/tournaments → 500'));
    expect(msg).not.toMatch(/^Error:/);
  });
});