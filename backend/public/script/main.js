import { checkSession, startOIDCLogin, handleOIDCCallback, logout, apiCall } from './auth-oidc.js';

// ╔══════════════════════════════════════════════════════════╗
// ║         🔐  OIDC AUTHENTICATION (via auth-oidc.js)      ║
// ╚══════════════════════════════════════════════════════════╝

// Supabase compatibility stub (for phased migration)
// Must support chaining: sb.from('x').select('*').eq('a','b').order('c').range(0,10)
function makeChain() {
  // A thenable object that also has all query builder methods
  const result = { data: [], count: 0, error: null };
  const chain = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (fn) => Promise.resolve(result).catch(fn),
    finally: (fn) => Promise.resolve(result).finally(fn),
    select: () => makeChain(),
    insert: () => makeChain(),
    update: () => makeChain(),
    delete: () => makeChain(),
    upsert: () => makeChain(),
    eq: () => makeChain(),
    neq: () => makeChain(),
    in: () => makeChain(),
    order: () => makeChain(),
    range: () => makeChain(),
    single: () => makeChain(),
    limit: () => makeChain(),
    filter: () => makeChain(),
    match: () => makeChain(),
  };
  return chain;
}

window.sb = {
  from: () => makeChain(),
  rpc: () => Promise.resolve({data:null, error:'Supabase stub'}),
  storage: {from: () => ({upload: ()=>Promise.resolve({error:null}), createSignedUrl: ()=>Promise.resolve({data:null}), createSignedUrls: ()=>Promise.resolve({data:[]}), remove: ()=>Promise.resolve({error:null})})}
};

const SHARED  = 'gemeinsam';
const MAX_USR = 10;
const PG_SIZE = 24;
const SIGNED_URL_EXPIRES = 3600;
const COLORS  = ['#b07448','#5a9e7a','#6888d4','#c86888','#8868c8','#4aacb8','#c8a048','#7888c8','#a8c858','#c87848'];

let me, meProfile, curFolder = SHARED, curAlbum = null, curFilter = null;
let curView = 'medium';
let curSort = 'newest';
let selectMode = false, selectedIds = new Set();
let curGroupId = null, myGroups = [], groupMembers = [];
let curFilterUserId = null;
let allProfiles = {}, photos = [], pgFrom = 0, hasMore = false;
let allAlbums = [];
let urlCache = {};
let lbIdx = 0, delTarget = null, delFromLb = false;

// Hängt den Access-Token als ?t= an Foto-URLs (nötig da <img src> keinen Auth-Header sendet)
function photoSrc(url) {
  if (!url) return url;
  const t = sessionStorage.getItem('accessToken');
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t);
}
let ssPlaying = false, ssTimer = null, ssSpeeds = [3,4,6,8], ssSpeedIdx = 1;
let lbLiked = false, lbLikeCount = 0, lbComments = [], lbLikers = [];


// ── SVG ICONS (dedupliziert) ────────────────────────────
const _heart = (s,f) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const ICON_HEART_EMPTY = _heart(14,false);
const ICON_HEART_FULL  = _heart(14,true);
const ICON_HEART_LG_EMPTY = _heart(18,false);
const ICON_HEART_LG_FULL  = _heart(18,true);
const ICON_COMMENT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_TRASH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICON_DOWNLOAD = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_SEND = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const ICON_ALBUM_MANAGE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_ALBUM = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const ICON_PLUS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const ICON_GRID = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>`;
const ICON_GEAR = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_UPLOAD = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const ICON_HAMBURGER = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
const ICON_FULLSCREEN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const ICON_SHRINK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

// ── TOAST NOTIFICATIONS ─────────────────────────────────
function toast(msg, type='info') {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

// ── BOOT ─────────────────────────────────────────────────
window.addEventListener('load', async () => {
  hide('loading');
  show('auth-page');
  
  // Check if we're returning from OIDC callback
  const params = new URLSearchParams(window.location.search);
  if (params.has('code')) {
    const code = params.get('code');
    const state = params.get('state');
    
    try {
      // Process OIDC callback
      const user = await handleOIDCCallback(code, state);
      me = user;
      
      // Clean up URL (remove code/state params)
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Start app
      await startApp();
      return;
    } catch (e) {
      console.error('OIDC callback failed:', e);
      showMsg('login-msg', 'error', '❌ Authentifizierung fehlgeschlagen. Versuche es erneut.');
      return;
    }
  }
  
  // Check if already logged in
  const session = await checkSession();
  if (session && session.id) {
    me = session;
    try {
      await startApp();
      return;
    } catch (e) {
      console.error('App start failed:', e);
      await logout();
    }
  }
  
  // Not logged in, show login page
  show('auth-page');
});

// Make startOIDCLogin available globally for the HTML onclick handler
window.startOIDCLogin = startOIDCLogin;

// ── AUTH (OIDC - via auth-oidc.js) ──────────────────────
function toLogin()  { hide('reg-card'); hide('forgot-card'); show('login-card'); }
function toReg()    { /* Registration disabled - use Authentik instead */ }
function toForgot() { /* Forgot password disabled - use Authentik instead */ }

async function doLogout() {
  await logout();
  me = null;
  meProfile = null;
  photos = [];
  urlCache = {};
  $('app').classList.remove('show');
  show('auth-page');
  toLogin();
}

// ── APP START ─────────────────────────────────────────────
async function startApp() {
  hide('auth-page');
  $('app').classList.add('show');
  
  if (!me || !me.email) {
    toast('Authentifizierung fehlgeschlagen', 'error');
    hide('app'); show('auth-page');
    return;
  }
  
  // Set user profile UI
  meProfile = me;
  const avElement = $('hav');
  if (avElement) {
    if (me.avatar) {
      avElement.innerHTML = `<img class="av-img" src="${esc(me.avatar)}">`;
    } else {
      avElement.textContent = (me.name || me.email)[0].toUpperCase();
      avElement.style.background = me.color || '#8a6a4a';
    }
  }
  
  const nameElement = $('hname');
  if (nameElement) {
    nameElement.textContent = me.name || me.email;
  }
  
  updateMobileAv();
  
  // Load basic UI (albums, etc. - for now kept simple)
  curFolder = SHARED;
  curAlbum = null;
  curFilter = null;
  
  $('gal-title').textContent = folderTitle();
  
  // Initialize other UI elements
  const sb2 = $('send-btn'); 
  if (sb2) sb2.innerHTML = ICON_SEND;
  
  updateThemeIcon();
  
  // Gruppe laden (Auto-Create falls keine vorhanden)
  try {
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || [];
    if (myGroups.length > 0) {
      // Letzte aktive Gruppe wiederherstellen
      const saved = localStorage.getItem('activeGroup');
      curGroupId = (saved && myGroups.find(g => g.id === saved)) ? saved : myGroups[0].id;
    }
  } catch(e) {
    console.error('Gruppen laden fehlgeschlagen:', e);
  }

  // Gruppenmmitglieder laden (für Sidebar)
  if (curGroupId) {
    try {
      const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
      groupMembers = members || [];
      groupMembers.forEach(m => { allProfiles[m.id] = m; });
      // Aktuellen User vorne
      groupMembers.sort((a, b) => {
        if (a.id === me.id) return -1;
        if (b.id === me.id) return 1;
        return (a.name||'').localeCompare(b.name||'');
      });
    } catch(e) { console.warn('Mitglieder laden fehlgeschlagen:', e); }
  }

  // Alben laden
  if (curGroupId) await loadAlbums();

  renderGroupSwitcher();
  // Sidebar asynchron rendern (blockiert App-Start nicht)
  setTimeout(() => renderSidebar(), 100);

  // Fotos laden
  if (curGroupId) await loadPhotos(true);
  else toast('Keine Gruppe gefunden – ein Album wird automatisch erstellt.', 'info');
}

async function loadHeaderAvatar() {
  updateMobileAv();
  if (!meProfile?.avatar) return;
  const av = $('hav');
  if (av) av.innerHTML = `<img class="av-img" src="${esc(meProfile.avatar)}">`;
}

// ── SIGNED URLS / PHOTO LOADING ──────────────────────────
// Gibt die Presigned URL aus dem URL-Cache zurück (befüllt von loadPhotos)
function getSignedUrl(photoId) {
  return urlCache[photoId] || null;
}

async function loadSignedUrls(list) {
  // No-op – URLs kommen direkt aus dem API-Response
}

// ── SIDEBAR ──────────────────────────────────────────────
function renderSidebar() {
  // Albums list — always show "Neues Album" first, then existing albums
  const albumsListHtml = allAlbums.map(a=>`
    <button class="fb ${curAlbum===a.id?'active':''}" onclick="switchAlbum('${a.id}')">
      <span class="fi">${ICON_ALBUM}</span>
      <span class="fn">${esc(a.name)}</span>
      <span class="fc" id="fc-a-${a.id}">…</span>
    </button>`).join('');

  // Members list (exclude self, already shown as "Meine Fotos")
  const otherMembers = groupMembers.filter(m => m.id !== me.id);
  const membersHtml = otherMembers.map(m => `
    <button class="fb ${curFilterUserId===m.id?'active':''}" onclick="switchToUser('${m.id}')">
      <span class="fi">${avatarHtml(m, 20)}</span>
      <span class="fn">${esc(m.name||'?')}</span>
    </button>`).join('');

  $('sidebar').innerHTML = `
    <span class="sb-label">Fotos</span>
    <button class="fb ${!curAlbum&&!curFilter&&!curFilterUserId?'active':''}" onclick="switchFolder(null)">
      <span class="fi">${ICON_GRID}</span>
      <span class="fn">Alle Fotos</span>
      <span class="fc" id="fc-all">…</span>
    </button>
    <button class="fb ${curFilter==='mine'&&!curAlbum?'active':''}" onclick="switchFolder('mine')">
      <span class="fi">${avatarHtml(meProfile, 20)}</span>
      <span class="fn">Meine Fotos</span>
      <span class="fc" id="fc-mine">…</span>
    </button>
    <button class="fb" onclick="openSS()${window.innerWidth<=900?';closeSidebar()':''}">
      <span class="fi">${ICON_PLAY}</span>
      <span class="fn">Diashow</span>
    </button>
    <div class="sb-div"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 4px">
      <span class="sb-label" style="padding:0">Alben</span>
      <button onclick="openNewAlbumInline()" title="Neues Album" style="background:none;border:none;cursor:pointer;color:var(--accent);display:flex;align-items:center;padding:2px;border-radius:6px;transition:background .15s" onmouseover="this.style.background='var(--accent-l)'" onmouseout="this.style.background='none'">
        ${ICON_PLUS}
      </button>
    </div>
    <div id="new-album-inline" class="hidden" style="padding:6px 10px">
      <div style="display:flex;gap:6px">
        <input id="new-album-sb-input" type="text" placeholder="Albumname…" maxlength="40"
          style="flex:1;padding:7px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);font-size:13px;outline:none;font-family:inherit"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter')createAlbumInline();if(event.key==='Escape')closeNewAlbumInline()">
        <button onclick="createAlbumInline()" style="background:var(--accent);border:none;color:#fff;padding:7px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">✓</button>
        <button onclick="closeNewAlbumInline()" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:7px 9px;border-radius:8px;cursor:pointer;font-size:13px">✕</button>
      </div>
    </div>
    ${albumsListHtml}
    <button class="fb" onclick="openAlbumModal()${window.innerWidth<=900?';closeSidebar()':''}">
      <span class="fi">${ICON_ALBUM_MANAGE}</span>
      <span class="fn">Alben verwalten</span>
    </button>
    ${otherMembers.length ? `
      <div class="sb-div"></div>
      <span class="sb-label">Mitglieder</span>
      ${membersHtml}
    ` : ''}
    <div class="sb-div"></div>
    <span class="sb-label">Gruppen</span>
    <button class="fb" onclick="openJoinGroup();closeSidebar()">
      <span class="fi" style="color:var(--accent)">${ICON_PLUS}</span>
      <span class="fn" style="color:var(--accent)">Gruppe beitreten</span>
    </button>
    <button class="fb" onclick="openLeaveGroup();closeSidebar()">
      <span class="fi" style="color:var(--red)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
      <span class="fn" style="color:var(--red)">Gruppe verlassen</span>
    </button>
    <button class="fb" onclick="showGroupCode()">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg></span>
      <span class="fn">Einladungscode anzeigen</span>
    </button>
    ${window.innerWidth <= 900 && myGroups.length > 1 ? `
    <div class="sb-div"></div>
    <span class="sb-label">Gruppe wechseln</span>
    ${myGroups.map(g=>`
    <button class="fb ${g.id===curGroupId?'active':''}" onclick="switchGroup('${g.id}');closeSidebar()">
      <span class="fi" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
      <span class="fn">${esc(g.name)}</span>
    </button>`).join('')}` : ''}
    ${me.role === 'admin' ? `
    <div class="sb-div"></div>
    <span class="sb-label">Admin</span>
    <button class="fb" onclick="openAdminUsers()">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
      <span class="fn">Benutzer verwalten</span>
    </button>
    <button class="fb" onclick="openAdminGroups()">
      <span class="fi">${ICON_GEAR}</span>
      <span class="fn">Gruppen verwalten</span>
    </button>` : ''}
    <div class="sb-div"></div>
    <div style="padding:6px 14px;display:flex;align-items:center;gap:8px">
      <button class="theme-btn" id="theme-btn" onclick="toggleDarkMode()" title="Dark Mode" style="width:32px;height:32px">
        <svg id="theme-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <span style="font-size:12px;color:var(--muted);font-weight:400">Nachtmodus</span>
    </div>
  `;
  loadSidebarAvatars();
  // Load counts asynchronously (don't block sidebar rendering)
  try {
    fetchCounts();
    allAlbums.forEach(a => fetchAlbumCount(a.id));
  } catch (e) {
    console.warn('Error fetching sidebar counts:', e);
  }
  updateThemeIcon();
  // Only on mobile: append profile + logout + groups at bottom of sidebar
  if (window.innerWidth <= 900) {
    const sb2 = $('sidebar');
    const div = document.createElement('div');
    div.id = 'sb-mobile-extra';
    div.innerHTML = `
      <div class="sb-div">
      <div style="padding:10px 14px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="sb-profile-btn" onclick="openProfileModal();closeSidebar()" style="flex:1">
            <div class="av" style="background:${meProfile.color};width:32px;height:32px;font-size:13px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;border-radius:50%;overflow:hidden">${avatarHtml(meProfile, 32)}</div>
            <span>${esc(meProfile.name)}</span>
          </button>
        </div>
        <button class="sb-logout-btn" onclick="doLogout()" style="width:100%;text-align:center">Abmelden</button>
      </div>`;
    sb2.appendChild(div);
  }
}

async function fetchAlbumCount(albumId) {
  if (_cachedAlbumCounts && _cachedAlbumCounts[albumId] !== undefined) {
    const el = document.getElementById('fc-a-'+albumId);
    if (el) el.textContent = _cachedAlbumCounts[albumId]??'…';
    return;
  }
  // Anzahl aus allAlbums._count (kommt vom API)
  const a = allAlbums.find(x=>x.id===albumId);
  const el = document.getElementById('fc-a-'+albumId);
  if (el && a?._count) el.textContent = a._count.photos??'…';
}

let _cachedAlbumCounts = null;
let _cachedTotalAll  = null;
let _cachedTotalMine = null;

function invalidateCounts() {
  _cachedTotalAll = null;
  _cachedTotalMine = null;
}

async function fetchCounts() {
  try {
    // Mine-Count: nur wenn noch nicht gecacht
    if (_cachedTotalMine === null) {
      const mineRes = await apiCall(`/photos?groupId=${curGroupId}&uploaderId=${me.id}&limit=1`, 'GET');
      _cachedTotalMine = mineRes.total ?? 0;
    }
    const elAll  = document.getElementById('fc-all');  if(elAll && _cachedTotalAll  !== null) elAll.textContent  = _cachedTotalAll;
    const elMine = document.getElementById('fc-mine'); if(elMine) elMine.textContent = _cachedTotalMine ?? '…';
    // Album counts aus allAlbums._count
    allAlbums.forEach(a => {
      const el = document.getElementById('fc-a-'+a.id);
      if (el) el.textContent = a._count?.photos ?? '…';
    });
  } catch(e) { /* counts not critical */ }
}

async function loadSidebarAvatars() {
  // No-op: avatarHtml() is used directly in renderSidebar() now
}
async function switchFolder(f) { curAlbum=null; curFilter=f; curFilterUserId=null; closeSidebar(); renderSidebar(); await loadPhotos(true); }
async function switchAlbum(id) { curAlbum=id; curFilter=null; curFilterUserId=null; closeSidebar(); renderSidebar(); await loadPhotos(true); }

// ── GALLERY ──────────────────────────────────────────────
function folderTitle() {
  if (curAlbum) { const a=allAlbums.find(x=>x.id===curAlbum); return a?.name??'Album'; }
  if (curFilterUserId) { const p=allProfiles[curFilterUserId]; return p ? `Fotos von ${p.name}` : 'Fotos'; }
  if (curFilter==='mine') return 'Meine Fotos';
  return 'Alle Fotos';
}
function canUpload() { return true; }

async function switchToUser(userId) {
  curAlbum = null; curFilter = null; curFilterUserId = userId;
  closeSidebar(); renderSidebar(); await loadPhotos(true);
}

async function loadPhotos(reset=false) {
  if (reset) { photos=[]; pgFrom=0; hasMore=false; if(selectMode) toggleSelectMode(); }
  if (reset) {
    $('grid').innerHTML='<div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }
  hide('empty'); hide('more-btn');
  $('gal-title').textContent = folderTitle();
  $('upload-btn').style.display = canUpload()?'':'none';
  // Show album action button if in album view
  const albumAddBtn = document.getElementById('album-add-btn');
  if (curAlbum) {
    if (!albumAddBtn) {
      const btn = document.createElement('button');
      btn.id = 'album-add-btn';
      btn.className = 'btn-ghost btn';
      btn.style.cssText = 'padding:5px 10px;font-size:11px;gap:4px;display:flex;align-items:center;border:1px solid var(--border);border-radius:7px;color:var(--muted)';
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Hinzufügen`;
      btn.onclick = openAddFromAll;
      $('upload-btn').after(btn);
    }
    // Add gear/rename button
    if (!document.getElementById('album-rename-btn')) {
      const gear = document.createElement('button');
      gear.id = 'album-rename-btn';
      gear.className = 'btn-ghost btn';
      gear.title = 'Album umbenennen';
      gear.style.cssText = 'padding:5px 7px;font-size:11px;display:flex;align-items:center;border:1px solid var(--border);border-radius:7px;color:var(--muted)';
      gear.innerHTML = ICON_GEAR;
      gear.onclick = openRenameAlbum;
      $('upload-btn').after(gear);
    }
  } else {
    if (albumAddBtn) albumAddBtn.remove();
    const gear = document.getElementById('album-rename-btn');
    if (gear) gear.remove();
  }
  if (!curGroupId) { renderGrid(0); return; }

  const params = new URLSearchParams({
    groupId: curGroupId,
    skip:    pgFrom,
    limit:   PG_SIZE,
    order:   curSort === 'oldest' ? 'asc' : 'desc',
  });
  if (curAlbum)          params.set('albumId',    curAlbum);
  else if (curFilterUserId) params.set('uploaderId', curFilterUserId);
  else if (curFilter === 'mine') params.set('uploaderId', me.id);

  try {
    const res = await apiCall(`/photos?${params}`, 'GET');
    const data = res.photos || [];

    // Gesamtzahl aus Haupt-Response cachen → kein extra Count-Request nötig
    if (reset && res.total !== undefined) {
      if (!curAlbum && !curFilter && !curFilterUserId) _cachedTotalAll  = res.total;
      else if (curFilter === 'mine')                   _cachedTotalMine = res.total;
    }

    // URL-Cache befüllen: photoId → presigned URL
    data.forEach(p => { if (p.url) urlCache[p.id] = p.url; });

    let appendFrom = 0;
    if (data.length) {
      appendFrom = reset ? 0 : photos.length;
      photos = reset ? data : [...photos, ...data];
      if (curSort === 'most-likes')    photos.sort((a,b) => (b._likes||0)-(a._likes||0));
      else if (curSort === 'most-comments') photos.sort((a,b) => (b._comments||0)-(a._comments||0));
      hasMore = res.hasMore || false;
      pgFrom  = photos.length;
    } else if (reset) {
      hasMore = false;
    }
    renderGrid(appendFrom);
  } catch(err) {
    console.error('Fotos laden fehlgeschlagen:', err);
    renderGrid(0);
  }
}

