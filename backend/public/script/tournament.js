// Turnier-Bestätigungs-Vergleich (§13.10) — geteilt mit Server/Mock.
import { normalizeConfirmName } from './normalize-confirm-name.js';

// Auth-Helper: einheitlicher fetch mit Bearer-Header + 401-Auto-Refresh.
// Vorher hatte jedes fetch() in dieser Datei nur credentials:'include',
// aber KEINEN Authorization-Header. Der Server lehnt deshalb mit
// "No Authorization was found in request.headers" ab, sobald die
// Anmeldung nicht (nur) per Cookie läuft. fetchWithAuth() löst das an
// EINER Stelle — alle Aufrufer bekommen den Header automatisch.
import { fetchWithAuth } from './auth-oidc.js';

// Pure Helpers für die Team-Verwaltung (auch in Vitest getestet).
import {
  isPlaceholderName,
  nextPlaceholderName,
  parseTeamInput,
  duplicateNames,
  groupRowSizes,
} from './tournament-team-helpers.js';

// Pure Funktionen für die Wizard-Vorschau (Spec §13.3, Bug 10).
// Regressionsschutz: thirdPlaceMatch muss sich auf die Vorschau
// auswirken — siehe wizard-preview-helpers.js für Details.
import {
  computeEndInfo,
  estimateKoGames,
  bracketSizeLabel,
} from './wizard-preview-helpers.js';

// ----------------------------------------------------------------
// Entwurfs-Lebenszyklus (Spec §1.2, §12).
//
// Der Wizard erzeugt im Live-Modus beim Übergang Schritt 1→2 einen
// Entwurf in der DB (status='draft'). Beim Abbrechen räumt der
// Wizard denselben Entwurf wieder ab. Genau ein POST pro
// Wizard-Leben, genau ein DELETE beim Cancel.
//
// Fehler werden tolerant behandelt:
//   - POST fehlschlägt: Wizard bleibt in Step 1, Hint zeigt den
//     Fehler. Der User kann den Namen korrigieren und erneut
//     "Weiter" klicken.
//   - DELETE fehlschlägt: kein UI-Block. Der Entwurf bleibt in der
//     DB und ist für Admins in der Liste sichtbar + löschbar.
// ----------------------------------------------------------------
async function createDraft({ groupId, name, mode }) {
  const res = await fetchWithAuth('/api/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, name: name.trim(), mode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body?.message || body?.error || `POST /api/tournaments → ${res.status}`
    );
  }
  return body.tournament;
}

/**
 * Stellt sicher, dass für die aktuelle Wizard-State ein Entwurf in
 * der DB existiert. Wird von zwei Stellen aufgerufen:
 *
 *   1) blur auf dem Turniernamen-Feld (auto-create, sobald Name da)
 *   2) Klick auf "Weiter" in Step 1 (klassisches Create vor Step-Wechsel)
 *
 * Single-flight: wenn bereits ein POST läuft, hängen wir uns an
 * dieselbe Promise. So bekommt der User kein Duplikat-Entwurf, auch
 * wenn er blur → Klick auf Weiter in schneller Folge auslöst.
 *
 * Genau ein POST pro Wizard-leben, danach idempotent (no-op).
 *
 * Wichtig: Wirft NIE. Wenn der POST scheitert (z. B. 401/403/409 oder
 * Netzwerk), speichern wir den Fehler in state.__draftError und geben
 * { tournamentId: null, created: false, error } zurück. Der Step-1-
 * "Weiter"-Handler zeigt dann einen freundlichen Hinweis, lässt den
 * User aber weiterklicken. Ein endgültiger Block ist nur am Ende
 * erlaubt — beim "Turnier generieren" (onGenerate in main.js), wo der
 * Server ohne tournamentId wirklich nicht weiterkommt.
 *
 * @returns {Promise<{ tournamentId: string|null, created: boolean, error?: string }>}
 *   - created=true:  POST ist gerade gelaufen, tournamentId gesetzt.
 *   - created=false: tournamentId war schon gesetzt ODER POST ist fehlgeschlagen.
 *   - error:         deutsche Beschreibung, falls POST fehlgeschlagen ist.
 */
function ensureDraftPromise(state, opts) {
  if (!opts.groupId) {
    // Mock-Modus — kein Draft, sofort "fertig".
    // ACHTUNG: das ist der genaue Punkt, an dem der main.js-Wrapper
    // in den Bug gelaufen ist: er hat groupId nur in initialState
    // gepackt, aber opts.groupId leer gelassen → kein POST → keine
    // tournamentId → "draft_missing" in Step 5. renderWizardView()
    // gibt deshalb eine console.warn aus, falls opts.groupId fehlt
    // aber state.groupId gesetzt ist.
    return Promise.resolve({ tournamentId: state.tournamentId, created: false });
  }
  if (state.tournamentId) {
    return Promise.resolve({ tournamentId: state.tournamentId, created: false });
  }
  if (state.__draftInFlight) {
    // Hänge an die laufende Promise.
    return state.__draftInFlight;
  }
  state.__draftInFlight = (async () => {
    try {
      const t = await createDraft({
        groupId: opts.groupId,
        name: state.name,
        mode: state.mode,
      });
      state.tournamentId = t.id;
      state.__draftError = null;
      return { tournamentId: t.id, created: true };
    } catch (err) {
      // POST fehlgeschlagen — NICHT werfen. Der User darf weiterklicken;
      // main.js onGenerate versucht es am Ende nochmal (idempotent). Wir
      // speichern die deutsche Übersetzung für UI + Konsole.
      const message = translateDraftError(err);
      state.__draftError = message;
      console.warn('[wizard] Entwurf konnte nicht angelegt werden:', message, err);
      return { tournamentId: null, created: false, error: message };
    } finally {
      // Promise-Cache wieder freigeben, damit ein Retry (z. B. nach
      // Fehler) erneut versuchen kann.
      state.__draftInFlight = null;
    }
  })();
  return state.__draftInFlight;
}
// Export für Tests — die Funktion wird intern weiterhin über die
// Closure referenziert, daher ändert sich die Sichtbarkeit nicht.
export { ensureDraftPromise };

