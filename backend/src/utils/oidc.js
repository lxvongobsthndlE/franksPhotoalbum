import crypto from 'crypto';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import https from 'https';

let discoveredConfig = null;
let initPromise = null;

// Ignoriere self-signed certificates für Development
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

async function _initializeOIDC() {
  if (discoveredConfig) return discoveredConfig;
  
  try {
    const wellKnownUrl = `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`;
    console.log('Discovering OIDC config from:', wellKnownUrl);
    
    const response = await axios.get(wellKnownUrl, {
      httpsAgent,
      timeout: 10000
    });
    discoveredConfig = response.data;
    
    console.log('✅ OIDC Client initialized');
    return discoveredConfig;
  } catch (err) {
    console.error('❌ OIDC initialization failed:', err.message);
    throw err;
  }
}

export async function initializeOIDC() {
  if (initPromise) return initPromise;
  initPromise = _initializeOIDC();
  return initPromise;
}

async function ensureInitialized() {
  if (!discoveredConfig) {
    await initializeOIDC();
  }
}

export function getAuthorizationUrl(state, nonce) {
  if (!discoveredConfig) throw new Error('OIDC not initialized - call initializeOIDC() first');
  
  const redirectUri = process.env.NODE_ENV === 'production' 
    ? process.env.OIDC_REDIRECT_URI_PROD 
    : process.env.OIDC_REDIRECT_URI_DEV;
  
  const params = new URLSearchParams({
    client_id: process.env.OIDC_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    nonce
  });
  
  return `${discoveredConfig.authorization_endpoint}?${params.toString()}`;
}

export async function handleCallback(code, state) {
  await ensureInitialized();
  
  const redirectUri = process.env.NODE_ENV === 'production' 
    ? process.env.OIDC_REDIRECT_URI_PROD 
    : process.env.OIDC_REDIRECT_URI_DEV;
  
  // Hole Token von Authentik (als form-urlencoded, nicht JSON!)
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
    redirect_uri: redirectUri
  });

  const tokenResponse = await axios.post(discoveredConfig.token_endpoint, tokenParams.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    httpsAgent,
    timeout: 10000
  });
  
  const { id_token, access_token } = tokenResponse.data;
  
  // Decode ID Token (ohne Verifizierung für jetzt)
  const idTokenDecoded = jwtDecode(id_token);
  
  return {
    claims: () => idTokenDecoded,
    id_token,
    access_token
  };
}

export function getEndSessionUrl(idToken, postLogoutRedirectUri) {
  if (!discoveredConfig?.end_session_endpoint) return null;
  const params = new URLSearchParams({ post_logout_redirect_uri: postLogoutRedirectUri });
  if (idToken) params.set('id_token_hint', idToken);
  return `${discoveredConfig.end_session_endpoint}?${params.toString()}`;
}
