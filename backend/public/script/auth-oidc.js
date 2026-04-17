// ╔══════════════════════════════════════════════════════════╗
// ║         🔐  OIDC AUTHENTICATION MODULE                  ║
// ╚══════════════════════════════════════════════════════════╝

const API_BASE = '/api';
const TOKEN_REFRESH_INTERVAL = 14 * 60 * 1000; // Refresh 1 min before expiry (15min total)

let accessToken = null;
let refreshTokenTimeout = null;

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
    startTokenRefreshTimer();
    return data.user;
  } catch (e) {
    sessionStorage.removeItem('accessToken');
    return null;
  }
}

// ── LOGIN: REDIRECT TO AUTHENTIK ────────────────────────────
export async function startOIDCLogin() {
  try {
    const response = await fetch(`${API_BASE}/auth/login`);
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
      throw new Error(err.error || 'Callback failed');
    }
    
    const { accessToken: token, user } = await response.json();
    
    // Store access token in sessionStorage (NOT localStorage for security)
    sessionStorage.setItem('accessToken', token);
    accessToken = token;
    
    // Start token refresh timer
    startTokenRefreshTimer();
    
    return user;
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
        'Authorization': `Bearer ${accessToken}`
      },
      credentials: 'include' // Include cookies (for refresh token)
    });
    
    if (!response.ok) {
      throw new Error('Token refresh failed');
    }
    
    const { accessToken: newToken } = await response.json();
    sessionStorage.setItem('accessToken', newToken);
    accessToken = newToken;
    
    return newToken;
  } catch (e) {
    console.error('Token refresh failed:', e);
    await logout();
    throw e;
  }
}

// ── AUTO-REFRESH TOKEN BEFORE EXPIRY ────────────────────────
function startTokenRefreshTimer() {
  clearTimeout(refreshTokenTimeout);
  refreshTokenTimeout = setTimeout(() => {
    refreshAccessToken().then(() => {
      startTokenRefreshTimer(); // Reschedule after refresh
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

  // Zu Authentik weiterleiten um die dortge Session zu beenden
  if (endSessionUrl) {
    window.location.href = endSessionUrl;
  }
}

// ── API CALL HELPER WITH AUTO-AUTHORIZATION ────────────────
export async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {},
    credentials: 'include' // Include cookies (for refresh token)
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
      return fetch(`${API_BASE}${endpoint}`, options).then(r => r.json());
    }
    
    if (!response.ok) {
      let serverMsg = '';
      try { const j = await response.json(); serverMsg = j.error || j.message || ''; } catch(_) {}
      const err = new Error(serverMsg || `HTTP ${response.status}`);
      err.status = response.status;
      err.serverMessage = serverMsg;
      throw err;
    }
    
    return response.json();
  } catch (e) {
    console.error(`API call failed: ${endpoint}`, e);
    throw e;
  }
}

// ── FILE UPLOAD WITH AUTO-AUTHORIZATION ────────────────────
export async function uploadFile(endpoint, file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const options = {
    method: 'POST',
    credentials: 'include'
  };
  
  // Add authorization header
  if (accessToken) {
    options.headers = {
      'Authorization': `Bearer ${accessToken}`
    };
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      body: formData
    });
    
    // Handle 401 - token expired, try refresh
    if (response.status === 401) {
      await refreshAccessToken();
      options.headers['Authorization'] = `Bearer ${accessToken}`;
      return fetch(`${API_BASE}${endpoint}`, {
        ...options,
        body: formData
      }).then(r => r.json());
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