async function deleteDraft(tournamentId) {
  if (!tournamentId) return;
  try {
    await fetchWithAuth(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    // Bewusst geschluckt — der Entwurf bleibt als Admin-Liste-Eintrag
    // sichtbar und der Admin kann ihn dort selbst löschen.
    console.warn('[wizard] deleteDraft failed:', err);
  }
}

// ----------------------------------------------------------------
// Team-Sync zum Server (Spec §1.2, §3 Schritt 2).
//
// Vor diesem Fix hatte der Wizard 12 Teams im state.teams, aber keine
// davon in der DB. POST /generate brach dann mit "Mindestens 2 Teams
// erforderlich" ab — obwohl der User Teams eingegeben hatte. Ursache:
// Wizard baute state.teams auf, sendete sie aber NIE an den Server
// (nur die Config via PATCH). Der Server sah also eine leere teams-
// Tabelle.
//
// syncTeamsToBackend() ist ein inkrementelles Sync:
//   1. POST /api/tournaments/:id/teams mit allen aktuellen Namen
//      (Server skippt Duplikate per tournamentId+name-Index, deshalb
//      ist die Funktion idempotent).
//   2. Server-Antwort enthält die kanonische ID-Liste. Wir mappen
//      die IDs zurück nach state.teams[i].id (per Name-Match).
//   3. Welche Server-IDs nicht mehr im aktuellen state sind, werden
//      per DELETE /:id/teams/:teamId entfernt. So entsteht ein
//      sauberer Spiegel zwischen Wizard-State und DB.
//
// Aufgerufen wird sie aus main.js onStateChange beim Übergang
// Schritt 2 → 3 (sobald der User "Weiter" aus Step 2 klickt). Beim
// Verlassen des Wizards in onGenerate läuft ein letzter Sync als
// Sicherheitsnetz (falls der User direkt zu "Turnier generieren"
// springt, ohne dass die Auto-Save-Schleife gelaufen ist).
//
// Spec §13.5: "Ursache beheben statt Meldung verschönern". Hier
// war die Ursache, dass teams nicht im Request landeten — die
// Fehlermeldung war symptomatisch korrekt ("Mindestens 2 Teams
// erforderlich"), aber der Wizard hat sie selbst verursacht.
// ----------------------------------------------------------------
async function syncTeamsToBackend(state) {
  if (!state.tournamentId) {
    return { ok: false, error: 'no_tournament', added: 0, removed: 0 };
  }
  if (!Array.isArray(state.teams) || state.teams.length === 0) {
    // Nichts zu syncen. Aber: falls vorher Teams da waren und der
    // User alle entfernt hat, müssen wir die Server-Teams aufräumen.
    const prevIds = Array.isArray(state.__syncedTeamIds)
      ? state.__syncedTeamIds
      : [];
    let removed = 0;
    for (const id of prevIds) {
      try {
        await fetchWithAuth(
          `/api/tournaments/${encodeURIComponent(state.tournamentId)}/teams/${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
        removed++;
      } catch (err) {
        console.warn('[wizard] team-Delete failed:', err);
      }
    }
    state.__syncedTeamIds = [];
    return { ok: true, added: 0, removed };
  }

  // 1. POST alle aktuellen Namen. Server skippt Duplikate.
  let res;
  try {
    res = await fetchWithAuth(
      `/api/tournaments/${encodeURIComponent(state.tournamentId)}/teams`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          names: state.teams.map((t) => String(t?.name ?? '').trim()).filter(Boolean),
        }),
      }
    );
  } catch (err) {
    return { ok: false, error: 'network', message: err.message };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: body?.error || `teams_sync_failed_${res.status}`,
      message: body?.message || `Teams konnten nicht gespeichert werden (${res.status}).`,
    };
  }

  // 2. ID-Mapping: Server liefert { teams: [{ id, name, seed }] }.
  // Wir schreiben die IDs zurück nach state.teams[i].id (per Name),
  // damit spätere Syncs erkennen, welche Teams neu hinzugekommen sind.
  const serverTeams = Array.isArray(body.teams) ? body.teams : [];
  const byName = new Map(serverTeams.map((t) => [t.name, t.id]));
  for (const t of state.teams) {
    const name = String(t?.name ?? '').trim();
    if (!t.id && byName.has(name)) {
      t.id = byName.get(name);
    }
  }

  // 3. IDs, die im letzten Sync da waren, aber jetzt nicht mehr im
  // state → DELETE. So bleiben Wizard-State und DB synchron, auch
  // wenn der User Teams im Wizard entfernt hat.
  const previousIds = Array.isArray(state.__syncedTeamIds)
    ? state.__syncedTeamIds.slice()
    : [];
  const currentIds = new Set(
    state.teams.map((t) => t.id).filter(Boolean)
  );
  const toDelete = previousIds.filter((id) => !currentIds.has(id));
  let removed = 0;
  for (const id of toDelete) {
    try {
      await fetchWithAuth(
        `/api/tournaments/${encodeURIComponent(state.tournamentId)}/teams/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      removed++;
    } catch (err) {
      console.warn('[wizard] team-Delete failed:', err);
    }
  }

  // Cache für den nächsten Sync-Vergleich.
  state.__syncedTeamIds = state.teams.map((t) => t.id).filter(Boolean);

  return {
    ok: true,
    added: Number(body.added) || 0,
    removed,
    teamCount: state.teams.length,
  };
}
// Export für main.js onStateChange + Tests.
export { syncTeamsToBackend };

/**
 * Übersetzt einen Fehler aus createDraft()/ensureDraftPromise() in
 * eine deutsche, für den End-User verständliche Meldung.
 *
 * createDraft() wirft mit:
 *   - server message (z. B. "Nur Gruppen-Owner / Admins …") → deutsch, durchreichen
 *   - server error code (z. B. "name erforderlich")          → generischer Fallback
 *   - status-only message ("POST /api/tournaments → 500")    → übersetzen
 *   - fetch-Fehler (TypeError: Failed to fetch)             → Netzwerk-Hinweis
 *
 * Spec §13.5: Keine kryptischen Codes im UI. Der User muss verstehen,
 * was schiefgelaufen ist und was er tun kann.
 */
function translateDraftError(err) {
  const raw = (err && err.message) ? String(err.message) : '';
  const lower = raw.toLowerCase();

  // Netzwerk / Offline
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung und versuche es erneut.';
  }
  // HTTP-Status-only Message ("POST /api/tournaments → 500")
  const statusMatch = raw.match(/→\s*(\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401) return 'Du bist nicht angemeldet. Bitte melde dich an und versuche es erneut.';
    if (status === 403) return 'Du hast keine Berechtigung, in dieser Gruppe ein Turnier anzulegen.';
    if (status === 404) return 'Die Gruppe wurde nicht gefunden. Bitte lade die Seite neu.';
    if (status === 409) return 'In dieser Gruppe existiert bereits ein Turnier mit diesem Namen. Bitte wähle einen anderen Namen.';
    if (status === 500 || status === 502 || status === 503) {
      return 'Das Turnier konnte nicht gespeichert werden. Bitte versuche es in einem Moment erneut.';
    }
  }
  // Server hat eine lesbare message geschickt → durchreichen.
  // Das sind die "Nur Gruppen-Owner …"-Texte aus routes.js.
  if (raw && !lower.includes('error') && raw.length < 200 && !raw.startsWith('Error:')) {
    return raw;
  }
  // Letzter Fallback — generisch, aber verständlich.
  return 'Der Turnier-Entwurf konnte nicht angelegt werden. Bitte prüfe Name und Gruppe und versuche es erneut.';
}
// Export für Tests — der Wizard greift über die Closure weiter auf den
// unexportierten Namen zu, daher ist die Sichtbarkeit unverändert.
export { translateDraftError };

// ----------------------------------------------------------------
// PATCH-Wrapper für Wizard-Konfiguration + Grunddaten.
//
// Wird pro Step-Wechsel aufgerufen (NICHT pro Tastenanschlag —
// sonst hätte der User 30 PATCHes/min auf dem Server). Die
// serverseitige Validierung in routes.js / config-validator.js
// lehnt ungültige Werte hart ab (400); unerwartete Felder werden
// vom Validator still verworfen (Whitelist).
//
// Was NICHT hier passiert:
//   - teams (POST /:id/teams)
//   - generate-Body (POST /:id/generate)
//   - logo (POST /:id/logo)
// Diese haben eigene Endpoints mit eigener UX (Bulk-Add, separater
// Bestätigungsdialog, File-Upload).
// ----------------------------------------------------------------

/**
 * Wizard-State → PATCH-Body.
 *
 * Liefert NUR Felder, die der User seit dem letzten PATCH geändert hat
 * könnte. Welche tatsächlich geschickt werden, entscheidet der Aufrufer
 * per `changedFields`-Whitelist (z. B. ['sport', 'location'] für
 * Step-1-Wechsel).
 *
 * @returns {{
 *   config: object,           // Engine-Konfiguration (Whitelist)
 *   meta: object,             // location, sport, tableLabels
 * }}
 */
export function buildPatchPayload(state, { changedFields = null } = {}) {
  const config = {
    distribution: state.distributionMethod,
    pointsPerWin: state.pointsWin,
    pointsPerDraw: state.pointsDraw,
    pointsPerLoss: state.pointsLoss,
    tiebreakers: state.tiebreakers,
    qualifyPerGroup: state.advancePerGroup,
    bestThirds: state.bestThirdsCount,
    hasThirdPlacePlayoff: state.thirdPlaceMatch,
    schedule: {
      // Bug 2 (2026-08-17): slotMinutes ist eine Legacy-Konfig-Option.
      // Die Engine berechnet den Slot-Abstand jetzt selbst aus
      // matchDurationMinutes + pauseAfterMatches. Wir senden matchDuration
      // und Pause explizit; slotMinutes bleibt als Kompat-Feld stehen,
      // damit bestehende DB-Configs nicht brechen.
      slotMinutes: (state.matchDuration ?? 30) + (state.pauseMinutes ?? 0),
      matchDurationMinutes: state.matchDuration,
      pauseAfterMatches: state.pauseMinutes,
      parallelFields: state.numTables,
      startTime: state.startTime,
    },
  };
  // numGroups gehört in config (Spec §3 / Engine-Eingabe). Vor diesem
  // Fix wurde numGroups nur im /generate-Body mitgeschickt — Engine
  // konnte es dort zwar lesen, aber wenn der User den Plan nach dem
  // ersten Generate ändert (z. B. zurück in den Wizard geht), konnte
  // /reschedule die config nicht mehr heranziehen. Wir schreiben es
  // daher mit in config.numGroups, das der Validator ab sofort
  // zulassen muss (siehe config-validator.js).
  config.numGroups = state.numGroups;
  // location: leere Strings werden zu null (kein „ " im Druckkopf).
  const locationClean = (typeof state.location === 'string'
                        && state.location.trim() === '')
                        ? null
                        : (state.location ?? null);
  const meta = {
    location: locationClean,
    sport: state.sport,
    tableLabels: Array.isArray(state.tableNames) && state.tableNames.length > 0
      ? state.tableNames
      : null,
  };
  // changedFields enthält WIZARD-Feldnamen (z. B. „location", „tableNames",
  // „numTables"), nicht die API-Feldnamen. Map:
  const metaFieldsByName = {
    location: 'location',
    sport: 'sport',
    tableNames: 'tableLabels',
  };
  const include = (field) =>
    !changedFields || changedFields.includes(field);
  const body = {};
  for (const [wizardName, apiName] of Object.entries(metaFieldsByName)) {
    if (include(wizardName)) body[apiName] = meta[apiName];
  }
  // Mode wird vom Server als Top-Level-Feld akzeptiert (Bug A,
  // 2026-08-17). Vorher schickte der Wizard ihn nur beim Create mit
  // — nach Step 3 hatte der PATCH keine Chance, ihn zu aktualisieren,
  // und der Header zeigte dauerhaft den Create-Default ('groups_ko').
  if (include('mode')) {
    body.mode = state.mode;
  }
  // config wird IMMER mitgeschickt, sobald ein Engine-Feld betroffen ist.
  // numGroups seit 2026-08-17 (Bug A): war vorher nur im /generate-Body
  // und konnte nach Step 3 nicht mehr aktualisiert werden.
  const configOnly = [
    'numGroups',
    'distributionMethod', 'pointsWin', 'pointsDraw', 'pointsLoss',
    'tiebreakers', 'advancePerGroup', 'bestThirdsCount',
    'thirdPlaceMatch', 'numTables', 'matchDuration',
    'pauseMinutes', 'startTime',
  ];
  const anyConfig = !changedFields || configOnly.some((f) =>
    changedFields.includes(f)
  );
  if (anyConfig) body.config = config;
  return body;
}

/**
 * Wizard-Konfiguration + Grunddaten am Server speichern (PATCH /:id).
 *
 * @param {object} state           Wizard-State
 * @param {object} [opts]
 * @param {string[]} [opts.changedFields]
 *   Welche State-Felder haben sich geändert? Null = "alle".
 * @returns {Promise<{ ok: true, tournament: object }
 *                | { ok: false, status: number, error: string,
 *                     message: string, field?: string }>}
 */
export async function persistConfig(state, opts = {}) {
  if (!state.tournamentId) {
    // Mock-Modus oder Entwurf noch nicht angelegt — kein Server-Call.
    return { ok: true, tournament: null };
  }
  const body = buildPatchPayload(state, opts);
  let res;
  try {
    res = await fetchWithAuth(
      `/api/tournaments/${encodeURIComponent(state.tournamentId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message: `Netzwerkfehler: ${err.message}`,
    };
  }
  const respBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: respBody?.error ?? `patch_failed_${res.status}`,
      message: respBody?.message ?? `PATCH /:id → ${res.status}`,
      field: respBody?.field ?? null,
    };
  }
  return { ok: true, tournament: respBody.tournament };
}

/**
 * Wizard-State → POST /api/tournaments/:id/generate-Body.
 *
 * Reiner Mapper — KEIN fetch. Test-freundlich (Round-Trip-Test ruft
 * diese Funktion mit Wizard-State auf und prüft das Mapping). Das
 * eigentliche fetch übernimmt der main.js-Wrapper (opts.onGenerate).
 *
 * @param {object} state
 * @param {object} [opts]
 * @param {string} [opts.confirmTournamentName]   für 409-Folge-Request
 * @returns {object} Body für POST /api/tournaments/:id/generate
 */
export function buildGeneratePayload(state, opts = {}) {
  const body = {};
  // baseDate: schedule.startTime zu einem vollen Datum machen.
  // Engine braucht einen konkreten Tag (YYYY-MM-DD), nicht eine Uhrzeit.
  // Wir nehmen das im Wizard gepflegte state.date (Step 1, ISO-Format).
  if (state.date) {
    body.baseDate = state.date;
  }
  // Anzahl Gruppen + Gruppengröße explizit mitschicken — die Engine
  // würde sie sonst aus config.numGroups lesen, das ist beim ersten
  // Generate (vor PATCH) aber noch null. Doppelung ist OK; der Server
  // bevorzugt den Body-Wert.
  body.numGroups = state.numGroups;
  const groupSize = state.teams.length > 0 && state.numGroups > 0
    ? Math.ceil(state.teams.length / state.numGroups)
    : 0;
  body.groupSize = groupSize;
  // Modus explizit mitschicken (Bug A, 2026-08-17). Body hat Priorität
  // vor der DB-Spalte (routes.js Z. 587: `request.body?.mode ?? ctx…`).
  // Verteidigungslinie: wenn der PATCH-Auto-Save nicht durchgekommen ist
  // (Wizard-Regression, Race Condition), weiß der Server trotzdem,
  // welchen Modus der User wollte — Spec §13.10, keine stillen Annahmen.
  if (state.mode) {
    body.mode = state.mode;
  }
  if (opts.confirmTournamentName) {
    body.confirmTournamentName = opts.confirmTournamentName;
  }
  return body;
}

// ----------------------------------------------------------------
// Logo-Upload (Spec §3 Schritt 1, §8.4 Header/PDF).
//
// Das Logo wird hochgeladen, sobald die Datei ausgewählt wird
// (kein "Speichern" nötig). Der Server verkleinert serverseitig
// auf 512 px und speichert in MinIO. Das Frontend bekommt eine
// Proxy-URL zurück, die es in <img src> rendert.
//
// Wichtig: Diese Funktion MUSS ohne Re-Render des Wizards
// auskommen. Sie aktualisiert nur die ihr übergebenen DOM-Elemente
// (statusEl, previewEl). So bleibt der Fokus in allen anderen
// Eingabefeldern erhalten, falls der User parallel tippt.
// ----------------------------------------------------------------

/**
 * Eine vom User gewählte Bilddatei hochladen.
 * @returns {Promise<{ ok: true, logoUrl: string } | { ok: false, error: string, code?: string }>}
 */
async function uploadTournamentLogo(tournamentId, file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  let res;
  try {
    res = await fetchWithAuth(`/api/tournaments/${encodeURIComponent(tournamentId)}/logo`, {
      method: 'POST',
      body: fd,
    });
  } catch (err) {
    return { ok: false, error: `Netzwerkfehler: ${err.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body?.error || `Upload fehlgeschlagen (${res.status})`,
      code: body?.code,
    };
  }
  return { ok: true, logoUrl: body.logoUrl };
}

/**
 * Logo entfernen — löscht die Datei in MinIO + Referenz in DB.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function deleteTournamentLogo(tournamentId) {
  let res;
  try {
    res = await fetchWithAuth(`/api/tournaments/${encodeURIComponent(tournamentId)}/logo`, {
      method: 'DELETE',
    });
  } catch (err) {
    return { ok: false, error: `Netzwerkfehler: ${err.message}` };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body?.error || `Löschen fehlgeschlagen (${res.status})` };
  }
  return { ok: true };
}

/* ================================================================
   [kru:]nest — Turniermodul Renderer
   ----------------------------------------------------------------
   Step 5 (§12 Punkt 5): die EINE Match-Komponente in drei Größen.

   Was hier lebt:
     - renderMatch(match, opts)         Hauptfunktion
     - renderMatchCompact(match)        == renderMatch({size:'compact'})
     - renderMatchLarge(match)          == renderMatch({size:'large'})
     - renderTeamSlot(slot, side)       {kind, teamId, name, color, …}
     - renderPlaceholderLabel(match)    "Sieger Gruppe A" etc.

   Die Komponente wird in Spielplan, Gruppen, Baum und Kontextspalte
   IDENTISCH wiederverwendet. Nicht vier Varianten bauen — Spec §13.11.

   KEINE Screens, KEINE Endpoints. Nur Render-Helpers, die auf den
   DTOs aus /modules/tournament/access arbeiten.
   ================================================================ */

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Die Match-Komponente in einer von drei Größen.
 *
 * @param {object} match  DTO aus prepareMatchView.
 *   Erwartete Felder (alle aus /modules/tournament/access):
 *     - id, label, statusLabel, isFinished, isPlaceholder, isGroupMatch, isKoMatch
 *     - scoreHome, scoreAway   (number|null)
 *     - home, away            ({ kind: 'team'|'placeholder', name, … } | null)
 *     - field, scheduledLabel ("10:00", "10:00 · Sa, 05. Sep.", oder "")
 *     - winnerTeamId, winnerName     (KO-Matches, beendet)
 *     - loserTeamId, loserName
 *     - scheduledAt (Date)
 * @param {object} [opts]
 *   - size: 'compact' | 'normal' | 'large'   (default: 'normal')
 *   - showAction: bool                       (default: true; bei compact=false)
 *   - onAction:  (match) => void             (Klick auf Aktions-Button)
 *   - classes:   string[]                    (zusätzliche Klassen)
 *
 * @returns {HTMLDivElement} zusammengesetzter Match-Knoten.
 */
export function renderMatch(match, opts = {}) {
  const size = opts.size ?? 'normal';
  const showAction = opts.showAction ?? size !== 'compact';
  const classes = ['t-match'];
  if (size === 'compact') classes.push('t-match--compact');
  if (size === 'large') classes.push('t-match--large');
  if (match.isFinished) classes.push('t-match--done');
  if (match.isGroupMatch) classes.push('t-match--group');
  if (match.isKoMatch) classes.push('t-match--ko');
  if (match.isPlaceholder) classes.push('t-match--placeholder');
  if (Array.isArray(opts.classes)) classes.push(...opts.classes);

  const root = document.createElement('div');
  root.className = classes.join(' ');
  root.dataset.matchId = match.id;
  root.dataset.size = size;
  if (match.isFinished) root.dataset.status = 'finished';
  else if (match.isLive) root.dataset.status = 'live';
  else root.dataset.status = 'open';

  // 1) Farb-Balken links
  const bar = document.createElement('span');
  bar.className = 't-match-bar';
  bar.setAttribute('aria-hidden', 'true');
  root.appendChild(bar);

  // 2) Metadaten (Label + Zeit + Feld)
  const meta = document.createElement('div');
  meta.className = 't-match-meta';
  meta.appendChild(buildMetaContent(match, size));
  root.appendChild(meta);

  if (size === 'compact') {
    // Kompakt: home + away in einem gemeinsamen Element.
    const teams = document.createElement('div');
    teams.className = 't-match-teams';
    teams.appendChild(renderTeamSlot(match.home, 'home', match));
    teams.appendChild(renderTeamSlot(match.away, 'away', match));
    root.appendChild(teams);
  } else {
    // normal/large: getrenntes home + away.
    root.appendChild(renderTeamSlot(match.home, 'home', match));
    root.appendChild(renderMatchScore(match));
    root.appendChild(renderTeamSlot(match.away, 'away', match));
  }

  // 3) Aktions-Spalte (rechts)
  if (showAction) {
    root.appendChild(renderMatchAction(match, opts));
  } else {
    // Kompakt-Variante braucht score in einer eigenen Spalte.
    if (size === 'compact') {
      // (score ist in normal/large ein eigenes Element, bei compact
      // sitzt es bereits im Grid — nichts nachholen)
    } else {
      // (leer)
    }
  }

  return root;
}

// Convenience-Wrapper für die zwei Spezial-Größen.
export function renderMatchCompact(match, opts = {}) {
  return renderMatch(match, { ...opts, size: 'compact', showAction: false });
}
export function renderMatchLarge(match, opts = {}) {
  return renderMatch(match, { ...opts, size: 'large' });
}

// ----------------------------------------------------------------
// Innere Helfer
// ----------------------------------------------------------------

function buildMetaContent(match, size) {
  const frag = document.createDocumentFragment();

  const label = document.createElement('div');
  label.className = 't-match-meta-label';
  label.textContent = match.label ?? 'Spiel';
  frag.appendChild(label);

  // Zeit + Feld, klein darunter.
  if (match.scheduledLabel || match.field) {
    const meta = document.createElement('div');
    meta.className = 't-match-meta-when';
    const parts = [];
    if (match.scheduledLabel) parts.push(match.scheduledLabel);
    if (match.field) parts.push(`Tisch ${match.field}`);
    meta.textContent = parts.join(' · ');
    frag.appendChild(meta);
  }

  return frag;
}

/**
 * Liefert entweder ein Team-Element oder einen Platzhalter.
 * @param {object|null} slot     { kind: 'team'|'placeholder', name, teamId, color, logoUrl }
 * @param {'home'|'away'} side
 * @param {object}      match    das umgebende Match-DTO (für Gewinner-Markierung)
 */
function renderTeamSlot(slot, side, match) {
  const el = document.createElement('div');
  el.className = `t-match-team${side === 'away' ? ' right' : ''}`;
  if (!slot) {
    // Kein Slot → leerer Platzhalter.
    el.classList.add('t-match-team--empty');
    el.textContent = '—';
    return el;
  }

  // Optionaler Farbpunkt (Teams haben .color).
  if (slot.color) {
    const dot = document.createElement('span');
    dot.className = 't-dot';
    dot.style.background = slot.color;
    el.appendChild(dot);
  }

  // Logo oder Initiale (kein zusätzlicher Bild-Request, einfach).
  if (slot.logoUrl) {
    const img = document.createElement('img');
    img.className = 't-match-team-logo';
    img.src = slot.logoUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 20;
    img.height = 20;
    el.appendChild(img);
  }

  const name = document.createElement('span');
  name.className = 'name';
  if (slot.kind === 'placeholder') {
    name.classList.add('is-placeholder');
    name.textContent = slot.name; // bereits aufgelöst vom DTO
  } else {
    name.textContent = slot.name ?? '—';
  }
  el.appendChild(name);

  // Gewinner-Markierung: schauen, ob dieser Slot der Sieger/Verlierer ist.
  if (match.winnerTeamId && slot.teamId === match.winnerTeamId) {
    el.classList.add('is-winner');
  } else if (match.loserTeamId && slot.teamId === match.loserTeamId) {
    el.classList.add('is-loser');
  }

  return el;
}

function renderMatchScore(match) {
  const score = document.createElement('div');
  score.className = 't-match-score';
  if (
    match.scoreHome != null &&
    match.scoreAway != null
  ) {
    score.textContent = `${match.scoreHome} : ${match.scoreAway}`;
  } else {
    score.classList.add('empty');
    score.textContent = '— : —';
    score.setAttribute('aria-label', 'Noch nicht gespielt');
  }
  return score;
}

function renderMatchAction(match, opts) {
  const action = document.createElement('div');
  action.className = 't-match-action';

  if (typeof opts.onAction !== 'function') {
    return action; // leerer Container — Komponente bleibt layout-stabil.
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 't-btn t-btn--sm';
  button.textContent = match.isFinished
    ? 'Ergebnis ändern'
    : 'Ergebnis eintragen';
  button.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onAction(match);
  });
  action.appendChild(button);
  return action;
}

// ----------------------------------------------------------------
// Default-Export: einzige Tür für die ganze UI.
// Beim späteren Screen-Build: `import { renderMatch } from '/script/tournament.js'`.
// ----------------------------------------------------------------
export default {
  renderMatch,
  renderMatchCompact,
  renderMatchLarge,
  renderListView,
  renderEmptyState,
};

// ----------------------------------------------------------------
// Screen A — Turnierliste (§13.2)
//
// Aufbau:
//   <div class="t-mod">
//     <div class="t-mod-tabs">…</div>
//     <div class="t-shell">
//       <nav class="t-mod-nav">…</nav>
//       <main class="t-mod-main">
//         <div class="t-view is-active">…</div>
//       </main>
//     </div>
//   </div>
//
// Die Funktionen hier geben DOM-Knoten zurück; sie sind NICHT an
// globale Events gebunden. Klick-Handler werden vom Aufrufer
// gesetzt (oder nicht — siehe "keine Platzhalter"-Vorgabe).
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Teams-View (C5) — post-Generate.
//
// Spec §5: "Ein Team umbenennen berührt den Spielplan nicht — nur die
// Anzeige." Diese View ist die UI dazu: pro Zeile ein <input> für
// den Namen, ein Color-Picker, ein Reset-Knopf für „Farbe zurück-
// setzen", und ein Status-Indikator (✓/⚠/…).
//
// Wichtig: KEIN Re-Render beim Tippen. Das Eingabefeld bleibt
// durchgehend fokussiert (selbe Lehre wie Step 2). Wir mutieren den
// lokalen State direkt beim 'input'-Event und feuern erst beim
// 'change' oder 'blur' einen PATCH.
//
// Pro Team eine Pending-Queue: läuft gerade ein PATCH, wird der
// nächste Wert in pendingValues[i] gesammelt. Sobald der aktuelle
// PATCH zurückkommt, wird pendingValues[i] sofort nachgesendet
// (falls vorhanden). Damit überschreiben sich schnelle Änderungen
// am gleichen Team nicht.
//
// Oben über der Liste eine Sammelanzeige:
//   ✓ Alle Änderungen gespeichert.
//   ⚠ N Änderungen konnten nicht gespeichert werden.  [Erneut versuchen]
//
// @param {object} opts
//   - teams:        Array<{ id, name, color, seed, logoUrl? }>
//   - tournamentId: string
//   - canEdit:      boolean (Admin-JSON-Flag)
//   - fetchPatch:   async ({teamId, patch}) => { ok, error?, body? }
//                   Default: fetch('/api/tournaments/:id/teams/:tid', …).
//                   Im Mock-Modus liefert der Test einen Stub.
//   - onUpdated:    (newTeams) => void  — Parent-State-Update nach PATCH
// ----------------------------------------------------------------
export function renderTeamsView(opts = {}) {
  const {
    teams: initialTeams = [],
    tournamentId = '',
    canEdit = false,
    fetchPatch = defaultFetchPatch(tournamentId),
    onUpdated = () => {},
  } = opts;

  // Lokaler State: Kopie der initialen Teams, plus pro Team
  // Pending-Queue und Status.
  const localTeams = initialTeams.map((t) => ({ ...t }));
  const pendingValues = new Map(); // teamId -> { name?, color? }
  const inFlight = new Set();      // teamIds mit laufendem PATCH
  const failedPatches = new Map(); // teamId -> { name?, color? } (für Retry)
  let lastSuccessAt = 0;

  const root = document.createElement('div');
  root.className = 't-teams-view';
  root.setAttribute('data-screen', 'teams');

  // ── Kopf mit Titel + Sammelanzeige ──────────────────────────────
  const head = document.createElement('div');
  head.className = 't-teams-head';
  const title = document.createElement('h2');
  title.className = 't-teams-title';
  title.textContent = `Teams (${localTeams.length})`;
  head.appendChild(title);

  const summary = document.createElement('div');
  summary.className = 't-teams-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.dataset.state = 'idle'; // 'idle' | 'ok' | 'err' | 'saving'
  head.appendChild(summary);
  root.appendChild(head);

  function renderSummary() {
    const errCount = failedPatches.size;
    const savingCount = inFlight.size;
    summary.innerHTML = '';
    if (savingCount > 0 && errCount === 0) {
      summary.dataset.state = 'saving';
      summary.textContent = `Speichere ${savingCount} Änderung${savingCount === 1 ? '' : 'en'} …`;
      return;
    }
    if (errCount > 0) {
      summary.dataset.state = 'err';
      const text = document.createElement('span');
      text.textContent =
        errCount === 1
          ? '1 Änderung konnte nicht gespeichert werden.'
          : `${errCount} Änderungen konnten nicht gespeichert werden.`;
      summary.appendChild(text);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 't-btn t-btn--sm t-btn--primary';
      retry.textContent = 'Erneut versuchen';
      retry.addEventListener('click', () => retryAll());
      summary.appendChild(retry);
      return;
    }
    if (lastSuccessAt && Date.now() - lastSuccessAt < 4000) {
      summary.dataset.state = 'ok';
      summary.textContent = '✓ Alle Änderungen gespeichert.';
      return;
    }
    summary.dataset.state = 'idle';
    summary.textContent = '';
  }

  // ── Liste ───────────────────────────────────────────────────────
  const list = document.createElement('ul');
  list.className = 't-teams-list';
  root.appendChild(list);

  function buildRow(team) {
    const li = document.createElement('li');
    li.className = 't-teams-row';
    li.dataset.teamId = team.id;
    li.dataset.rowState = 'idle';

    // Seed-Badge
    const seed = document.createElement('span');
    seed.className = 't-teams-seed';
    seed.textContent = String(team.seed ?? '');
    li.appendChild(seed);

    // Name-Input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 't-input t-teams-name-input';
    nameInput.value = team.name ?? '';
    nameInput.maxLength = 128;
    nameInput.placeholder = 'Teamname';
    nameInput.disabled = !canEdit;
    li.appendChild(nameInput);

    // Color-Picker
    const colorWrap = document.createElement('span');
    colorWrap.className = 't-teams-color-wrap';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 't-teams-color-input';
    colorInput.value = normalizeColor(team.color);
    colorInput.disabled = !canEdit;
    colorInput.title = 'Teamfarbe';
    colorWrap.appendChild(colorInput);
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 't-btn t-btn--xs t-btn--ghost';
    resetBtn.textContent = '×';
    resetBtn.title = 'Farbe zurücksetzen';
    resetBtn.disabled = !canEdit;
    colorWrap.appendChild(resetBtn);
    li.appendChild(colorWrap);

    // Status
    const status = document.createElement('span');
    status.className = 't-teams-row-status';
    status.setAttribute('aria-label', 'Status');
    status.dataset.state = 'idle';
    li.appendChild(status);

    // ── Event-Handler ────────────────────────────────────────────
    // input: KEINE Mutation von team.name! Wir wollen den letzten
    // *committed* Wert für den 409-Rollback behalten. Erst beim
    // 'change'/'blur' wird der PATCH abgefeuert und bei Erfolg der
    // lokale State aktualisiert.
    //
    // change (Blur, Enter, Tab): PATCH feuern.
    function scheduleChange(patch) {
      const prev = pendingValues.get(team.id) || {};
      pendingValues.set(team.id, { ...prev, ...patch });
      drainQueue(team.id);
    }

    nameInput.addEventListener('change', () => {
      scheduleChange({ name: nameInput.value.trim() });
    });
    nameInput.addEventListener('blur', () => {
      // Falls 'change' schon gefeuert hat, ist pendingValues leer.
      // Wir prüfen nur, ob der Wert vom letzten committed-Wert
      // abweicht — und feuern ggf. nach.
      if ((nameInput.value ?? '') !== (team.name ?? '')) {
        scheduleChange({ name: nameInput.value.trim() });
      }
    });
    colorInput.addEventListener('change', () => {
      scheduleChange({ color: colorInput.value });
    });
    resetBtn.addEventListener('click', () => {
      scheduleChange({ color: null });
    });

    return li;
  }

  function buildAll() {
    list.innerHTML = '';
    for (const t of localTeams) list.appendChild(buildRow(t));
  }
  buildAll();

  // ── Queue-Worker ────────────────────────────────────────────────
  async function drainQueue(teamId) {
    if (inFlight.has(teamId)) return;
    const patch = pendingValues.get(teamId);
    if (!patch) return;
    pendingValues.delete(teamId);
    inFlight.add(teamId);
    failedPatches.delete(teamId);
    setRowStateFor(teamId, 'saving');
    renderSummary();
    try {
      const result = await fetchPatch({ teamId, patch });
      if (result && result.ok) {
        const t = localTeams.find((x) => x.id === teamId);
        if (t) {
          if (patch.name !== undefined) t.name = patch.name;
          if (patch.color !== undefined) t.color = patch.color;
        }
        lastSuccessAt = Date.now();
        setRowStateFor(teamId, 'ok');
        onUpdated(localTeams.slice());
      } else {
        failedPatches.set(teamId, patch);
        setRowStateFor(teamId, 'err');
        // Bei 409 (Duplikat) setzen wir den letzten erfolgreich
        // gespeicherten Wert zurück ins Input-Feld. NICHT den
        // initialen — der ist möglicherweise schon veraltet.
        if (result && result.status === 409 && patch.name !== undefined) {
          const t = localTeams.find((x) => x.id === teamId);
          const nameInput = list.querySelector(
            `[data-team-id="${cssEscape(teamId)}"] .t-teams-name-input`
          );
          if (nameInput && t) nameInput.value = t.name ?? '';
        }
      }
    } catch (err) {
      failedPatches.set(teamId, patch);
      setRowStateFor(teamId, 'err');
    } finally {
      inFlight.delete(teamId);
      renderSummary();
      const next = pendingValues.get(teamId);
      if (next) drainQueue(teamId);
    }
  }

  function setRowStateFor(teamId, state) {
    const li = list.querySelector(`[data-team-id="${cssEscape(teamId)}"]`);
    if (!li) return;
    const status = li.querySelector('.t-teams-row-status');
    if (!status) return;
    status.dataset.state = state;
    status.textContent =
      state === 'saving' ? '…'
      : state === 'ok' ? '✓'
      : state === 'err' ? '⚠'
      : '';
    li.dataset.rowState = state;
  }

  async function retryAll() {
    const ids = Array.from(failedPatches.keys());
    for (const id of ids) {
      const patch = failedPatches.get(id);
      failedPatches.delete(id);
      pendingValues.set(id, patch);
      drainQueue(id);
    }
    renderSummary();
  }

  // Initial-Summary + sammelt alle 1s ein „Alle Änderungen
  // gespeichert" aus, wenn länger nichts mehr passiert ist.
  renderSummary();
  const summaryTimer = setInterval(renderSummary, 1000);
  // Falls die View entfernt wird (SPA-Navigation), Timer abräumen.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      clearInterval(summaryTimer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return root;
}

function defaultFetchPatch(tournamentId) {
  return async ({ teamId, patch }) => {
    try {
      const res = await fetchWithAuth(
        `/api/tournaments/${encodeURIComponent(tournamentId)}/teams/${encodeURIComponent(teamId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      );
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { error: 'network', message: err.message } };
    }
  };
}

function normalizeColor(c) {
  if (!c || typeof c !== 'string') return '#888888';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#888888';
}

function cssEscape(s) {
  return String(s).replace(/(["\\])/g, '\\$1');
}

// ----------------------------------------------------------------

/**
 * Baut die vollständige Screen-A-Struktur (Tabs + Shell + Main + Aside).
 *
 * @param {object} dto  Liste-Kontext vom Backend (buildTournamentListContext):
 *   { tournaments: TournamentDTO[], isAdmin: bool, rawCount: number }
 *
 * Erwartete Felder pro Tournament-DTO:
 *   id, name, logoUrl
 *   startsAt (Date|string), endsAt, singleDay
 *   mode, modeLabel, status, statusLabel, cardStatusLabel
 *   teamCount, groupCount, matchCount, finishedCount
 *   startsAtDate, endsAtDate, startsAtShort
 *
 * @param {object} [opts]
 *   - activeTab: 'aktuelle' | 'kommende' | 'beendete' (default: alle)
 *   - onCardClick: (tournament) => void
 *   - onRefresh: () => void
 */
export function renderListView(dto, opts = {}) {
  const isAdmin = dto?.isAdmin === true;
  const tournaments = Array.isArray(dto?.tournaments) ? dto.tournaments : [];

  const root = document.createElement('div');
  root.className = 't-mod';
  root.setAttribute('data-screen', 'list');
  root.setAttribute('data-role', isAdmin ? 'admin' : 'member');

  // ── Mobile Tab-Leiste ──────────────────────────────────────────
  root.appendChild(renderMobileTabs(opts.activeTab ?? 'alle'));

  // ── 3-Spalten-Shell ────────────────────────────────────────────
  const shell = document.createElement('div');
  shell.className = 't-shell';

  shell.appendChild(renderSideNav(isAdmin));
  shell.appendChild(renderListMain(tournaments, isAdmin, opts));
  // Aside ist auf <1500px ausgeblendet (Spec §8.1).
  // Hier rendern wir ihn trotzdem als leere Spalte, damit das Grid
  // auf breiten Schirmen nicht "zusammenfällt".
  shell.appendChild(renderAside(isAdmin, tournaments.length));

  root.appendChild(shell);
  return root;
}

function renderMobileTabs(active) {
  const wrap = document.createElement('div');
  wrap.className = 't-mod-tabs';
  wrap.setAttribute('role', 'tablist');
  for (const tab of [
    { id: 'alle',     label: 'Alle' },
    { id: 'aktuelle', label: 'Aktuelle' },
    { id: 'kommende', label: 'Kommende' },
    { id: 'beendete', label: 'Beendete' },
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 't-mod-tab';
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    if (tab.id === active) btn.classList.add('is-active');
    wrap.appendChild(btn);
  }
  return wrap;
}

function renderSideNav(isAdmin) {
  const nav = document.createElement('nav');
  nav.className = 't-mod-nav';
  nav.setAttribute('aria-label', 'Turnier-Navigation');

  const title = document.createElement('div');
  title.className = 't-section-label';
  title.textContent = 'Turniere';
  nav.appendChild(title);

  const items = [
    { id: 'aktuelle', label: 'Aktuelle', count: null },
    { id: 'kommende', label: 'Kommende', count: null },
    { id: 'beendete', label: 'Beendete', count: null },
  ];
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.nav = item.id;
    btn.textContent = item.label;
    nav.appendChild(btn);
  }
  return nav;
}

function renderListMain(tournaments, isAdmin, opts) {
  const main = document.createElement('main');
  main.className = 't-mod-main';

  // View-Header
  const head = document.createElement('div');
  head.className = 't-view-head';
  const title = document.createElement('div');
  title.className = 't-view-title';
  title.textContent = 'Aktuelle Turniere';
  const sub = document.createElement('div');
  sub.className = 't-view-sub';
  sub.textContent = tournaments.length === 1
    ? '1 Turnier in dieser Gruppe'
    : `${tournaments.length} Turniere in dieser Gruppe`;
  head.appendChild(title);
  head.appendChild(sub);
  main.appendChild(head);

  // Body — Liste oder Empty-State
  if (tournaments.length === 0) {
    main.appendChild(renderEmptyState(isAdmin));
  } else {
    main.appendChild(renderTournamentGrid(tournaments, isAdmin, opts));
  }
  return main;
}

function renderTournamentGrid(tournaments, isAdmin, opts) {
  const grid = document.createElement('div');
  grid.className = 't-card-grid';

  // Filter: Mitglieder sehen keine Entwürfe (Spec §13.2).
  const visible = isAdmin
    ? tournaments
    : tournaments.filter((t) => t.status !== 'draft');

  for (const t of visible) {
    grid.appendChild(renderTournamentCard(t, isAdmin, opts));
  }

  if (visible.length === 0 && !isAdmin) {
    // Sonderfall: nur Entwürfe existieren → für Member wirkt die Liste leer.
    grid.appendChild(renderEmptyState(false));
  }
  return grid;
}

/**
 * Einzelne Turnier-Karte.
 * @param {object} tournament   DTO mit .id, .name, .logoUrl, .cardStatusLabel,
 *                              .startsAtShort, .teamCount, .groupCount,
 *                              .matchCount, .finishedCount, .status
 * @param {boolean} isAdmin
 * @param {object} [opts]   onCardClick, onMenuAction
 */
export function renderTournamentCard(tournament, isAdmin, opts = {}) {
  // ── Entwurf: eigene schmale Karte (Spec §1.2 + Schnitt 1+2+b) ───
  // Anzeige NUR: Status-Badge, Name, Datum, Löschen-Button,
  // ehrlicher Hinweis. KEIN Fortsetzen-Button — der kommt in
  // Schnitt 2.5, sobald PATCH das Wizard-Format versteht und der
  // Wizard State wiederherstellen kann. Bis dahin zeigt die Karte
  // unmissverständlich, dass der Entwurf nicht weiterbearbeitbar ist.
  if (tournament.status === 'draft') {
    return renderDraftCard(tournament, isAdmin, opts);
  }

  const card = document.createElement('article');
  card.className = 't-list-card';
  card.dataset.tournamentId = tournament.id;
  card.dataset.status = tournament.status;

  // ── Kopf: Logo + Name + (optional Kontextmenü) ────────────────
  const headRow = document.createElement('div');
  headRow.className = 't-list-card-row';

  const logo = document.createElement('div');
  logo.className = 't-list-card-logo';
  if (tournament.logoUrl) {
    const img = document.createElement('img');
    img.src = tournament.logoUrl;
    img.alt = '';
    img.loading = 'lazy';
    logo.appendChild(img);
  } else {
    logo.textContent = (tournament.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  }
  headRow.appendChild(logo);

  const name = document.createElement('div');
  name.className = 't-list-card-name';
  name.textContent = tournament.name ?? '';
  headRow.appendChild(name);

  if (isAdmin) {
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 't-list-card-menu-btn';
    menuBtn.setAttribute('aria-label', 'Aktionen');
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (typeof opts.onMenuAction === 'function') {
        opts.onMenuAction(tournament);
      }
    });
    headRow.appendChild(menuBtn);
  }

  card.appendChild(headRow);

  // ── Status-Badge + Datum ──────────────────────────────────────
  const metaRow = document.createElement('div');
  metaRow.className = 't-list-card-row';

  const badge = document.createElement('span');
  badge.className = `t-list-card-status t-list-card-status--${badgeVariant(tournament.status)}`;
  badge.textContent = tournament.cardStatusLabel ?? tournament.statusLabel ?? '';
  metaRow.appendChild(badge);

  if (tournament.startsAtShort) {
    const date = document.createElement('span');
    date.className = 't-list-card-date';
    date.textContent = tournament.startsAtShort;
    metaRow.appendChild(date);
  }

  card.appendChild(metaRow);

  // ── Kurzinfo: "16 Teams · 4 Gruppen · 12 von 24 Spielen" ─────
  const info = buildInfoLine(tournament);
  if (info) {
    const infoEl = document.createElement('div');
    infoEl.className = 't-list-card-info';
    infoEl.textContent = info;
    card.appendChild(infoEl);
  }

  // ── Fortschrittsbalken ────────────────────────────────────────
  const progress = renderTournamentProgress(tournament);
  if (progress) card.appendChild(progress);

  // Karten-Klick — nur wenn Handler gesetzt.
  if (typeof opts.onCardClick === 'function') {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => opts.onCardClick(tournament));
  }
  return card;
}

/**
 * Entwurf-Karte (Schnitt 1+b).
 *
 * Anzeige:
 *   - Status-Badge „Entwurf"
 *   - Turniername + Datum
 *   - Ehrlicher Hinweis: „Dieser Entwurf wurde nicht fertig
 *     eingerichtet."
 *   - Löschen-Button (ruft opts.onMenuAction mit action='delete')
 *
 * Bewusst NICHT da:
 *   - Fortschrittsbalken, Team-/Gruppen-Zahlen — der Entwurf hat
 *     diese Daten nicht.
 *   - „Fortsetzen"-Button — kommt in Schnitt 2.5, sobald PATCH das
 *     Wizard-Format versteht und der Wizard State wiederherstellen
 *     kann. Bis dahin ist der Entwurf nur auffindbar + löschbar.
 */
function renderDraftCard(tournament, isAdmin, opts = {}) {
  const card = document.createElement('article');
  card.className = 't-list-card t-list-card--draft';
  card.dataset.tournamentId = tournament.id;
  card.dataset.status = 'draft';

  // Kopf: Logo + Name
  const headRow = document.createElement('div');
  headRow.className = 't-list-card-row';
  const logo = document.createElement('div');
  logo.className = 't-list-card-logo';
  logo.textContent = (tournament.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  headRow.appendChild(logo);
  const name = document.createElement('div');
  name.className = 't-list-card-name';
  name.textContent = tournament.name ?? '';
  headRow.appendChild(name);
  card.appendChild(headRow);

  // Status-Badge „Entwurf" + Datum
  const metaRow = document.createElement('div');
  metaRow.className = 't-list-card-row';
  const badge = document.createElement('span');
  badge.className = 't-list-card-status t-list-card-status--draft';
  badge.textContent = 'Entwurf';
  metaRow.appendChild(badge);
  if (tournament.startsAtShort) {
    const date = document.createElement('span');
    date.className = 't-list-card-date';
    date.textContent = tournament.startsAtShort;
    metaRow.appendChild(date);
  }
  card.appendChild(metaRow);

  // Ehrlicher Hinweis (statt „Fortsetzen"-Button)
  const note = document.createElement('p');
  note.className = 't-list-card-note';
  note.textContent = 'Dieser Entwurf wurde nicht fertig eingerichtet.';
  card.appendChild(note);

  // Löschen-Button (nur Admin sieht diese Karte — siehe §1.2-Filter)
  if (isAdmin && typeof opts.onMenuAction === 'function') {
    const actions = document.createElement('div');
    actions.className = 't-list-card-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 't-btn t-btn--danger';
    deleteBtn.textContent = 'Löschen';
    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      opts.onMenuAction(tournament, 'delete');
    });
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
  }

  return card;
}

function badgeVariant(status) {
  switch (status) {
    case 'draft':       return 'draft';
    case 'generated':   return 'ready';
    case 'group_stage':
    case 'ko_stage':    return 'running';
    case 'finished':    return 'finished';
    default:            return 'draft';
  }
}

/**
 * "16 Teams · 4 Gruppen · 12 von 24 Spielen gespielt"
 * Gibt null zurück, wenn die Counts leer sind (Turnier im Entwurf).
 */
function buildInfoLine(tournament) {
  const parts = [];
  const teamCount = tournament.teamCount ?? 0;
  const groupCount = tournament.groupCount ?? 0;
  const matchCount = tournament.matchCount ?? 0;
  const finished = tournament.finishedCount ?? 0;

  if (teamCount > 0) {
    parts.push(`${teamCount} ${teamCount === 1 ? 'Team' : 'Teams'}`);
  }
  if (groupCount > 0) {
    parts.push(`${groupCount} ${groupCount === 1 ? 'Gruppe' : 'Gruppen'}`);
  }
  if (matchCount > 0) {
    parts.push(`${finished} von ${matchCount} ${matchCount === 1 ? 'Spiel' : 'Spielen'} gespielt`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Fortschrittsbalken. Gibt null zurück, wenn es keine Spiele gibt
 * (z. B. bei Entwürfen — keine Progress-Anzeige).
 */
export function renderTournamentProgress(tournament) {
  const matchCount = tournament.matchCount ?? 0;
  const finished = tournament.finishedCount ?? 0;
  if (matchCount <= 0) return null;

  const pct = Math.max(0, Math.min(100, Math.round((finished / matchCount) * 100)));

  const wrap = document.createElement('div');
  wrap.className = 't-list-card-progress';

  const bar = document.createElement('div');
  bar.className = 't-list-card-progress-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(matchCount));
  bar.setAttribute('aria-valuenow', String(finished));

  const fill = document.createElement('div');
  fill.className = 't-list-card-progress-fill';
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  const label = document.createElement('div');
  label.className = 't-list-card-progress-label';
  label.textContent = `${finished} / ${matchCount} · ${pct}%`;

  wrap.appendChild(bar);
  wrap.appendChild(label);
  return wrap;
}

/**
 * Leerer Zustand (§13.2). Unterschiedliche Texte für Admin und Member.
 * KEIN Button — der Wizard ist noch nicht gebaut (siehe "keine Platzhalter"-Regel).
 *
 * @param {boolean} isAdmin
 */
export function renderEmptyState(isAdmin) {
  const wrap = document.createElement('div');
  wrap.className = 't-empty-state';
  wrap.setAttribute('role', 'status');

  // KEIN Icon mehr — es wirkte wie ein klickbarer Button, war aber
  // keiner (§13 "Keine Platzhalter"). Bis der Wizard steht, reicht
  // reiner Text.

  const text = document.createElement('div');
  text.className = 't-empty-state-text';
  text.textContent = isAdmin
    ? 'Noch kein Turnier angelegt.'
    : 'In dieser Gruppe läuft gerade kein Turnier.';
  wrap.appendChild(text);

  const hint = document.createElement('div');
  hint.className = 't-empty-state-hint';
  hint.textContent = isAdmin
    ? 'Das Anlegen folgt im nächsten Schritt.'
    : '';
  wrap.appendChild(hint);

  return wrap;
}

function renderAside(isAdmin, tournamentCount) {
  const aside = document.createElement('aside');
  aside.className = 't-mod-aside';
  aside.setAttribute('aria-label', 'Legende');

  // Block 1: Status-Legende (für alle Rollen)
  const legendBlock = document.createElement('div');
  legendBlock.className = 't-aside-block';
  const legendTitle = document.createElement('div');
  legendTitle.className = 't-section-label';
  legendTitle.textContent = 'Status';
  legendBlock.appendChild(legendTitle);

  for (const v of [
    { status: 'draft',       label: 'Entwurf' },
    { status: 'generated',   label: 'Bereit' },
    { status: 'group_stage', label: 'Läuft' },
    { status: 'finished',    label: 'Beendet' },
  ]) {
    const row = document.createElement('div');
    row.className = 't-list-card-row';
    row.style.padding = '4px 0';
    const badge = document.createElement('span');
    badge.className = `t-list-card-status t-list-card-status--${badgeVariant(v.status)}`;
    badge.textContent = v.label;
    row.appendChild(badge);
    legendBlock.appendChild(row);
  }
  aside.appendChild(legendBlock);

  // Block 2: Anzahl-Hinweis (für alle Rollen, klein)
  if (tournamentCount > 0) {
    const countBlock = document.createElement('div');
    countBlock.className = 't-aside-block';
    const countTitle = document.createElement('div');
    countTitle.className = 't-section-label';
    countTitle.textContent = 'Übersicht';
    countBlock.appendChild(countTitle);
    const countText = document.createElement('div');
    countText.className = 't-list-card-info';
    countText.textContent = `${tournamentCount} ${tournamentCount === 1 ? 'Turnier' : 'Turniere'} in dieser Gruppe`;
    countBlock.appendChild(countText);
    aside.appendChild(countBlock);
  }

  // Block 3: Ehrlicher Hinweis statt Button (Wizard kommt gleich)
  if (isAdmin) {
    const adminBlock = document.createElement('div');
    adminBlock.className = 't-aside-block';
    const adminTitle = document.createElement('div');
    adminTitle.className = 't-section-label';
    adminTitle.textContent = 'Neu anlegen';
    adminBlock.appendChild(adminTitle);
    const adminText = document.createElement('div');
    adminText.className = 't-list-card-info';
    adminText.textContent = 'Du kannst gleich ein Turnier erstellen.';
    adminBlock.appendChild(adminText);
    aside.appendChild(adminBlock);
  }

  return aside;
}

// ----------------------------------------------------------------
// Globale API — wird vom Preview-HTML und später vom Hauptrouting
// konsumiert. main.js bleibt ahnungslos (kein Tournament-Wissen).
// ----------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.Tournament = {
    renderListView,
    renderTournamentCard,
    renderTournamentProgress,
    renderEmptyState,
    renderMatch,
    renderMatchCompact,
    renderMatchLarge,
    renderWizardView,
    renderTeamsView,
  };
}

// ========================================================================
// Screen B — Wizard "Neues Turnier" (§13.3)
//
// Fünf Schritte, oben Fortschrittsanzeige, unten Zurück/Weiter.
// Live-Vorschau rechts ab 1200px Modul-Breite.
// Max 900px Form-Breite — die einzige Ansicht im Modul, die
// absichtlich schmal ist (lange Formularzeilen unleserlich).
// ========================================================================

const SPORT_OPTIONS = [
  { id: 'becher', label: 'Bierpong',   score: 'Becher',  scoreShort: 'B.' },
  { id: 'tore',   label: 'Fußball',    score: 'Tore',    scoreShort: 'Tore' },
  { id: 'punkte', label: 'Sonstiges',  score: 'Punkte',  scoreShort: 'Pkt.' },
];

const MODE_OPTIONS = [
  { id: 'groups_ko',  label: 'Gruppen + K.-o.', desc: 'WM-Modus. Jede Gruppe spielt Jeder-gegen-Jeden, die besten Teams steigen in den K.-o.-Baum auf.' },
  { id: 'groups_only', label: 'Nur Gruppen',    desc: 'Liga-Modus. Endstand ist die Gruppentabelle.' },
  { id: 'ko_only',     label: 'Nur K.-o.',      desc: 'Single-Elimination. Direkt in den K.-o.-Baum, optional mit Spiel um Platz 3.' },
  { id: 'double_elim', label: 'Doppel-K.O.',    desc: 'Doppelt-k.-o. (Kommt in einer späteren Ausbaustufe.)', disabled: true },
];

const DISTRIBUTION_METHODS = [
  { id: 'random', label: 'Zufällig auslosen' },
  { id: 'seeded', label: 'Setzliste (Snake Seeding)' },
  { id: 'manual', label: 'Manuell zuweisen' },
];

const TIEBREAKER_ORDER = [
  { id: 'points',         label: 'Punkte' },
  { id: 'headToHead',     label: 'Direkter Vergleich' },
  { id: 'goalDiff',       label: 'Tordifferenz' },
  { id: 'goalsFor',       label: 'Erzielte Tore' },
  { id: 'goalsAgainst',   label: 'Wenigste Gegentore' },
];

const STEP_TITLES = [
  'Grunddaten',
  'Teams',
  'Modus',
  'Qualifikation & Zeitplan',
  'Zusammenfassung',
];

const DEFAULT_WIZARD_STATE = {
  step: 1,
  // Step 1
  name: '',
  date: '',
  location: '',
  sport: 'becher',
  logoUrl: null,
  // Step 2
  teamInput: '',
  teams: [],
  // Step 3
  mode: 'groups_ko',
  numGroups: 2,
  distributionMethod: 'random',
  // Hin+Rück-Toggle ist raus (Spec-Slice entschieden), offene Liste.
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: TIEBREAKER_ORDER.map((t) => t.id),
  // Step 4
  advancePerGroup: 2,
  bestThirdsCount: 0,
  thirdPlaceMatch: false,
  numTables: 2,
  // Tischnamen sind eigene Werte (Spec §1.2); sie heißen im Backend
  // tableLabels, im State bleiben sie aus Lesbarkeitsgründen tableNames.
  tableNames: [],
  startTime: '14:00',
  matchDuration: 15,
  pauseMinutes: 5,
};

/**
 * Validiert und normalisiert einen step-Wert für den Wizard.
 * Akzeptiert werden genau die Integer 1..5; alles andere (0, 7,
 * undefined, NaN, "1" als String, 3.5, -1) fällt auf
 * DEFAULT_WIZARD_STATE.step (=1) zurück.
 *
 * Hintergrund: ensureDraftPromise() in Step 1 prüft `state.step === 1`
 * und legt sonst keinen Entwurf an — ein falscher Startwert hätte
 * "no_tournament_id" in Schritt 5 zur Folge.
 *
 * Pure-Function, damit sie ohne DOM in Vitest getestet werden kann.
 */
export function coerceWizardStep(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return DEFAULT_WIZARD_STATE.step;
}

// ----------------------------------------------------------------
// §9-Konstellations-Validierung (2026-08-17, Bug B).
//
// Spec §9 sagt: "Wenn eine Konstellation nicht eindeutig auflösbar ist,
// zeigt die App das dem Veranstalter an, statt sich still zu entscheiden."
//
// Konkreter Fall, der im UI-Bug-Report dokumentiert ist:
//   4 Teams / 2 Gruppen à 2 / Top 2 + 0 beste Dritte = 4 Qualifikanten
//   → alle 4 Teams kommen weiter, niemand scheidet aus
//   → Halbfinale mit allen 4 = sinnlos, jeder spielt nochmal
//
// validateConstitution() ist eine Pure-Function, die ALLE §9-Fälle
// prüft und ein Array von Warnungen zurückgibt. Sie wird vom Wizard
// in Step 4 gerendert und kann vom Backend-Audit/Tests ebenfalls
// aufgerufen werden.
//
// Rückgabe:
//   {
//     level: 'ok' | 'warn' | 'block',
//     messages: [{ severity, code, text, fix? }, ...]
//   }
//
//   - 'ok':    keine Probleme (kann Messages mit severity 'info' enthalten)
//   - 'warn':  sinnvolle Konstellation mit Schwächen, UI zeigt sie gelb
//   - 'block': so sinnlos, dass die App das Generieren ablehnen sollte
//
// Codes (für Tests + Audit):
//   - NO_TEAMS           keine Teams erfasst
//   - TOO_FEW_TEAMS      weniger als 2 Teams
//   - QUALIFIERS_GE_TEAMS  alle Teams qualifizieren sich (= Bug B)
//   - SINGLE_GROUP_NO_KO   nur 1 Gruppe, kein KO-Modus gewählt
//   - KO_WITH_ONE_TEAM   KO-Modus mit nur 1 Team
// ----------------------------------------------------------------
export function validateConstitution(state) {
  const messages = [];
  const teamCount = Array.isArray(state.teams) ? state.teams.length : 0;
  const mode = state.mode ?? 'groups_ko';
  const numGroups = Math.max(1, Number(state.numGroups) || 1);
  const advancePerGroup = Math.max(1, Number(state.advancePerGroup) || 1);
  const bestThirds = Math.max(0, Number(state.bestThirdsCount) || 0);

  // 1) Keine Teams.
  if (teamCount === 0) {
    return {
      level: 'block',
      messages: [{
        severity: 'error',
        code: 'NO_TEAMS',
        text: 'Es sind noch keine Teams erfasst.',
      }],
    };
  }

  // 2) Mindestens 2 Teams (generell).
  if (teamCount < 2) {
    return {
      level: 'block',
      messages: [{
        severity: 'error',
        code: 'TOO_FEW_TEAMS',
        text: 'Ein Turnier braucht mindestens 2 Teams.',
      }],
    };
  }

  // 3) KO-Modi: prüfen, dass die KO-Runde tatsächlich jemanden
  //    eliminiert. Wenn alle Teams weiterkommen, ist die KO-Phase
  //    sinnlos (Bug B: 4 Teams / 2 Gruppen / Top 2 = alle 4 weiter).
  const hasKoPhase =
    mode === 'groups_ko' ||
    mode === 'ko_only' ||
    mode === 'double_elim';
  if (hasKoPhase) {
    if (mode === 'ko_only') {
      if (teamCount < 2) {
        return {
          level: 'block',
          messages: [{
            severity: 'error',
            code: 'KO_WITH_ONE_TEAM',
            text: 'KO-Modus braucht mindestens 2 Teams.',
          }],
        };
      }
      // ko_only: alle Teams sind direkt im Bracket, daher OK sofern >= 2.
    } else {
      // groups_ko oder double_elim: Qualifikanten = Gruppen * advance + beste Dritte.
      const qualifiers = numGroups * advancePerGroup + bestThirds;
      if (qualifiers >= teamCount) {
        return {
          level: 'block',
          messages: [{
            severity: 'error',
            code: 'QUALIFIERS_GE_TEAMS',
            text:
              `${numGroups} Gruppen × ${advancePerGroup} Aufsteiger + ` +
              `${bestThirds} beste Dritte = ${qualifiers} Qualifikanten. ` +
              `Bei ${teamCount} Teams kommt jeder weiter — die KO-Phase ` +
              `wäre sinnlos. Reduziere die Anzahl der Gruppen oder die ` +
              `Aufsteiger pro Gruppe.`,
            fix: {
              reduceAdvancePerGroup: Math.max(
                1,
                Math.floor(teamCount / numGroups) - 1,
              ),
            },
          }],
        };
      }
    }
  }

  // 4) groups_only mit 1 Gruppe = Ligamodus (§9.7). Andere Modi mit
  //    1 Gruppe sind ebenfalls OK (kleines Turnier).
  if (mode === 'groups_only' && numGroups === 1 && teamCount >= 2) {
    messages.push({
      severity: 'info',
      code: 'SINGLE_GROUP_NO_KO',
      text:
        '1 Gruppe ohne KO — das ist der Ligamodus. Alle Teams spielen ' +
        'jede Runde gegeneinander.',
    });
  }

  // 5) Mehr Gruppen als Teams/2 — der Stepper dürfte das eigentlich
  //    gar nicht zulassen, aber wenn der State extern manipuliert
  //    wurde, fangen wir's hier ab.
  if (numGroups > Math.floor(teamCount / 2)) {
    messages.push({
      severity: 'error',
      code: 'TOO_MANY_GROUPS',
      text:
        `Mit ${teamCount} Teams sind maximal ` +
        `${Math.floor(teamCount / 2)} Gruppen möglich (min. 2 Teams/Gruppe).`,
    });
  }

  const hasError = messages.some((m) => m.severity === 'error');
  return {
    level: messages.length === 0 ? 'ok' : (hasError ? 'block' : 'warn'),
    messages,
  };
}

// ----------------------------------------------------------------
// Phasen-Klassifikation v3 (Issue 6, 2026-08-13).
//
// v3-Status (DB-seitig, Prisma schema.prisma Tournament.status):
//   draft         Entwurf — Konfig angelegt, noch keine Spiele.
//   generated     Bereit — Engine gelaufen, Spiele + Brackets in der DB,
//                 erste Runde noch nicht "startknopf" gedrückt.
//   group_stage   Läuft — Phase Gruppenphase aktiv (mind. 1 Spiel
//                 abgehakt, KO noch nicht gestartet).
//   ko_stage      Läuft — KO-Phase aktiv.
//   finished      Beendet — letztes Match beendet.
//
// v2-Aliase (zur Rückwärts-Kompatibilität alter Mock-DB-Datensätze):
//   registration → ready (war: "Registrierung" vor v3)
//   scheduled    → ready
//   in_progress  → live
//   completed    → finished
//
// Spec §13.5: Unbekannte Status-Werte werden unter "other" ("Sonstige")
// gefangen — nicht falsch einsortiert, nicht verschluckt.
//
// "cancelled" wird mit "finished" zusammengefasst (Endzustand).
// ----------------------------------------------------------------
export const TOURNAMENT_PHASE_ORDER = ['draft', 'ready', 'live', 'finished', 'other'];

const TOURNAMENT_STATUS_TO_PHASE = {
  draft:        'draft',
  generated:    'ready',
  group_stage:  'live',
  ko_stage:     'live',
  finished:     'finished',
  cancelled:    'finished',
  // v2-Aliase:
  registration: 'ready',
  scheduled:    'ready',
  in_progress:  'live',
  completed:    'finished',
};

const TOURNAMENT_PHASE_LABELS = {
  draft:     'Entwurf',
  ready:     'Bereit',
  live:      'Läuft',
  finished:  'Beendet',
  cancelled: 'Abgebrochen',
  other:     'Sonstige',
};

/**
 * Mappt einen DB-Status-String auf den v3-Phasen-Key.
 * Unbekannt / leer / null → 'other' (NICHT 'draft' — Issue 6:
 * stillschweigendes falsches Einsortieren war der Bug.)
 */
export function tournamentStatusPhase(status) {
  if (status && typeof status === 'string' && TOURNAMENT_STATUS_TO_PHASE[status]) {
    return TOURNAMENT_STATUS_TO_PHASE[status];
  }
  return 'other';
}

/**
 * Liefert das deutsche Label für einen Phasen-Key.
 * Unbekannter Key → "Sonstige" (Fallback).
 */
export function tournamentPhaseLabel(phase) {
  return TOURNAMENT_PHASE_LABELS[phase] ?? 'Sonstige';
}

/**
 * Liefert das deutsche Label für einen Turnier-Modus.
 * Spec §1.2: User sieht Modus als Klartext, nicht als DB-Token.
 * Unbekannter Modus → "Sonstiges" (Fallback, kein Rohwert).
 */
const TOURNAMENT_MODE_LABELS = {
  groups_ko: 'Gruppen + K.-o.',
  groups_only: 'Nur Gruppenphase',
  ko_only: 'Nur K.-o.',
  double_elim: 'Double Elimination',
};
export function tournamentModeLabel(mode) {
  return TOURNAMENT_MODE_LABELS[mode] ?? 'Sonstiges';
}

/**
 * Legacy-Helper: ein-Argument-Form für alten main.js-Code,
 * der direkt tournamentStatusLabel(status) statt
 * tournamentPhaseLabel(tournamentStatusPhase(status)) aufrief.
 * Bleibt für Aufrufer-Kompat erhalten — gibt aber nicht 'Sonstige'
 * für unbekannte Status zurück (sondern den Status selbst),
 * damit Stale-DB-Calls keine neue Bucket-Klasse erfinden.
 */
export function tournamentStatusLabel(status) {
  if (status && TOURNAMENT_PHASE_LABELS[TOURNAMENT_STATUS_TO_PHASE[status]]) {
    return TOURNAMENT_PHASE_LABELS[TOURNAMENT_STATUS_TO_PHASE[status]];
  }
  return status || '-';
}

/**
 * Eintrittspunkt für Screen B. Liefert ein .t-mod-Wurzelelement,
 * das der Aufrufer in den DOM einsetzt.
 *
 * @param {object} opts
 *   - initialState: optionale Vorbelegung (für "Duplizieren")
 *   - groupId: wenn gesetzt, legt der Wizard beim Übergang Schritt 1→2
 *     einen Entwurf in der DB an (POST /api/tournaments) und räumt
 *     ihn bei Abbrechen wieder ab (DELETE). Im Mock-Modus ohne
 *     groupId überspringt der Wizard diesen Lebenszyklus, weil
 *     es keine DB gibt.
 *   - onCancel: () => void
 *   - onGenerate: async (state, { confirmTournamentName?: string }) => Promise<GenerateResult>
 *         GenerateResult = { ok: true, body, warnings?: string[] }
 *                       | { ok: false, status: 400|409, body: { error, finishedMatches?, needsConfirmation? } }
 *         Wird vom Aufrufer i. d. R. ein fetch() gegen POST /api/tournaments/:id/generate sein.
 *         Der Wizard wertet 409 + error==='results_present' aus und öffnet einen
 *         Bestätigungsdialog, in dem der User den Turniernamen eintippt.
 *         Wird opts.onGenerate nicht gesetzt, fällt der Wizard auf opts.onComplete(state)
 *         zurück (alte API, kein Dialog).
 *   - onComplete: (state) => void  (Legacy — nur Klick-Forward, kein Dialog)
 *   - onStateChange: (state) => void  (für Auto-Save als Entwurf)
 *
 * Der Wizard ist stateless aufruferseitig: er hält seinen Zustand
 * in einem Closure. Der Aufrufer bekommt ihn nur über onStateChange.
 */
export function renderWizardView(opts = {}) {
  // Schritt defensiv korrigieren — der Wrapper darf step nicht
  // falsch setzen. Akzeptiert werden genau 1..5; alles andere
  // (0, 7, undefined, NaN, "1") fällt auf DEFAULT_WIZARD_STATE.step
  // zurück. Hintergrund: ensureDraftPromise() in Step 1 prüft
  // `state.step === 1` und legt sonst keinen Entwurf an — ein
  // falscher Startwert hätte "no_tournament_id" in Schritt 5 zur
  // Folge. Wir verlassen uns also nicht auf den Aufrufer.
  const safeStep = coerceWizardStep(opts.initialState?.step);

  const state = {
    ...DEFAULT_WIZARD_STATE,
    ...(opts.initialState || {}),
    step: safeStep,
  };

  // groupId muss ALS TOP-LEVEL-OPTION übergeben werden
  // (`opts.groupId`), nicht nur im initialState. Hintergrund:
  // ensureDraftPromise() und der Step-1-„Weiter"-Handler lesen
  // opts.groupId, um den Live-Modus vom Mock-Modus zu trennen.
  //
  // Konkreter Bug, der genau hier passiert ist: ein Wrapper hat
  // groupId in initialState.groupId gepackt, aber opts.groupId leer
  // gelassen. Folge: ensureDraftPromise() ging in den Mock-Modus
  // und legte stillschweigend keinen POST ab → state.tournamentId
  // blieb null → "draft_missing" in Schritt 5.
  //
  // Wir prüfen das hier explizit und geben einen lauten
  // console.warn aus, falls ein Aufrufer in die gleiche Falle tappt.
  // Im Mock-Modus (kein initialState.groupId UND kein opts.groupId)
  // schweigen wir — das ist die beabsichtigte Verwendung für die
  // Preview-Datei.
  if (!opts.groupId && state.groupId) {
    console.warn(
      '[wizard] opts.groupId fehlt, aber initialState.groupId ist gesetzt. ' +
      'Die Turnier-Erstellung geht in den Mock-Modus und legt keinen Entwurf an. ' +
      '→ renderWizardView({ groupId, initialState, ... }) — groupId MUSS ' +
      'als Top-Level-Option übergeben werden, nicht nur in initialState.'
    );
  }

  const root = document.createElement('div');
  root.className = 't-mod t-wizard';
  root.setAttribute('data-screen', 'wizard');
  root.dataset.step = String(state.step);

  // ── Entwurfs-Lebenszyklus (Spec §1.2) ────────────────────────────
  // Wrap onCancel so that an in-flight Entwurf automatisch entfernt
  // wird, BEVOR der Aufrufer seine UI zumacht. Im Mock-Modus (kein
  // opts.groupId) bleibt opts.onCancel unverändert.
  const effectiveOpts = {
    ...opts,
    onCancel: async () => {
      await deleteDraft(state.tournamentId);
      if (typeof opts.onCancel === 'function') {
        try { opts.onCancel(); } catch (e) {
          console.warn('[wizard] caller onCancel threw:', e);
        }
      }
    },
  };
  // Auch an root exposen, damit Tests den Wizard-Dispose-Pfad direkt
  // auslösen können, ohne den Cancel-Button suchen zu müssen.
  root._dispose = effectiveOpts.onCancel;

  // ── Header (Fortschrittsanzeige) ─────────────────────────────────
  root.appendChild(renderWizardProgress(state, effectiveOpts, root));

  // ── Body: Formular + Live-Vorschau ───────────────────────────────
  const body = document.createElement('div');
  body.className = 't-wizard-body';

  const form = document.createElement('div');
  form.className = 't-wizard-form';

  const stepEl = renderWizardStep(state, effectiveOpts);
  form.appendChild(stepEl);

  const footerEl = renderWizardFooter(state, effectiveOpts);
  form.appendChild(footerEl);

  body.appendChild(form);

  const previewWrap = document.createElement('aside');
  previewWrap.className = 't-wizard-preview-wrap';
  previewWrap.appendChild(renderWizardPreview(state));
  body.appendChild(previewWrap);

  root.appendChild(body);

  // ── Reaktiver Footer (Bug A, §13.3) ─────────────────────────────
  // Ein einziger Listener auf der Wizard-Root reicht validateStep()
  // bei jeder Eingabe neu durch und schreibt nur disabled + Hint-Text
  // — KEIN Full-Re-Render, sonst springt der Fokus aus dem gerade
  // aktiven Eingabefeld.
  //
  // ACHTUNG: bubble-Phase (nicht capturing) — sonst läuft der
  // reaktive Hook VOR dem Sub-Listener, der state.* erst aktualisiert.
  // In der Bubble-Phase ist state schon frisch, wenn wir validieren.
  const reactToInput = () => {
    const v = validateStep(state, state.step);
    const nextBtn = root.querySelector('[data-t-wizard-next="true"]');
    const hintEl = root.querySelector('[data-t-wizard-next-hint="true"]');
    if (nextBtn) nextBtn.disabled = !v.ok;
    if (hintEl) applyHint(hintEl, v);
  };
  root.addEventListener('input', reactToInput);
  root.addEventListener('change', reactToInput);

  // Hooks für Tests / parent screens (bleiben wie gehabt).
  root._state = state;
  // WICHTIG: root._opts MUSS das rohe opts sein, NICHT effectiveOpts.
  // Sonst wird effectiveOpts.onCancel (das den DELETE macht) beim
  // nächsten renderWizardView erneut gewrappt — und nach einem
  // Step-Wechsel würde Cancel zwei DELETEs feuern (deleteDraft wird
  // sowohl vom neuen effectiveOpts als auch vom alten inneren Wrapper
  // aufgerufen). Siehe renderWizardFooter: dort wird { ...root._opts,
  // initialState: state } an renderWizardView weitergegeben.
  root._opts = opts;
  root._rerender = () => {
    const fresh = renderWizardView({ ...opts, initialState: state });
    root.parentNode?.replaceChild(fresh, root);
  };

  return root;
}

// ----------------------------------------------------------------
// Fortschrittsanzeige — klickbare abgeschlossene Schritte
// ----------------------------------------------------------------
function renderWizardProgress(state, opts, root) {
  const wrap = document.createElement('div');
  wrap.className = 't-wizard-progress';
  wrap.setAttribute('role', 'navigation');
  wrap.setAttribute('aria-label', 'Turnier erstellen — Schritte');

  const title = document.createElement('div');
  title.className = 't-wizard-progress-title';
  title.textContent = 'Turnier erstellen';
  wrap.appendChild(title);

  const list = document.createElement('ol');
  list.className = 't-wizard-progress-list';
  for (let i = 0; i < STEP_TITLES.length; i++) {
    const stepNum = i + 1;
    const li = document.createElement('li');
    const isCurrent = stepNum === state.step;
    const isDone = stepNum < state.step;
    const isReachable = stepNum <= state.step;
    li.className = 't-wizard-progress-step';
    if (isCurrent) li.classList.add('is-current');
    if (isDone) li.classList.add('is-done');
    if (isReachable) li.classList.add('is-reachable');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.step = String(stepNum);
    btn.disabled = !isReachable;
    btn.innerHTML = '';

    const dot = document.createElement('span');
    dot.className = 't-wizard-progress-dot';
    dot.textContent = isDone ? '✓' : String(stepNum);
    btn.appendChild(dot);

    const label = document.createElement('span');
    label.className = 't-wizard-progress-label';
    label.textContent = STEP_TITLES[i];
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      if (stepNum <= state.step) {
        state.step = stepNum;
        notifyChange(state, opts);
        root?._rerender?.();
      }
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 't-wizard-progress-cancel';
  cancel.textContent = 'Abbrechen';
  cancel.addEventListener('click', () => {
    if (typeof opts.onCancel === 'function') opts.onCancel();
  });
  wrap.appendChild(cancel);

  // Hooks (root._state, root._opts, root._rerender) werden in
  // renderWizardView gesetzt — siehe Bug-A-Reaktivitäts-Block dort.
  // Hinweis: renderWizardProgress läuft vor renderWizardView, also
  // wird der neuere Hook-Stand am Ende der View-Initialisierung
  // angewandt.

  return wrap;
}

// ----------------------------------------------------------------
// Step-Renderer (1–5)
// ----------------------------------------------------------------
function renderWizardStep(state, opts) {
  const wrap = document.createElement('div');
  wrap.className = 't-wizard-step';
  wrap.dataset.step = String(state.step);

  const heading = document.createElement('h2');
  heading.className = 't-wizard-step-title';
  heading.textContent = `Schritt ${state.step} von 5 — ${STEP_TITLES[state.step - 1]}`;
  wrap.appendChild(heading);

  switch (state.step) {
    case 1: renderStep1Grunddaten(wrap, state, opts); break;
    case 2: renderStep2Teams(wrap, state, opts); break;
    case 3: renderStep3Modus(wrap, state, opts); break;
    case 4: renderStep4Qualifikation(wrap, state, opts); break;
    case 5: renderStep5Zusammenfassung(wrap, state, opts); break;
    default: break;
  }

  return wrap;
}

function renderStep1Grunddaten(wrap, state, opts) {
  const form = document.createElement('form');
  form.className = 't-wizard-fields';
  form.addEventListener('submit', (e) => e.preventDefault());

  form.appendChild(buildField({
    label: 'Turniername',
    required: true,
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'text';
      i.id = id;
      i.className = 't-input';
      i.placeholder = 'z. B. „Sommer-Cup 2026"';
      i.value = state.name;
      i.addEventListener('input', () => {
        state.name = i.value;
        notifyChange(state, opts);
      });
      // Auto-Draft bei blur: sobald der User einen gültigen Namen
      // eingibt und das Feld verlässt, legen wir den Entwurf in der
      // DB an. Damit wird das Logo-Feld sofort aktiv (statt erst nach
      // Schritt 1 → 2 → 1). Genau ein POST pro Wizard-leben —
      // ensureDraftPromise() ist single-flight und idempotent.
      //
      // Mock-Modus (kein opts.groupId): das Logo-Feld ist bereits von
      // Anfang an aktiv (Picker läuft über FileReader/dataURL) — kein
      // zusätzlicher Blur-Handler nötig.
      i.addEventListener('blur', () => {
        if (state.step !== 1) return;       // Nur in Step 1 sinnvoll
        if (state.tournamentId) return;     // Schon angelegt
        if (!state.name.trim()) return;     // Leerer Name → kein POST
        if (!opts.groupId) return;          // Mock: Feld ist schon aktiv
        ensureDraftPromise(state, opts)
          .then(() => {
            // Logo-Picker aktivieren, ohne Re-Render. Wir holen das
            // Element frisch per Selector, weil der Picker in einer
            // eigenen Sub-Component sitzt.
            const pickBtn = document.querySelector(
              '.t-wizard-logo-picker button'
            );
            const statusEl = document.querySelector('.t-wizard-logo-status');
            if (pickBtn) pickBtn.disabled = false;
            if (statusEl && statusEl.textContent.includes('Hinweis:')) {
              statusEl.textContent = '';
              statusEl.className = 't-wizard-logo-status';
            }
          })
          .catch((err) => {
            // Fehler schlucken — die "Weiter"-Routen-Fehlermeldung
            // wird beim nächsten Klick sichtbar. Hier nur leise
            // loggen, damit der User nicht durch Inline-Rotmeldung
            // aus dem Tipp-Flow gerissen wird.
            console.warn('[wizard] auto-draft failed:', err.message);
          });
      });
      return i;
    },
  }));

  const row = document.createElement('div');
  row.className = 't-wizard-row two';
  row.appendChild(buildField({
    label: 'Datum',
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'date';
      i.id = id;
      i.className = 't-input';
      i.value = state.date;
      i.addEventListener('input', () => {
        state.date = i.value;
        notifyChange(state, opts);
      });
      return i;
    },
  }));
  row.appendChild(buildField({
    label: 'Ort (optional)',
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'text';
      i.id = id;
      i.className = 't-input';
      i.placeholder = 'z. B. „Sporthalle Süd"';
      i.value = state.location;
      i.addEventListener('input', () => {
        state.location = i.value;
        notifyChange(state, opts);
      });
      return i;
    },
  }));
  form.appendChild(row);

  // Sportart
  const sportField = document.createElement('div');
  sportField.className = 't-wizard-field';
  const sportLabel = document.createElement('div');
  sportLabel.className = 't-wizard-field-label';
  sportLabel.textContent = 'Sportart (beeinflusst Bezeichnungen)';
  sportField.appendChild(sportLabel);
  const sportGrid = document.createElement('div');
  sportGrid.className = 't-wizard-choice-grid';
  for (const opt of SPORT_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 't-wizard-choice';
    if (state.sport === opt.id) btn.classList.add('is-active');
    btn.innerHTML = `
      <span class="t-wizard-choice-label">${opt.label}</span>
      <span class="t-wizard-choice-sub">Zähler: „${opt.score}"</span>
    `;
    btn.addEventListener('click', () => {
      state.sport = opt.id;
      notifyChange(state, opts);
      refreshShell();
    });
    sportGrid.appendChild(btn);
  }
  sportField.appendChild(sportGrid);
  form.appendChild(sportField);

  // Logo-Upload (Spec §3 Schritt 1, §8.4). Nur sichtbar, wenn der
  // User überhaupt Upload-Rechte bekommt (Live-Modus mit groupId =
  // Admin). Im Mock-Modus (kein groupId) blenden wir das Feld aus,
  // weil MinIO nicht verfügbar ist und ein nicht-funktionierendes
  // Feld nur verwirrt.
  if (opts.groupId) {
    form.appendChild(buildLogoField(state, opts));
  }

  wrap.appendChild(form);

  function refreshShell() {
    const root = getRoot();
    if (!root) return;
    const fresh = renderWizardView({ ...root._opts, initialState: state });
    root.parentNode?.replaceChild(fresh, root);
  }
}

// ----------------------------------------------------------------
// Logo-Feld (Step 1).
//
// Aufbau: Label + Statustext, dann
//   - Wenn logoUrl existiert: Preview-Bild + "Entfernen"-Button
//   - Sonst: verstecktes <input type="file">, daneben sichtbarer
//     "Logo auswählen"-Button, der den File-Picker öffnet
//
// Verhalten beim Datei-Auswählen:
//   1. File-Picker schließt → change-Event auf <input>
//   2. file-Input zeigt "Wird hochgeladen…", wird disabled
//   3. POST /api/tournaments/:id/logo (oder dataURL-Lesen im Mock)
//   4. Erfolg: state.logoUrl = body.logoUrl, status-Text "Hochgeladen."
//      Preview sichtbar machen, File-Input verstecken
//   5. Fehler: status-Text "Fehler: <message>" rot, File-Input wieder aktiv
//
// KEIN refreshShell() während des Uploads — würde den halben Wizard
// neu rendern und andere Eingaben zerstören. Lediglich die
// logoField-Teile (previewBox, statusEl, fileInput) werden direkt
// mutiert.
// ----------------------------------------------------------------
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader-Fehler'));
    reader.readAsDataURL(file);
  });
}

function buildLogoField(state, opts) {
  const wrap = document.createElement('div');
  wrap.className = 't-wizard-field t-wizard-logo-field';
  wrap.dataset.tWizardLogoField = 'true';

  const label = document.createElement('span');
  label.className = 't-wizard-field-label';
  label.textContent = 'Logo (optional, erscheint im Header und im PDF)';
  wrap.appendChild(label);

  // Statuszeile — was passiert gerade (Hochladen, Erfolg, Fehler).
  const status = document.createElement('div');
  status.className = 't-wizard-logo-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  wrap.appendChild(status);

  // Vorschau-Box — Bild + Entfernen-Button.
  const previewBox = document.createElement('div');
  previewBox.className = 't-wizard-logo-preview';
  previewBox.hidden = true;
  wrap.appendChild(previewBox);

  // File-Picker-Zeile — sichtbarer Button + verstecktes <input type="file">.
  const picker = document.createElement('div');
  picker.className = 't-wizard-logo-picker';
  wrap.appendChild(picker);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp';
  fileInput.className = 't-wizard-logo-file-input';
  fileInput.dataset.tWizardLogoFileInput = 'true';
  fileInput.hidden = true;

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 't-btn t-btn--sm';
  pickBtn.textContent = 'Logo auswählen';
  pickBtn.addEventListener('click', () => fileInput.click());

  // Mock-Modus: keine DB, aber Logo-Picker darf trotzdem funktionieren.
  // Wir lesen die Datei per FileReader und zeigen eine dataURL-Vorschau.
  const isMockMode = !opts.groupId;

  // Draft-Gate: solange der Entwurf noch nicht in der DB existiert
  // (User hat noch nicht "Weiter" geklickt UND im Live-Modus), kann
  // kein Upload stattfinden. Wir zeigen einen freundlichen Hinweis
  // statt einer Fehlermeldung, und blenden den Picker aus.
  // Im Mock-Modus ist der Picker IMMER aktiv — der User soll das
  // Design auch ohne Backend beurteilen können.
  if (!state.tournamentId && !isMockMode) {
    pickBtn.disabled = true;
    status.textContent = 'Hinweis: Der Entwurf wird beim Klick auf „Weiter" angelegt. Danach kannst du hier ein Logo hochladen.';
  } else {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      // UI sofort umstellen — der User soll sehen, dass was passiert.
      pickBtn.disabled = true;
      fileInput.disabled = true;
      status.textContent = `Wird hochgeladen: ${file.name} …`;
      status.className = 't-wizard-logo-status is-pending';

      let result;
      if (isMockMode) {
        // Mock: dataURL lokal erzeugen, kein Backend-Roundtrip.
        const dataUrl = await readFileAsDataURL(file);
        result = { ok: true, logoUrl: dataUrl };
      } else {
        result = await uploadTournamentLogo(state.tournamentId, file);
      }
      if (result.ok) {
        state.logoUrl = result.logoUrl;
        status.textContent = isMockMode
          ? 'Logo (Mock-Vorschau). Wird im Live-Modus zu MinIO hochgeladen.'
          : 'Logo hochgeladen.';
        status.className = 't-wizard-logo-status is-ok';
        renderPreview(previewBox, state.logoUrl, () => removeLogo());
        previewBox.hidden = false;
        // Picker ausblenden — User kann stattdessen "Entfernen" drücken.
        picker.hidden = true;
        notifyChange(state, opts);
      } else {
        status.textContent = `Fehler: ${result.error}`;
        status.className = 't-wizard-logo-status is-error';
        pickBtn.disabled = false;
        fileInput.disabled = false;
        // File-Input zurücksetzen, sonst kann der User nicht dieselbe
        // Datei erneut auswählen.
        fileInput.value = '';
      }
    });
  }

  picker.appendChild(pickBtn);
  picker.appendChild(fileInput);

  function renderPreview(box, url, onRemove) {
    box.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Turnier-Logo';
    img.className = 't-wizard-logo-img';
    img.dataset.tWizardLogoImg = 'true';
    box.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 't-btn t-btn--sm t-btn--danger';
    removeBtn.textContent = 'Entfernen';
    removeBtn.dataset.tWizardLogoRemove = 'true';
    removeBtn.addEventListener('click', onRemove);
    box.appendChild(removeBtn);
  }

  async function removeLogo() {
    if (!state.tournamentId && !isMockMode) return;
    status.textContent = 'Wird entfernt …';
    status.className = 't-wizard-logo-status is-pending';
    let result = { ok: true };
    if (!isMockMode) {
      result = await deleteTournamentLogo(state.tournamentId);
    }
    if (result.ok) {
      state.logoUrl = null;
      status.textContent = '';
      status.className = 't-wizard-logo-status';
      previewBox.hidden = true;
      previewBox.innerHTML = '';
      picker.hidden = false;
      pickBtn.disabled = false;
      fileInput.disabled = false;
      fileInput.value = '';
      notifyChange(state, opts);
    } else {
      status.textContent = `Fehler beim Entfernen: ${result.error}`;
      status.className = 't-wizard-logo-status is-error';
    }
  }

  // Initial-Zustand: Wenn logoUrl schon gesetzt ist (z. B. nach
  // Round-Trip zu Step 2), direkt Preview rendern.
  if (state.logoUrl) {
    renderPreview(previewBox, state.logoUrl, () => removeLogo());
    previewBox.hidden = false;
    picker.hidden = true;
  }

  return wrap;
}

// ----------------------------------------------------------------
// Step 2 — Teams
// ----------------------------------------------------------------
function renderStep2Teams(wrap, state, opts) {
  const hint = document.createElement('p');
  hint.className = 't-wizard-step-hint';
  hint.textContent = 'Lege die Teams an. Du kannst die Namen später jederzeit anpassen — auch noch nach dem Generieren.';
  wrap.appendChild(hint);

  // ─────────────────────────────────────────────────────────
  // Zwei-Wege-Eingabe (Weg A: Anzahl / Weg B: Copy-Paste)
  // ─────────────────────────────────────────────────────────
  const paths = document.createElement('div');
  paths.className = 't-wizard-teams-paths';

  // Weg A: Anzahl festlegen.
  const pathA = document.createElement('div');
  pathA.className = 't-wizard-teams-path';
  const pathAHead = document.createElement('div');
  pathAHead.className = 't-wizard-teams-path-head';
  pathAHead.textContent = 'A) Anzahl festlegen';
  pathA.appendChild(pathAHead);

  const stepper = document.createElement('div');
  stepper.className = 't-wizard-stepper';
  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 't-btn t-btn--ghost t-btn--sm';
  minusBtn.textContent = '−';
  minusBtn.setAttribute('aria-label', 'Ein Team weniger');
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = '0';
  numberInput.max = '128';
  numberInput.value = String(state.teams.length || 0);
  numberInput.className = 't-input t-wizard-stepper-input';
  numberInput.setAttribute('aria-label', 'Anzahl Teams');
  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 't-btn t-btn--ghost t-btn--sm';
  plusBtn.textContent = '+';
  plusBtn.setAttribute('aria-label', 'Ein Team mehr');
  stepper.appendChild(minusBtn);
  stepper.appendChild(numberInput);
  stepper.appendChild(plusBtn);
  pathA.appendChild(stepper);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 't-btn t-btn--primary';
  applyBtn.textContent = 'Anzahl übernehmen';
  applyBtn.addEventListener('click', () => {
    applyCount(parseInt(numberInput.value, 10) || 0);
  });
  pathA.appendChild(applyBtn);

  const pathAHint = document.createElement('p');
  pathAHint.className = 't-wizard-teams-path-hint';
  pathAHint.textContent = 'Erzeugt Platzhalter („Team 1", „Team 2" …), die du unten direkt umbenennen kannst.';
  pathA.appendChild(pathAHint);

  minusBtn.addEventListener('click', () => {
    numberInput.value = String(Math.max(0, (parseInt(numberInput.value, 10) || 0) - 1));
  });
  plusBtn.addEventListener('click', () => {
    numberInput.value = String(Math.min(128, (parseInt(numberInput.value, 10) || 0) + 1));
  });

  // Weg B: Namen einfügen.
  const pathB = document.createElement('div');
  pathB.className = 't-wizard-teams-path';
  const pathBHead = document.createElement('div');
  pathBHead.className = 't-wizard-teams-path-head';
  pathBHead.textContent = 'B) Namen einfügen';
  pathB.appendChild(pathBHead);

  const textarea = document.createElement('textarea');
  textarea.className = 't-input t-wizard-teams-textarea';
  textarea.rows = 6;
  textarea.placeholder = 'Rakija Boys\nBierversorium\nKubb Küken\nLos Chungos\n…';
  textarea.value = state.teamInput;
  textarea.addEventListener('input', () => {
    state.teamInput = textarea.value;
  });
  pathB.appendChild(textarea);

  const pathBCTA = document.createElement('div');
  pathBCTA.className = 't-wizard-teams-cta';
  const adoptBtn = document.createElement('button');
  adoptBtn.type = 'button';
  adoptBtn.className = 't-btn t-btn--primary';
  adoptBtn.textContent = 'Namen übernehmen';
  adoptBtn.addEventListener('click', () => {
    const parsed = parseTeamInput(state.teamInput);
    replaceNames(parsed.entries).catch((err) => {
      console.warn('[wizard] replaceNames failed:', err);
    });
  });
  pathBCTA.appendChild(adoptBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 't-btn t-btn--ghost';
  clearBtn.textContent = 'Liste leeren';
  clearBtn.addEventListener('click', () => {
    state.teams = [];
    state.teamInput = '';
    notifyChange(state, opts);
    refreshShell();
  });
  pathBCTA.appendChild(clearBtn);
  pathB.appendChild(pathBCTA);

  const pathBHint = document.createElement('p');
  pathBHint.className = 't-wizard-teams-path-hint';
  pathBHint.textContent = 'Eine Zeile pro Team — aus WhatsApp, Excel oder einer Mailingliste direkt einfügen.';
  pathB.appendChild(pathBHint);

  paths.appendChild(pathA);
  paths.appendChild(pathB);
  wrap.appendChild(paths);

  // ─────────────────────────────────────────────────────────
  // Teamliste — der eigentliche Arbeitsbereich.
  // Counter, Drag-Reihenfolge, Inline-Rename, ←→↑↓, Löschen, +1.
  // ─────────────────────────────────────────────────────────

  const counter = document.createElement('div');
  counter.className = 't-wizard-teams-counter';
  counter.dataset.tWizardTeamsCounter = 'true';
  updateCounter(state, counter);
  wrap.appendChild(counter);

  const list = document.createElement('ol');
  list.className = 't-wizard-team-list';
  list.dataset.tWizardTeamList = 'true';
  wrap.appendChild(list);

  renderTeamRows(list, state, opts);

  // "+ Team hinzufügen" am Ende.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 't-btn t-btn--ghost';
  addBtn.textContent = '+ Team hinzufügen';
  addBtn.addEventListener('click', () => {
    const next = nextPlaceholderName(state.teams);
    const color = nextPaletteColor(state.teams);
    state.teams.push({ name: next, color, seed: state.teams.length + 1 });
    notifyChange(state, opts);
    // Zahlenfeld oben spiegelt IMMER die Listen-Länge — nicht eine
    // alte Eingabe des Users. Sonst hat man zwei sich widersprechende
    // Anzeigen auf einem Bildschirm.
    numberInput.value = String(state.teams.length);
    // Komplett-Render, damit up/down-Buttons aller Rows korrekt
    // disabled-Status bekommen (vorher-letzte Zeile bekommt jetzt ↓ aktiv).
    renderTeamRows(list, state, opts);
    updateCounter(state, counter);
  });
  wrap.appendChild(addBtn);

  // Duplicate-Warnung (immer rendern, Sichtbarkeit wird in renderTeamRows
  // durch den counter-Update mitgepflegt).
  const warn = document.createElement('div');
  warn.className = 't-wizard-warn';
  warn.hidden = true;
  warn.dataset.tWizardTeamsWarn = 'true';
  wrap.appendChild(warn);
  updateDuplicateWarn(state.teams, warn);

  // ─────────────────────────────────────────────────────────
  // Lokale Helper
  // ─────────────────────────────────────────────────────────

  async function applyCount(target) {
    const current = state.teams.length;
    if (target === current) return;
    if (target > current) {
      // Anhängen: "Team N+1", "Team N+2", …
      for (let i = current; i < target; i++) {
        state.teams.push({
          name: nextPlaceholderName(state.teams),
          color: nextPaletteColor(state.teams),
          seed: i + 1,
        });
      }
    } else {
      // Von hinten entfernen. Wenn betroffene Teams bereits
      // umbenannt wurden, kurze Rückfrage.
      const toRemove = state.teams.slice(target);
      const renamed = toRemove.filter((t) => !isPlaceholderName(t.name));
      if (renamed.length > 0) {
        const list = renamed.map((t) => `• ${t.name}`).join('\n');
        const dlg = await openConfirmDialog({
          title: 'Teams entfernen?',
          message:
            `Du entfernst ${renamed.length} umbenannte${renamed.length === 1 ? 's Team' : ' Teams'}:\n` +
            list +
            '\n\nWirklich entfernen?',
          confirmLabel: 'Entfernen',
        });
        if (dlg.cancelled) return;
      }
      state.teams.length = target;
    }
    notifyChange(state, opts);
    refreshShell();
  }

  async function replaceNames(newEntries) {
    // Weg B ersetzt die Liste. Wenn schon Teams da sind, vorher fragen —
    // kein stilles Anhängen, sonst hat der User plötzlich 24 Teams,
    // wenn er die korrigierte Liste ein zweites Mal einfügt.
    if (state.teams.length > 0) {
      const dlg = await openConfirmDialog({
        title: 'Teams ersetzen?',
        message:
          `Die bestehenden ${state.teams.length} Teams werden ersetzt. ` +
          'Fortfahren?',
        confirmLabel: 'Ersetzen',
      });
      if (dlg.cancelled) return;
    }
    // Neue Teams bekommen der Reihe nach Palette-Farben, die noch
    // nicht in `state.teams` vergeben sind. Damit der Reihe nach alle
    // 8 Farben durchgegangen werden, bauen wir die Liste der
    // "schon vergebenen Farben" iterativ auf.
    const assignedSoFar = [];
    state.teams = newEntries.map((e, i) => {
      const color = nextPaletteColor([
        ...state.teams,
        ...assignedSoFar,
      ]);
      assignedSoFar.push({ name: e.name, color });
      return { name: e.name, color, seed: i + 1 };
    });
    state.teamInput = newEntries.map((e) => e.name).join('\n');
    notifyChange(state, opts);
    refreshShell();
  }

  function refreshShell() {
    const root = getRoot();
    if (!root) return;
    const fresh = renderWizardView({ ...root._opts, initialState: state });
    root.parentNode?.replaceChild(fresh, root);
  }

  // Re-Expose der Liste, damit renderTeamRows sie füllen kann.
  wrap.__list = list;
  wrap.__counter = counter;
  wrap.__warn = warn;
}

// ----------------------------------------------------------------
// Team-Rendering
// ----------------------------------------------------------------

function updateCounter(state, counter) {
  const count = state.teams.length;
  counter.textContent = count === 1 ? '1 Team' : `${count} Teams`;
}

function updateDuplicateWarn(teams, warn) {
  const dupes = duplicateNames(teams);
  if (dupes.length === 0) {
    warn.hidden = true;
    warn.textContent = '';
  } else {
    warn.hidden = false;
    warn.textContent = `Doppelte Teamnamen: ${dupes.join(', ')}`;
  }
}

function renderTeamRows(list, state, opts) {
  list.innerHTML = '';
  for (let i = 0; i < state.teams.length; i++) {
    appendRow(list, i);
  }
  // Pointer-basiertes DnD einmal pro Render installieren.
  attachTeamDnD(list, state, opts);
}

// ----------------------------------------------------------------
// Team-DnD: Pointer-Events (Touch + Maus), HTML5-Drag fällt weg.
// Action-Buttons (↑↓ Löschen) und das Input bleiben Klick-/Tipp-Ziele.
// ----------------------------------------------------------------
function attachTeamDnD(list, state, opts) {
  // Doppelinstallation verhindern.
  if (list.dataset.tWizardDndBound === 'true') return;
  list.dataset.tWizardDndBound = 'true';

  const THRESHOLD = 5;
  let drag = null;

  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.t-wizard-team-row');
    if (!row || !list.contains(row)) return;
    // Action-Buttons und Input NICHT als Drag-Quelle.
    if (e.target.closest('.t-wizard-team-actions')) return;
    if (e.target.closest('input')) return;

    const idx = Array.prototype.indexOf.call(list.children, row);
    if (idx < 0) return;
    drag = {
      row,
      index: idx,
      startY: e.clientY,
      offsetY: e.clientY - row.getBoundingClientRect().top,
      active: false,
      pointerId: e.pointerId,
      placeholder: null,
    };
    row.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < THRESHOLD) return;
      drag.active = true;
      drag.row.classList.add('is-dragging');
      const ph = document.createElement('li');
      ph.className = 't-wizard-team-placeholder';
      ph.style.height = drag.row.offsetHeight + 'px';
      drag.placeholder = ph;
      drag.row.parentNode.insertBefore(ph, drag.row);
      drag.row.style.position = 'absolute';
      drag.row.style.left = '0';
      drag.row.style.right = '0';
      drag.row.style.width = '100%';
    }
    drag.row.style.top = (e.clientY - drag.offsetY) + 'px';

    const others = Array.from(list.querySelectorAll('.t-wizard-team-row:not(.is-dragging)'));
    const draggedMid = e.clientY;
    let targetIdx = others.length;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (draggedMid < mid) {
        targetIdx = i;
        break;
      }
    }
    const ref = others[targetIdx] || null;
    if (ref) list.insertBefore(drag.placeholder, ref);
    else list.appendChild(drag.placeholder);
  });

  const finish = (commit) => {
    if (!drag) return;
    if (drag.active && commit && drag.placeholder) {
      const phIdx = Array.prototype.indexOf.call(list.children, drag.placeholder);
      drag.placeholder.remove();
      const [moved] = state.teams.splice(drag.index, 1);
      const adjusted = phIdx > drag.index ? phIdx - 1 : phIdx;
      state.teams.splice(adjusted, 0, moved);
      notifyChange(state, opts);
      refreshAfterMutation();
    }
    if (drag.active) {
      drag.row.classList.remove('is-dragging');
      drag.row.style.position = '';
      drag.row.style.left = '';
      drag.row.style.right = '';
      drag.row.style.width = '';
      drag.row.style.top = '';
      if (drag.placeholder && drag.placeholder.parentNode) {
        drag.placeholder.remove();
      }
    }
    drag = null;
  };

  list.addEventListener('pointerup',     (e) => { if (drag && e.pointerId === drag.pointerId) finish(true);  });
  list.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) finish(false); });
}

function appendRow(list, index) {
  // index is the position in the parent DOM. We read state from the
  // parent scope via the dataset-name attribute pattern.
  const wrap = list.closest('.t-mod');
  const state = wrap?._state;
  const opts = wrap?._opts;
  if (!state || !opts) return;
  const t = state.teams[index];
  if (!t) return;

  const li = document.createElement('li');
  li.className = 't-wizard-team-row';
  li.dataset.seed = String(index + 1);
  li.dataset.index = String(index);
  // touch-action: none wird via CSS gesetzt, damit Touch-Gesten nicht
  // von Pointer-Events abgefangen werden.

  const dot = document.createElement('span');
  dot.className = 't-wizard-team-dot';
  dot.style.background = t.color || paletteColor(index);
  li.appendChild(dot);

  // Inline-Editing: ein normales <input type="text"> mit unauffälligem
  // Rahmen. Tippen aktualisiert den State live — KEIN Re-Render, sonst
  // springt der Fokus weg.
  const name = document.createElement('input');
  name.type = 'text';
  name.className = 't-input t-wizard-team-name-input';
  name.value = t.name;
  name.setAttribute('spellcheck', 'false');
  name.setAttribute('aria-label', 'Teamname');
  name.title = 'Tippen zum Umbenennen';

  // Sync-Back: bei jeder Eingabe State aktualisieren, Counter und
  // Duplikat-Warnung lokal nachziehen — KEIN renderWizardView().
  name.addEventListener('input', () => {
    t.name = name.value; // ungetrimmt, damit der User tippen kann
    notifyChange(state, opts);
    const counter = document.querySelector('[data-t-wizard-teams-counter="true"]');
    if (counter) updateCounter(state, counter);
    const warn = document.querySelector('[data-t-wizard-teams-warn="true"]');
    if (warn) updateDuplicateWarn(state.teams, warn);
  });
  // Auf blur: leeren Wert verwerfen, ansonsten trimmen.
  name.addEventListener('blur', () => {
    const trimmed = name.value.trim();
    if (trimmed === '') {
      name.value = t.name;
      return;
    }
    if (trimmed !== name.value) {
      name.value = trimmed;
      t.name = trimmed;
      notifyChange(state, opts);
    }
  });
  li.appendChild(name);

  const actions = document.createElement('span');
  actions.className = 't-wizard-team-actions';

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 't-btn t-btn--ghost t-btn--sm';
  up.textContent = '↑';
  up.title = 'Auf';
  up.disabled = index === 0;
  up.addEventListener('click', () => moveTeam(index, index - 1));
  actions.appendChild(up);

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 't-btn t-btn--ghost t-btn--sm';
  down.textContent = '↓';
  down.title = 'Ab';
  down.disabled = index === state.teams.length - 1;
  down.addEventListener('click', () => moveTeam(index, index + 1));
  actions.appendChild(down);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 't-btn t-btn--ghost t-btn--sm';
  remove.textContent = 'Löschen';
  remove.addEventListener('click', () => {
    removeTeam(index).catch((err) => console.warn('[wizard] removeTeam failed:', err));
  });
  actions.appendChild(remove);

  li.appendChild(actions);
  list.appendChild(li);

  // DnD wird zentral in attachTeamDnD verkabelt — hier nur Markierung.
  return li;
}

function moveTeam(from, to) {
  const wrap = document.querySelector('.t-mod.t-wizard');
  const state = wrap?._state;
  const opts = wrap?._opts;
  if (!state || !opts) return;
  if (to < 0 || to >= state.teams.length) return;
  const [moved] = state.teams.splice(from, 1);
  state.teams.splice(to, 0, moved);
  notifyChange(state, opts);
  // Re-render ist hier OK, weil der User eine explizite Aktion macht
  // (Pfeil/Klick/Drag). Nicht bei Tipp-Aktionen.
  refreshAfterMutation();
}

async function removeTeam(index) {
  const wrap = document.querySelector('.t-mod.t-wizard');
  const state = wrap?._state;
  const opts = wrap?._opts;
  if (!state || !opts) return;
  if (index < 0 || index >= state.teams.length) return;
  const t = state.teams[index];
  if (!isPlaceholderName(t.name)) {
    const dlg = await openConfirmDialog({
      title: 'Team entfernen?',
      message: `Team „${t.name}" wirklich entfernen?`,
      confirmLabel: 'Entfernen',
    });
    if (dlg.cancelled) return;
  }
  state.teams.splice(index, 1);
  notifyChange(state, opts);
  refreshAfterMutation();
}

function refreshAfterMutation() {
  const root = document.querySelector('.t-mod.t-wizard');
  if (!root) return;
  const state = root._state;
  const opts = root._opts;
  if (!state || !opts) return;
  const fresh = renderWizardView({ ...opts, initialState: state });
  root.parentNode?.replaceChild(fresh, root);
}

/**
 * Team-Farbpalette — MUSS identisch sein mit
 * `backend/src/modules/tournament/team-colors.js` (gleiche Reihenfolge,
 * gleiche Hex-Werte). Wir prüfen die Übereinstimmung per
 * `team-colors-parity.test.js`.
 *
 * Wird beim Anlegen automatisch vergeben (Weg A und Weg B im Wizard)
 * und als Fallback in `renderTeamRows` benutzt, falls ein Team noch
 * keine eigene Farbe hat.
 */
const TEAM_COLOR_PALETTE = [
  '#4F46E5', // Indigo
  '#059669', // Emerald
  '#D97706', // Amber
  '#E11D48', // Rose
  '#0284C7', // Sky
  '#7C3AED', // Violet
  '#0D9488', // Teal
  '#EA580C', // Orange
];

/**
 * Liefert die nächste freie Palette-Farbe, die noch kein Team hat.
 * Cycling: wenn alle Palette-Farben belegt sind, wird modulo gewickelt.
 */
function nextPaletteColor(existingTeams) {
  const palette = TEAM_COLOR_PALETTE;
  if (palette.length === 0) return null;
  const used = new Set(
    (existingTeams || [])
      .map((t) => (typeof t?.color === 'string' ? t.color.toLowerCase() : null))
      .filter(Boolean),
  );
  for (const color of palette) {
    if (!used.has(color.toLowerCase())) return color;
  }
  const paletteCount = (existingTeams || []).filter((t) => {
    const c = (t?.color ?? '').toLowerCase();
    return palette.some((p) => p.toLowerCase() === c);
  }).length;
  return palette[paletteCount % palette.length];
}

/**
 * Fallback für `renderTeamRows`, wenn ein Team keine Farbe hat — nimmt
 * die Position in der Liste modulo Palette-Länge. NICHT für neue
 * Teams verwenden, dort `nextPaletteColor`.
 */
function paletteColor(index) {
  const palette = TEAM_COLOR_PALETTE;
  return palette[index % palette.length];
}

// ----------------------------------------------------------------
// Step 3 — Modus
// ----------------------------------------------------------------
function renderStep3Modus(wrap, state, opts) {
  const form = document.createElement('div');
  form.className = 't-wizard-fields';

  // 4 Mode-Karten
  const modeField = document.createElement('div');
  modeField.className = 't-wizard-field';
  const modeLabel = document.createElement('div');
  modeLabel.className = 't-wizard-field-label';
  modeLabel.textContent = 'Turniermodus';
  modeField.appendChild(modeLabel);

  const modeGrid = document.createElement('div');
  modeGrid.className = 't-wizard-mode-grid';
  for (const m of MODE_OPTIONS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 't-wizard-mode-card';
    if (state.mode === m.id) card.classList.add('is-active');
    if (m.disabled) card.classList.add('is-disabled');
    card.disabled = m.disabled;
    card.innerHTML = `
      <span class="t-wizard-mode-card-label">${m.label}</span>
      <span class="t-wizard-mode-card-desc">${m.desc}</span>
    `;
    if (!m.disabled) {
      card.addEventListener('click', () => {
        state.mode = m.id;
        notifyChange(state, opts);
        refreshShell();
      });
    }
    modeGrid.appendChild(card);
  }
  modeField.appendChild(modeGrid);
  form.appendChild(modeField);

  if (state.mode !== 'ko_only') {
    // Anzahl Gruppen
    const groupField = document.createElement('div');
    groupField.className = 't-wizard-field';

    const groupLabel = document.createElement('div');
    groupLabel.className = 't-wizard-field-label';
    groupLabel.textContent = 'Anzahl Gruppen';
    groupField.appendChild(groupLabel);

    const groupRow = document.createElement('div');
    groupRow.className = 't-wizard-group-control';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 't-btn t-btn--sm';
    minus.textContent = '–';
    minus.disabled = state.numGroups <= 1;
    minus.addEventListener('click', () => {
      if (state.numGroups > 1) {
        state.numGroups--;
        notifyChange(state, opts);
        refreshShell();
      }
    });
    groupRow.appendChild(minus);

    const num = document.createElement('span');
    num.className = 't-wizard-group-num';
    num.textContent = String(state.numGroups);
    groupRow.appendChild(num);

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 't-btn t-btn--sm';
    plus.textContent = '+';
    const maxGroups = Math.max(1, Math.floor(state.teams.length / 2));
    plus.disabled = state.numGroups >= maxGroups;
    plus.addEventListener('click', () => {
      if (state.numGroups < maxGroups) {
        state.numGroups++;
        notifyChange(state, opts);
        refreshShell();
      }
    });
    groupRow.appendChild(plus);

    // Live-Verteilung
    const dist = groupRowSizes(state.teams.length, state.numGroups);
    const distLabel = document.createElement('span');
    distLabel.className = 't-wizard-group-dist';
    distLabel.textContent = state.teams.length > 0
      ? `→ ${state.numGroups} Gruppen → ${dist.join(' / ')}`
      : `(${state.teams.length} Teams bisher erfasst)`;
    groupRow.appendChild(distLabel);

    groupField.appendChild(groupRow);

    if (state.teams.length > 0 && state.teams.length < state.numGroups * 2) {
      const warn = document.createElement('div');
      warn.className = 't-wizard-warn';
      warn.textContent = `Mit ${state.teams.length} Teams sind maximal ${Math.floor(state.teams.length / 2)} Gruppen möglich (min. 2 Teams/Gruppe).`;
      groupField.appendChild(warn);
    }

    form.appendChild(groupField);

    // Verteilungsmethode
    const methodField = document.createElement('div');
    methodField.className = 't-wizard-field';
    const methodLabel = document.createElement('div');
    methodLabel.className = 't-wizard-field-label';
    methodLabel.textContent = 'Verteilungsmethode';
    methodField.appendChild(methodLabel);

    const methodList = document.createElement('div');
    methodList.className = 't-wizard-method-list';
    for (const dm of DISTRIBUTION_METHODS) {
      const row = document.createElement('label');
      row.className = 't-wizard-method-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'distribution';
      radio.value = dm.id;
      radio.checked = state.distributionMethod === dm.id;
      radio.addEventListener('change', () => {
        state.distributionMethod = dm.id;
        notifyChange(state, opts);
      });
      const txt = document.createElement('span');
      txt.textContent = dm.label;
      row.appendChild(radio);
      row.appendChild(txt);
      methodList.appendChild(row);
    }
    methodField.appendChild(methodList);
    form.appendChild(methodField);

    // Hin- und Rückrunde
    const dblField = document.createElement('label');
    dblField.className = 't-wizard-checkbox-row';
    const dbl = document.createElement('input');
    dbl.type = 'checkbox';
    dbl.checked = state.doubleRoundRobin;
    dbl.addEventListener('change', () => {
      state.doubleRoundRobin = dbl.checked;
      notifyChange(state, opts);
      refreshShell();
    });
    const dblLabel = document.createElement('span');
    dblLabel.textContent = 'Hin- und Rückrunde (jede Paarung zweimal)';
    dblField.appendChild(dbl);
    dblField.appendChild(dblLabel);
    form.appendChild(dblField);

    // Punkteregel
    const pField = document.createElement('div');
    pField.className = 't-wizard-field';
    const pLabel = document.createElement('div');
    pLabel.className = 't-wizard-field-label';
    pLabel.textContent = 'Punkteregel';
    pField.appendChild(pLabel);

    const pRow = document.createElement('div');
    pRow.className = 't-wizard-points-row';
    for (const [key, fallback] of [
      ['pointsWin', 'Sieg'],
      ['pointsDraw', 'Unentschieden'],
      ['pointsLoss', 'Niederlage'],
    ]) {
      const cell = document.createElement('label');
      cell.className = 't-wizard-points-cell';
      const ct = document.createElement('span');
      ct.textContent = fallback;
      cell.appendChild(ct);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 't-input';
      inp.value = String(state[key]);
      inp.min = '0';
      inp.style.width = '64px';
      inp.addEventListener('input', () => {
        state[key] = Math.max(0, Number(inp.value) || 0);
        notifyChange(state, opts);
      });
      cell.appendChild(inp);
      pRow.appendChild(cell);
    }
    pField.appendChild(pRow);
    form.appendChild(pField);

    // Tiebreaker (sortierbar, vereinfachte Bedienung mit ↑/↓)
    const tieField = document.createElement('div');
    tieField.className = 't-wizard-field';
    const tieLabel = document.createElement('div');
    tieLabel.className = 't-wizard-field-label';
    tieLabel.textContent = 'Tiebreaker-Reihenfolge';
    tieField.appendChild(tieLabel);

    const tieList = document.createElement('ol');
    tieList.className = 't-wizard-tie-list';
    for (let i = 0; i < state.tiebreakers.length; i++) {
      const id = state.tiebreakers[i];
      const def = TIEBREAKER_ORDER.find((t) => t.id === id);
      if (!def) continue;
      const li = document.createElement('li');
      li.className = 't-wizard-tie-row';

      const num = document.createElement('span');
      num.className = 't-wizard-tie-num';
      num.textContent = String(i + 1);
      li.appendChild(num);

      const lbl = document.createElement('span');
      lbl.className = 't-wizard-tie-label';
      lbl.textContent = def.label;
      li.appendChild(lbl);

      const actions = document.createElement('span');
      actions.className = 't-wizard-tie-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 't-btn t-btn--ghost t-btn--sm';
      up.textContent = '↑';
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        if (i === 0) return;
        const x = state.tiebreakers[i - 1];
        state.tiebreakers[i - 1] = state.tiebreakers[i];
        state.tiebreakers[i] = x;
        notifyChange(state, opts);
        refreshShell();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 't-btn t-btn--ghost t-btn--sm';
      down.textContent = '↓';
      down.disabled = i === state.tiebreakers.length - 1;
      down.addEventListener('click', () => {
        if (i === state.tiebreakers.length - 1) return;
        const x = state.tiebreakers[i + 1];
        state.tiebreakers[i + 1] = state.tiebreakers[i];
        state.tiebreakers[i] = x;
        notifyChange(state, opts);
        refreshShell();
      });
      actions.appendChild(up);
      actions.appendChild(down);
      li.appendChild(actions);
      tieList.appendChild(li);
    }
    tieField.appendChild(tieList);
    form.appendChild(tieField);

    // DnD aktivieren — Pointer Events, funktioniert auf Maus UND Touch.
    // refreshShell wird per Closure über die renderStep3Modus-Argumente
    // gebunden (siehe Funktionsende).
    if (typeof refreshShell === 'function') {
      attachTiebreakerDnD(tieList, state, opts, refreshShell);
    }
  }

  wrap.appendChild(form);

  function refreshShell() {
    const root = getRoot();
    if (!root) return;
    const fresh = renderWizardView({ ...root._opts, initialState: state });
    root.parentNode?.replaceChild(fresh, root);
  }
}

// ----------------------------------------------------------------
// Tiebreaker-DnD: Touch- und Maus-tauglich via Pointer Events.
// HTML5-Drag ignoriert Touchscreens, daher der Umweg.
// ----------------------------------------------------------------
function attachTiebreakerDnD(list, state, opts, refresh) {
  const THRESHOLD = 5;       // Pixel bis ein Tap zum Drag wird
  const HALF_SWAP = 12;      // Pixel ab Mitte der nächsten Row → Reihenfolge-Wechsel
  let drag = null;           // aktiver Drag-State

  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.t-wizard-tie-row');
    if (!row || !list.contains(row)) return;
    // Action-Buttons bleiben Klick-Ziele, kein Drag von dort.
    if (e.target.closest('.t-wizard-tie-actions')) return;

    const idx = Array.prototype.indexOf.call(list.children, row);
    drag = {
      row,
      index: idx,
      startY: e.clientY,
      offsetY: e.clientY - row.getBoundingClientRect().top,
      active: false,
      pointerId: e.pointerId,
      placeholder: null,
    };
    row.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < THRESHOLD) return;
      // Aktivierung: Liste vorbereiten, Placeholder einsetzen.
      drag.active = true;
      drag.row.classList.add('is-dragging');
      list.classList.add('is-dragging-active');
      const ph = document.createElement('li');
      ph.className = 't-wizard-tie-placeholder';
      ph.style.height = drag.row.offsetHeight + 'px';
      drag.placeholder = ph;
      drag.row.parentNode.insertBefore(ph, drag.row);
      drag.row.style.position = 'absolute';
      drag.row.style.left = '0';
      drag.row.style.right = '0';
      drag.row.style.width = '100%';
    }
    drag.row.style.top = (e.clientY - drag.offsetY) + 'px';

    // Ziel-Index bestimmen: Vergleich Drag-Mitte mit Row-Mitten.
    const others = Array.from(list.querySelectorAll('.t-wizard-tie-row:not(.is-dragging)'));
    const draggedMid = e.clientY;
    let targetIdx = others.length; // Fallback: ans Ende
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      // Wir setzen den Placeholder ÜBER die erste Row, deren Mitte
      // wir nach unten überschritten haben — dann darunter.
      if (draggedMid < mid + HALF_SWAP) {
        targetIdx = i;
        break;
      }
    }
    const ref = others[targetIdx] || null;
    if (ref) {
      list.insertBefore(drag.placeholder, ref);
    } else {
      list.appendChild(drag.placeholder);
    }
  });

  const finish = (commit) => {
    if (!drag) return;
    if (drag.active && commit) {
      const phIdx = Array.prototype.indexOf.call(list.children, drag.placeholder);
      drag.placeholder.remove();
      const [moved] = state.tiebreakers.splice(drag.index, 1);
      // Nach dem Entfernen der Original-Row verschieben sich alle
      // Positionen >= drag.index um 1. Kompensieren:
      const adjusted = phIdx > drag.index ? phIdx - 1 : phIdx;
      state.tiebreakers.splice(adjusted, 0, moved);
      notifyChange(state, opts);
      refresh();
    }
    if (drag.active) {
      drag.row.classList.remove('is-dragging');
      list.classList.remove('is-dragging-active');
      drag.row.style.position = '';
      drag.row.style.left = '';
      drag.row.style.right = '';
      drag.row.style.width = '';
      drag.row.style.top = '';
      if (drag.placeholder && drag.placeholder.parentNode) {
        drag.placeholder.remove();
      }
    }
    drag = null;
  };

  list.addEventListener('pointerup',     (e) => { if (drag && e.pointerId === drag.pointerId) finish(true);  });
  list.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) finish(false); });
}

