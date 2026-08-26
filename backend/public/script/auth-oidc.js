// ╔══════════════════════════════════════════════════════════╗
// ║         🔐  OIDC AUTHENTICATION MODULE                  ║
// ╚══════════════════════════════════════════════════════════╝

const API_BASE = '/api';
const TOKEN_REFRESH_INTERVAL = 14 * 60 * 1000; // Refresh 1 min before expiry (15min total)

let accessToken = null;
let refreshTokenTimeout = null;

// ── SITZUNGSENDE ────────────────────────────────────────────
// Punkt 4.2 der Uebergabe (turniermodul-uebergabe.md), gefixt am
// 2026-08-25. Vorher endete ein gescheiterter Refresh in
// `await logout()` — und logout() setzt `window.location.href`.
// Am Turniertag hiess das: Ergebnis-Dialog offen, 3:2 getippt,
// Refresh-Cookie abgelaufen → Weiterleitung zu Authentik, Eingabe
// weg, ohne Meldung und ohne Rueckfrage.
//
// Jetzt entscheidet das UI, wann umgeleitet wird. Dieses Modul
// meldet nur: „die Sitzung ist zu Ende" — und faehrt sonst nichts
// herunter. Der Redirect passiert erst in `forceReauth()`, also
// nachdem der Nutzer zugestimmt und das UI seine Eingaben
// gesichert hat.
let sessionExpired = false;
const sessionExpiredHandlers = new Set();

/** Meldet das Sitzungsende genau EINMAL je Ablauf. */
function notifySessionExpired(reason) {
  if (sessionExpired) return;
  sessionExpired = true;
  for (const fn of sessionExpiredHandlers) {
    try {
      fn({ reason });
    } catch (e) {
      console.error('session-expired handler failed:', e);
    }
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('auth:session-expired', { detail: { reason } }));
    } catch (e) {
      /* CustomEvent fehlt (aelterer Browser) — die Handler oben haben schon gefeuert */
    }
  }
}

/**
 * Meldet einen Horcher an, der beim Sitzungsende gerufen wird.
 * Rueckgabe: Funktion zum Abmelden.
 */
export function onSessionExpired(fn) {
  if (typeof fn !== 'function') return () => {};
  sessionExpiredHandlers.add(fn);
  return () => sessionExpiredHandlers.delete(fn);
}

export function isSessionExpired() {
  return sessionExpired;
}

/**
 * Der bewusste Weg zur Neu-Anmeldung. Nur HIER wird umgeleitet —
 * und nur, weil jemand es ausgeloest hat.
 */
export async function forceReauth() {
  await logout();
}

// ── CHECK LOGIN STATUS ──────────────────────────────────────
export async function checkSession() {
  try {
    const stored = sessionStorage.getItem('accessToken');
    if (!stored) return null;

    accessToken = stored;

    // Verify token is still valid by calling /me endpoint
    const data = await apiCall('/auth/me', 'GET');
    if (!data || !data.user) {
      sessionStorage.removeItem('accessToken');
      return null;
    }

    // Start refresh timer
    sessionExpired = false;
    startTokenRefreshTimer();
    return data.user;
  } catch (e) {
    sessionStorage.removeItem('accessToken');
    return null;
  }
}