// Counts kommen direkt vom API-Response (_likes, _comments, _liked) – kein Extra-Fetch nötig
async function enrichPhotos(list) { /* no-op */ }

let _loadingMore = false;
async function loadMore() {
  if (!hasMore || _loadingMore) return;
  _loadingMore = true;
  $('more-btn').textContent='Lädt…';
  show('more-btn');
  await loadPhotos(false);
  _loadingMore = false;
}

function initInfiniteScroll() {
  const content = $('content');
  if (!content) return;
  content.addEventListener('scroll', () => {
    if (!hasMore || _loadingMore) return;
    const {scrollTop, scrollHeight, clientHeight} = content;
    if (scrollTop + clientHeight >= scrollHeight - 400) {
      loadMore();
    }
  });
}

function renderEmptyState() {
  const icon = $('empty-icon');
  const text = $('empty-text');
  const actions = $('empty-actions');
  if (curAlbum) {
    const a = allAlbums.find(x=>x.id===curAlbum);
    if(icon) icon.textContent = '🖼';
    if(text) text.textContent = `Das Album „${a?.name||'Album'}" ist noch leer.`;
    if(actions) actions.innerHTML = `
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;font-weight:300">Füge Fotos aus deiner Sammlung oder direkt vom Gerät hinzu.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="btn" style="background:var(--accent);color:#fff;padding:11px 22px;border-radius:11px;font-size:14px;font-weight:600;border:none;display:flex;align-items:center;gap:8px" onclick="openAddFromAll()">
          ${ICON_GRID}
          Aus allen Fotos
        </button>
        <button class="btn" style="background:var(--accent-l);color:var(--accent);border:1.5px solid #dcc0a0;padding:11px 22px;border-radius:11px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px" onclick="openModal()">
          ${ICON_UPLOAD}
          Vom Gerät hochladen
        </button>
      </div>`;
  } else {
    if(icon) icon.textContent = '🌿';
    if(text) text.textContent = 'Noch keine Fotos – lade das erste hoch!';
    if(actions) actions.innerHTML = `<button class="btn" style="background:var(--accent-l);color:var(--accent);border:1.5px solid #dcc0a0;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:600;margin-top:4px" onclick="openModal()">＋ Foto hochladen</button>`;
  }
}

// ── VIEW SWITCHER ────────────────────────────────────────
const VIEW_ICONS = {
  small: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`,
  medium: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="14" rx="1.5"/><rect x="9" y="1" width="6" height="14" rx="1.5"/></svg>`,
  large: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>`,
  list: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="1" y1="4" x2="15" y2="4"/><line x1="1" y1="8" x2="15" y2="8"/><line x1="1" y1="12" x2="15" y2="12"/></svg>`
};
const VIEW_LABELS = {small:'Klein',medium:'Mittel',large:'Groß',list:'Liste'};

function renderViewSwitcher() {
  const el = $('view-select');
  if (el) el.value = curView;
}

function switchView(v) {
  curView = v;
  const g = $('grid');
  g.className = 'grid view-' + v;
  renderViewSwitcher();
  document.querySelectorAll('.p-card').forEach((card, i) => {
    card.classList.remove('visible');
    setTimeout(() => card.classList.add('visible'), i * 50);
  });
}