// ----------------------------------------------------------------
// Step 4 — Qualifikation & Zeitplan
// ----------------------------------------------------------------
function renderStep4Qualifikation(wrap, state, opts) {
  const form = document.createElement('div');
  form.className = 't-wizard-fields';

  const isKoPhase = state.mode === 'groups_ko' || state.mode === 'groups_only';

  if (isKoPhase) {
    // Aufsteiger pro Gruppe
    const advField = document.createElement('div');
    advField.className = 't-wizard-field';
    const advLabel = document.createElement('div');
    advLabel.className = 't-wizard-field-label';
    advLabel.textContent = 'Aufsteiger pro Gruppe';
    advField.appendChild(advLabel);

    const advRow = document.createElement('div');
    advRow.className = 't-wizard-stepper';
    const maxAdv = Math.max(1, state.teams.length / state.numGroups - 1);
    for (const [delta, label] of [[-1, '–'], [1, '+']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 't-btn t-btn--sm';
      b.textContent = label;
      const newVal = state.advancePerGroup + delta;
      b.disabled = newVal < 1 || newVal > maxAdv;
      b.addEventListener('click', () => {
        state.advancePerGroup = newVal;
        notifyChange(state, opts);
        refreshShell();
      });
      advRow.appendChild(b);
    }
    const advNum = document.createElement('span');
    advNum.className = 't-wizard-stepper-num';
    advNum.textContent = String(state.advancePerGroup);
    advRow.appendChild(advNum);
    advField.appendChild(advRow);
    form.appendChild(advField);

    // Beste Dritte
    const btField = document.createElement('div');
    btField.className = 't-wizard-field';
    const btLabel = document.createElement('div');
    btLabel.className = 't-wizard-field-label';
    btLabel.textContent = 'Beste Drittplatzierte (Lucky Loser)';
    btField.appendChild(btLabel);

    const btRow = document.createElement('div');
    btRow.className = 't-wizard-stepper';
    const maxBt = Math.max(0, state.numGroups - 1);
    for (const [delta, label] of [[-1, '–'], [1, '+']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 't-btn t-btn--sm';
      b.textContent = label;
      const newVal = state.bestThirdsCount + delta;
      b.disabled = newVal < 0 || newVal > maxBt;
      b.addEventListener('click', () => {
        state.bestThirdsCount = newVal;
        notifyChange(state, opts);
        refreshShell();
      });
      btRow.appendChild(b);
    }
    const btNum = document.createElement('span');
    btNum.className = 't-wizard-stepper-num';
    btNum.textContent = String(state.bestThirdsCount);
    btRow.appendChild(btNum);
    btField.appendChild(btRow);

    if (state.teams.length > 0) {
      const qualTotal = state.numGroups * state.advancePerGroup + state.bestThirdsCount;
      const empfehlung = recommendForQualifiers(qualTotal);
      const live = document.createElement('div');
      live.className = 't-wizard-live-info';
      live.textContent = empfehlung
        ? `${qualTotal} Qualifikanten → ${empfehlung}`
        : `${qualTotal} Qualifikanten → ${bracketSizeLabel(qualTotal)}`;
      btField.appendChild(live);
    }

    form.appendChild(btField);

    // Spiel um Platz 3
    const tpmField = document.createElement('label');
    tpmField.className = 't-wizard-checkbox-row';
    const tpm = document.createElement('input');
    tpm.type = 'checkbox';
    tpm.checked = state.thirdPlaceMatch;
    tpm.addEventListener('change', () => {
      state.thirdPlaceMatch = tpm.checked;
      notifyChange(state, opts);
      // refreshShell() triggert Preview-Card-Re-Render (zeigt jetzt
      // 8 statt 7 K.-o.-Spiele). refreshShell ist hier OK, weil die
      // Checkbox KEINEN Fokus hält wie ein Textfeld — der "Fokus weg"-
      // Bug (BUG 2) betrifft nur Inputs. Konsistent mit advancePerGroup
      // und bestThirdsCount, die ebenfalls refreshShell() rufen.
      //
      // Bug 10 (2026-08-18): Ohne diesen refreshShell()-Aufruf blieb
      // sowohl die Live-EndInfo-Zeile als auch die rechte Preview-Card
      // bei 7 K.-o.-Spielen stehen, obwohl state.thirdPlaceMatch true
      // war. computeEndInfo lieferte korrekt 8 — nur wurde es nirgends
      // neu gerendert.
      refreshShell();
    });
    const tpmLabel = document.createElement('span');
    tpmLabel.textContent = 'Spiel um Platz 3';
    tpmField.appendChild(tpm);
    tpmField.appendChild(tpmLabel);
    form.appendChild(tpmField);
  }

  // §9-Konstellations-Validierung (2026-08-17, Bug B).
  // Inline-Warnung statt stillem Generieren — die App zeigt dem
  // Veranstalter sofort, ob seine Konstellation Sinn ergibt.
  // Wir rendern sie in Step 4, weil dort die Qualifikations-Auswahl
  // (Aufsteiger/beste Dritte) getroffen wird — die kritische Eingabe
  // für "alle kommen weiter".
  if (Array.isArray(state.teams) && state.teams.length > 0) {
    const constitution = validateConstitution(state);
    if (constitution.level !== 'ok') {
      const banner = document.createElement('div');
      banner.className = constitution.level === 'block'
        ? 't-wizard-warn t-wizard-warn--block'
        : 't-wizard-warn';
      banner.setAttribute('role', 'alert');
      for (const msg of constitution.messages) {
        const line = document.createElement('div');
        line.className = 't-wizard-warn-line';
        // Prefix für severity — klar, nicht Code-only.
        const prefix = msg.severity === 'error'
          ? '❌ Konstellation problematisch: '
          : msg.severity === 'warn'
            ? '⚠️ Hinweis: '
            : 'ℹ️ ';
        line.textContent = prefix + msg.text;
        banner.appendChild(line);
        // Optional: "Trotzdem generieren" für block-Cases. Da §9
        // "anzeigen statt entscheiden" sagt, lassen wir den Button
        // weiterhin blockiert und signalisieren das via Klassen.
        // Bei Bedarf kann das in Etappe B.6 zu einem Toggle werden.
      }
      form.appendChild(banner);
    }
  }

  // Tische
  const tblField = document.createElement('div');
  tblField.className = 't-wizard-field';
  const tblLabel = document.createElement('div');
  tblLabel.className = 't-wizard-field-label';
  tblLabel.textContent = 'Tische / Spielfelder';
  tblField.appendChild(tblLabel);

  const tblRow = document.createElement('div');
  tblRow.className = 't-wizard-stepper';
  for (const [delta, label] of [[-1, '–'], [1, '+']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 't-btn t-btn--sm';
    b.textContent = label;
    const newVal = state.numTables + delta;
    b.disabled = newVal < 1 || newVal > 16;
    b.addEventListener('click', () => {
      state.numTables = newVal;
      notifyChange(state, opts);
      refreshShell();
    });
    tblRow.appendChild(b);
  }
  const tblNum = document.createElement('span');
  tblNum.className = 't-wizard-stepper-num';
  tblNum.textContent = String(state.numTables);
  tblRow.appendChild(tblNum);
  tblField.appendChild(tblRow);
  form.appendChild(tblField);

  // Startzeit, Spieldauer, Pause
  //
  // WICHTIG: KEIN refreshShell() in den input-Listenern. Ein Full-Render
  // würde das Eingabefeld neu erzeugen und der Fokus wäre weg (BUG 2).
  // Statt dessen hält das Live-Preview-Element (endInfo) unten eine
  // Closure-Referenz; updateEndInfo() schreibt nur den TextContent.
  const timeRow = document.createElement('div');
  timeRow.className = 't-wizard-row three';
  timeRow.appendChild(buildField({
    label: 'Startzeit',
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'time';
      i.id = id;
      i.className = 't-input';
      i.value = state.startTime;
      i.addEventListener('input', () => {
        state.startTime = i.value;
        notifyChange(state, opts);
        updateEndInfo();
      });
      return i;
    },
  }));
  timeRow.appendChild(buildField({
    label: 'Spieldauer (Min.)',
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.id = id;
      i.className = 't-input';
      i.min = '1';
      i.value = String(state.matchDuration);
      i.addEventListener('input', () => {
        state.matchDuration = Math.max(1, Number(i.value) || 1);
        notifyChange(state, opts);
        updateEndInfo();
      });
      return i;
    },
  }));
  timeRow.appendChild(buildField({
    label: 'Pause (Min.)',
    input: (id) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.id = id;
      i.className = 't-input';
      i.min = '0';
      i.value = String(state.pauseMinutes);
      i.addEventListener('input', () => {
        state.pauseMinutes = Math.max(0, Number(i.value) || 0);
        notifyChange(state, opts);
        updateEndInfo();
      });
      return i;
    },
  }));
  form.appendChild(timeRow);

  // Live: voraussichtliches Ende. Rendert bedingt (nur wenn genug Teams
  // für die aktuelle Gruppenzahl da sind). Die Closure greift beim
  // Update auf das gleiche Element zu, das wir hier anlegen — KEIN
  // Re-Render, nur TextContent patchen.
  let endInfoEl = null;
  function updateEndInfo() {
    if (state.teams.length < state.numGroups * 2) {
      if (endInfoEl) { endInfoEl.remove(); endInfoEl = null; }
      return;
    }
    const endInfo = computeEndInfo(state);
    const text = `Voraussichtliches Turnierende: ${endInfo.endLabel} ` +
      `(ca. ${endInfo.totalMinutes} Min., ${endInfo.groupGames} Gruppenspiele + ${endInfo.koGames} K.-o.-Spiele).`;
    if (endInfoEl) {
      endInfoEl.textContent = text;
    } else {
      endInfoEl = document.createElement('div');
      endInfoEl.className = 't-wizard-live-info';
      endInfoEl.dataset.tWizardEndInfo = 'true';
      endInfoEl.textContent = text;
      form.appendChild(endInfoEl);
    }
  }
  updateEndInfo();

  wrap.appendChild(form);

  function refreshShell() {
    const root = getRoot();
    if (!root) return;
    const fresh = renderWizardView({ ...root._opts, initialState: state });
    root.parentNode?.replaceChild(fresh, root);
  }
}