// ── LOGIN: REDIRECT TO AUTHENTIK ────────────────────────────
export async function startOIDCLogin(inviteToken = null, options = {}) {
  try {
    const params = new URLSearchParams();
    if (typeof inviteToken === 'string' && inviteToken.trim()) {
      params.set('invite', inviteToken.trim());
    }
    if (typeof options?.feedPostId === 'string' && options.feedPostId.trim()) {
      params.set('feedPost', options.feedPostId.trim());
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE}/auth/login${query}`);
    const { loginUrl } = await response.json();

    if (!loginUrl) throw new Error('No login URL returned');

    // Redirect to Authentik login page
    window.location.href = loginUrl;
  } catch (e) {
    console.error('Login failed:', e);
    throw e;
  }
}

// ── HANDLE CALLBACK FROM AUTHENTIK ──────────────────────────
export async function handleOIDCCallback(code, state) {
  try {
    const response = await fetch(`${API_BASE}/auth/callback?code=${code}&state=${state}`);

    if (!response.ok) {
      const err = await response.json();
      const callbackError = new Error(err.error || 'Callback failed');
      callbackError.status = response.status;
      throw callbackError;
    }

    const { accessToken: token, user, inviteResult, loginContext } = await response.json();

    // Store access token in sessionStorage (NOT localStorage for security)
    sessionStorage.setItem('accessToken', token);
    accessToken = token;

    // Start token refresh timer
    sessionExpired = false;
    startTokenRefreshTimer();

    return { user, inviteResult, loginContext };
  } catch (e) {
    console.error('Callback processing failed:', e);
    throw e;
  }
}

// ── REFRESH ACCESS TOKEN ────────────────────────────────────
async function refreshAccessToken() {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include', // Include cookies (for refresh token)
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const { accessToken: newToken } = await response.json();
    sessionStorage.setItem('accessToken', newToken);
    accessToken = newToken;
    sessionExpired = false;

    return newToken;
  } catch (e) {
    console.error('Token refresh failed:', e);
    // HIER stand der Zwangs-Logout. logout() setzt window.location.href —
    // die Seite war weg, bevor irgendwer etwas melden oder sichern
    // konnte. Stattdessen: melden und einen erkennbaren Fehler werfen.
    // Wer umleiten will, ruft forceReauth().
    const err = new Error('Deine Anmeldung ist abgelaufen.');
    err.code = 'session_expired';
    err.serverMessage = 'Deine Anmeldung ist abgelaufen. Bitte neu anmelden.';
    err.serverCode = 'session_expired';
    err.status = 401;
    err.cause = e;
    notifySessionExpired('refresh_failed');
    throw err;
  }
}

// ── AUTO-REFRESH TOKEN BEFORE EXPIRY ────────────────────────
function startTokenRefreshTimer() {
  clearTimeout(refreshTokenTimeout);
  refreshTokenTimeout = setTimeout(() => {
    refreshAccessToken()
      .then(() => {
        startTokenRefreshTimer(); // Reschedule after refresh
      })
      .catch(() => {
        // Ohne diesen catch war das eine unbehandelte Rejection —
        // und weil refreshAccessToken frueher selbst ausgeloggt hat,
        // flog der Nutzer mitten in der Arbeit raus, ausgeloest von
        // einem Timer, den er nicht gestartet hat.
        //
        // notifySessionExpired() ist in refreshAccessToken schon
        // gelaufen; das UI zeigt seinen Dialog. Kein neuer Timer:
        // der Refresh-Cookie ist abgelaufen, ein zweiter Versuch in
        // 14 Minuten waere nur eine weitere Absage.
      });
  }, TOKEN_REFRESH_INTERVAL);
}

// ── LOGOUT ──────────────────────────────────────────────────
export async function logout() {
  // Hole Authentik End-Session-URL bevor wir den Token löschen
  let endSessionUrl = null;
  try {
    const data = await apiCall('/auth/logout-url', 'GET');
    endSessionUrl = data.endSessionUrl || null;
  } catch (e) {
    console.warn('logout-url abrufen fehlgeschlagen:', e);
  }

  // Lokalen Logout durchführen (Cookies löschen)
  try {
    await apiCall('/auth/logout', 'POST');
  } catch (e) {
    console.warn('Logout API call failed:', e);
  } finally {
    sessionStorage.removeItem('accessToken');
    accessToken = null;
    clearTimeout(refreshTokenTimeout);
  }

  // Zu Authentik weiterleiten um die dortige Session zu beenden,
  // oder Fallback auf App-Root damit die UI den Login-Screen zeigt
  window.location.href = endSessionUrl || '/';
}

async function parseApiResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── API CALL HELPER WITH AUTO-AUTHORIZATION ────────────────
export async function apiCall(endpoint, method = 'GET', body = null, extra = {}) {
  const options = {
    method,
    headers: { ...(extra?.headers || {}) },
    credentials: 'include', // Include cookies (for refresh token)
  };

  // Add authorization header
  if (accessToken) {
    options.headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Add body if present (only set Content-Type when there is a body)
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);

    // Handle 401 - token expired, try refresh
    if (response.status === 401) {
      await refreshAccessToken();
      options.headers['Authorization'] = `Bearer ${accessToken}`;
      const retryResponse = await fetch(`${API_BASE}${endpoint}`, options);
      if (!retryResponse.ok) {
        let serverMsg = '';
        let serverCode = '';
        try {
          const j = await parseApiResponse(retryResponse);
          serverMsg = j?.message || j?.error || '';
          serverCode = j?.code || '';
        } catch (_) {}
        const err = new Error(serverMsg || `HTTP ${retryResponse.status}`);
        err.status = retryResponse.status;
        err.serverMessage = serverMsg;
        err.serverCode = serverCode;
        throw err;
      }
      return parseApiResponse(retryResponse);
    }

    if (!response.ok) {
      let serverMsg = '';
      let serverCode = '';
      try {
        const j = await response.json();
        // Reihenfolge ist wichtig und darf nicht gedreht werden: die
        // Turnier-Routen antworten mit { error: '<code>', message:
        // '<deutscher Satz>' }. Wer `error` zuerst nimmt, zeigt dem
        // Nutzer `groups_locked` statt der Meldung. handleError()
        // liefert nur `error` — dort steht der Text drin, also greift
        // der Fallback.
        serverMsg = j.message || j.error || '';
        serverCode = j.code || '';
      } catch (_) {}
      const err = new Error(serverMsg || `HTTP ${response.status}`);
      err.status = response.status;
      err.serverMessage = serverMsg;
      err.serverCode = serverCode;
      throw err;
    }

    return parseApiResponse(response);
  } catch (e) {
    console.error(`API call failed: ${endpoint}`, e);
    throw e;
  }
}

// ── FETCH HELPER WITH AUTO-AUTHORIZATION (for blobs/streams) ───────────────
export async function fetchWithAuth(endpoint, options = {}) {
  const url = endpoint.startsWith('/api/') ? endpoint : `${API_BASE}${endpoint}`;
  const requestOptions = {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  };

  if (accessToken && !requestOptions.headers.Authorization) {
    requestOptions.headers.Authorization = `Bearer ${accessToken}`;
  }

  // Ein String-Body ist bei uns immer JSON. Ohne Content-Type setzt der
  // Browser `text/plain`, und Fastify hat dafür keinen Parser — die
  // Antwort ist dann 415, obwohl der Aufruf inhaltlich korrekt ist.
  // FormData/Blob bleiben unangetastet: dort muss der Browser die
  // Boundary selbst setzen.
  const hasContentType = Object.keys(requestOptions.headers).some(
    (h) => h.toLowerCase() === 'content-type'
  );
  if (typeof requestOptions.body === 'string' && !hasContentType) {
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  let response = await fetch(url, requestOptions);
  if (response.status === 401) {
    await refreshAccessToken();
    requestOptions.headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(url, requestOptions);
  }
  return response;
}

// ── FILE UPLOAD WITH AUTO-AUTHORIZATION ────────────────────
export async function uploadFile(endpoint, file) {
  const formData = new FormData();
  formData.append('file', file);

  const options = {
    method: 'POST',
    credentials: 'include',
  };

  // Add authorization header
  if (accessToken) {
    options.headers = {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      body: formData,
    });

    // Handle 401 - token expired, try refresh
    if (response.status === 401) {
      await refreshAccessToken();
      options.headers['Authorization'] = `Bearer ${accessToken}`;
      return fetch(`${API_BASE}${endpoint}`, {
        ...options,
        body: formData,
      }).then((r) => r.json());
    }

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    return response.json();
  } catch (e) {
    console.error(`Upload failed: ${endpoint}`, e);
    throw e;
  }
}

// ── GET CURRENT ACCESS TOKEN (for debugging) ────────────────
export function getAccessToken() {
  return accessToken;
}