function renderGrid(appendFrom=0) {
  const g=$('grid');
  if (!photos.length) { g.innerHTML=''; g.className='grid'; renderEmptyState(); show('empty'); hide('more-btn'); return; }
  hide('empty');
  g.className = 'grid view-' + curView;

  const startIdx = appendFrom > 0 ? appendFrom : 0;
  const photosToRender = appendFrom > 0 ? photos.slice(appendFrom) : photos;

  const html = photosToRender.map((p, idx) => {
    const i = startIdx + idx;
    const u=allProfiles[p.uploaderId]||{};
    const url=urlCache[p.id]||'';
    const canDel=p.uploaderId===me.id;
    const liked=p._liked||false;
    const likes=p._likes||0;
    const comms=p._comments||0;
    return `<div class="p-card${selectedIds.has(p.id)?' selected':''}" id="pc-${p.id}" onclick="if(window.selectMode){event.stopPropagation();toggleCardSelect('${p.id}',this)}else{openLB(${i})}">
      <div class="p-thumb">
        <div class="sel-check" onclick="event.stopPropagation();toggleCardSelect('${p.id}',this.closest('.p-card'))">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        ${url?`<img src="${esc(photoSrc(url))}" alt="" loading="lazy" class="loading" onload="onThumbLoad(this)">`:`<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="spinner"></div></div>`}
        <div class="p-ov">
          <div class="p-ov-stats">
            <span class="p-ov-stat">${ICON_HEART_LG_EMPTY} ${likes}</span>
            <span class="p-ov-stat">${ICON_COMMENT} ${comms}</span>
          </div>
          ${p.description?`<div class="p-ov-desc">${esc(p.description)}</div>`:''}
        </div>
      </div>
      <div class="p-meta">
        ${p.description?`<div class="p-desc">${esc(p.description)}</div>`:''}
        <div class="p-top">
          <span class="dot" style="background:${esc(u.color||'#888')}"></span>
          <span class="p-who">${esc(u.name||'?')}</span>
          <span class="p-dt">${fmtDate(p.created_at)}</span>
        </div>
        <div class="p-actions">
          <button class="p-like-btn${liked?' liked':''}" onclick="event.stopPropagation();doLike('${p.id}')">
            <span class="heart">${liked?ICON_HEART_FULL:ICON_HEART_EMPTY}</span> ${likes>0?`<span>${likes}</span>`:''}
          </button>
          ${comms>0?`<span class="p-comment-count">${ICON_COMMENT}<span>${comms}</span></span>`:''}
          ${canDel?`<button class="p-del" onclick="event.stopPropagation();askDel('${p.id}',false)">${ICON_TRASH}</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  if (appendFrom > 0) {
    g.insertAdjacentHTML('beforeend', html);
    const allCards = g.querySelectorAll('.p-card');
    for (let i = appendFrom; i < allCards.length; i++) {
      setTimeout(() => allCards[i].classList.add('visible'), (i - appendFrom) * 60);
    }
  } else {
    g.innerHTML = html;
    g.querySelectorAll('.p-card').forEach((card, i) => {
      setTimeout(() => card.classList.add('visible'), i * 60);
    });
  }

  if (hasMore) { show('more-btn'); $('more-btn').textContent='Weitere Fotos laden…'; }
  else hide('more-btn');
  renderViewSwitcher();
}

// Unified like handler for grid + lightbox
async function doLike(photoId) {
  const p = photos.find(x=>x.id===photoId);
  if (!p) return;
  try {
    if (p._liked) {
      await apiCall(`/likes/${photoId}`, 'DELETE');
      p._liked=false; p._likes=Math.max(0,(p._likes||0)-1);
    } else {
      await apiCall('/likes', 'POST', { photoId });
      p._liked=true; p._likes=(p._likes||0)+1;
    }
  } catch(e) { toast('Fehler beim Liken','error'); return; }
  // Update grid card
  const card=document.getElementById('pc-'+photoId);
  if (card) {
    const btn=card.querySelector('.p-like-btn');
    if(btn) { btn.className='p-like-btn'+(p._liked?' liked':''); btn.innerHTML=`<span class="heart">${p._liked?ICON_HEART_FULL:ICON_HEART_EMPTY}</span> ${p._likes>0?`<span>${p._likes}</span>`:''}`; }
  }
  // Update lightbox if open and showing this photo
  if (photos[lbIdx]?.id===photoId) {
    lbLiked=p._liked; lbLikeCount=p._likes;
    if (p._liked) {
      if (!lbLikers.find(u=>u.id===me.id)) lbLikers.unshift(allProfiles[me.id]||{id:me.id,name:meProfile.name});
    } else {
      lbLikers = lbLikers.filter(u=>u.id!==me.id);
    }
    updateLikeBtn();
    updateLikers();
  }
}

// ── UPLOAD ───────────────────────────────────────────────
function openModal() {
  const asel=$('asel');
  asel.innerHTML=`<option value="">— Kein Album —</option>`+allAlbums.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  if (curAlbum) asel.value=curAlbum;
  if ($('desc-input')) $('desc-input').value='';
  show('up-modal'); show('dz-wrap'); hide('prog-wrap');
  // Drag&Drop-Listener (einmalig registrieren)
  const dzEl=$('dz');
  if (dzEl && !dzEl._dzInit) {
    dzEl._dzInit = true;
    dzEl.addEventListener('dragover',  e=>{e.preventDefault();dzEl.classList.add('drag');});
    dzEl.addEventListener('dragleave', ()=>dzEl.classList.remove('drag'));
    dzEl.addEventListener('drop',      e=>{e.preventDefault();dzEl.classList.remove('drag');handleFiles(e.dataTransfer.files);});
    dzEl.addEventListener('click',     ()=>$('fi').click());
  }
}
function closeModal() { hide('up-modal'); $('fi').value=''; }

async function handleFiles(fileList) {
  const files=Array.from(fileList).filter(f=>f.type.startsWith('image/'));
  if (!files.length) return;
  const folder=SHARED;
  const desc = $('desc-input')?.value?.trim()||null;
  const albumId = $('asel')?.value||null;
  hide('dz-wrap'); show('prog-wrap');
  const PARALLEL = 3;
  let done = 0, failed = 0;
  const uploadedIds = [];

  // Process in parallel batches of 3
  async function uploadWithProgress(file) {
    try {
      const id = await uploadOne(file, folder, desc, albumId);
      if (id) uploadedIds.push(id);
      done++;
    } catch(e) {
      console.error('Upload failed:', file.name, e);
      failed++;
      done++;
    }
    $('prog-txt').textContent = `${done} von ${files.length}${failed?' ('+failed+' fehlgeschlagen)':''}`;
    $('prog-fill').style.width = (done/files.length*100)+'%';
  }

  // Batch processing: 3 at a time to avoid memory issues
  for (let i = 0; i < files.length; i += PARALLEL) {
    const batch = files.slice(i, i + PARALLEL);
    $('prog-txt').textContent = `${done} von ${files.length} — ${batch.length} werden verarbeitet…`;
    await Promise.all(batch.map(f => uploadWithProgress(f)));
  }

  $('prog-fill').style.width='100%';
  $('prog-txt').textContent = failed
    ? `Fertig! ${done-failed} hochgeladen, ${failed} fehlgeschlagen`
    : `Fertig! ${done} Fotos hochgeladen`;

  // Batch-Benachrichtigung (no-op, server-side handled)
  if (uploadedIds.length > 0) { /* notifications handled server-side */ }

  if (uploadedIds.length > 0) invalidateCounts();
  setTimeout(closeModal, 800);
  if (curFolder===folder) await loadPhotos(true);
  renderSidebar();
  $('fi').value='';
  if (failed) toast(`${failed} Foto${failed>1?'s':''} konnten nicht hochgeladen werden`, 'error');
  else toast(`${done} Foto${done>1?'s':''} hochgeladen`, 'success');
}

async function uploadOne(file, folder=SHARED, desc=null, albumId=null) {
  const blob = await compress(file);

  const formData = new FormData();
  formData.append('file', new File([blob], file.name, { type: 'image/jpeg' }));
  formData.append('groupId', curGroupId);
  if (albumId)   formData.append('albumId', albumId);
  if (desc)      formData.append('description', desc);

  // apiCall doesn’t support multipart, direkter fetch
  const { accessToken: token } = await import('./auth-oidc.js').catch(() => ({}));
  const storedToken = sessionStorage.getItem('accessToken');
  const resp = await fetch('/api/photos', {
    method: 'POST',
    headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
    body: formData,
  });
  if (!resp.ok) throw new Error(await resp.text());
  const { photo } = await resp.json();
  return photo?.id;
}

// Drag&Drop-Listener werden in openModal() registriert (DOM erst dann vorhanden)

// ── LIGHTBOX ─────────────────────────────────────────────
async function openLB(i) {
  lbIdx=i;
  const p=photos[i], u=allProfiles[p.uploaderId]||{};
  show('lb');
  initLbSwipe();
  // Lightbox: Foto-URL aus Cache
  const url = urlCache[p.id] || p.url || '';
  $('lb-img').src = photoSrc(url);
  $('lb-av').innerHTML = avatarHtml(u, 32);
  $('lb-av').style.background = u.avatar ? 'transparent' : (u.color||'#888');
  $('lb-who').textContent=u.name||'?';
  $('lb-dt').textContent=fmtDateLong(p.created_at);
  $('lb-cnt').textContent=`${i+1} von ${photos.length} Fotos`;
  // Description with edit capability
  let descWrap = document.getElementById('lb-desc-wrap');
  if (!descWrap) {
    descWrap = document.createElement('div');
    descWrap.id = 'lb-desc-wrap';
    descWrap.style.cssText = 'margin-top:6px;display:flex;align-items:start;gap:6px';
    $('lb-cnt').after(descWrap);
  }
  const isOwner = p.uploaderId === me.id;
  if (p.description) {
    descWrap.innerHTML = `<div class="lb-desc" id="lb-desc-text" style="flex:1">${esc(p.description)}</div>${isOwner?`<button onclick="editDesc()" style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:2px;flex-shrink:0" title="Beschreibung bearbeiten"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}`;
    descWrap.style.display = 'flex';
  } else if (isOwner) {
    descWrap.innerHTML = `<button onclick="editDesc()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:12px;font-weight:500;padding:0;font-family:inherit">+ Beschreibung hinzufügen</button>`;
    descWrap.style.display = 'flex';
  } else {
    descWrap.style.display = 'none';
    descWrap.innerHTML = '';
  }
  // Update slideshow counter
  const ssCnt=$('ss-counter'); if(ssCnt) ssCnt.textContent=`${i+1} / ${photos.length}`;
  $('lb-prv').style.display=i>0?'':'none';
  $('lb-nxt').style.display=i<photos.length-1?'':'none';
  // Action buttons
  const d=$('lb-del-btn');
  if(d){ d.innerHTML=ICON_TRASH+' Löschen'; p.uploaderId===me.id?d.classList.remove('hidden'):d.classList.add('hidden'); }
  const dn=$('lb-down-btn'); if(dn) dn.innerHTML=ICON_DOWNLOAD+' Herunterladen';
  const ab=$('lb-album-btn'); if(ab) ab.innerHTML=`${ICON_ALBUM} Album`;
  updateFullviewBtn();
  updateLbAlbumTag(p);
  // Refresh album_id from API
  try {
    const fresh = await apiCall(`/photos/${p.id}`, 'GET');
    if (fresh) { p.albumIds = fresh.albumIds || []; photos[i].albumIds = p.albumIds;
      updateLbAlbumTag(p); }
  } catch(e) { /* ignore */ }
  await loadLBMeta(p.id);
}

async function loadLBMeta(photoId) {
  try {
    const photo = await apiCall(`/photos/${photoId}`, 'GET');
    lbLikeCount = (photo.likes||[]).length;
    lbLiked     = (photo.likes||[]).some(l => l.userId === me.id);
    lbLikers    = (photo.likes||[]).map(l => allProfiles[l.userId] || l.user).filter(Boolean);
    updateLikeBtn();
    updateLikers();
    lbComments  = (photo.comments||[]);
    renderComments();
  } catch(e) {
    console.warn('LB Meta laden fehlgeschlagen:', e);
    lbLikeCount=0; lbLiked=false; lbLikers=[]; lbComments=[];
    updateLikeBtn(); renderComments();
  }
}

function updateLikers() {
  const el = $('lb-likers');
  if (!el) return;
  if (!lbLikers || !lbLikers.length) { el.textContent=''; return; }
  const names = lbLikers.map(u => u.id===me.id ? 'Dir' : u.name);
  if (names.length === 1) el.innerHTML = `Gefällt <b>${esc(names[0])}</b>`;
  else if (names.length === 2) el.innerHTML = `Gefällt <b>${esc(names[0])}</b> und <b>${esc(names[1])}</b>`;
  else el.innerHTML = `Gefällt <b>${esc(names[0])}</b>, <b>${esc(names[1])}</b> und ${names.length-2} weiteren`;
}

function showLikersList() {
  if (!lbLikers || !lbLikers.length) return;
  // Remove existing popup
  document.getElementById('likers-popup')?.remove();
  const popup = document.createElement('div');
  popup.id = 'likers-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:20px;z-index:500;box-shadow:var(--shadow2);min-width:220px;max-width:300px;max-height:60vh;overflow-y:auto;animation:fadeIn .2s ease';
  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-size:15px;font-weight:600;color:var(--text)">Gefällt ${lbLikers.length} ${lbLikers.length===1?'Person':'Personen'}</span>
      <button onclick="document.getElementById('likers-popup')?.remove();document.getElementById('likers-backdrop')?.remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:4px">✕</button>
    </div>
    ${lbLikers.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${u.id!==lbLikers[lbLikers.length-1]?.id?'border-bottom:1px solid var(--border)':''}">
        <div style="width:32px;height:32px;border-radius:50%;background:${esc(u.color||'#888')};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0">${(u.name||'?')[0].toUpperCase()}</div>
        <span style="font-size:14px;font-weight:500;color:var(--text)">${esc(u.id===me.id ? u.name+' (Du)' : u.name||'?')}</span>
      </div>
    `).join('')}`;
  const backdrop = document.createElement('div');
  backdrop.id = 'likers-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:499;animation:fadeIn .15s ease';
  backdrop.onclick = () => { popup.remove(); backdrop.remove(); };
  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

function updateLikeBtn() {
  const btn=$('lb-like-btn');
  btn.className='lb-like-btn'+(lbLiked?' liked':'');
  btn.innerHTML=`<span class="lheart">${lbLiked?ICON_HEART_LG_FULL:ICON_HEART_LG_EMPTY}</span> <span id="lb-like-count">${lbLikeCount}</span> Gefällt mir`;
}

async function toggleLike() {
  const p=photos[lbIdx];
  if (!p) return;
  await doLike(p.id);
}

async function sendComment() {
  const ta=$('comment-input');
  const text=ta.value.trim();
  if (!text) return;
  const p=photos[lbIdx];
  if (!p) return;
  $('send-btn').disabled=true;
  try {
    const comment = await apiCall('/comments', 'POST', { photoId: p.id, content: text });
    lbComments.push(comment);
    p._comments=(p._comments||0)+1;
    renderComments();
    ta.value=''; ta.style.height='auto';
  // Kommentare im Grid aktualisieren
  const card=document.getElementById('pc-'+p.id);
  if (card) {
    const cc=card.querySelector('.p-comment-count');
    if (cc) cc.innerHTML=`${ICON_COMMENT}<span>${p._comments}</span>`;
    else {
      const actions=card.querySelector('.p-actions');
      if (actions) { const sp=document.createElement('span'); sp.className='p-comment-count'; sp.innerHTML=`${ICON_COMMENT}<span>${p._comments}</span>`; actions.insertBefore(sp,actions.children[1]||null); }
    }
  }
  } catch(e) { toast('Kommentar konnte nicht gesendet werden','error'); }
  $('send-btn').disabled=false;
}

async function deleteComment(commentId) {
  try {
    await apiCall(`/comments/${commentId}`, 'DELETE');
    lbComments=lbComments.filter(c=>c.id!==commentId);
    const p=photos[lbIdx];
    if (p) p._comments=Math.max(0,(p._comments||0)-1);
    renderComments();
  } catch(e) { toast('Kommentar konnte nicht gelöscht werden','error'); }
}

function renderComments() {
  const el=$('lb-comments');
  if (!lbComments.length) { el.innerHTML='<div class="no-comments">Noch keine Kommentare — schreib den ersten! ✨</div>'; return; }
  el.innerHTML=lbComments.map(c=>{
    const u=allProfiles[c.userId] || c.user || {};
    const canDel=c.userId===me.id || me.role==='admin';
    const ts=fmtDateLong(c.createdAt);
    return `<div class="comment-item" title="${esc(ts)}">
      <div class="c-av">${avatarHtml(u, 32)}</div>
      <div class="c-body">
        <span class="c-name">${esc(u.name||'?')}</span>
        ${canDel?`<button class="c-del" onclick="deleteComment('${c.id}')" title="Löschen">${ICON_TRASH}</button>`:''}
        <div class="c-text">${esc(c.content)}</div>
        <div class="c-time">${ts}</div>
      </div>
    </div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
}

function closeLB() { resetZoom(); hide('lb'); hide('ss-bar'); pauseSS(); $('lb').classList.remove('ss-fullscreen'); $('lb').classList.remove('lb-fullview'); document.querySelectorAll('.lb-fullview-hint').forEach(e=>e.remove()); }
function handleLbBgClick(e) {
  // In fullview: click anywhere to exit fullview
  if ($('lb').classList.contains('lb-fullview')) {
    if (e.target === $('lb-img') || e.target.classList.contains('lb-img-side') || e.target === $('lb')) {
      toggleFullview(); return;
    }
  }
  // Close if clicking the dark background or the image side (not the panel)
  if (e.target === $('lb') || e.target.classList.contains('lb-img-side') || e.target === $('lb-img-side-inner')) closeLB();
}
function lbNav(d) { resetZoom(); openLB(Math.max(0,Math.min(photos.length-1,lbIdx+d))); }
document.addEventListener('keydown',e=>{
  if ($('lb').classList.contains('hidden')) return;
  if(e.key==='Escape') closeLB();
  if ($('comment-input') === document.activeElement) return;
  if(e.key==='ArrowLeft') lbNav(-1);
  else if(e.key==='ArrowRight') lbNav(1);
});

// ── DELETE ───────────────────────────────────────────────
function askDel(id, fromLb) {
  delFromLb = fromLb;
  delTarget = fromLb ? photos[lbIdx]?.id : id;
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if (curAlbum) {
    if(ico) ico.textContent = '🖼';
    if(txt) txt.textContent = 'Was möchtest du mit diesem Foto tun?';
    btns.className = 'dlg-btns stacked';
    btns.innerHTML = `
      <button class="btn" style="background:var(--accent-l);color:var(--accent);border:1.5px solid #dcc0a0;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600" onclick="removeFromAlbum()">Aus Album entfernen</button>
      <button class="btn btn-danger" style="padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600" onclick="execDel()">Überall löschen</button>
      <button class="btn btn-ghost" style="padding:12px 18px;border-radius:10px;font-size:14px" onclick="cancelDel()">Abbrechen</button>`;
  } else {
    if(ico) ico.textContent = '🗑';
    if(txt) txt.textContent = 'Dieses Foto wirklich unwiderruflich löschen?';
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execDel()">Löschen</button>`;
  }
  show('del-dlg');
}

async function removeFromAlbum() {
  if (!delTarget || !curAlbum) return;
  hide('del-dlg');
  try { await apiCall(`/photos/${delTarget}`, 'PATCH', { albumId: curAlbum }); } catch(e) { /* ignore */ }
  if (delFromLb) closeLB();
  await loadPhotos(true);
  if (curAlbum) await loadAlbums();
}
function cancelDel() { hide('del-dlg'); delTarget=null; }
async function execDel() {
  if (!delTarget) return;
  hide('del-dlg');
  try {
    await apiCall(`/photos/${delTarget}`, 'DELETE');
  } catch(e) { console.error(e); }
  if (delFromLb) closeLB();
  delTarget=null;
  invalidateCounts();
  await loadPhotos(true); renderSidebar();
}



// ── MOBILE SIDEBAR ───────────────────────────────────────
function toggleSidebar() {
  const sb = $('sidebar'), ov = $('mob-overlay');
  const isOpen = sb.classList.contains('open');
  isOpen ? closeSidebar() : openSidebar();
}
function openSidebar() {
  $('sidebar').classList.add('open');
  $('mob-overlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('mob-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// ── MOBILE NAV ────────────────────────────────────────────
function updateMobileAv() {
}

// ── ALBUMS ────────────────────────────────────────────────
async function loadAlbums() {
  try {
    const { albums } = await apiCall(`/albums?groupId=${curGroupId}`, 'GET');
    allAlbums = albums || [];
  } catch(e) { allAlbums = []; }
}

function openAlbumModal(fromLightbox = false) {
  renderAlbumList();
  const el = document.getElementById('album-modal');
  if (fromLightbox) el.classList.add('modal-bg--top');
  else el.classList.remove('modal-bg--top');
  show('album-modal');
}
function closeAlbumModal() { hide('album-modal'); document.getElementById('album-modal')?.classList.remove('modal-bg--top'); }

function renderAlbumList() {
  const el=$('album-list');
  if (!allAlbums.length) { el.innerHTML='<p style="font-size:13px;color:var(--muted2);font-weight:300;padding:8px 0">Noch keine Alben erstellt.</p>'; return; }
  // Album-Foto-Anzahl aus _count (kommt vom API)
  el.innerHTML=allAlbums.map(a=>`
    <div class="album-row">
      <span class="album-row-name">${esc(a.name)}</span>
      <span class="album-row-count" id="arc-${a.id}">${a._count?.photos ?? '…'} Fotos</span>
      ${a.createdBy===me.id||a.created_by===me.id?`<button class="album-row-del" onclick="deleteAlbum('${a.id}')" title="Löschen">${ICON_TRASH}</button>`:''}
    </div>`).join('');
}

async function createAlbum() {
  const name=$('new-album-name').value.trim();
  if (!name) return;
  try {
    const album = await apiCall('/albums', 'POST', { name, groupId: curGroupId });
    allAlbums.push(album);
    $('new-album-name').value='';
    renderAlbumList();
    renderSidebar();
  } catch(e) { toast('Album-Erstellung fehlgeschlagen','error'); }
}

function openNewAlbumInline() {
  const el=$('new-album-inline');
  if(el){ el.classList.remove('hidden'); document.getElementById('new-album-sb-input')?.focus(); }
}
function closeNewAlbumInline() {
  const el=$('new-album-inline'); if(el) el.classList.add('hidden');
  const inp=document.getElementById('new-album-sb-input'); if(inp) inp.value='';
}
async function createAlbumInline() {
  const inp=document.getElementById('new-album-sb-input');
  const name=inp?.value?.trim();
  if(!name) return;
  try {
    const album = await apiCall('/albums', 'POST', { name, groupId: curGroupId });
    allAlbums.push(album);
    closeNewAlbumInline();
    renderSidebar();
  } catch(e) { toast('Album-Erstellung fehlgeschlagen','error'); }
}

function openRenameAlbum() {
  const a = allAlbums.find(x=>x.id===curAlbum);
  if (!a) return;
  const newName = prompt('Album umbenennen:', a.name);
  if (!newName || newName.trim()===a.name) return;
  renameAlbum(curAlbum, newName.trim());
}
async function renameAlbum(id, newName) {
  try {
    await apiCall(`/albums/${id}`, 'PATCH', { name: newName });
    const a = allAlbums.find(x=>x.id===id);
    if (a) a.name = newName;
    renderSidebar();
    $('gal-title').textContent = newName;
  } catch(e) { toast('Umbenennen fehlgeschlagen','error'); }
}

async function deleteAlbum(id) {
  const a = allAlbums.find(x=>x.id===id);
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if(ico) ico.textContent = '📁';
  if(txt) txt.textContent = `Album „${a?.name||'Album'}" wirklich löschen? Die Fotos bleiben erhalten.`;
  btns.className = 'dlg-btns';
  btns.innerHTML = `
    <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
    <button class="btn btn-danger" onclick="execDeleteAlbum('${id}')">Album löschen</button>`;
  show('del-dlg');
}
async function execDeleteAlbum(id) {
  hide('del-dlg');
  try {
    await apiCall(`/albums/${id}`, 'DELETE');
    allAlbums=allAlbums.filter(a=>a.id!==id);
    if (curAlbum===id) { curAlbum=null; await loadPhotos(true); }
    renderAlbumList();
    renderSidebar();
    toast('Album gelöscht','success');
  } catch(e) { toast('Album-Löschen fehlgeschlagen','error'); }
}

// ── SLIDESHOW ─────────────────────────────────────────────
function openSS() {
  if (!photos.length) return;
  openLB(0);
  $('lb').classList.add('ss-fullscreen');
  show('ss-bar');
  startSS();
}

function toggleSS() {
  ssPlaying ? pauseSS() : startSS();
}

function startSS() {
  ssPlaying=true;
  const icon=$('ss-play-icon');
  if(icon) icon.innerHTML='<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  clearInterval(ssTimer);
  ssTimer=setInterval(()=>{
    if(lbIdx<photos.length-1) lbNav(1);
    else { pauseSS(); closeLB(); }
  }, ssSpeeds[ssSpeedIdx]*1000);
}

function pauseSS() {
  ssPlaying=false;
  clearInterval(ssTimer);
  const icon=$('ss-play-icon');
  if(icon) icon.innerHTML='<polygon points="5 3 19 12 5 21 5 3"/>';
}

function ssChangeSpeed() {
  ssSpeedIdx=(ssSpeedIdx+1)%ssSpeeds.length;
  const el=$('ss-speed'); if(el) el.textContent=ssSpeeds[ssSpeedIdx]+'s';
  if(ssPlaying) startSS();
}

// ── PROFILE / AVATAR ──────────────────────────────────────
const PROFILE_COLORS = ['#b07448','#c86888','#8868c8','#6888d4','#4aacb8','#5a9e7a','#c8a048','#c87848','#7888c8','#a8c858','#888888'];

async function openProfileModal() {
  const av=$('avatar-preview');
  av.style.background=meProfile.color;
  if (meProfile.avatar) {
    av.innerHTML=`<img src="${meProfile.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else { av.textContent=meProfile.name[0].toUpperCase(); }
  const clearBtn = $('clear-avatar-btn');
  if (clearBtn) clearBtn.style.display = meProfile.avatar ? '' : 'none';
  renderColorSwatches();
  hide('avatar-msg');
  show('profile-modal');
}

function renderColorSwatches() {
  const wrap = $('color-swatches');
  if (!wrap) return;
  const current = meProfile.color || '#888888';
  const isPreset = PROFILE_COLORS.includes(current);
  wrap.innerHTML = PROFILE_COLORS.map(c => `
    <div class="color-swatch${c===current?' active':''}" style="background:${c}" title="${c}" onclick="setUserColor('${c}')"></div>
  `).join('') + `
    <div class="color-swatch-custom" title="Eigene Farbe wählen" style="position:relative">
      ${isPreset ? '<span style="pointer-events:none;font-size:14px">🎨</span>' : `<span style="pointer-events:none;display:inline-block;width:14px;height:14px;border-radius:50%;background:${current}"></span>`}
      <input type="color" value="${isPreset ? '#ff8844' : current}" oninput="setUserColor(this.value,true)" onchange="setUserColor(this.value)">
    </div>
  `;
}

async function setUserColor(color, previewOnly=false) {
  meProfile.color = color;
  if (allProfiles[me.id]) allProfiles[me.id].color = color;
  const av = $('avatar-preview');
  if (av) av.style.background = color;
  const hav = $('hav');
  if (hav && !meProfile.avatar) hav.style.background = color;
  renderColorSwatches();
  if (previewOnly) return;
  try {
    await apiCall('/auth/profile', 'PATCH', { color });
    me.color = color;
    renderSidebar();
    showMsg('avatar-msg', 'success', '✓ Farbe gespeichert!');
  } catch(e) {
    showMsg('avatar-msg', 'error', 'Fehler beim Speichern der Farbe.');
  }
}

function closeProfileModal() { hide('profile-modal'); }

async function uploadAvatar(file) {
  if (!file) return;
  showMsg('avatar-msg','info','Wird hochgeladen…');
  try {
    const blob = await compress(file, 400, 0.88);
    const storedToken = sessionStorage.getItem('accessToken');
    const fd = new FormData();
    fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
    const resp = await fetch('/api/auth/avatar', {
      method: 'POST',
      headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
      body: fd,
    });
    if (!resp.ok) throw new Error(await resp.text());
    const { avatarUrl } = await resp.json();
    meProfile.avatar = avatarUrl;
    if (allProfiles[me.id]) allProfiles[me.id].avatar = avatarUrl;
    $('avatar-preview').innerHTML=`<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover">`;
    const hav=$('hav'); if(hav) hav.innerHTML=`<img class="av-img" src="${avatarUrl}">`;
    renderSidebar();
    updateMobileAv();
    showMsg('avatar-msg','success','✓ Profilfoto gespeichert!');
    $('clear-avatar-btn').style.display = '';
  } catch(e){ showMsg('avatar-msg','error','Fehler beim Hochladen.'); }
}

async function clearAvatar() {
  showMsg('avatar-msg','info','Wird gelöscht…');
  try {
    await apiCall('/auth/avatar', 'DELETE');
    meProfile.avatar = null;
    if (allProfiles[me.id]) allProfiles[me.id].avatar = null;
    const av = $('avatar-preview');
    av.innerHTML = '';
    av.textContent = meProfile.name[0].toUpperCase();
    const hav = $('hav'); if (hav) { hav.innerHTML=''; hav.textContent=(meProfile.name||'')[0].toUpperCase(); hav.style.background=meProfile.color; }
    $('clear-avatar-btn').style.display = 'none';
    renderSidebar();
    updateMobileAv();
    showMsg('avatar-msg','success','✓ Profilfoto entfernt.');
  } catch(e) { showMsg('avatar-msg','error','Fehler beim Löschen.'); }
}

// ── ADD FROM ALL PHOTOS ──────────────────────────────────
let addPhotoSelection = new Set();

async function openAddFromAll() {
  if (!curAlbum) return;
  addPhotoSelection = new Set();
  show('add-photos-modal');
  const grid = $('add-photos-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:30px"><div class="spinner"></div></div>';
  try {
    const { photos: allData } = await apiCall(`/photos?groupId=${curGroupId}&limit=200`, 'GET');
    if (!allData?.length) { grid.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;grid-column:1/-1">Keine Fotos vorhanden.</p>'; return; }
    allData.forEach(p => { if (p.url) urlCache[p.id] = p.url; });
    grid.innerHTML = allData.map(p => {
      const url = urlCache[p.id] || '';
      const inAlbum = (p.albumIds||[]).includes(curAlbum);
      return `<div class="add-photo-thumb${inAlbum?' selected':''}" id="apt-${p.id}" onclick="toggleAddSelection('${p.id}',${inAlbum})" title="${esc(p.filename||'')}">
        <img src="${esc(photoSrc(url))}" loading="lazy">
        <div class="check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        ${inAlbum?'<div style="position:absolute;bottom:4px;left:4px;background:var(--accent);border-radius:4px;padding:1px 5px;font-size:9px;color:#fff;font-weight:700">Im Album</div>':''}
      </div>`;
    }).join('');
    allData.filter(p=>(p.albumIds||[]).includes(curAlbum)).forEach(p=>addPhotoSelection.add(p.id));
    updateAddCount();
  } catch(e) { grid.innerHTML='<p style="color:var(--muted);text-align:center;grid-column:1/-1">Fehler beim Laden.</p>'; }
}

function toggleAddSelection(photoId, wasInAlbum) {
  const el = document.getElementById('apt-'+photoId);
  if (addPhotoSelection.has(photoId)) {
    addPhotoSelection.delete(photoId);
    el?.classList.remove('selected');
  } else {
    addPhotoSelection.add(photoId);
    el?.classList.add('selected');
  }
  updateAddCount();
}

function updateAddCount() {
  const el = $('add-photos-count');
  if (el) el.textContent = addPhotoSelection.size === 1 ? '1 Foto ausgewählt' : `${addPhotoSelection.size} Fotos ausgewählt`;
}

async function confirmAddToAlbum() {
  if (!curAlbum || !addPhotoSelection.size) { closeAddModal(); return; }
  const btn = document.querySelector('#add-photos-modal .btn-primary');
  if(btn) { btn.disabled=true; btn.textContent='Wird gespeichert…'; }
  try {
    // Alle gewählten Fotos dem Album zuordnen, nicht gewählte raus
    const { photos: albumPhotos } = await apiCall(`/photos?groupId=${curGroupId}&albumId=${curAlbum}&limit=200`, 'GET');
    const currentIds = new Set((albumPhotos||[]).map(p=>p.id));
    const toAdd    = [...addPhotoSelection].filter(id => !currentIds.has(id));
    const toRemove = [...currentIds].filter(id => !addPhotoSelection.has(id));
    const calls = [];
    if (toAdd.length)    calls.push(apiCall('/photos/batch-album', 'PATCH', { photoIds: toAdd,    albumId: curAlbum }));
    if (toRemove.length) calls.push(apiCall('/photos/batch-album', 'PATCH', { photoIds: toRemove, albumId: curAlbum, remove: true }));
    await Promise.all(calls);
  } catch(e) { toast('Fehler beim Speichern','error'); console.error(e); }
  closeAddModal();
  await loadPhotos(true);
  await loadAlbums();
}

function closeAddModal() {
  hide('add-photos-modal');
  addPhotoSelection = new Set();
  const btn = document.querySelector('#add-photos-modal .btn-primary');
  if (btn) { btn.disabled = false; btn.textContent = 'Hinzufügen'; }
}

// ── ALBUM PICKER ─────────────────────────────────────────
let pickerOpen = false;

function openAlbumPicker() {
  if (!allAlbums.length) { openAlbumModal(true); return; }
  // Remove existing picker
  const existing = document.getElementById('album-picker-popup');
  if (existing) { existing.remove(); pickerOpen=false; return; }
  pickerOpen = true;
  const p = photos[lbIdx];
  const picker = document.createElement('div');
  picker.className = 'album-picker';
  picker.id = 'album-picker-popup';
  picker.innerHTML = `
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted2);padding:4px 10px 8px">Zum Album hinzufügen</div>
    ${allAlbums.map(a=>{
      const inA = (p.albumIds||[]).includes(a.id);
      return `<div class="album-picker-item ${inA?'selected':''}" onclick="togglePhotoAlbum('${a.id}','${a.name}')">
        ${ICON_ALBUM}
        ${esc(a.name)}
        ${inA?'<span style="margin-left:auto;font-size:10px">✓</span>':''}
      </div>`;
    }).join('')}
    <div style="border-top:1px solid var(--border);margin:6px 0"></div>
    <div class="album-picker-item" onclick="openAlbumModal(true);document.getElementById('album-picker-popup')?.remove()" style="color:var(--accent)">
      ${ICON_PLUS}
      Neues Album erstellen
    </div>`;
  // Position near the button (fixed, damit über der Lightbox)
  const btn = $('lb-album-btn');
  const rect = btn.getBoundingClientRect();
  const isMobile = window.innerWidth <= 900;
  if (isMobile) {
    picker.style.cssText = `left:50%;transform:translateX(-50%);bottom:${window.innerHeight - rect.top + 8}px;max-width:calc(100vw - 32px);width:280px;`;
  } else {
    picker.style.cssText = `bottom:${window.innerHeight - rect.top + 8}px;left:${rect.left}px;`;
  }
  document.body.appendChild(picker);
  // Close on outside click
  setTimeout(()=>{ document.addEventListener('click', function handler(e){ if(!picker.contains(e.target)&&e.target!==$('lb-album-btn')){ picker.remove(); pickerOpen=false; document.removeEventListener('click',handler); } }); },10);
}

async function togglePhotoAlbum(albumId, albumName) {
  const p = photos[lbIdx];
  if (!p) return;
  document.getElementById('album-picker-popup')?.remove();
  try {
    await apiCall(`/photos/${p.id}`, 'PATCH', { albumId });
    const ids = p.albumIds || [];
    const idx = ids.indexOf(albumId);
    if (idx >= 0) ids.splice(idx, 1); else ids.push(albumId);
    p.albumIds = ids;
    photos[lbIdx].albumIds = ids;
    updateLbAlbumTag(p);
    await loadAlbums();
  } catch(e) { toast('Album-Zuordnung fehlgeschlagen','error'); }
}

function updateLbAlbumTag(p) {
  const tag = document.getElementById('lb-album-tag');
  if (!tag) return;
  const ids = p.albumIds || [];
  if (ids.length) {
    tag.style.display = 'block';
    tag.innerHTML = ids.map(aid => {
      const a = allAlbums.find(x=>x.id===aid);
      return `<span class="album-tag-chip">${ICON_ALBUM}${esc(a?.name||'Album')}<button onclick="togglePhotoAlbum('${aid}','')">✕</button></span>`;
    }).join('');
  } else {
    tag.style.display = 'none';
    tag.innerHTML = '';
  }
}

// ── HELPERS ──────────────────────────────────────────────
async function compress(file,maxW=1400,q=0.82) {
  return new Promise(res=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        c.toBlob(b=>res(b),'image/jpeg',q);
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
  });
}
function fmtDate(s){ if(!s)return''; return new Date(s).toLocaleDateString('de-DE'); }
function fmtDateLong(s){ if(!s)return''; return new Date(s).toLocaleString('de-DE'); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Gibt konsistentes Avatar-HTML zurück: Foto oder Initialen-Kreis
function avatarHtml(user, size=20) {
  if (user?.avatar) {
    return `<img src="${esc(user.avatar)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;flex-shrink:0">`;
  }
  const initial = (user?.name||'?')[0].toUpperCase();
  const bg = esc(user?.color||'#888');
  const fs = Math.round(size * 0.52);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;font-weight:700;font-size:${fs}px;flex-shrink:0;overflow:hidden">${initial}</span>`;
}
function $(id){ return document.getElementById(id); }
function V(id){ return $(id).value; }
function show(id){ $(id)?.classList.remove('hidden'); }
function hide(id){ $(id)?.classList.add('hidden'); }
function showMsg(id,t,txt){ const e=$(id); if(!e)return; e.className=`msg msg-${t}`; e.textContent=txt; e.classList.remove('hidden'); }
function clearMsgs(){ ['login-msg','reg-msg','forgot-msg','join-group-msg'].forEach(id=>{ const e=$(id); if(e)e.classList.add('hidden'); }); }
function setBL(id,l,txt){ const b=$(id); if(!b)return; b.disabled=l; b.innerHTML=l?`<span class="spin-sm"></span>${txt}`:txt; }

// ── GROUP MEMBERS ─────────────────────────────────────────
async function loadGroupMembers() {
  try {
    const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
    groupMembers = members || [];
    groupMembers.forEach(m => { allProfiles[m.id] = m; });
    groupMembers.sort((a,b) => {
      if (a.id === me.id) return -1;
      if (b.id === me.id) return 1;
      return (a.name||'').localeCompare(b.name||'');
    });
  } catch(e) { groupMembers = []; }
}

// ── GROUP SWITCHER ────────────────────────────────────────
function renderGroupSwitcher() {
  const wrap = $('group-switcher-wrap');
  if (!wrap || myGroups.length <= 0) return;
  const active = myGroups.find(g=>g.id===curGroupId);
  // Update header subtitle
  const sub = $('header-group-name');
  if (sub) sub.textContent = active?.name || 'Gruppe';
  // Auf Mobile keinen Header-Switcher zeigen (Gruppe wird in der Sidebar gewechselt)
  if (window.innerWidth <= 900) { wrap.innerHTML=''; return; }
  // Only show switcher if multiple groups
  if (myGroups.length <= 1) { wrap.innerHTML=''; return; }
  wrap.innerHTML = `
    <div class="group-sw" id="group-sw-btn" onclick="toggleGroupDropdown()">
      <span class="g-dot"></span>
      <span>${esc(active?.name||'Gruppe')}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>`;
}

function toggleGroupDropdown() {
  const existing = document.getElementById('group-dd');
  if (existing) { existing.remove(); return; }
  const btn = $('group-sw-btn');
  if (!btn) return;
  const dd = document.createElement('div');
  dd.className = 'group-dd';
  dd.id = 'group-dd';
  dd.innerHTML = myGroups.map(g => `
    <div class="group-dd-item${g.id===curGroupId?' active':''}" onclick="switchGroup('${g.id}')">
      <span class="g-dot" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
      ${esc(g.name)}
      ${g.id===curGroupId?'<span class="g-check">✓</span>':''}
    </div>`).join('') + `
    <div class="group-dd-divider"></div>
    <div class="group-dd-join" onclick="openJoinGroup()">
      ${ICON_PLUS} Weiterer Gruppe beitreten
    </div>`;
  btn.appendChild(dd);
  setTimeout(()=>{
    document.addEventListener('click', function handler(e) {
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.remove(); document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

async function switchGroup(groupId) {
  document.getElementById('group-dd')?.remove();
  if (groupId === curGroupId) return;
  curGroupId = groupId;
  try { localStorage.setItem('activeGroup', groupId); } catch(e){}
  invalidateCounts();
  renderGroupSwitcher();
  // Reload everything for new group
  await loadGroupMembers();
  curAlbum = null; curFilter = null; curFilterUserId = null;
  await loadAlbums();
  renderSidebar();
  renderGroupSwitcher();
  await loadPhotos(true);
  toast(`Gewechselt zu „${myGroups.find(g=>g.id===groupId)?.name}"`, 'success');
}

// ── CONFIRM DIALOG (Promise-basiert) ────────────────────
function showConfirmDlg(title, text, confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = true) {
  return new Promise(resolve => {
    document.getElementById('confirm-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'confirm-dlg';
    dlg.className = 'dlg-bg';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:600;animation:fadeIn .15s ease';
    dlg.innerHTML = `
      <div class="dlg" style="animation:scaleIn .2s ease">
        <div class="dlg-ico">🗑</div>
        <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">${esc(title)}</h3>
        <p style="font-size:13px;color:var(--muted);font-weight:300;margin:0 0 20px;line-height:1.5">${esc(text)}</p>
        <div class="dlg-btns">
          <button id="cdlg-cancel" class="btn btn-ghost">${esc(cancelLabel)}</button>
          <button id="cdlg-confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#cdlg-confirm').onclick = () => { dlg.remove(); resolve(true); };
    dlg.querySelector('#cdlg-cancel').onclick  = () => { dlg.remove(); resolve(false); };
    dlg.onclick = e => { if (e.target === dlg) { dlg.remove(); resolve(false); } };
  });
}

// ── ADMIN GROUPS ─────────────────────────────────────────
async function openAdminGroups() {
  closeSidebar();
  show('admin-groups-modal');
  await renderAdminGroups();
}
function closeAdminGroups() { hide('admin-groups-modal'); }

// ── ADMIN USERS ──────────────────────────────────────────
async function openAdminUsers() {
  closeSidebar();
  show('admin-users-modal');
  const list = $('admin-users-list');
  list.innerHTML = '<div style="display:flex;justify-content:center;padding:30px"><div class="spinner"></div></div>';
  try {
    const { users } = await apiCall('/admin/users', 'GET');
    if (!users?.length) { list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Keine Benutzer gefunden.</p>'; return; }
    list.innerHTML = users.map(u => `
      <div class="admin-user-row" id="aur-${u.id}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border)">
        <div style="width:38px;height:38px;border-radius:50%;overflow:hidden;flex-shrink:0;background:${esc(u.color||'#888')};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px">
          ${u.avatar ? `<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover">` : (u.name||'?')[0].toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name||u.username)}</div>
          <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</div>
        </div>
        <select onchange="adminSetRole('${u.id}', this.value, this)"
          style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;cursor:pointer;flex-shrink:0"
          ${u.id === me.id ? 'title="Eigene Rolle kann nur geändert werden solange weitere Admins existieren"' : ''}>
          <option value="user" ${u.role==='user'?'selected':''}>Benutzer</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select>
      </div>`).join('');
  } catch(e) {
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Fehler beim Laden.</p>';
  }
}

async function adminSetRole(userId, newRole, selectEl) {
  const prev = newRole === 'admin' ? 'user' : 'admin';
  try {
    await apiCall(`/admin/users/${userId}/role`, 'PATCH', { role: newRole });
    toast(`Rolle auf „${newRole === 'admin' ? 'Admin' : 'Benutzer'}" gesetzt`, 'success');
  } catch(e) {
    toast(e.message || 'Fehler beim Ändern der Rolle', 'error');
    selectEl.value = prev; // Revert
  }
}

function closeAdminUsers() { hide('admin-users-modal'); }

async function renderAdminGroups() {
  const list = $('ag-list');
  list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Wird geladen…</div>';
  try {
    const { groups } = await apiCall('/groups/admin/all', 'GET');
    if (!groups.length) { list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Keine Gruppen vorhanden.</div>'; return; }
    list.innerHTML = groups.map(g => `
      <div id="ag-row-${g.id}" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div id="ag-view-${g.id}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Code: <span style="font-family:monospace;font-weight:700;letter-spacing:1px;color:var(--accent)">${esc(g.code)}</span> · ${g._count.members} Mitglieder · ${g._count.photos} Fotos</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button onclick="adminEditGroup('${g.id}','${esc(g.name)}','${esc(g.code)}')" style="background:var(--accent-l);border:none;color:var(--accent);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Bearbeiten</button>
            <button onclick="adminDeleteGroup('${g.id}','${esc(g.name)}')" style="background:none;border:1.5px solid var(--danger,#e05555);color:var(--danger,#e05555);padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Löschen</button>
          </div>
        </div>
        <div id="ag-edit-${g.id}" class="hidden" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <input id="ag-edit-name-${g.id}" type="text" value="${esc(g.name)}" maxlength="60"
            style="flex:2;min-width:140px;padding:8px 11px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);font-size:13px;color:var(--text);font-family:inherit"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
          <input id="ag-edit-code-${g.id}" type="text" value="${esc(g.code)}" maxlength="20"
            style="flex:1;min-width:110px;padding:8px 11px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);font-size:13px;color:var(--text);font-family:monospace;text-transform:uppercase;letter-spacing:1px"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
            oninput="this.value=this.value.toUpperCase()">
          <button onclick="adminSaveGroup('${g.id}')" style="background:var(--accent);border:none;color:#fff;padding:8px 14px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600">Speichern</button>
          <button onclick="adminCancelEdit('${g.id}')" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:8px 10px;border-radius:9px;cursor:pointer;font-size:13px">✕</button>
        </div>
        <div id="ag-err-${g.id}" class="msg hidden" style="margin-top:8px"></div>
      </div>`).join('');
  } catch(e) {
    list.innerHTML = `<div style="color:var(--danger,#e05555);font-size:13px">${esc(e.message)}</div>`;
  }
}

function adminEditGroup(id, name, code) {
  document.getElementById(`ag-view-${id}`).classList.add('hidden');
  document.getElementById(`ag-edit-${id}`).classList.remove('hidden');
  document.getElementById(`ag-edit-name-${id}`).focus();
}
function adminCancelEdit(id) {
  document.getElementById(`ag-view-${id}`).classList.remove('hidden');
  document.getElementById(`ag-edit-${id}`).classList.add('hidden');
}
async function adminSaveGroup(id) {
  const name = document.getElementById(`ag-edit-name-${id}`)?.value?.trim();
  const code = document.getElementById(`ag-edit-code-${id}`)?.value?.trim();
  const errEl = document.getElementById(`ag-err-${id}`);
  if (!name || !code) { errEl.textContent = '⚠ Name und Code erforderlich'; errEl.classList.remove('hidden'); return; }
  try {
    await apiCall(`/groups/admin/${id}`, 'PATCH', { name, code });
    await renderAdminGroups();
  } catch(e) {
    errEl.textContent = '❌ ' + (e.serverMessage || e.message);
    errEl.classList.remove('hidden');
  }
}
async function adminCreateGroup() {
  const name = $('ag-new-name')?.value?.trim();
  const code = $('ag-new-code')?.value?.trim();
  const msgEl = $('ag-create-msg');
  if (!name || !code) { msgEl.textContent = '⚠ Name und Code eingeben'; msgEl.className = 'msg msg-error'; msgEl.classList.remove('hidden'); return; }
  try {
    await apiCall('/groups/admin/create', 'POST', { name, code });
    $('ag-new-name').value = '';
    $('ag-new-code').value = '';
    msgEl.classList.add('hidden');
    await renderAdminGroups();
    toast('Gruppe angelegt', 'success');
  } catch(e) {
    msgEl.textContent = '❌ ' + (e.serverMessage || e.message);
    msgEl.className = 'msg msg-error';
    msgEl.classList.remove('hidden');
  }
}
async function adminDeleteGroup(id, name) {
  _agdm_id = id;
  _agdm_name = name;
  _agdm_backupDone = false;

  $('agdm-title').textContent = `Gruppe „${name}" löschen`;
  $('agdm-info').textContent = 'Alle Fotos, Alben und Mitglieder dieser Gruppe werden unwiderruflich gelöscht. Ein ZIP-Backup aller Fotos wird in jedem Fall in MinIO gespeichert (7 Tage).';

  show('agdm-actions');
  hide('agdm-loading');
  hide('agdm-result');
  $('agdm-confirm-delete-btn')?.classList.add('hidden');
  $('agdm-backup-btn').disabled = false;
  $('agdm-delete-btn').disabled = false;

  show('admin-group-delete-modal');
}

function closeAdminGroupDeleteModal() {
  hide('admin-group-delete-modal');
}

let _agdm_id = null;
let _agdm_name = null;
let _agdm_backupDone = false;

async function adminGroupDoBackup() {
  $('agdm-backup-btn').disabled = true;
  $('agdm-delete-btn').disabled = true;
  hide('agdm-actions');
  $('agdm-loading-text').textContent = 'ZIP wird erstellt…';
  show('agdm-loading');
  try {
    const { backupUrl, count } = await apiCall(`/groups/admin/${_agdm_id}/backup`, 'POST');
    hide('agdm-loading');
    show('agdm-result');
    if (backupUrl) {
      $('agdm-dl-link').href = backupUrl;
    } else {
      $('agdm-dl-link').closest('div').innerHTML = '<p style="color:var(--text2);font-size:13px;margin:0">ℹ️ Keine Fotos in dieser Gruppe — kein Backup nötig.</p>';
    }
    _agdm_backupDone = true;
    $('agdm-confirm-delete-btn')?.classList.remove('hidden');
  } catch (e) {
    hide('agdm-loading');
    show('agdm-actions');
    $('agdm-backup-btn').disabled = false;
    $('agdm-delete-btn').disabled = false;
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function adminGroupDoDelete() {
  $('agdm-backup-btn').disabled = true;
  $('agdm-delete-btn').disabled = true;
  hide('agdm-actions');
  $('agdm-loading-text').textContent = 'ZIP wird erstellt & Gruppe wird gelöscht…';
  show('agdm-loading');
  try {
    const res = await apiCall(`/groups/admin/${_agdm_id}`, 'DELETE');
    hide('agdm-loading');
    show('agdm-result');
    if (res.backupUrl) {
      $('agdm-dl-link').href = res.backupUrl;
    } else {
      $('agdm-dl-link').closest('div').innerHTML = '<p style="color:var(--text2);font-size:13px;margin:0">ℹ️ Keine Fotos vorhanden — kein Backup erstellt.</p>';
    }
    await _agdm_afterDelete(_agdm_id, _agdm_name);
  } catch (e) {
    hide('agdm-loading');
    show('agdm-actions');
    $('agdm-backup-btn').disabled = false;
    $('agdm-delete-btn').disabled = false;
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function adminGroupConfirmDelete() {
  $('agdm-confirm-delete-btn').disabled = true;
  $('agdm-loading-text').textContent = 'Gruppe wird gelöscht…';
  hide('agdm-result');
  show('agdm-loading');
  try {
    await apiCall(`/groups/admin/${_agdm_id}`, 'DELETE');
    hide('agdm-loading');
    await _agdm_afterDelete(_agdm_id, _agdm_name);
  } catch (e) {
    hide('agdm-loading');
    show('agdm-result');
    $('agdm-confirm-delete-btn').disabled = false;
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function _agdm_afterDelete(id, name) {
  closeAdminGroupDeleteModal();
  if (id === curGroupId) {
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || [];
    const next = myGroups[0];
    if (next) {
      curGroupId = next.id;
      try { localStorage.setItem('activeGroup', next.id); } catch(e) {}
      closeAdminGroups();
      await loadGroupMembers();
      await loadAlbums();
      renderGroupSwitcher();
      renderSidebar();
      await loadPhotos(true);
      toast(`Gruppe „${name}" gelöscht. Gewechselt zu „${next.name}"`, 'success');
      return;
    }
  } else {
    myGroups = myGroups.filter(g => g.id !== id);
  }
  await renderAdminGroups();
  toast(`Gruppe „${name}" gelöscht`, 'success');
}

// ── JOIN GROUP ───────────────────────────────────────────
function showGroupCode() {
  const g = myGroups.find(x => x.id === curGroupId);
  if (!g) return;
  // Remove any existing popup
  document.getElementById('group-code-popup')?.remove();
  const pop = document.createElement('div');
  pop.id = 'group-code-popup';
  pop.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:28px 28px 22px;z-index:500;box-shadow:var(--shadow2);min-width:280px;text-align:center;animation:fadeIn .2s ease';
  pop.innerHTML = `
    <div style="font-size:13px;color:var(--muted);margin-bottom:10px;font-weight:500">Einladungscode für</div>
    <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px">${esc(g.name)}</div>
    <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:var(--accent);background:var(--accent-l);border-radius:12px;padding:14px 18px;margin-bottom:18px;font-family:monospace" id="gc-code">${esc(g.code)}</div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button onclick="navigator.clipboard.writeText('${esc(g.code)}').then(()=>toast('Code kopiert','success'))" style="background:var(--accent);border:none;color:#fff;padding:9px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600">Kopieren</button>
      <button onclick="document.getElementById('group-code-popup').remove()" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:9px 18px;border-radius:10px;cursor:pointer;font-size:13px">Schließen</button>
    </div>`;
  document.body.appendChild(pop);
  // Close on backdrop click
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', h); }
  }), 50);
}

function openJoinGroup() {
  document.getElementById('group-dd')?.remove();
  $('join-group-code').value = '';
  hide('join-group-msg');
  show('join-group-modal');
}
function closeJoinGroup() { hide('join-group-modal'); }

function openLeaveGroup() {
  document.getElementById('group-dd')?.remove();
  const sel = $('leave-group-select');
  sel.innerHTML = myGroups.map(g =>
    `<option value="${g.id}"${g.id===curGroupId?' selected':''}>${esc(g.name)}</option>`
  ).join('');
  hide('leave-group-msg');
  show('leave-group-modal');
}
function closeLeaveGroup() { hide('leave-group-modal'); }

async function doLeaveGroup() {
  const groupId = $('leave-group-select').value;
  if (myGroups.length <= 1) {
    return showMsg('leave-group-msg', 'error', '⚠ Du kannst deine letzte Gruppe nicht verlassen.');
  }
  const groupName = myGroups.find(g => g.id === groupId)?.name || 'Gruppe';
  const confirmed = await showConfirmDlg(
    `„${groupName}" verlassen`,
    'Du verlässt diese Gruppe und siehst ihre Fotos nicht mehr. Deine hochgeladenen Fotos bleiben erhalten.',
    'Verlassen', 'Abbrechen', true
  );
  if (!confirmed) return;
  setBL('leave-group-btn', true, 'Wird verlassen…');
  try {
    await apiCall(`/groups/${groupId}/leave`, 'DELETE');
    myGroups = myGroups.filter(g => g.id !== groupId);
    closeLeaveGroup();
    // Falls aktive Gruppe verlassen → zur nächsten wechseln
    if (groupId === curGroupId) {
      curGroupId = myGroups[0].id;
      try { localStorage.setItem('activeGroup', curGroupId); } catch(e) {}
      renderGroupSwitcher();
      const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
      groupMembers = members || [];
      groupMembers.forEach(m => { allProfiles[m.id] = m; });
      curAlbum = null; curFilter = null; curFilterUserId = null;
      await loadAlbums();
      renderSidebar();
      await loadPhotos(true);
      toast(`„${groupName}" verlassen. Gewechselt zu „${myGroups[0].name}".`, 'success');
    } else {
      renderGroupSwitcher();
      renderSidebar();
      toast(`„${groupName}" erfolgreich verlassen.`, 'success');
    }
  } catch(e) {
    const msg = e.serverMessage || 'Fehler beim Verlassen der Gruppe.';
    showMsg('leave-group-msg', 'error', msg);
  } finally {
    setBL('leave-group-btn', false, 'Verlassen');
  }
}

async function doJoinGroup() {
  const code = V('join-group-code').trim();
  if (!code) return showMsg('join-group-msg','error','⚠ Bitte Code eingeben.');
  setBL('join-group-btn',true,'Wird beigetreten…');
  try {
    const { group } = await apiCall('/groups/join', 'POST', { code });
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || [];
    curGroupId = group.id;
    try { localStorage.setItem('activeGroup', group.id); } catch(e){}
    closeJoinGroup();
    await loadGroupMembers();
    await loadAlbums();
    renderGroupSwitcher();
    renderSidebar();
    await loadPhotos(true);
    toast('Gruppe beigetreten!', 'success');
  } catch(e) {
    const status = e.status;
    const msg = e.serverMessage || e.message || '';
    let display;
    if (status === 404 || msg.toLowerCase().includes('nicht gefunden')) display = '❌ Ungültiger Gruppencode – bitte prüfen.';
    else if (status === 409 || msg.toLowerCase().includes('bereits')) display = 'ℹ️ Du bist dieser Gruppe bereits beigetreten.';
    else if (status === 400) display = '⚠️ Bitte einen Gruppencode eingeben.';
    else if (msg) display = '❌ ' + msg;
    else display = '❌ Beitritt fehlgeschlagen. Bitte versuche es erneut.';
    showMsg('join-group-msg','error', display);
  } finally { setBL('join-group-btn',false,'Beitreten →'); }
}

// ── DARK MODE ─────────────────────────────────────────────
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  try { localStorage.setItem('theme', isDark ? 'light' : 'dark'); } catch(e){}
  updateThemeIcon();
  if (typeof syncThemeColor === 'function') syncThemeColor();
}
function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const sunSvg = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const moonSvg = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const content = isDark ? sunSvg : moonSvg;
  ['theme-icon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content;
  });
}
// Restore theme on load
try { if (localStorage.getItem('theme')==='dark') document.documentElement.setAttribute('data-theme','dark'); } catch(e){}

// ── SORTING ──────────────────────────────────────────────
function changeSort(val) {
  curSort = val;
  loadPhotos(true);
}

// ── MULTI-SELECT ─────────────────────────────────────────
function toggleSelectMode() {
  selectMode = !selectMode;
  window.selectMode = selectMode;
  selectedIds.clear();
  const grid = $('grid');
  const toggle = $('sel-toggle');
  if (selectMode) {
    grid.classList.add('selecting');
    toggle.classList.add('active');
    toggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Abbrechen`;
    show('bulk-bar');
  } else {
    grid.classList.remove('selecting');
    toggle.classList.remove('active');
    toggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Auswählen`;
    hide('bulk-bar');
    document.querySelectorAll('.p-card.selected').forEach(c => c.classList.remove('selected'));
  }
  updateBulkCount();
}

function toggleCardSelect(id, el) {
  if (!selectMode) return;
  if (selectedIds.has(id)) { selectedIds.delete(id); el.classList.remove('selected'); }
  else { selectedIds.add(id); el.classList.add('selected'); }
  updateBulkCount();
}

function updateBulkCount() {
  const el = $('bulk-count');
  if (el) el.textContent = selectedIds.size === 1 ? '1 Foto' : `${selectedIds.size} Fotos`;
}

async function bulkDelete() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  const own = ids.filter(id => { const p=photos.find(x=>x.id===id); return p?.uploaderId===me.id; });
  const foreign = ids.length - own.length;
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if(ico) ico.textContent = '🗑';
  if (own.length === 0) {
    if(txt) txt.textContent = 'Du kannst nur eigene Fotos löschen. Keins der ausgewählten Fotos gehört dir.';
    btns.className = 'dlg-btns';
    btns.innerHTML = `<button class="btn btn-ghost" onclick="cancelDel()">Verstanden</button>`;
  } else if (foreign > 0) {
    if(txt) txt.textContent = `${own.length} eigene${own.length>1?' Fotos':' Foto'} löschen? (${foreign} fremde${foreign>1?' Fotos':' Foto'} werden übersprungen)`;
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execBulkDelete()">Eigene löschen</button>`;
  } else {
    if(txt) txt.textContent = `${own.length} Foto${own.length>1?'s':''} wirklich unwiderruflich löschen?`;
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execBulkDelete()">Alle löschen</button>`;
  }
  show('del-dlg');
}

async function execBulkDelete() {
  hide('del-dlg');
  const ids = [...selectedIds].filter(id => { const p=photos.find(x=>x.id===id); return p?.uploaderId===me.id; });
  if (!ids.length) { toggleSelectMode(); return; }
  for (const id of ids) {
    try {
      const p = photos.find(x=>x.id===id);
      delete urlCache[id];
      try { await apiCall(`/photos/${id}`, 'DELETE'); } catch(e) { console.error(e); }
    } catch(e) { console.error(e); }
  }
  toast(`${ids.length} Foto${ids.length>1?'s':''} gelöscht`, 'success');
  toggleSelectMode();
  await loadPhotos(true); renderSidebar();
}

function bulkMoveToAlbum() {
  if (!selectedIds.size) return;
  if (!allAlbums.length) { toast('Erstelle zuerst ein Album','info'); return; }
  const sel = $('bulk-album-select');
  sel.innerHTML = allAlbums.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  show('bulk-album-modal');
}
function closeBulkAlbumModal() { hide('bulk-album-modal'); }
async function execBulkMoveToAlbum() {
  const albumId = $('bulk-album-select').value;
  if (!albumId) return;
  hide('bulk-album-modal');
  try {
    await apiCall('/photos/batch-album', 'PATCH', { photoIds: [...selectedIds], albumId });
  } catch(e) { toast('Verschieben fehlgeschlagen','error'); return; }
  toast(`${selectedIds.size} Foto${selectedIds.size>1?'s':''} verschoben`, 'success');
  toggleSelectMode();
  await loadAlbums();
  await loadPhotos(true);
  renderSidebar();
}

async function bulkDownload() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  const btn = $('bulk-down-btn');
  const orig = btn.textContent;
  btn.innerHTML = '<span class="spin-sm"></span> Lädt…';
  btn.disabled = true;
  let done = 0;
  for (const id of ids) {
    try {
      const p = photos.find(x=>x.id===id);
      if (!p) continue;
      const url = await getSignedUrl(p.storage_path);
      if (!url) continue;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.filename || 'foto.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      done++;
      btn.innerHTML = `<span class="spin-sm"></span> ${done}/${ids.length}`;
    } catch(e) { console.error(e); }
  }
  btn.textContent = orig;
  btn.disabled = false;
  toast(`${done} Foto${done>1?'s':''} heruntergeladen`, 'success');
}

// ── TOUCH SWIPE (Lightbox) ──────────────────────────────
let touchStartX = 0, touchStartY = 0, touchMoved = false;

let zoomScale = 1, zoomX = 0, zoomY = 0, _pinchStartDist = 0;

function initLbSwipe() {
  const el = $('lb');
  if (!el) return;

  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _pinchStartDist = getTouchDist(e.touches);
      e.preventDefault();
    } else if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }
  }, {passive:false});

  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dist = getTouchDist(e.touches);
      zoomScale = Math.min(4, Math.max(1, dist / _pinchStartDist));
      const img = $('lb-img');
      if (img) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = img.getBoundingClientRect();
        const ox = (cx - rect.left) / rect.width * 100;
        const oy = (cy - rect.top) / rect.height * 100;
        img.style.transformOrigin = `${ox}% ${oy}%`;
        img.style.transform = `scale(${zoomScale})`;
        img.style.transition = 'none';
      }
      e.preventDefault();
    } else if (e.touches.length === 1) {
      touchMoved = true;
    }
  }, {passive:false});

  el.addEventListener('touchend', e => {
    if (zoomScale > 1) {
      // Snap back to normal
      const img = $('lb-img');
      if (img) {
        img.style.transition = 'transform .25s ease';
        img.style.transform = '';
        setTimeout(() => { img.style.transition = ''; img.style.transformOrigin = ''; }, 260);
      }
      zoomScale = 1;
      return;
    }
    // Swipe navigation (only when not zoomed)
    if (!touchMoved) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) lbNav(1);
      else lbNav(-1);
    }
  }, {passive:true});
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

function resetZoom() {
  zoomScale = 1;
  const img = $('lb-img');
  if (img) { img.style.transform = ''; img.style.transformOrigin = ''; img.style.transition = ''; }
}

// ── BLUR PLACEHOLDER HELPER ─────────────────────────────
function onThumbLoad(img) {
  img.classList.remove('loading');
  img.classList.add('loaded');
}

// ── FULLVIEW MODE ─────────────────────────────────────────
function toggleFullview() {
  const lb = $('lb');
  const isFullview = lb.classList.contains('lb-fullview');
  lb.classList.toggle('lb-fullview');
  updateFullviewBtn();
  if (!isFullview) {
    // Show hint
    document.querySelectorAll('.lb-fullview-hint').forEach(e=>e.remove());
    const hint = document.createElement('div');
    hint.className = 'lb-fullview-hint';
    hint.textContent = 'Tippe auf das Bild zum Beenden';
    document.body.appendChild(hint);
    setTimeout(()=>hint.remove(), 2500);
  } else {
    document.querySelectorAll('.lb-fullview-hint').forEach(e=>e.remove());
  }
}

function updateFullviewBtn() {
  const btn = $('lb-full-btn');
  if (!btn) return;
  const isFullview = $('lb').classList.contains('lb-fullview');
  btn.innerHTML = (isFullview ? ICON_SHRINK : ICON_FULLSCREEN) + (isFullview ? ' Verkleinern' : ' Vollbild');
}

// ── EDIT DESCRIPTION ──────────────────────────────────────
function editDesc() {
  const p = photos[lbIdx];
  if (!p || p.uploaderId !== me.id) return;
  const wrap = document.getElementById('lb-desc-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <input type="text" id="desc-edit-input" value="${esc(p.description||'')}" placeholder="Beschreibung eingeben…"
      maxlength="200" style="flex:1;padding:8px 10px;border-radius:8px;border:1.5px solid var(--accent);background:var(--bg);color:var(--text);font-size:13px;outline:none;font-family:inherit"
      onkeydown="if(event.key==='Enter')saveDesc();if(event.key==='Escape')openLB(lbIdx)">
    <button onclick="saveDesc()" style="background:var(--accent);border:none;color:#fff;padding:7px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;flex-shrink:0">✓</button>
    <button onclick="openLB(lbIdx)" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:7px 9px;border-radius:8px;cursor:pointer;font-size:13px;flex-shrink:0">✕</button>`;
  document.getElementById('desc-edit-input')?.focus();
}

async function saveDesc() {
  const p = photos[lbIdx];
  if (!p) return;
  const input = document.getElementById('desc-edit-input');
  const newDesc = input?.value?.trim() || null;
  try {
    await apiCall(`/photos/${p.id}`, 'PATCH', { description: newDesc });
    p.description = newDesc;
    // Karte im Grid sofort aktualisieren
    const card = document.getElementById('pc-'+p.id);
    if (card) {
      const descEl = card.querySelector('.p-desc');
      if (newDesc) {
        if (descEl) descEl.textContent = newDesc;
        else {
          const meta = card.querySelector('.p-meta');
          if (meta) meta.insertAdjacentHTML('afterbegin', `<div class="p-desc">${esc(newDesc)}</div>`);
        }
      } else {
        if (descEl) descEl.remove();
      }
      const ovDesc = card.querySelector('.p-ov-desc');
      if (newDesc) {
        if (ovDesc) ovDesc.textContent = newDesc;
        else {
          const ov = card.querySelector('.p-ov');
          if (ov) ov.insertAdjacentHTML('beforeend', `<div class="p-ov-desc">${esc(newDesc)}</div>`);
        }
      } else {
        if (ovDesc) ovDesc.remove();
      }
    }
    toast('Beschreibung gespeichert', 'success');
    openLB(lbIdx);
  } catch(e) {
    toast('Fehler beim Speichern', 'error');
  }
}

// ── DOWNLOAD ──────────────────────────────────────────────
async function downloadPhoto() {
  const p = photos[lbIdx];
  if (!p) return;
  const btn = $('lb-down-btn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spin-sm"></span> Lädt…';
  try {
    const url = urlCache[p.id] || p.url;
    if (!url) { toast('URL nicht verfügbar','error'); btn.innerHTML=orig; return; }
    const resp = await fetch(photoSrc(url));
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.filename || 'foto.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch(e) { console.error(e); }
  btn.innerHTML = orig;
}

// ── SERVICE WORKER (PWA) ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/script/sw.js', { scope: '/' })
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.log('SW failed:', err));
  });
}

// Sync theme-color meta tag with dark mode
function syncThemeColor() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? '#141210' : '#8a6a4a';
}

// ── GLOBAL EXPORTS für onclick-Handler im HTML ───────────
// ES-Module haben ihren eigenen Scope; onclick="fn()" braucht window.fn
Object.assign(window, {
  // Auth / Session
  doLogout,
  // Navigation / Sidebar
  toggleSidebar, openSidebar, closeSidebar,
  switchFolder, switchAlbum, switchToUser,
  toast,
  // Upload Modal
  openModal, closeModal, handleFiles,
  // Gallery
  loadMore, toggleSelectMode, toggleCardSelect, switchView,
  openLB, doLike,
  // Lightbox
  closeLB, lbNav, handleLbBgClick,
  toggleLike, sendComment, deleteComment,
  showLikersList, toggleFullview, downloadPhoto,
  openAlbumPicker, togglePhotoAlbum,
  editDesc, saveDesc,
  // Delete dialogs
  askDel, cancelDel, execDel, removeFromAlbum,
  // Bulk actions
  bulkDelete, execBulkDelete, bulkMoveToAlbum, closeBulkAlbumModal, execBulkMoveToAlbum, bulkDownload,
  // Albums
  openAlbumModal, closeAlbumModal, createAlbum,
  openNewAlbumInline, closeNewAlbumInline, createAlbumInline,
  deleteAlbum, execDeleteAlbum,
  // Add-to-album modal
  openAddFromAll, closeAddModal, confirmAddToAlbum, toggleAddSelection,
  // Profile
  openProfileModal, closeProfileModal, uploadAvatar, clearAvatar, setUserColor,
  // Groups
  switchGroup, openJoinGroup, closeJoinGroup, doJoinGroup, showGroupCode,
  openLeaveGroup, closeLeaveGroup, doLeaveGroup,
  openAdminGroups, closeAdminGroups, adminEditGroup, adminCancelEdit, adminSaveGroup, adminCreateGroup, adminDeleteGroup,
  closeAdminGroupDeleteModal, adminGroupDoBackup, adminGroupDoDelete, adminGroupConfirmDelete,
  openAdminUsers, closeAdminUsers, adminSetRole,
  toggleGroupDropdown,
  // Slideshow
  openSS, toggleSS, ssChangeSpeed,
  // Misc
  toggleDarkMode, changeSort,
  // Utility (gebraucht von HTML onclick z.B. dz-onclick)
  $,
  onThumbLoad,
});