function recommendForQualifiers(qualifiers) {
  if (qualifiers < 2) return null;
  const bracket = Math.pow(2, Math.ceil(Math.log2(qualifiers)));
  const gap = bracket - qualifiers;
  if (gap === 0) return `${bracketSizeLabel(qualifiers)} ohne Freilose`;
  if (gap === 1) return bracketSizeLabel(qualifiers) + ' (1 Freilos)';
  if (gap === 2 && qualifiers === 6) return 'Viertelfinale — 2 beste Dritte ergänzen → sauberer Baum';
  if (gap >= 2) {
    return `${gap} Plätze fehlen → ${gap} beste Dritte ergänzen (Empfehlung)`;
  }
  return null;
}

// ----------------------------------------------------------------
// Step 5 — Zusammenfassung
// ----------------------------------------------------------------
function renderStep5Zusammenfassung(wrap, state, opts) {
  const sport = SPORT_OPTIONS.find((s) => s.id === state.sport) || SPORT_OPTIONS[0];
  const mode = MODE_OPTIONS.find((m) => m.id === state.mode) || MODE_OPTIONS[0];

  const list = document.createElement('dl');
  list.className = 't-wizard-summary';

  appendSummaryRow(list, 'Turniername', state.name || '—', 1, state, opts);
  appendSummaryRow(list, 'Datum', state.date || '—', 1, state, opts);
  appendSummaryRow(list, 'Ort', state.location || '—', 1, state, opts);
  appendSummaryRow(list, 'Sportart', sport.label, 1, state, opts);
  appendSummaryRow(list, 'Teams', `${state.teams.length} Teams`, 2, state, opts);
  appendSummaryRow(list, 'Modus', mode.label, 3, state, opts);

  if (state.mode !== 'ko_only') {
    const sizes = groupRowSizes(state.teams.length, state.numGroups);
    appendSummaryRow(
      list,
      'Gruppen',
      `${state.numGroups} Gruppen → ${sizes.join(' / ')}`,
      3,
      state,
      opts
    );
    appendSummaryRow(list, 'Verteilung', distributionLabel(state.distributionMethod), 3, state, opts);
    if (state.doubleRoundRobin) {
      appendSummaryRow(list, 'Hin- und Rückrunde', 'Ja', 3, state, opts);
    }
  }

  if (state.mode === 'groups_ko') {
    appendSummaryRow(
      list,
      'Qualifikation',
      `Top ${state.advancePerGroup} pro Gruppe` +
        (state.bestThirdsCount > 0 ? ` + ${state.bestThirdsCount} beste Dritte` : '') +
        (state.thirdPlaceMatch ? ' + Spiel um Platz 3' : ''),
      4,
      state,
      opts
    );
  }

  appendSummaryRow(
    list,
    'Tische',
    `${state.numTables}`,
    4,
    state,
    opts
  );
  appendSummaryRow(
    list,
    'Zeit',
    `Start ${state.startTime} · ${state.matchDuration} Min. + ${state.pauseMinutes} Min. Pause`,
    4,
    state,
    opts
  );

  // Mindest-Team-Anzahl für die Endzeit-Hochrechnung: ko_only braucht
  // nur 2 Teams, Gruppenphasen numGroups * 2.
  const minTeamsForEnd = state.mode === 'ko_only' ? 2 : state.numGroups * 2;
  if (state.teams.length >= minTeamsForEnd) {
    const end = computeEndInfo(state);
    appendSummaryRow(list, 'Voraussichtliches Ende', end.endLabel, 4, state, opts);
  }

  wrap.appendChild(list);

  // Hauptaktion
  const footer = document.createElement('div');
  footer.className = 't-wizard-summary-cta';
  const gen = document.createElement('button');
  gen.type = 'button';
  gen.className = 't-btn t-btn--primary';
  gen.textContent = 'Turnier generieren';

  // §9-Block: bei problematischer Konstellation ist der Button
  // disabled und der Footer zeigt die Begründung inline. Der User
  // muss zurück in Step 3/4 und die Konstellation reparieren.
  // Spec §9: "zeigt das dem Veranstalter an, statt sich still zu
  // entscheiden." — disable ist genau das.
  const constitution = validateConstitution(state);
  if (constitution.level === 'block') {
    gen.disabled = true;
    gen.title = 'Konstellation blockiert die Generierung — siehe Hinweis unten.';
    const block = document.createElement('div');
    block.className = 't-wizard-warn t-wizard-warn--block';
    block.setAttribute('role', 'alert');
    for (const msg of constitution.messages) {
      const line = document.createElement('div');
      line.className = 't-wizard-warn-line';
      line.textContent = (msg.severity === 'error' ? '❌ ' : '⚠️ ') + msg.text;
      block.appendChild(line);
    }
    block.textContent =
      'Diese Konstellation kann nicht generiert werden. ' +
      'Bitte zurück zu Schritt 3 oder 4 und anpassen.';
    // Re-render mit Messages (überschreibt die obere Zeile, OK so).
    while (block.firstChild) block.removeChild(block.firstChild);
    for (const msg of constitution.messages) {
      const line = document.createElement('div');
      line.className = 't-wizard-warn-line';
      line.textContent =
        (msg.severity === 'error' ? '❌ ' : '⚠️ ') + msg.text;
      block.appendChild(line);
    }
    wrap.appendChild(block);
  }

  const inlineError = document.createElement('div');
  inlineError.className = 't-wizard-gen-error';
  inlineError.setAttribute('role', 'alert');
  inlineError.hidden = true;
  footer.appendChild(gen);
  footer.appendChild(inlineError);
  wrap.appendChild(footer);

  /**
   * Klick auf "Turnier generieren".
   *
   * Verzweigt:
   *  - opts.onGenerate vorhanden → Promise auswerten, 409/Dialog-Schleife.
   *  - sonst opts.onComplete (Legacy, kein Dialog).
   */
  let busy = false;
  gen.addEventListener('click', async () => {
    if (busy) return;

    if (typeof opts.onGenerate === 'function') {
      busy = true;
      gen.disabled = true;
      inlineError.hidden = true;
      try {
        const result = await opts.onGenerate(state, {});
        busy = false;
        gen.disabled = false;
        if (result && result.ok) {
          return; // Aufrufer kümmert sich um den Übergang (z. B. Detail-View).
        }
        // 409 results_present → Bestätigungsdialog.
        if (result && result.status === 409 && result.body?.error === 'results_present') {
          const finished = result.body.finishedMatches ?? 0;
          const confirmed = await openConfirmDialog({
            title: 'Bereits ' + finished + ' Ergebnisse eingetragen',
            message:
              'Beim Neu-Generieren gehen die vorhandenen Ergebnisse verloren. ' +
              'Tippe zur Bestätigung den Turniernamen ein:',
            expectedName: state.name,
            confirmLabel: 'Neu generieren',
          });
          if (confirmed.cancelled) {
            return;
          }
          // Zweiter Versuch mit Bestätigung.
          busy = true;
          gen.disabled = true;
          try {
            const r2 = await opts.onGenerate(state, {
              confirmTournamentName: confirmed.typedName,
            });
            busy = false;
            gen.disabled = false;
            if (r2 && r2.ok) return;
            showInlineError(inlineError, errorMessageFromResult(r2));
          } catch (err) {
            busy = false;
            gen.disabled = false;
            showInlineError(inlineError, 'Unerwarteter Fehler: ' + (err?.message ?? err));
          }
          return;
        }
        // Alle anderen Fehler (400 confirmation_mismatch, 409 tournament_finished, 500 …).
        showInlineError(inlineError, errorMessageFromResult(result));
      } catch (err) {
        busy = false;
        gen.disabled = false;
        showInlineError(inlineError, 'Unerwarteter Fehler: ' + (err?.message ?? err));
      }
      return;
    }

    // Legacy-Pfad: nur Klick weiterreichen, kein Dialog.
    if (typeof opts.onComplete === 'function') opts.onComplete(state);
  });
}

/**
 * Zeigt eine kompakte Inline-Fehlermeldung unter dem
 * "Turnier generieren"-Button. Verlässt den Wizard NICHT.
 */
function showInlineError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

/**
 * Übersetzt ein onGenerate-Ergebnis in eine deutsche Fehlermeldung.
 */
function errorMessageFromResult(result) {
  if (!result) return 'Unbekannter Fehler beim Generieren.';
  const err = result.body?.error;
  if (err === 'tournament_finished') {
    return 'Dieses Turnier ist bereits beendet und kann nicht neu generiert werden.';
  }
  if (err === 'confirmation_mismatch') {
    return 'Der eingegebene Name stimmt nicht mit dem Turniernamen überein.';
  }
  if (err === 'results_present') {
    return 'Es liegen bereits Ergebnisse vor — eine Bestätigung ist nötig.';
  }
  if (err === 'teams_missing' || err === 'teams_required') {
    return 'Mindestens 2 Teams sind erforderlich.';
  }
  return result.body?.message ?? result.body?.error ?? 'Generieren fehlgeschlagen.';
}

/**
 * Öffnet einen modalen Bestätigungsdialog für destruktive Aktionen
 * (Spec §13.10).
 *
 * Der "Bestätigen"-Button ist erst aktiv, wenn das Eingabefeld exakt
 * === expectedName entspricht (case-sensitive).
 *
 * @returns Promise<{ cancelled: true } | { cancelled: false, typedName: string }>
 */
export function openConfirmDialog({ title, message, expectedName, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 't-confirm-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 't-confirm-dialog';

    const h = document.createElement('h3');
    h.className = 't-confirm-title';
    h.textContent = title;
    dialog.appendChild(h);

    const p = document.createElement('p');
    p.className = 't-confirm-message';
    p.textContent = message;
    dialog.appendChild(p);

    // Optionales Eingabefeld: nur wenn expectedName gesetzt ist
    // (§13.10 Zerstörerische Aktionen). Sonst reicht ein Klick.
    let input = null;
    if (expectedName) {
      const expected = document.createElement('p');
      expected.className = 't-confirm-expected';
      expected.textContent = 'Erwartet: „' + expectedName + '"';
      dialog.appendChild(expected);

      input = document.createElement('input');
      input.type = 'text';
      input.className = 't-confirm-input';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Turniername zur Bestätigung');
      dialog.appendChild(input);
    }

    const row = document.createElement('div');
    row.className = 't-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 't-btn t-btn--ghost';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.addEventListener('click', () => {
      close();
      resolve({ cancelled: true });
    });

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 't-btn ' + (danger ? 't-btn--danger' : 't-btn--primary');
    okBtn.textContent = confirmLabel;
    okBtn.disabled = !!expectedName;
    okBtn.addEventListener('click', () => {
      close();
      resolve({ cancelled: false, typedName: input ? input.value : '' });
    });

    if (input) {
      input.addEventListener('input', () => {
        // Geteilter Vergleich mit Server + Mock (Spec §13.10).
        okBtn.disabled =
          normalizeConfirmName(input.value) !==
          normalizeConfirmName(expectedName);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !okBtn.disabled) okBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      });
    }

    row.appendChild(cancelBtn);
    row.appendChild(okBtn);
    dialog.appendChild(row);

    backdrop.appendChild(dialog);

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') cancelBtn.click();
    }
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    if (input) input.focus();
    else okBtn.focus();
  });
}

function distributionLabel(id) {
  switch (id) {
    case 'random': return 'Zufällig auslosen';
    case 'seeded': return 'Setzliste (Snake Seeding)';
    case 'manual': return 'Manuell zuweisen';
    default: return id;
  }
}

function appendSummaryRow(list, label, value, backToStep, state, opts) {
  const wrap = document.createElement('div');
  wrap.className = 't-wizard-summary-row';
  const lab = document.createElement('dt');
  lab.textContent = label;
  const val = document.createElement('dd');
  val.textContent = value;
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 't-wizard-summary-edit';
  link.textContent = 'Ändern';
  link.addEventListener('click', () => {
    state.step = backToStep;
    notifyChange(state, opts);
    const root = getRoot();
    if (root) {
      const fresh = renderWizardView({ ...root._opts, initialState: state });
      root.parentNode?.replaceChild(fresh, root);
    }
  });
  wrap.appendChild(lab);
  wrap.appendChild(val);
  wrap.appendChild(link);
  list.appendChild(wrap);
}

// ----------------------------------------------------------------
// Live-Vorschau (rechts ab 1200px Modul-Breite)
// ----------------------------------------------------------------
function renderWizardPreview(state) {
  const card = document.createElement('div');
  card.className = 't-wizard-preview';

  const heading = document.createElement('div');
  heading.className = 't-wizard-preview-head';
  const title = document.createElement('div');
  title.className = 't-wizard-preview-title';
  title.textContent = 'Vorschau';
  const sub = document.createElement('div');
  sub.className = 't-wizard-preview-sub';
  sub.textContent = state.name ? state.name : 'Noch kein Name';
  heading.appendChild(title);
  heading.appendChild(sub);
  card.appendChild(heading);

  // Block 1: Modus
  const mode = MODE_OPTIONS.find((m) => m.id === state.mode) || MODE_OPTIONS[0];
  addPreviewRow(card, 'Modus', mode.label);

  // Block 2: Teams/Gruppen — modusspezifisch.
  if (state.mode === 'ko_only') {
    // Reine K.-o.-Phase: nur Team-Zahl + Bracket-Runde.
    addPreviewRow(
      card,
      'Teams',
      state.teams.length > 0
        ? `${state.teams.length} Teams`
        : '0 Teams'
    );
    if (state.teams.length > 0) {
      const slots = Math.pow(2, Math.ceil(Math.log2(state.teams.length)));
      addPreviewRow(card, 'Runde', bracketSizeLabel(slots));
    }
  } else {
    // Gruppenphase (groups_ko, groups_only) — Verteilung zeigen.
    const sizes = groupRowSizes(state.teams.length, state.numGroups);
    addPreviewRow(
      card,
      'Gruppen',
      state.teams.length > 0
        ? `${state.numGroups} → ${sizes.join(' / ')}`
        : `${state.numGroups} (noch 0 Teams)`
    );
  }

  if (state.mode === 'groups_ko') {
    const qualifiers = state.numGroups * state.advancePerGroup + state.bestThirdsCount;
    addPreviewRow(card, 'Qualifikanten', String(qualifiers));
    addPreviewRow(card, 'Runde', bracketSizeLabel(qualifiers));
  }

  // Block 3: Spiele — Mindest-Team-Anzahl ist modusspezifisch.
  // ko_only: 2 Teams reichen. Gruppenphasen: numGroups * 2.
  const minTeams = state.mode === 'ko_only' ? 2 : state.numGroups * 2;
  if (state.teams.length >= minTeams) {
    const end = computeEndInfo(state);
    if (state.mode !== 'ko_only') {
      addPreviewRow(card, 'Gruppenspiele', String(end.groupGames));
    }
    if (state.mode !== 'groups_only') {
      addPreviewRow(card, 'K.-o.-Spiele', String(end.koGames));
    }
    addPreviewRow(
      card,
      'Gesamt',
      `${end.groupGames + end.koGames} Spiele · ${state.numTables} Tische`
    );
    addPreviewRow(card, 'Ende', `ca. ${end.endLabel} Uhr`);
  } else {
    addPreviewRow(card, 'Gesamt', '— (zu wenig Teams)');
  }

  // Block 4: Hinweis, wenn noch unklar — modusspezifisch.
  if (state.teams.length === 0) {
    const hint = document.createElement('div');
    hint.className = 't-wizard-preview-hint';
    hint.textContent = 'Trage Schritt 2 Teams ein, um die Verteilung zu sehen.';
    card.appendChild(hint);
  } else if (state.mode !== 'ko_only' && state.teams.length < state.numGroups * 2) {
    const hint = document.createElement('div');
    hint.className = 't-wizard-preview-hint';
    hint.textContent = `Mindestens ${state.numGroups * 2} Teams nötig, damit ${state.numGroups} Gruppen je 2 Teams enthalten.`;
    card.appendChild(hint);
  } else if (state.mode === 'ko_only' && state.teams.length < 2) {
    const hint = document.createElement('div');
    hint.className = 't-wizard-preview-hint';
    hint.textContent = 'Mindestens 2 Teams nötig für ein K.-o.-Turnier.';
    card.appendChild(hint);
  }

  return card;
}

function addPreviewRow(card, label, value) {
  const row = document.createElement('div');
  row.className = 't-wizard-preview-row';
  const lab = document.createElement('span');
  lab.className = 't-wizard-preview-label';
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 't-wizard-preview-value';
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  card.appendChild(row);
}

// ----------------------------------------------------------------
// Footer (Zurück / Weiter)
// ----------------------------------------------------------------
//
// Bug A (§13.3): "Weiter" muss reaktiv auf den aktuellen Form-State
// reagieren, nicht erst beim Re-Render. Strategie: Marker-Daten ins
// DOM (data-t-wizard-next, data-t-wizard-next-hint), ein einziger
// Capturing-Listener auf der Wizard-Root reicht validateStep() bei
// jedem input/change neu durch und schreibt disabled + Hint-Text
// direkt — KEIN Full-Re-Render, sonst fliegt der Fokus aus dem Feld.
function renderWizardFooter(state, opts) {
  const footer = document.createElement('div');
  footer.className = 't-wizard-footer';
  footer.dataset.tWizardFooter = String(state.step);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 't-btn t-btn--ghost';
  back.textContent = 'Zurück';
  back.disabled = state.step === 1;
  back.addEventListener('click', () => {
    if (state.step > 1) {
      state.step--;
      notifyChange(state, opts);
      const root = getRoot();
      if (root) {
        const fresh = renderWizardView({ ...root._opts, initialState: state });
        root.parentNode?.replaceChild(fresh, root);
      }
    }
  });
  footer.appendChild(back);

  const nextWrap = document.createElement('div');
  nextWrap.className = 't-wizard-next-wrap';

  // "Weiter" auf Step 1–4, "Generieren" auf Step 5 entfällt (ist im Step selbst).
  if (state.step < 5) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 't-btn t-btn--primary';
    next.textContent = 'Weiter';
    next.dataset.tWizardNext = 'true';
    const initialValidation = validateStep(state, state.step);
    next.disabled = !initialValidation.ok;
    next.addEventListener('click', async () => {
      // Frische Validierung — state kann sich zwischen Render und Klick
      // verändert haben (durch direkte Eingabe, Drag&Drop, etc.).
      if (!validateStep(state, state.step).ok) return;

      // Step 1 → 2: Entwurf in der DB anlegen, BEVOR wir Step erhöhen.
      // Genau ein POST pro Wizard-Leben. Wenn state.tournamentId
      // schon gesetzt ist (z. B. weil blur ihn angelegt hat), ist
      // ensureDraftPromise idempotent — kein zweiter POST.
      //
      // Wichtig: Wir blockieren hier NICHT, falls der POST scheitert.
      // ensureDraftPromise wirft nicht (siehe Funktion), sondern legt
      // den Fehler in state.__draftError ab. Der User darf weiterklicken;
      // main.js onGenerate versucht es am Ende nochmal. Ein Block ist nur
      // am Ende erlaubt — dort geht es ohne Entwurf wirklich nicht.
      if (state.step === 1 && !state.tournamentId && opts.groupId) {
        next.disabled = true;
        const hintEl = footer.querySelector('[data-t-wizard-next-hint="true"]');
        if (hintEl) {
          applyHint(hintEl, {
            ok: false,
            message: 'Entwurf wird angelegt …',
          });
        }
        await ensureDraftPromise(state, opts);
        next.disabled = false;
        // Falls der POST gescheitert ist, zeigen wir den Hinweis, lassen
        // den User aber weiterklicken. Ein endgültiger Block ist nur am
        // Ende erlaubt (onGenerate in main.js).
        if (!state.tournamentId && state.__draftError && hintEl) {
          applyHint(hintEl, {
            ok: false,
            message:
              state.__draftError +
              ' Du kannst weiterklicken — der Entwurf wird beim „Turnier generieren" erneut angelegt.',
          });
        }
      }

      state.step++;
      notifyChange(state, opts);
      const root = getRoot();
      if (root) {
        const fresh = renderWizardView({ ...root._opts, initialState: state });
        root.parentNode?.replaceChild(fresh, root);
      }
    });
    nextWrap.appendChild(next);

    // Hint IMMER rendern — auch bei ok=true. Der reaktive Listener
    // auf der Wizard-Root (siehe renderWizardView) versteckt / zeigt
    // ihn und schreibt den Text passend. role="status" + aria-live
    // sorgt dafür, dass Screenreader bei jedem Tastendruck den
    // aktuellen Hinweis bekommen.
    const hint = document.createElement('div');
    hint.className = 't-wizard-next-hint';
    hint.dataset.tWizardNextHint = 'true';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    applyHint(hint, initialValidation);
    nextWrap.appendChild(hint);
  }

  footer.appendChild(nextWrap);
  return footer;
}

// ----------------------------------------------------------------
// Hint-Element reaktiv füllen / verstecken (Bug A, §13.3)
// ----------------------------------------------------------------
function applyHint(hintEl, validation) {
  if (validation.ok) {
    hintEl.hidden = true;
    hintEl.textContent = '';
  } else {
    hintEl.hidden = false;
    hintEl.textContent = validation.message;
  }
}

// ----------------------------------------------------------------
// Validierung pro Schritt
// ----------------------------------------------------------------
function validateStep(state, step) {
  switch (step) {
    case 1: {
      if (!state.name || !state.name.trim()) {
        return { ok: false, message: 'Bitte einen Turniernamen eingeben.' };
      }
      return { ok: true };
    }
    case 2: {
      if (state.teams.length < 2) {
        return { ok: false, message: 'Mindestens 2 Teams eingeben.' };
      }
      return { ok: true };
    }
    case 3: {
      // Mind. 2 Teams / Gruppe.
      if (state.teams.length < state.numGroups * 2) {
        return {
          ok: false,
          message: `Für ${state.numGroups} Gruppen brauchst du mindestens ${state.numGroups * 2} Teams.`,
        };
      }
      // Bei Nur-K.-o. ist numGroups unkritisch; Modus selbst ist gewählt.
      if (!state.mode) {
        return { ok: false, message: 'Bitte einen Turniermodus wählen.' };
      }
      return { ok: true };
    }
    case 4: {
      if (state.advancePerGroup < 1) {
        return { ok: false, message: 'Mindestens 1 Aufsteiger pro Gruppe.' };
      }
      if (state.numTables < 1) {
        return { ok: false, message: 'Mindestens 1 Tisch.' };
      }
      if (!state.startTime) {
        return { ok: false, message: 'Bitte eine Startzeit wählen.' };
      }
      return { ok: true };
    }
    case 5: return { ok: true };
    default: return { ok: true };
  }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function buildField({ label, required, input }) {
  const wrap = document.createElement('label');
  wrap.className = 't-wizard-field';
  const lab = document.createElement('span');
  lab.className = 't-wizard-field-label';
  lab.textContent = label + (required ? ' *' : '');
  wrap.appendChild(lab);
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const i = input(id);
  wrap.appendChild(i);
  return wrap;
}

function notifyChange(state, opts) {
  if (typeof opts.onStateChange === 'function') {
    opts.onStateChange(state);
  }
}

// Aktuelle Root finden — wir laufen über das DOM, weil wir die
// renderWizardView-Funktion bei jedem Refresh neu instanziieren.
function getRoot() {
  // Das aktuelle .t-mod-Wizard-Element.
  const sel = document.querySelector('.t-mod.t-wizard');
  return sel || null;
}

