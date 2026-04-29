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
  rpc: () => Promise.resolve({ data: null, error: 'Supabase stub' }),
  storage: {
    from: () => ({
      upload: () => Promise.resolve({ error: null }),
      createSignedUrl: () => Promise.resolve({ data: null }),
      createSignedUrls: () => Promise.resolve({ data: [] }),
      remove: () => Promise.resolve({ error: null }),
    }),
  },
};

const SHARED = 'gemeinsam';
const MAX_USR = 10;
const PG_SIZE = 24;
const SIGNED_URL_EXPIRES = 3600;
const COLORS = [
  '#b07448',
  '#5a9e7a',
  '#6888d4',
  '#c86888',
  '#8868c8',
  '#4aacb8',
  '#c8a048',
  '#7888c8',
  '#a8c858',
  '#c87848',
];

let me,
  meProfile,
  curFolder = SHARED,
  curAlbum = null,
  curFilter = null;
let curView = 'medium';
let curSort = 'newest';
let selectMode = false,
  selectedIds = new Set();
let curGroupId = null,
  myGroups = [],
  groupMembers = [],
  groupDeputies = [];
let curFilterUserId = null;
let allProfiles = {},
  photos = [],
  pgFrom = 0,
  hasMore = false;
let allAlbums = [];
let urlCache = {};
let lbIdx = 0,
  delTarget = null,
  delFromLb = false;
let appVersion = '...';
let changelogEntries = [];
let changelogEditingId = null;

// Hängt den Access-Token als ?t= an Foto-URLs (nötig da <img src> keinen Auth-Header sendet)
function photoSrc(url) {
  if (!url) return url;
  const t = sessionStorage.getItem('accessToken');
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t);
}
// Dasselbe für Backup-Download-URLs — kein Auth nötig, zipKey ist das Geheimnis
function backupSrc(url) {
  return url;
}
let ssPlaying = false,
  ssTimer = null,
  ssSpeeds = [3, 4, 6, 8],
  ssSpeedIdx = 1;
let lbLiked = false,
  lbLikeCount = 0,
  lbComments = [],
  lbLikers = [];

// ── SVG ICONS (dedupliziert) ────────────────────────────
const _heart = (s, f) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${f ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
const ICON_HEART_EMPTY = _heart(14, false);
const ICON_HEART_FULL = _heart(14, true);
const ICON_HEART_LG_EMPTY = _heart(18, false);
const ICON_HEART_LG_FULL = _heart(18, true);
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
function toast(msg, type = 'info') {
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
function toLogin() {
  hide('reg-card');
  hide('forgot-card');
  show('login-card');
}
function toReg() {
  /* Registration disabled - use Authentik instead */
}
function toForgot() {
  /* Forgot password disabled - use Authentik instead */
}

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

function resolveDisplayName(user, preferredField) {
  if (!user) return '';
  const field = preferredField !== undefined ? preferredField : user.displayNameField || 'name';
  if (field === 'username') return user.username || user.name || '';
  if (field === 'name') return user.name || user.username || '';
  return '';
}

function getVisibleProfile(user) {
  if (!user) return null;
  if (!user.id) return user;
  return { ...(allProfiles[user.id] || {}), ...user };
}

function getVisibleName(user, preferredField) {
  return resolveDisplayName(getVisibleProfile(user), preferredField);
}

function getVisibleInitial(user, preferredField) {
  const visibleName = getVisibleName(user, preferredField);
  const fallback = user?.username || user?.email || '?';
  return (visibleName || fallback || '?')[0].toUpperCase();
}

function withCacheBust(url) {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

// ── APP START ─────────────────────────────────────────────
async function startApp() {
  hide('auth-page');
  $('app').classList.add('show');

  if (!me || !me.email) {
    toast('Authentifizierung fehlgeschlagen', 'error');
    hide('app');
    show('auth-page');
    return;
  }

  // Set user profile UI
  meProfile = me;
  // Freeze original OIDC values so toggle buttons always have correct labels
  me._origName = me.name;
  me._origUsername = me.username;
  const avElement = $('hav');
  if (avElement) {
    if (me.avatar) {
      avElement.innerHTML = `<img class="av-img" src="${esc(me.avatar)}">`;
    } else {
      avElement.textContent = getVisibleInitial(me, me.displayNameField);
      avElement.style.background = me.color || '#8a6a4a';
    }
  }

  const nameElement = $('hname');
  if (nameElement) {
    nameElement.textContent = getVisibleName(me, me.displayNameField) || me.email;
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
      curGroupId = saved && myGroups.find((g) => g.id === saved) ? saved : myGroups[0].id;
    }
  } catch (e) {
    console.error('Gruppen laden fehlgeschlagen:', e);
  }

  // Gruppenmmitglieder laden (für Sidebar)
  if (curGroupId) {
    try {
      await loadGroupMembers();
    } catch (e) {
      console.warn('Mitglieder laden fehlgeschlagen:', e);
    }
  }

  // Gruppen-Vertreter laden
  if (curGroupId) {
    try {
      const { deputies } = await apiCall(`/groups/${curGroupId}/deputies`, 'GET');
      groupDeputies = deputies || [];
    } catch (e) {
      console.warn('Deputies laden fehlgeschlagen:', e);
    }
  }

  // Alben laden
  if (curGroupId) await loadAlbums();

  renderGroupSwitcher();
  // Sidebar asynchron rendern (blockiert App-Start nicht)
  setTimeout(() => renderSidebar(), 100);
  loadAppVersion();

  // Fotos laden
  if (curGroupId) await loadPhotos(true);
  else toast('Keine Gruppe gefunden – ein Album wird automatisch erstellt.', 'info');

  // Notifications initialisieren
  loadNotifications();
  initNotificationSSE();
  // Broadcast-Button nur für Admins anzeigen
  const broadcastBtn = $('notif-broadcast-btn');
  if (broadcastBtn && me?.role === 'admin') broadcastBtn.style.display = '';
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
  const sortedAlbums = [...allAlbums].sort((a, b) => {
    const aOwn = a.createdBy === me.id ? 0 : 1;
    const bOwn = b.createdBy === me.id ? 0 : 1;
    return aOwn - bOwn;
  });
  const albumsListHtml = sortedAlbums
    .map((a) => {
      const isOwn = a.createdBy === me.id;
      return `
    <button class="fb ${curAlbum === a.id ? 'active' : ''}" onclick="switchAlbum('${a.id}')" ${isOwn ? 'style="font-weight:600"' : ''}>
      <span class="fi" style="${isOwn ? 'color:var(--accent)' : ''}">${ICON_ALBUM}</span>
      <span class="fn" style="${isOwn ? 'color:var(--accent)' : ''}">${esc(a.name)}</span>
      <span class="fc" id="fc-a-${a.id}">…</span>
    </button>`;
    })
    .join('');

  // Members list (exclude self, already shown as "Meine Fotos")
  const curGroup = myGroups.find((x) => x.id === curGroupId);
  const deputyIds = new Set(groupDeputies.map((d) => d.id));
  const selfFromMembers = groupMembers.find((m) => m.id === me.id) || {};
  const selfMember = {
    ...selfFromMembers,
    ...meProfile,
    id: me.id,
    displayNameField:
      me.displayNameField ?? selfFromMembers.displayNameField ?? meProfile?.displayNameField,
  };
  const otherMembers = groupMembers
    .filter((m) => m.id !== me.id)
    .slice()
    .sort((a, b) =>
      getVisibleName(a).localeCompare(getVisibleName(b), 'de', { sensitivity: 'base' })
    );
  const allMembers = [selfMember, ...otherMembers];
  const membersHtml = allMembers
    .map((m) => {
      const isSelf = m.id === me.id;
      const isOwner = curGroup?.createdBy === m.id;
      const isDeputy = deputyIds.has(m.id);
      const badge = isOwner
        ? `<span style="font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-l);border-radius:4px;padding:1px 5px;flex-shrink:0" title="Gruppen-Owner">Owner</span>`
        : isDeputy
          ? `<span style="font-size:10px;font-weight:600;color:var(--muted2);background:var(--border);border-radius:4px;padding:1px 5px;flex-shrink:0" title="Vertreter">Vertreter</span>`
          : '';
      const isActive = isSelf
        ? curFilter === 'mine' && !curAlbum && !curFilterUserId
        : curFilterUserId === m.id;
      const onclick = isSelf ? `switchFolder('mine')` : `switchToUser('${m.id}')`;
      const resolvedName = getVisibleName(m, isSelf ? me.displayNameField : undefined);
      const displayName = isSelf
        ? `${esc(resolvedName || '?')} <span style="font-size:10px;color:var(--muted);font-weight:400">(du)</span>`
        : esc(resolvedName || '?');
      return `
    <button class="fb ${isActive ? 'active' : ''}" onclick="${onclick}" style="gap:6px">
      <span class="fi">${avatarHtml(m, 20)}</span>
      <span class="fn" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayName}</span>
      ${badge}
    </button>`;
    })
    .join('');

  const isOwnerInCurrentGroup = curGroup?.createdBy === me.id;
  const isDeputyInCurrentGroup = deputyIds.has(me.id);
  const canSeeInviteCode =
    !!curGroup &&
    (isOwnerInCurrentGroup || isDeputyInCurrentGroup || curGroup.inviteCodeVisibleToMembers);
  const membersCounter =
    curGroup?.maxMembers !== null && curGroup?.maxMembers !== undefined
      ? `${allMembers.length}/${curGroup.maxMembers}`
      : null;

  $('sidebar').innerHTML = `
    <span class="sb-label">Fotos</span>
    <button class="fb ${!curAlbum && !curFilter && !curFilterUserId ? 'active' : ''}" onclick="switchFolder(null)">
      <span class="fi">${ICON_GRID}</span>
      <span class="fn">Alle Fotos</span>
      <span class="fc" id="fc-all">…</span>
    </button>
    <button class="fb ${curFilter === 'mine' && !curAlbum ? 'active' : ''}" onclick="switchFolder('mine')">
      <span class="fi">${avatarHtml(meProfile, 20)}</span>
      <span class="fn">Meine Fotos</span>
      <span class="fc" id="fc-mine">…</span>
    </button>
    <button class="fb" onclick="openSS()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}">
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
    <button class="fb" onclick="openAlbumModal()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}">
      <span class="fi">${ICON_ALBUM_MANAGE}</span>
      <span class="fn">Alben verwalten</span>
    </button>
    ${
      allMembers.length
        ? `
      <div class="sb-div"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 4px;gap:8px">
        <span class="sb-label" style="padding:0">Mitglieder</span>
        ${membersCounter ? `<span style="font-size:11px;color:var(--muted);font-weight:600">${membersCounter}</span>` : ''}
      </div>
      ${membersHtml}
    `
        : ''
    }
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
    ${
      canSeeInviteCode
        ? `
    <button class="fb" onclick="showGroupCode()">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg></span>
      <span class="fn">Einladungscode anzeigen</span>
    </button>`
        : ''
    }
    ${
      isOwnerInCurrentGroup
        ? `
    <button class="fb" onclick="openGroupSettingsModal()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}">
      <span class="fi">${ICON_GEAR}</span>
      <span class="fn">Gruppe verwalten</span>
    </button>`
        : ''
    }
    ${
      window.innerWidth <= 900 && myGroups.length > 1
        ? `
    <div class="sb-div"></div>
    <span class="sb-label">Gruppe wechseln</span>
    ${myGroups
      .map(
        (g) => `
    <button class="fb ${g.id === curGroupId ? 'active' : ''}" onclick="switchGroup('${g.id}');closeSidebar()">
      <span class="fi" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
      <span class="fn">${esc(g.name)}</span>
    </button>`
      )
      .join('')}`
        : ''
    }
    ${
      me.role === 'admin'
        ? `
    <div class="sb-div"></div>
    <span class="sb-label">Admin</span>
    <button class="fb" onclick="openAdminUsers()">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
      <span class="fn">Benutzer verwalten</span>
    </button>
    <button class="fb" onclick="openAdminGroups()">
      <span class="fi">${ICON_GEAR}</span>
      <span class="fn">Gruppen verwalten</span>
    </button>
    <button class="fb" onclick="openAdminBackups()">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 15 21 21 3 21 3 15"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
      <span class="fn">Backups verwalten</span>
    </button>
    <button class="fb" onclick="openAdminFeedback()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}">
      <span class="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
      <span class="fn">Feedback &amp; Meldungen</span>
      <span id="admin-feedback-badge" class="fb-badge hidden"></span>
    </button>`
        : ''
    }
    <div class="sb-div"></div>
    <button class="fb" onclick="toggleDarkMode()" id="theme-btn" title="Dark Mode">
      <span class="fi"><svg id="theme-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
      <span class="fn">Nachtmodus</span>
    </button>
    <button class="fb" onclick="openSupportModal()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}" title="Hilfe &amp; Feedback">
      <span class="fi"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
      <span class="fn">Hilfe &amp; Feedback</span>
    </button>
    <button class="fb sb-version-link" onclick="openChangelogModal()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}" title="Changelog öffnen">
      <span class="fi"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg></span>
      <span class="fn">Version <span id="sb-version-text">v${esc(appVersion)}</span></span>
    </button>
  `;
  loadSidebarAvatars();
  // Load counts asynchronously (don't block sidebar rendering)
  try {
    fetchCounts();
    allAlbums.forEach((a) => fetchAlbumCount(a.id));
  } catch (e) {
    console.warn('Error fetching sidebar counts:', e);
  }
  updateThemeIcon();
  // Sidebar footer: always show profile + logout at bottom
  const sb2 = $('sidebar');
  const footerDiv = document.createElement('div');
  footerDiv.id = 'sb-mobile-extra';
  footerDiv.innerHTML = `
    <div class="sb-footer">
      <div class="sb-div" style="margin:0 4px 2px"></div>
      <button class="sb-profile-btn" onclick="openProfileModal();closeSidebar()">
        <div class="av" style="background:${meProfile.color};width:32px;height:32px;font-size:13px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;border-radius:50%;overflow:hidden">${avatarHtml(meProfile, 32)}</div>
        <span>${esc(getVisibleName(meProfile, me.displayNameField) || me.email)}</span>
      </button>
      <button class="sb-logout-btn" onclick="doLogout()">Abmelden</button>
    </div>`;
  sb2.appendChild(footerDiv);

  if (me?.role === 'admin') {
    refreshAdminFeedbackBadge();
  }
}

function updateAppVersionUi() {
  const sbVersionEl = $('sb-version-text');
  if (sbVersionEl) sbVersionEl.textContent = `v${appVersion}`;
  const modalVersionEl = $('changelog-current-version');
  if (modalVersionEl) modalVersionEl.textContent = `Version ${appVersion}`;
  const inputVersion = $('changelog-version-input');
  if (inputVersion && !inputVersion.value.trim()) inputVersion.value = appVersion;
}

async function loadAppVersion() {
  try {
    const data = await apiCall('/changelog/meta', 'GET');
    if (data?.appVersion) {
      appVersion = String(data.appVersion);
      updateAppVersionUi();
    }
  } catch {
    // Changelog ist optional; UI bleibt mit Fallback-Version nutzbar
  }
}

function closeChangelogModal() {
  hide('changelog-modal');
}

function renderChangelogList() {
  const list = $('changelog-list');
  if (!list) return;

  if (!changelogEntries.length) {
    list.innerHTML = '<div class="changelog-empty">Noch keine Einträge vorhanden.</div>';
    return;
  }

  list.innerHTML = changelogEntries
    .map((entry) => {
      const isAdmin = me?.role === 'admin';
      const isEditing = changelogEditingId === entry.id;
      const createdAt = new Date(entry.createdAt);
      const dateLabel = Number.isNaN(createdAt.getTime())
        ? ''
        : createdAt.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
      const editVersionId = `changelog-edit-version-${entry.id}`;
      const editTitleId = `changelog-edit-title-${entry.id}`;
      const editBodyId = `changelog-edit-body-${entry.id}`;
      return `
      <article class="changelog-item">
        <div class="changelog-item-top">
          <span class="changelog-badge">v${esc(entry.version || '?')}</span>
          <span class="changelog-date">${esc(dateLabel)}</span>
        </div>
        ${
          isEditing
            ? `
          <div class="changelog-edit-form">
            <div class="changelog-edit-grid">
              <input id="${editVersionId}" class="broadcast-input" type="text" maxlength="32" value="${esc(entry.version || '')}">
              <input id="${editTitleId}" class="broadcast-input" type="text" maxlength="140" value="${esc(entry.title || '')}">
            </div>
            <textarea id="${editBodyId}" class="broadcast-input broadcast-textarea" rows="3" maxlength="4000">${esc(entry.body || '')}</textarea>
            <div class="changelog-item-actions">
              <button class="btn btn-ghost changelog-item-btn" onclick="cancelEditChangelogEntry()">Abbrechen</button>
              <button class="btn btn-primary changelog-item-btn" onclick="saveEditChangelogEntry('${entry.id}')">Speichern</button>
            </div>
          </div>
        `
            : `
          <h4>${esc(entry.title || '')}</h4>
          ${entry.body ? `<p>${esc(entry.body).replace(/\n/g, '<br>')}</p>` : ''}
        `
        }
        ${entry.createdByName ? `<div class="changelog-author">von ${esc(entry.createdByName)}</div>` : ''}
        ${
          isAdmin && !isEditing
            ? `
          <div class="changelog-item-actions">
            <button class="btn btn-ghost changelog-item-btn" onclick="startEditChangelogEntry('${entry.id}')">Bearbeiten</button>
            <button class="btn btn-danger changelog-item-btn" onclick="deleteChangelogEntry('${entry.id}')">Löschen</button>
          </div>
        `
            : ''
        }
      </article>
    `;
    })
    .join('');
}

function startEditChangelogEntry(id) {
  changelogEditingId = id;
  renderChangelogList();
}

function cancelEditChangelogEntry() {
  changelogEditingId = null;
  renderChangelogList();
}

async function saveEditChangelogEntry(id) {
  if (me?.role !== 'admin') {
    toast('Nur Admins können Changelog-Einträge bearbeiten', 'error');
    return;
  }

  const version = $(`changelog-edit-version-${id}`)?.value?.trim();
  const title = $(`changelog-edit-title-${id}`)?.value?.trim();
  const body = $(`changelog-edit-body-${id}`)?.value?.trim();

  if (!version || !title) {
    toast('Version und Titel sind Pflichtfelder', 'error');
    return;
  }

  try {
    await apiCall(`/changelog/${id}`, 'PATCH', { version, title, body });
    changelogEditingId = null;
    toast('Changelog-Eintrag aktualisiert', 'success');
    await loadChangelogEntries();
  } catch (e) {
    toast(e.serverMessage || 'Aktualisieren fehlgeschlagen', 'error');
  }
}

async function deleteChangelogEntry(id) {
  if (me?.role !== 'admin') {
    toast('Nur Admins können Changelog-Einträge löschen', 'error');
    return;
  }

  const confirmed = await showConfirmDlg(
    'Changelog löschen?',
    'Der Eintrag wird dauerhaft gelöscht.',
    'Löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  try {
    await apiCall(`/changelog/${id}`, 'DELETE');
    if (changelogEditingId === id) changelogEditingId = null;
    toast('Changelog-Eintrag gelöscht', 'success');
    await loadChangelogEntries();
  } catch (e) {
    toast(e.serverMessage || 'Löschen fehlgeschlagen', 'error');
  }
}

function updateChangelogAdminFormVisibility() {
  const formWrap = $('changelog-admin-form-wrap');
  if (!formWrap) return;
  formWrap.classList.toggle('hidden', me?.role !== 'admin');
}

async function loadChangelogEntries() {
  const list = $('changelog-list');
  if (list) list.innerHTML = '<div class="changelog-loading"><div class="spinner"></div></div>';

  const data = await apiCall('/changelog?limit=40', 'GET');
  if (data?.appVersion) appVersion = String(data.appVersion);
  changelogEntries = Array.isArray(data?.entries) ? data.entries : [];
  updateAppVersionUi();
  renderChangelogList();
}

async function openChangelogModal() {
  show('changelog-modal');
  changelogEditingId = null;
  updateAppVersionUi();
  updateChangelogAdminFormVisibility();
  try {
    await loadChangelogEntries();
  } catch {
    const list = $('changelog-list');
    if (list)
      list.innerHTML = '<div class="changelog-empty">Changelog konnte nicht geladen werden.</div>';
  }
}

async function createChangelogEntry() {
  if (me?.role !== 'admin') {
    toast('Nur Admins können Changelog-Einträge anlegen', 'error');
    return;
  }

  const version = $('changelog-version-input')?.value?.trim();
  const title = $('changelog-title-input')?.value?.trim();
  const body = $('changelog-body-input')?.value?.trim();

  if (!version || !title) {
    toast('Version und Titel sind Pflichtfelder', 'error');
    return;
  }

  const btn = $('changelog-create-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Speichern...';
  }

  try {
    await apiCall('/changelog', 'POST', { version, title, body });
    toast('Changelog-Eintrag gespeichert', 'success');
    $('changelog-title-input').value = '';
    $('changelog-body-input').value = '';
    await loadChangelogEntries();
  } catch (e) {
    toast(e.serverMessage || 'Speichern fehlgeschlagen', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Eintrag veröffentlichen';
    }
  }
}

async function fetchAlbumCount(albumId) {
  if (_cachedAlbumCounts && _cachedAlbumCounts[albumId] !== undefined) {
    const el = document.getElementById('fc-a-' + albumId);
    if (el) el.textContent = _cachedAlbumCounts[albumId] ?? '…';
    return;
  }
  // Anzahl aus allAlbums._count (kommt vom API)
  const a = allAlbums.find((x) => x.id === albumId);
  const el = document.getElementById('fc-a-' + albumId);
  if (el && a?._count) el.textContent = a._count.photos ?? '…';
}

let _cachedAlbumCounts = null;
let _cachedTotalAll = null;
let _cachedTotalMine = null;

function invalidateCounts() {
  _cachedTotalAll = null;
  _cachedTotalMine = null;
}

async function fetchCounts() {
  try {
    // Mine-Count: nur wenn noch nicht gecacht
    if (_cachedTotalMine === null) {
      const mineRes = await apiCall(
        `/photos?groupId=${curGroupId}&uploaderId=${me.id}&limit=1`,
        'GET'
      );
      _cachedTotalMine = mineRes.total ?? 0;
    }
    const elAll = document.getElementById('fc-all');
    if (elAll && _cachedTotalAll !== null) elAll.textContent = _cachedTotalAll;
    const elMine = document.getElementById('fc-mine');
    if (elMine) elMine.textContent = _cachedTotalMine ?? '…';
    // Album counts aus allAlbums._count
    allAlbums.forEach((a) => {
      const el = document.getElementById('fc-a-' + a.id);
      if (el) el.textContent = a._count?.photos ?? '…';
    });
  } catch (e) {
    /* counts not critical */
  }
}

async function loadSidebarAvatars() {
  // No-op: avatarHtml() is used directly in renderSidebar() now
}
async function switchFolder(f) {
  curAlbum = null;
  curFilter = f;
  curFilterUserId = null;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}
async function switchAlbum(id) {
  curAlbum = id;
  curFilter = null;
  curFilterUserId = null;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}

// ── GALLERY ──────────────────────────────────────────────
function folderTitle() {
  if (curAlbum) {
    const a = allAlbums.find((x) => x.id === curAlbum);
    return a?.name ?? 'Album';
  }
  if (curFilterUserId) {
    const p = allProfiles[curFilterUserId];
    if (!p) return 'Fotos';
    const visibleName = getVisibleName(p) || p.username || p.email || '?';
    return `Fotos von ${visibleName}`;
  }
  if (curFilter === 'mine') return 'Meine Fotos';
  return 'Alle Fotos';
}
function canUpload() {
  if (curAlbum) return true;
  if (curFilterUserId) return false;
  return !curFilter || curFilter === 'mine';
}

function updateUploadShortcutVisibility() {
  const btn = $('upload-shortcut-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !canUpload());
}

// Prüft ob der User Fotos zum aktuell geöffneten Album hinzufügen/entfernen darf
function canAddToAlbum() {
  if (!curAlbum) return false;
  if (me.role === 'admin') return true;
  const a = allAlbums.find((x) => x.id === curAlbum);
  if (!a) return false;
  if (a.createdBy === me.id) return true;
  return (a.contributors || []).some((c) => c.id === me.id);
}

// Prüft ob der User das Album verwalten darf (Contributor hinzufügen/entfernen, umbenennen)
function canManageAlbum() {
  if (!curAlbum) return false;
  if (me.role === 'admin') return true;
  const a = allAlbums.find((x) => x.id === curAlbum);
  if (!a) return false;
  if (a.createdBy === me.id) return true;
  const curGroup = myGroups.find((g) => g.id === curGroupId);
  if (curGroup?.createdBy === me.id) return true;
  return groupDeputies.some((d) => d.id === me.id);
}

async function switchToUser(userId) {
  curAlbum = null;
  curFilter = null;
  curFilterUserId = userId;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}

async function loadPhotos(reset = false) {
  if (reset) {
    photos = [];
    pgFrom = 0;
    hasMore = false;
    if (selectMode) toggleSelectMode();
  }
  if (reset) {
    $('grid').innerHTML =
      '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }
  hide('empty');
  hide('more-btn');
  $('gal-title').textContent = folderTitle();
  $('upload-btn').style.display = canUpload() ? '' : 'none';
  updateUploadShortcutVisibility();
  // Show album action button if in album view
  const albumAddBtn = document.getElementById('album-add-btn');
  if (curAlbum) {
    // Hinzufügen-Button: nur für Berechtigte (Creator, Contributor, Admin)
    if (canAddToAlbum()) {
      if (!albumAddBtn) {
        const btn = document.createElement('button');
        btn.id = 'album-add-btn';
        btn.className = 'btn-ghost btn';
        btn.style.cssText =
          'padding:5px 10px;font-size:11px;gap:4px;display:flex;align-items:center;border:1px solid var(--border);border-radius:7px;color:var(--muted)';
        btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Hinzufügen`;
        btn.onclick = openAddFromAll;
        $('upload-btn').after(btn);
      }
    } else {
      if (albumAddBtn) albumAddBtn.remove();
    }
    // Gear-Button: nur für Album-Creator, Gruppen-Owner, Admin
    if (canManageAlbum()) {
      if (!document.getElementById('album-rename-btn')) {
        const gear = document.createElement('button');
        gear.id = 'album-rename-btn';
        gear.className = 'btn-ghost btn';
        gear.title = 'Album-Einstellungen';
        gear.style.cssText =
          'padding:5px 7px;font-size:11px;display:flex;align-items:center;border:1px solid var(--border);border-radius:7px;color:var(--muted)';
        gear.innerHTML = ICON_GEAR;
        gear.onclick = () => openAlbumSettings(curAlbum);
        $('upload-btn').after(gear);
      }
    } else {
      const gear = document.getElementById('album-rename-btn');
      if (gear) gear.remove();
    }
  } else {
    if (albumAddBtn) albumAddBtn.remove();
    const gear = document.getElementById('album-rename-btn');
    if (gear) gear.remove();
  }
  if (!curGroupId) {
    renderGrid(0);
    return;
  }

  const params = new URLSearchParams({
    groupId: curGroupId,
    skip: pgFrom,
    limit: PG_SIZE,
    order: curSort === 'oldest' ? 'asc' : 'desc',
  });
  if (curAlbum) params.set('albumId', curAlbum);
  else if (curFilterUserId) params.set('uploaderId', curFilterUserId);
  else if (curFilter === 'mine') params.set('uploaderId', me.id);

  try {
    const res = await apiCall(`/photos?${params}`, 'GET');
    const data = res.photos || [];

    // Gesamtzahl aus Haupt-Response cachen → kein extra Count-Request nötig
    if (reset && res.total !== undefined) {
      if (!curAlbum && !curFilter && !curFilterUserId) _cachedTotalAll = res.total;
      else if (curFilter === 'mine') _cachedTotalMine = res.total;
    }

    // URL-Cache befüllen: photoId → presigned URL
    data.forEach((p) => {
      if (p.url) urlCache[p.id] = p.url;
    });

    let appendFrom = 0;
    if (data.length) {
      appendFrom = reset ? 0 : photos.length;
      photos = reset ? data : [...photos, ...data];
      if (curSort === 'most-likes') photos.sort((a, b) => (b._likes || 0) - (a._likes || 0));
      else if (curSort === 'most-comments')
        photos.sort((a, b) => (b._comments || 0) - (a._comments || 0));
      hasMore = res.hasMore || false;
      pgFrom = photos.length;
    } else if (reset) {
      hasMore = false;
    }
    renderGrid(appendFrom);
  } catch (err) {
    console.error('Fotos laden fehlgeschlagen:', err);
    renderGrid(0);
  }
}

// Counts kommen direkt vom API-Response (_likes, _comments, _liked) – kein Extra-Fetch nötig
async function enrichPhotos(list) {
  /* no-op */
}

let _loadingMore = false;
async function loadMore() {
  if (!hasMore || _loadingMore) return;
  _loadingMore = true;
  $('more-btn').textContent = 'Lädt…';
  show('more-btn');
  await loadPhotos(false);
  _loadingMore = false;
}

function initInfiniteScroll() {
  const content = $('content');
  if (!content) return;
  content.addEventListener('scroll', () => {
    if (!hasMore || _loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = content;
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
    const a = allAlbums.find((x) => x.id === curAlbum);
    if (icon) icon.textContent = '🖼';
    if (text) text.textContent = `Das Album „${a?.name || 'Album'}" ist noch leer.`;
    if (actions)
      actions.innerHTML = `
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
    if (icon) icon.textContent = '🌿';
    if (text) text.textContent = 'Noch keine Fotos – lade das erste hoch!';
    if (actions)
      actions.innerHTML = `<button class="btn" style="background:var(--accent-l);color:var(--accent);border:1.5px solid #dcc0a0;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:600;margin-top:4px" onclick="openModal()">＋ Foto hochladen</button>`;
  }
}

// ── VIEW SWITCHER ────────────────────────────────────────
const VIEW_ICONS = {
  small: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`,
  medium: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="14" rx="1.5"/><rect x="9" y="1" width="6" height="14" rx="1.5"/></svg>`,
  large: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>`,
  list: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="1" y1="4" x2="15" y2="4"/><line x1="1" y1="8" x2="15" y2="8"/><line x1="1" y1="12" x2="15" y2="12"/></svg>`,
};
const VIEW_LABELS = { small: 'Klein', medium: 'Mittel', large: 'Groß', list: 'Liste' };

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

function renderGrid(appendFrom = 0) {
  const g = $('grid');
  if (!photos.length) {
    g.innerHTML = '';
    g.className = 'grid';
    renderEmptyState();
    show('empty');
    hide('more-btn');
    return;
  }
  hide('empty');
  g.className = 'grid view-' + curView;

  const startIdx = appendFrom > 0 ? appendFrom : 0;
  const photosToRender = appendFrom > 0 ? photos.slice(appendFrom) : photos;

  const html = photosToRender
    .map((p, idx) => {
      const i = startIdx + idx;
      const u = allProfiles[p.uploaderId] || {};
      const url = urlCache[p.id] || '';
      const canDel = p.uploaderId === me.id;
      const liked = p._liked || false;
      const likes = p._likes || 0;
      const comms = p._comments || 0;
      return `<div class="p-card${selectedIds.has(p.id) ? ' selected' : ''}" id="pc-${p.id}" onclick="if(window.selectMode){event.stopPropagation();toggleCardSelect('${p.id}',this)}else{openLB(${i})}">
      <div class="p-thumb">
        <div class="sel-check" onclick="event.stopPropagation();toggleCardSelect('${p.id}',this.closest('.p-card'))">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        ${url ? `<img src="${esc(photoSrc(url))}" alt="" loading="lazy" class="loading" onload="onThumbLoad(this)">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="spinner"></div></div>`}
        <div class="p-ov">
          <div class="p-ov-stats">
            <span class="p-ov-stat">${ICON_HEART_LG_EMPTY} ${likes}</span>
            <span class="p-ov-stat">${ICON_COMMENT} ${comms}</span>
          </div>
          ${p.description ? `<div class="p-ov-desc">${esc(p.description)}</div>` : ''}
        </div>
      </div>
      <div class="p-meta">
        ${p.description ? `<div class="p-desc">${esc(p.description)}</div>` : ''}
        <div class="p-top">
          <span class="dot" style="background:${esc(u.color || '#888')}"></span>
          <span class="p-who">${esc(getVisibleName(u) || '?')}</span>
          <span class="p-dt">${fmtDate(p.created_at)}</span>
        </div>
        <div class="p-actions">
          <button class="p-like-btn${liked ? ' liked' : ''}" onclick="event.stopPropagation();doLike('${p.id}')">
            <span class="heart">${liked ? ICON_HEART_FULL : ICON_HEART_EMPTY}</span> ${likes > 0 ? `<span>${likes}</span>` : ''}
          </button>
          ${comms > 0 ? `<span class="p-comment-count">${ICON_COMMENT}<span>${comms}</span></span>` : ''}
          ${canDel ? `<button class="p-del" onclick="event.stopPropagation();askDel('${p.id}',false)">${ICON_TRASH}</button>` : ''}
        </div>
      </div>
    </div>`;
    })
    .join('');

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

  if (hasMore) {
    show('more-btn');
    $('more-btn').textContent = 'Weitere Fotos laden…';
  } else hide('more-btn');
  renderViewSwitcher();
}

// Unified like handler for grid + lightbox
async function doLike(photoId) {
  const p = photos.find((x) => x.id === photoId);
  if (!p) return;
  try {
    if (p._liked) {
      await apiCall(`/likes/${photoId}`, 'DELETE');
      p._liked = false;
      p._likes = Math.max(0, (p._likes || 0) - 1);
    } else {
      await apiCall('/likes', 'POST', { photoId });
      p._liked = true;
      p._likes = (p._likes || 0) + 1;
    }
  } catch (e) {
    toast('Fehler beim Liken', 'error');
    return;
  }
  // Update grid card
  const card = document.getElementById('pc-' + photoId);
  if (card) {
    const btn = card.querySelector('.p-like-btn');
    if (btn) {
      btn.className = 'p-like-btn' + (p._liked ? ' liked' : '');
      btn.innerHTML = `<span class="heart">${p._liked ? ICON_HEART_FULL : ICON_HEART_EMPTY}</span> ${p._likes > 0 ? `<span>${p._likes}</span>` : ''}`;
    }
  }
  // Update lightbox if open and showing this photo
  if (photos[lbIdx]?.id === photoId) {
    lbLiked = p._liked;
    lbLikeCount = p._likes;
    if (p._liked) {
      if (!lbLikers.find((u) => u.id === me.id)) lbLikers.unshift(allProfiles[me.id] || { ...me });
    } else {
      lbLikers = lbLikers.filter((u) => u.id !== me.id);
    }
    updateLikeBtn();
    updateLikers();
  }
}

// ── UPLOAD ───────────────────────────────────────────────
const UPLOAD_MAX_FILES = 100;
const UPLOAD_PREVIEW_VISIBLE = 12;
let _stagedFiles = [];

function openModal() {
  const asel = $('asel');
  asel.innerHTML =
    `<option value="">— Kein Album —</option>` +
    allAlbums.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  if (curAlbum) asel.value = curAlbum;
  if ($('desc-input')) $('desc-input').value = '';
  _stagedFiles = [];
  _renderStagedPreviews();
  show('up-modal');
  show('dz-wrap');
  hide('prog-wrap');
  // Drag&Drop-Listener (einmalig registrieren)
  const dzEl = $('dz');
  if (dzEl && !dzEl._dzInit) {
    dzEl._dzInit = true;
    dzEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dzEl.classList.add('drag');
    });
    dzEl.addEventListener('dragleave', () => dzEl.classList.remove('drag'));
    dzEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dzEl.classList.remove('drag');
      handleFiles(e.dataTransfer.files);
    });
    dzEl.addEventListener('click', () => $('fi').click());
  }
}
function closeModal() {
  hide('up-modal');
  $('fi').value = '';
  _stagedFiles = [];
}

// ── GRUPPE UMBENENNEN ─────────────────────────────────────
function openRenameGroupInline() {
  const wrap = $('rename-group-inline');
  if (!wrap) return;
  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const inp = $('rename-group-input');
  inp.value = curGroup?.name || '';
  wrap.classList.remove('hidden');
  inp.focus();
  inp.select();
}
function closeRenameGroupInline() {
  $('rename-group-inline')?.classList.add('hidden');
}
async function saveGroupRename() {
  const name = $('rename-group-input')?.value?.trim();
  if (!name) return;
  try {
    const { group } = await apiCall(`/groups/${curGroupId}`, 'PATCH', { name });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx].name = group.name;
    const sub = $('header-group-name');
    if (sub) sub.textContent = group.name;
    closeRenameGroupInline();
    // Mitgliederliste neu laden, damit Sidebar garantiert aktuellen Wert nutzt
    if (curGroupId) {
      try {
        const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
        groupMembers = members || [];
        groupMembers.forEach((m) => {
          allProfiles[m.id] = m;
        });
      } catch (e) {
        /* ignore */
      }
    }
    renderSidebar();
    toast('Gruppe umbenannt', 'success');
  } catch (e) {
    toast('Umbenennen fehlgeschlagen', 'error');
  }
}

function openGroupSettingsModal() {
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return;
  if (group.createdBy !== me.id) {
    toast('Nur der Owner kann die Gruppe verwalten', 'error');
    return;
  }

  const renameInp = $('group-settings-rename-input');
  const codeDisplay = $('group-settings-code-display');
  const visibilityChk = $('group-settings-code-visible');
  const limitEnabled = $('group-settings-limit-enabled');
  const limitInput = $('group-settings-limit-input');
  const lockHint = $('group-settings-limit-lock-hint');
  const limitSaveBtn = $('group-settings-limit-save-btn');
  const memberCount = Math.max(groupMembers.length, 1);
  if (renameInp) renameInp.value = group.name || '';
  if (codeDisplay) codeDisplay.textContent = group.code || '';
  if (visibilityChk) visibilityChk.checked = !!group.inviteCodeVisibleToMembers;
  if (limitEnabled)
    limitEnabled.checked = group.maxMembers !== null && group.maxMembers !== undefined;
  if (limitInput) {
    limitInput.min = String(memberCount);
    limitInput.max = '50';
    limitInput.value =
      group.maxMembers !== null && group.maxMembers !== undefined
        ? String(group.maxMembers)
        : String(memberCount);
  }

  if (lockHint) lockHint.classList.toggle('hidden', !group.memberLimitLocked);
  if (limitSaveBtn) limitSaveBtn.disabled = !!group.memberLimitLocked;

  toggleGroupLimitInputs();

  _loadGsDeputies();
  show('group-settings-modal');
}

function toggleGroupLimitInputs() {
  const group = myGroups.find((g) => g.id === curGroupId);
  const enabled = !!$('group-settings-limit-enabled')?.checked;
  const input = $('group-settings-limit-input');
  const hint = $('group-settings-limit-hint');
  const lockHint = $('group-settings-limit-lock-hint');
  const saveBtn = $('group-settings-limit-save-btn');
  const memberCount = Math.max(groupMembers.length, 1);
  if (!input || !group) return;

  input.min = String(memberCount);
  input.max = '50';

  const isLocked = !!group.memberLimitLocked;
  if (isLocked) {
    input.disabled = true;
    const cb = $('group-settings-limit-enabled');
    if (cb) cb.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    if (lockHint) lockHint.classList.remove('hidden');
    if (hint)
      hint.textContent = `Aktuell ${memberCount} Mitglieder in der Gruppe. Das Limit ist von einem Admin gesperrt.`;
    return;
  }

  const cb = $('group-settings-limit-enabled');
  if (cb) cb.disabled = false;
  if (saveBtn) saveBtn.disabled = false;
  if (lockHint) lockHint.classList.add('hidden');

  input.disabled = !enabled;
  if (enabled) {
    const current = Number(input.value);
    if (!Number.isInteger(current) || current < memberCount) {
      input.value = String(memberCount);
    }
  }
  if (hint) hint.textContent = `Erlaubt: mindestens ${memberCount}, maximal 50 Mitglieder.`;
}

async function saveGroupMemberLimit() {
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return;
  if (group.memberLimitLocked) {
    toast('Dieses Mitgliederlimit wurde von einem Admin gesperrt.', 'error');
    return;
  }

  const enabled = !!$('group-settings-limit-enabled')?.checked;
  const input = $('group-settings-limit-input');
  const memberCount = Math.max(groupMembers.length, 1);

  let maxMembers = null;
  if (enabled) {
    maxMembers = Number(input?.value);
    if (!Number.isInteger(maxMembers)) {
      return toast('Bitte eine ganze Zahl für das Mitgliederlimit eingeben.', 'error');
    }
    if (maxMembers < memberCount || maxMembers > 50) {
      return toast(`Das Limit muss zwischen ${memberCount} und 50 liegen.`, 'error');
    }
  }

  const btn = $('group-settings-limit-save-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Speichert…';
  }

  try {
    const { group: updatedGroup } = await apiCall(`/groups/${curGroupId}/settings`, 'PATCH', {
      maxMembers,
    });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...updatedGroup };
    toggleGroupLimitInputs();
    renderSidebar();
    toast(
      maxMembers === null ? 'Mitgliederlimit deaktiviert' : 'Mitgliederlimit gespeichert',
      'success'
    );
  } catch (e) {
    const msg = (e.serverMessage || e.message || '').toLowerCase();
    if (msg.includes('gesperrt')) {
      toast('Dieses Mitgliederlimit wurde von einem Admin gesperrt.', 'error');
    } else {
      toast(e.serverMessage || 'Mitgliederlimit konnte nicht gespeichert werden', 'error');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Limit speichern';
    }
  }
}

async function _loadGsDeputies() {
  try {
    const { deputies } = await apiCall(`/groups/${curGroupId}/deputies`, 'GET');
    groupDeputies = deputies || [];
  } catch (e) {
    groupDeputies = [];
  }
  _renderGsDeputyList();

  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const sel = $('gs-deputy-user-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Mitglied auswählen —</option>';
  groupMembers
    .filter((m) => m.id !== curGroup?.createdBy && !groupDeputies.some((d) => d.id === m.id))
    .forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.username;
      sel.appendChild(opt);
    });
}

function _renderGsDeputyList() {
  const el = $('gs-deputy-list');
  if (!el) return;
  if (!groupDeputies.length) {
    el.innerHTML =
      '<p style="font-size:12px;color:var(--muted2);font-weight:300;margin:0">Noch keine Vertreter ernannt.</p>';
    return;
  }
  el.innerHTML = groupDeputies
    .map(
      (d) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      ${avatarHtml(d, 26)}
      <span style="flex:1;font-size:13px">${esc(d.name || d.username)}</span>
      <button onclick="removeGsDeputy('${d.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:18px;line-height:1;padding:2px 6px" title="Entfernen">×</button>
    </div>`
    )
    .join('');
}

async function addGsDeputy() {
  const userId = $('gs-deputy-user-select')?.value;
  if (!userId) return;
  try {
    const deputy = await apiCall(`/groups/${curGroupId}/deputies`, 'POST', { userId });
    groupDeputies.push(deputy);
    _loadGsDeputies();
    renderSidebar();
  } catch (e) {
    toast('Fehler beim Hinzufügen', 'error');
  }
}

async function removeGsDeputy(userId) {
  try {
    await apiCall(`/groups/${curGroupId}/deputies/${userId}`, 'DELETE');
    groupDeputies = groupDeputies.filter((d) => d.id !== userId);
    _renderGsDeputyList();
    const curGroup = myGroups.find((g) => g.id === curGroupId);
    const sel = $('gs-deputy-user-select');
    if (sel) {
      const member = groupMembers.find((m) => m.id === userId);
      if (member && member.id !== curGroup?.createdBy) {
        const opt = document.createElement('option');
        opt.value = member.id;
        opt.textContent = member.name || member.username;
        sel.appendChild(opt);
      }
    }
    renderSidebar();
  } catch (e) {
    toast('Fehler beim Entfernen', 'error');
  }
}

function closeGroupSettingsModal() {
  hide('group-settings-modal');
}

async function saveGroupSettingsRename() {
  const name = $('group-settings-rename-input')?.value?.trim();
  if (!name) return;

  const btn = $('group-settings-rename-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Speichert…';
  }

  try {
    const { group } = await apiCall(`/groups/${curGroupId}`, 'PATCH', { name });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    const headerName = $('header-group-name');
    if (headerName) headerName.textContent = group.name;
    renderGroupSwitcher();
    renderSidebar();
    toast('Gruppenname gespeichert', 'success');
  } catch (e) {
    toast('Umbenennen fehlgeschlagen', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Speichern';
    }
  }
}

async function rotateGroupInviteCode() {
  const btn = $('group-settings-code-rotate-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Erzeuge…';
  }

  try {
    const { group } = await apiCall(`/groups/${curGroupId}/code/rotate`, 'POST');
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    const codeDisplay = $('group-settings-code-display');
    if (codeDisplay) codeDisplay.textContent = group.code || '';
    toast('Einladungscode wurde geändert', 'success');
  } catch (e) {
    toast('Code konnte nicht geändert werden', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Neu generieren';
    }
  }
}

async function saveGroupInviteCodeVisibility() {
  const visible = !!$('group-settings-code-visible')?.checked;

  try {
    const { group } = await apiCall(`/groups/${curGroupId}/settings`, 'PATCH', {
      inviteCodeVisibleToMembers: visible,
    });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    renderSidebar();
    toast(
      visible ? 'Code für alle Mitglieder sichtbar' : 'Code nur für Owner/Vertreter sichtbar',
      'success'
    );
  } catch (e) {
    // Checkbox zurücksetzen
    const chk = $('group-settings-code-visible');
    if (chk) chk.checked = !visible;
    toast('Sichtbarkeit konnte nicht gespeichert werden', 'error');
  }
}

function copyGroupSettingsCode() {
  const code = myGroups.find((g) => g.id === curGroupId)?.code;
  if (!code) return;
  navigator.clipboard
    .writeText(code)
    .then(() => toast('Code kopiert', 'success'))
    .catch(() => {
      toast('Kopieren nicht möglich', 'error');
    });
}

let _settingsDeleteGroupId = null;
let _settingsDeleteGroupName = null;

async function deleteGroupFromSettings() {
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return;

  _settingsDeleteGroupId = group.id;
  _settingsDeleteGroupName = group.name;
  _agdm_pendingCleanup = null;

  closeGroupSettingsModal();

  $('agdm-title').textContent = `Gruppe „${group.name}" löschen`;
  $('agdm-info').textContent =
    'Alle Fotos, Alben und Mitglieder dieser Gruppe werden unwiderruflich gelöscht.';

  hide('agdm-stranded-warning');
  $('agdm-stranded-confirm').checked = false;

  $('agdm-backup-btn').onclick = () => settingsGroupDoDelete(true);
  $('agdm-delete-btn').onclick = () => settingsGroupDoDelete(false);
  $('agdm-backup-btn').innerHTML =
    `📦 Backup erstellen &amp; herunterladen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Alle Fotos als ZIP sichern — Gruppe wird danach gelöscht</div>`;
  $('agdm-delete-btn').innerHTML =
    `🗑 Gruppe löschen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Kein Backup gewünscht — Gruppe wird sofort gelöscht</div>`;

  $('agdm-result-text').innerHTML = '✅ ZIP-Backup erstellt (30 Tage gültig)';
  $('agdm-dl-link').href = '#';
  $('agdm-dl-link').style.display = 'inline-block';
  $('agdm-copy-link-btn').style.display = 'inline-block';

  show('agdm-actions');
  hide('agdm-loading');
  hide('agdm-result');
  $('agdm-confirm-delete-btn')?.classList.add('hidden');
  $('agdm-backup-btn').disabled = false;
  $('agdm-delete-btn').disabled = false;

  show('admin-group-delete-modal');
}

async function settingsGroupDoDelete(createBackup = false) {
  $('agdm-backup-btn').disabled = true;
  $('agdm-delete-btn').disabled = true;
  hide('agdm-actions');
  $('agdm-loading-text').textContent = createBackup
    ? 'ZIP wird erstellt & heruntergeladen…'
    : 'ZIP wird erstellt & Gruppe wird gelöscht…';
  show('agdm-loading');

  try {
    const res = await apiCall(`/groups/${_settingsDeleteGroupId}`, 'DELETE');
    hide('agdm-loading');
    $('agdm-confirm-delete-btn')?.classList.add('hidden');

    if (res.backupUrl) {
      const expiry = res.linkExpiry
        ? new Date(res.linkExpiry)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiryStr = expiry.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      if (createBackup) {
        $('agdm-result-text').innerHTML =
          `✅ Backup heruntergeladen — Gruppe gelöscht<br><span style="font-size:11px;opacity:0.7">Der Link ist gültig bis ${expiryStr} — danach werden alle Daten restlos von unserem Server gelöscht.</span>`;
      } else {
        $('agdm-result-text').innerHTML =
          `✅ Gruppe gelöscht — über den Link kannst du alle Bilder noch bis ${expiryStr} herunterladen<br><span style="font-size:11px;opacity:0.7">Nach dem ${expiryStr} werden alle Daten restlos von unserem Server gelöscht.</span>`;
      }

      $('agdm-dl-link').href = backupSrc(res.backupUrl);
      $('agdm-dl-link').style.display = 'inline-block';
      $('agdm-copy-link-btn').style.display = 'inline-block';

      if (createBackup) {
        const a = document.createElement('a');
        a.href = backupSrc(res.backupUrl);
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } else {
      $('agdm-result-text').innerHTML = '✅ Gruppe gelöscht — es waren keine Fotos vorhanden.';
      $('agdm-dl-link').style.display = 'none';
      $('agdm-copy-link-btn').style.display = 'none';
    }

    show('agdm-result');
    await _afterSettingsGroupDelete();
  } catch (e) {
    hide('agdm-loading');
    show('agdm-actions');
    $('agdm-backup-btn').disabled = false;
    $('agdm-delete-btn').disabled = false;
    toast(e.serverMessage || 'Gruppe konnte nicht gelöscht werden', 'error');
  }
}

async function _afterSettingsGroupDelete() {
  const deletedId = _settingsDeleteGroupId;
  const deletedName = _settingsDeleteGroupName;

  _agdm_pendingCleanup = async () => {
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || [];

    if (!myGroups.length) {
      renderGroupSwitcher();
      renderSidebar();
      toast(`Gruppe „${deletedName}" gelöscht.`, 'success');
      return;
    }

    const nextGroup = myGroups.find((g) => g.id !== deletedId) || myGroups[0];
    curGroupId = nextGroup.id;
    try {
      localStorage.setItem('activeGroup', curGroupId);
    } catch (e) {}

    await loadGroupMembers();
    try {
      const { deputies } = await apiCall(`/groups/${curGroupId}/deputies`, 'GET');
      groupDeputies = deputies || [];
    } catch (e) {
      groupDeputies = [];
    }
    await loadAlbums();
    renderGroupSwitcher();
    renderSidebar();
    await loadPhotos(true);
    toast(`Gruppe „${deletedName}" gelöscht.`, 'success');
  };
}

function openDeputyModalFromSettings() {
  closeGroupSettingsModal();
  openDeputyModal();
}
// kept for potential external use; inline deputy management in group-settings uses addGsDeputy/removeGsDeputy

function _renderStagedPreviews() {
  const grid = $('dz-preview-grid');
  const previewWrap = $('dz-preview-wrap');
  const uploadBtn = $('do-upload-btn');
  const dz = $('dz');
  if (!grid) return;

  const hasFiles = _stagedFiles.length > 0;

  // Dropzone kompakt wenn Dateien vorhanden
  if (hasFiles) {
    dz?.classList.add('dz--compact');
    previewWrap.style.display = 'block';
    uploadBtn.style.display = 'flex';
    $('do-upload-label').textContent =
      _stagedFiles.length === 1 ? '1 Foto hochladen' : `${_stagedFiles.length} Fotos hochladen`;
  } else {
    dz?.classList.remove('dz--compact');
    previewWrap.style.display = 'none';
    uploadBtn.style.display = 'none';
  }

  const visible = _stagedFiles.slice(0, UPLOAD_PREVIEW_VISIBLE);
  const overflow = _stagedFiles.length - visible.length;
  grid.innerHTML =
    visible
      .map((f, i) => {
        const url = URL.createObjectURL(f);
        return `<div class="dz-thumb" id="dz-thumb-${i}">
      <img src="${url}" alt="${esc(f.name)}" onload="URL.revokeObjectURL(this.src)">
      <button class="dz-thumb-del" onclick="_removeStagedFile(${i})" title="Entfernen">✕</button>
    </div>`;
      })
      .join('') +
    (overflow > 0 ? `<div class="dz-thumb dz-thumb-overflow"><span>+${overflow}</span></div>` : '');
}

function _removeStagedFile(idx) {
  _stagedFiles.splice(idx, 1);
  _renderStagedPreviews();
}

function handleFiles(fileList) {
  const newFiles = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!newFiles.length) return;
  const remaining = UPLOAD_MAX_FILES - _stagedFiles.length;
  if (remaining <= 0) {
    toast(`Maximal ${UPLOAD_MAX_FILES} Fotos pro Upload erlaubt.`, 'error');
    $('fi').value = '';
    return;
  }
  const toAdd = newFiles.slice(0, remaining);
  if (newFiles.length > remaining) {
    toast(
      `Nur ${toAdd.length} von ${newFiles.length} Fotos hinzugefügt (Limit: ${UPLOAD_MAX_FILES}).`,
      'error'
    );
  }
  _stagedFiles.push(...toAdd);
  $('fi').value = ''; // reset so same files can be re-added
  _renderStagedPreviews();
}

async function startUpload() {
  const files = _stagedFiles;
  if (!files.length) return;
  const folder = SHARED;
  const desc = $('desc-input')?.value?.trim() || null;
  const albumId = $('asel')?.value || null;
  hide('dz-wrap');
  show('prog-wrap');
  const PARALLEL = 3;
  let done = 0,
    failed = 0;
  const uploadedIds = [];

  // Process in parallel batches of 3
  async function uploadWithProgress(file) {
    try {
      const id = await uploadOne(file, folder, desc, albumId);
      if (id) uploadedIds.push(id);
      done++;
    } catch (e) {
      console.error('Upload failed:', file.name, e);
      failed++;
      done++;
    }
    $('prog-txt').textContent =
      `${done} von ${files.length}${failed ? ' (' + failed + ' fehlgeschlagen)' : ''}`;
    $('prog-fill').style.width = (done / files.length) * 100 + '%';
  }

  // Batch processing: 3 at a time to avoid memory issues
  for (let i = 0; i < files.length; i += PARALLEL) {
    const batch = files.slice(i, i + PARALLEL);
    $('prog-txt').textContent = `${done} von ${files.length} — ${batch.length} werden verarbeitet…`;
    await Promise.all(batch.map((f) => uploadWithProgress(f)));
  }

  $('prog-fill').style.width = '100%';
  $('prog-txt').textContent = failed
    ? `Fertig! ${done - failed} hochgeladen, ${failed} fehlgeschlagen`
    : `Fertig! ${done} Fotos hochgeladen`;

  if (uploadedIds.length > 0) invalidateCounts();
  setTimeout(closeModal, 800);
  if (curFolder === folder) await loadPhotos(true);
  renderSidebar();
  _stagedFiles = [];
  $('fi').value = '';
  if (failed)
    toast(`${failed} Foto${failed > 1 ? 's' : ''} konnten nicht hochgeladen werden`, 'error');
  else toast(`${done} Foto${done > 1 ? 's' : ''} hochgeladen`, 'success');
}

async function uploadOne(file, folder = SHARED, desc = null, albumId = null) {
  const blob = await compress(file);

  const formData = new FormData();
  formData.append('file', new File([blob], file.name, { type: 'image/jpeg' }));
  formData.append('groupId', curGroupId);
  if (albumId) formData.append('albumId', albumId);
  if (desc) formData.append('description', desc);

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
  lbIdx = i;
  const p = photos[i],
    u = allProfiles[p.uploaderId] || {};
  show('lb');
  initLbSwipe();
  // Lightbox: Foto-URL aus Cache
  const url = urlCache[p.id] || p.url || '';
  $('lb-img').src = photoSrc(url);
  $('lb-av').innerHTML = avatarHtml(u, 32);
  $('lb-av').style.background = u.avatar ? 'transparent' : u.color || '#888';
  $('lb-who').textContent = getVisibleName(u) || '?';
  $('lb-dt').textContent = fmtDateLong(p.created_at);
  $('lb-cnt').textContent = `${i + 1} von ${photos.length} Fotos`;
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
    descWrap.innerHTML = `<div class="lb-desc" id="lb-desc-text" style="flex:1">${esc(p.description)}</div>${isOwner ? `<button onclick="editDesc()" style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:2px;flex-shrink:0" title="Beschreibung bearbeiten"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}`;
    descWrap.style.display = 'flex';
  } else if (isOwner) {
    descWrap.innerHTML = `<button onclick="editDesc()" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:12px;font-weight:500;padding:0;font-family:inherit">+ Beschreibung hinzufügen</button>`;
    descWrap.style.display = 'flex';
  } else {
    descWrap.style.display = 'none';
    descWrap.innerHTML = '';
  }
  // Update slideshow counter
  const ssCnt = $('ss-counter');
  if (ssCnt) ssCnt.textContent = `${i + 1} / ${photos.length}`;
  $('lb-prv').style.display = i > 0 ? '' : 'none';
  $('lb-nxt').style.display = i < photos.length - 1 ? '' : 'none';
  // Action buttons
  const d = $('lb-del-btn');
  if (d) {
    d.innerHTML = ICON_TRASH;
    p.uploaderId === me.id ? d.classList.remove('hidden') : d.classList.add('hidden');
  }
  const dn = $('lb-down-btn');
  if (dn) dn.innerHTML = ICON_DOWNLOAD;
  const ab = $('lb-album-btn');
  if (ab) ab.innerHTML = ICON_ALBUM;
  updateFullviewBtn();
  updateLbAlbumTag(p);
  // Copy Image ID (Admin only)
  const copyIdBtn = document.getElementById('lb-copy-id-btn');
  if (copyIdBtn) {
    copyIdBtn.innerHTML = '#ID';
    me?.role === 'admin' ? copyIdBtn.classList.remove('hidden') : copyIdBtn.classList.add('hidden');
  }
  // Refresh album_id from API
  try {
    const fresh = await apiCall(`/photos/${p.id}`, 'GET');
    if (fresh) {
      p.albumIds = fresh.albumIds || [];
      photos[i].albumIds = p.albumIds;
      updateLbAlbumTag(p);
    }
  } catch (e) {
    /* ignore */
  }
  await loadLBMeta(p.id);
}

async function loadLBMeta(photoId) {
  try {
    const photo = await apiCall(`/photos/${photoId}`, 'GET');
    lbLikeCount = (photo.likes || []).length;
    lbLiked = (photo.likes || []).some((l) => l.userId === me.id);
    lbLikers = (photo.likes || []).map((l) => allProfiles[l.userId] || l.user).filter(Boolean);
    updateLikeBtn();
    updateLikers();
    lbComments = photo.comments || [];
    renderComments();
  } catch (e) {
    console.warn('LB Meta laden fehlgeschlagen:', e);
    lbLikeCount = 0;
    lbLiked = false;
    lbLikers = [];
    lbComments = [];
    updateLikeBtn();
    renderComments();
  }
}

function updateLikers() {
  const el = $('lb-likers');
  if (!el) return;
  if (!lbLikers || !lbLikers.length) {
    el.textContent = '';
    return;
  }
  const names = lbLikers.map((u) => (u.id === me.id ? 'Dir' : getVisibleName(u) || '?'));
  if (names.length === 1) el.innerHTML = `Gefällt <b>${esc(names[0])}</b>`;
  else if (names.length === 2)
    el.innerHTML = `Gefällt <b>${esc(names[0])}</b> und <b>${esc(names[1])}</b>`;
  else
    el.innerHTML = `Gefällt <b>${esc(names[0])}</b>, <b>${esc(names[1])}</b> und ${names.length - 2} weiteren`;
}

function showLikersList() {
  if (!lbLikers || !lbLikers.length) return;
  // Remove existing popup
  document.getElementById('likers-popup')?.remove();
  const popup = document.createElement('div');
  popup.id = 'likers-popup';
  popup.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:20px;z-index:500;box-shadow:var(--shadow2);min-width:220px;max-width:300px;max-height:60vh;overflow-y:auto;animation:fadeIn .2s ease';
  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-size:15px;font-weight:600;color:var(--text)">Gefällt ${lbLikers.length} ${lbLikers.length === 1 ? 'Person' : 'Personen'}</span>
      <button onclick="document.getElementById('likers-popup')?.remove();document.getElementById('likers-backdrop')?.remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:4px">✕</button>
    </div>
    ${lbLikers
      .map(
        (u) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${u.id !== lbLikers[lbLikers.length - 1]?.id ? 'border-bottom:1px solid var(--border)' : ''}">
        <div style="width:32px;height:32px;border-radius:50%;background:${esc(u.color || '#888')};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0">${getVisibleInitial(u)}</div>
        <span style="font-size:14px;font-weight:500;color:var(--text)">${esc(u.id === me.id ? `${getVisibleName(u) || '?'} (Du)` : getVisibleName(u) || '?')}</span>
      </div>
    `
      )
      .join('')}`;
  const backdrop = document.createElement('div');
  backdrop.id = 'likers-backdrop';
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:499;animation:fadeIn .15s ease';
  backdrop.onclick = () => {
    popup.remove();
    backdrop.remove();
  };
  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

function updateLikeBtn() {
  const btn = $('lb-like-btn');
  btn.className = 'lb-like-btn' + (lbLiked ? ' liked' : '');
  btn.innerHTML = `<span class="lheart">${lbLiked ? ICON_HEART_LG_FULL : ICON_HEART_LG_EMPTY}</span> <span id="lb-like-count">${lbLikeCount}</span> Gefällt mir`;
}

async function toggleLike() {
  const p = photos[lbIdx];
  if (!p) return;
  await doLike(p.id);
}

async function sendComment() {
  const ta = $('comment-input');
  const text = ta.value.trim();
  if (!text) return;
  const p = photos[lbIdx];
  if (!p) return;
  $('send-btn').disabled = true;
  try {
    const comment = await apiCall('/comments', 'POST', { photoId: p.id, content: text });
    lbComments.push(comment);
    p._comments = (p._comments || 0) + 1;
    renderComments();
    ta.value = '';
    ta.style.height = 'auto';
    // Kommentare im Grid aktualisieren
    const card = document.getElementById('pc-' + p.id);
    if (card) {
      const cc = card.querySelector('.p-comment-count');
      if (cc) cc.innerHTML = `${ICON_COMMENT}<span>${p._comments}</span>`;
      else {
        const actions = card.querySelector('.p-actions');
        if (actions) {
          const sp = document.createElement('span');
          sp.className = 'p-comment-count';
          sp.innerHTML = `${ICON_COMMENT}<span>${p._comments}</span>`;
          actions.insertBefore(sp, actions.children[1] || null);
        }
      }
    }
  } catch (e) {
    toast('Kommentar konnte nicht gesendet werden', 'error');
  }
  $('send-btn').disabled = false;
}

async function deleteComment(commentId) {
  try {
    await apiCall(`/comments/${commentId}`, 'DELETE');
    lbComments = lbComments.filter((c) => c.id !== commentId);
    const p = photos[lbIdx];
    if (p) p._comments = Math.max(0, (p._comments || 0) - 1);
    renderComments();
  } catch (e) {
    toast('Kommentar konnte nicht gelöscht werden', 'error');
  }
}

function renderComments() {
  const el = $('lb-comments');
  if (!lbComments.length) {
    el.innerHTML = '<div class="no-comments">Noch keine Kommentare — schreib den ersten! ✨</div>';
    return;
  }
  el.innerHTML = lbComments
    .map((c) => {
      const u = allProfiles[c.userId] || c.user || {};
      const canDel = c.userId === me.id || me.role === 'admin';
      const ts = fmtDateLong(c.createdAt);
      return `<div class="comment-item" title="${esc(ts)}">
      <div class="c-av">${avatarHtml(u, 32)}</div>
      <div class="c-body">
        <span class="c-name">${esc(getVisibleName(u) || '?')}</span>
        ${canDel ? `<button class="c-del" onclick="deleteComment('${c.id}')" title="Löschen">${ICON_TRASH}</button>` : ''}
        <div class="c-text">${esc(c.content)}</div>
        <div class="c-time">${ts}</div>
      </div>
    </div>`;
    })
    .join('');
  el.scrollTop = el.scrollHeight;
}

let _lbMenuOpen = false;

function toggleLbMenu() {
  if (_lbMenuOpen) {
    document.getElementById('lb-action-menu')?.remove();
    _lbMenuOpen = false;
    return;
  }
  buildLbMenu();
}

function buildLbMenu() {
  document.getElementById('lb-action-menu')?.remove();
  const p = photos[lbIdx];
  if (!p) return;
  const isFullview = $('lb').classList.contains('lb-fullview');
  const canDel = p.uploaderId === me.id;
  const isAdmin = me?.role === 'admin';

  const items = [
    { icon: ICON_DOWNLOAD, label: 'Herunterladen', fn: 'downloadPhoto()', cls: '' },
    { icon: ICON_ALBUM, label: 'Album', fn: 'openAlbumPicker()', cls: '' },
    {
      icon: isFullview ? ICON_SHRINK : ICON_FULLSCREEN,
      label: isFullview ? 'Verkleinern' : 'Vollbild',
      fn: 'toggleFullview()',
      cls: 'muted',
    },
    ...(canDel
      ? [{ icon: ICON_TRASH, label: 'Löschen', fn: 'askDel(null,true)', cls: 'danger' }]
      : []),
    ...(isAdmin
      ? [{ icon: '', label: '#ID kopieren', fn: 'copyCurrentImageId()', cls: 'muted' }]
      : []),
  ];

  const menu = document.createElement('div');
  menu.id = 'lb-action-menu';
  menu.className = 'lb-action-menu';
  menu.innerHTML = items
    .map(
      (it) =>
        `<button class="lb-action-menu-item ${it.cls}" onclick="closeLbMenu();${it.fn}">${it.icon ? it.icon + '&nbsp;' : ''}${esc(it.label)}</button>`
    )
    .join('');

  // Positionieren relativ zum lb-panel-top
  const panelTop = document.querySelector('.lb-panel-top');
  if (panelTop) panelTop.appendChild(menu);
  _lbMenuOpen = true;

  // Schließen bei Klick außerhalb
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!menu.contains(e.target) && e.target !== document.getElementById('lb-more-btn')) {
        menu.remove();
        _lbMenuOpen = false;
        document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

function closeLbMenu() {
  document.getElementById('lb-action-menu')?.remove();
  _lbMenuOpen = false;
}

function copyCurrentImageId() {
  const p = photos[lbIdx];
  if (!p?.id) return;
  navigator.clipboard.writeText(p.id).then(() => toast('Bild-ID kopiert', 'success'));
}

function closeLB() {
  resetZoom();
  hide('lb');
  hide('ss-bar');
  pauseSS();
  $('lb').classList.remove('ss-fullscreen');
  $('lb').classList.remove('lb-fullview');
  document.querySelectorAll('.lb-fullview-hint').forEach((e) => e.remove());
}
function handleLbBgClick(e) {
  // In fullview: click anywhere to exit fullview
  if ($('lb').classList.contains('lb-fullview')) {
    if (
      e.target === $('lb-img') ||
      e.target.classList.contains('lb-img-side') ||
      e.target === $('lb')
    ) {
      toggleFullview();
      return;
    }
  }
  // Close if clicking the dark background or the image side (not the panel)
  if (
    e.target === $('lb') ||
    e.target.classList.contains('lb-img-side') ||
    e.target === $('lb-img-side-inner')
  )
    closeLB();
}
function lbNav(d) {
  resetZoom();
  openLB(Math.max(0, Math.min(photos.length - 1, lbIdx + d)));
}
document.addEventListener('keydown', (e) => {
  if ($('lb').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLB();
  if ($('comment-input') === document.activeElement) return;
  if (e.key === 'ArrowLeft') lbNav(-1);
  else if (e.key === 'ArrowRight') lbNav(1);
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
    if (ico) ico.textContent = '🖼';
    if (txt) txt.textContent = 'Was möchtest du mit diesem Foto tun?';
    btns.className = 'dlg-btns stacked';
    btns.innerHTML = `
      <button class="btn" style="background:var(--accent-l);color:var(--accent);border:1.5px solid #dcc0a0;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600" onclick="removeFromAlbum()">Aus Album entfernen</button>
      <button class="btn btn-danger" style="padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600" onclick="execDel()">Überall löschen</button>
      <button class="btn btn-ghost" style="padding:12px 18px;border-radius:10px;font-size:14px" onclick="cancelDel()">Abbrechen</button>`;
  } else {
    if (ico) ico.textContent = '🗑';
    if (txt) txt.textContent = 'Dieses Foto wirklich unwiderruflich löschen?';
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
  try {
    await apiCall(`/photos/${delTarget}`, 'PATCH', { albumId: curAlbum });
  } catch (e) {
    /* ignore */
  }
  if (delFromLb) closeLB();
  await loadPhotos(true);
  if (curAlbum) await loadAlbums();
}
function cancelDel() {
  hide('del-dlg');
  delTarget = null;
}
async function execDel() {
  if (!delTarget) return;
  hide('del-dlg');
  try {
    await apiCall(`/photos/${delTarget}`, 'DELETE');
  } catch (e) {
    console.error(e);
  }
  if (delFromLb) closeLB();
  delTarget = null;
  invalidateCounts();
  await loadPhotos(true);
  renderSidebar();
}

// ── MOBILE SIDEBAR ───────────────────────────────────────
function toggleSidebar() {
  const sb = $('sidebar'),
    ov = $('mob-overlay');
  const isOpen = sb.classList.contains('open');
  isOpen ? closeSidebar() : openSidebar();
}
function openSidebar() {
  $('sidebar').classList.add('open');
  $('mob-overlay').style.display = 'block';
  document.body.classList.add('mobile-sidebar-open');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('mob-overlay').style.display = 'none';
  document.body.classList.remove('mobile-sidebar-open');
  document.body.style.overflow = '';
}

// ── MOBILE NAV ────────────────────────────────────────────
function updateMobileAv() {}

// ── ALBUMS ────────────────────────────────────────────────
async function loadAlbums() {
  try {
    const { albums } = await apiCall(`/albums?groupId=${curGroupId}`, 'GET');
    allAlbums = albums || [];
  } catch (e) {
    allAlbums = [];
  }
}

function openAlbumModal(fromLightbox = false) {
  renderAlbumList();
  const el = document.getElementById('album-modal');
  if (fromLightbox) el.classList.add('modal-bg--top');
  else el.classList.remove('modal-bg--top');
  show('album-modal');
}
function closeAlbumModal() {
  hide('album-modal');
  document.getElementById('album-modal')?.classList.remove('modal-bg--top');
}

function renderAlbumList() {
  const el = $('album-list');
  if (!allAlbums.length) {
    el.innerHTML =
      '<p style="font-size:13px;color:var(--muted2);font-weight:300;padding:8px 0">Noch keine Alben erstellt.</p>';
    return;
  }
  const sortedForModal = [...allAlbums].sort((a, b) => {
    const aOwn = a.createdBy === me.id ? 0 : 1;
    const bOwn = b.createdBy === me.id ? 0 : 1;
    return aOwn - bOwn;
  });
  el.innerHTML = sortedForModal
    .map((a) => {
      const isCreator = a.createdBy === me.id;
      const isAdmin = me.role === 'admin';
      const curGroup = myGroups.find((g) => g.id === curGroupId);
      const isGroupOwner = curGroup?.createdBy === me.id;
      const isDeputy = groupDeputies.some((d) => d.id === me.id);
      const canManage = isCreator || isAdmin || isGroupOwner || isDeputy;
      const creatorUser = groupMembers.find((m) => m.id === a.createdBy);
      const creatorChip = creatorUser
        ? `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:10px;padding:1px 6px" title="Ersteller">${esc(getVisibleName(creatorUser) || '?')}</span>`
        : '';
      const contributorChips = (a.contributors || [])
        .map(
          (c) =>
            `<span style="font-size:10px;background:var(--accent-l);color:var(--accent);border-radius:10px;padding:1px 6px">${esc(getVisibleName(c) || '?')}</span>`
        )
        .join(' ');
      const chips = [creatorChip, contributorChips].filter(Boolean).join(' ');
      return `
    <div class="album-row" style="flex-direction:column;align-items:stretch;gap:4px${isCreator ? ';box-shadow:inset 3px 0 0 var(--accent)' : ''}">
      <div style="display:flex;align-items:center;gap:6px">
        <span class="album-row-name" style="${isCreator ? 'color:var(--accent);font-weight:600' : ''}">${esc(a.name)}</span>
        <span class="album-row-count" id="arc-${a.id}">${a._count?.photos ?? '…'} Fotos</span>
        ${canManage ? `<button class="album-row-del" onclick="openAlbumSettings('${a.id}')" title="Einstellungen" style="color:var(--muted2)">${ICON_GEAR}</button>` : ''}
        ${canManage ? `<button class="album-row-del" onclick="deleteAlbum('${a.id}')" title="Löschen">${ICON_TRASH}</button>` : ''}
      </div>
      ${chips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;padding-left:2px">${chips}</div>` : ''}
    </div>`;
    })
    .join('');
}

async function createAlbum() {
  const name = $('new-album-name').value.trim();
  if (!name) return;
  try {
    const album = await apiCall('/albums', 'POST', { name, groupId: curGroupId });
    allAlbums.push(album);
    $('new-album-name').value = '';
    renderAlbumList();
    renderSidebar();
  } catch (e) {
    toast('Album-Erstellung fehlgeschlagen', 'error');
  }
}

function openNewAlbumInline() {
  const el = $('new-album-inline');
  if (el) {
    el.classList.remove('hidden');
    document.getElementById('new-album-sb-input')?.focus();
  }
}
function closeNewAlbumInline() {
  const el = $('new-album-inline');
  if (el) el.classList.add('hidden');
  const inp = document.getElementById('new-album-sb-input');
  if (inp) inp.value = '';
}
async function createAlbumInline() {
  const inp = document.getElementById('new-album-sb-input');
  const name = inp?.value?.trim();
  if (!name) return;
  try {
    const album = await apiCall('/albums', 'POST', { name, groupId: curGroupId });
    allAlbums.push(album);
    closeNewAlbumInline();
    renderSidebar();
  } catch (e) {
    toast('Album-Erstellung fehlgeschlagen', 'error');
  }
}

// openAlbumSettings: öffnet Album-Einstellungen (Umbenennen + Contributors)
// Kann mit einer albumId aufgerufen werden (aus renderAlbumList) oder ohne (curAlbum)
function openAlbumSettings(albumId) {
  const id = albumId || curAlbum;
  if (!id) return;
  const a = allAlbums.find((x) => x.id === id);
  if (!a) return;
  openContributorModal(id);
}

function openRenameAlbum() {
  const a = allAlbums.find((x) => x.id === curAlbum);
  if (!a) return;
  const newName = prompt('Album umbenennen:', a.name);
  if (!newName || newName.trim() === a.name) return;
  renameAlbum(curAlbum, newName.trim());
}
async function renameAlbum(id, newName) {
  try {
    await apiCall(`/albums/${id}`, 'PATCH', { name: newName });
    const a = allAlbums.find((x) => x.id === id);
    if (a) a.name = newName;
    renderSidebar();
    $('gal-title').textContent = newName;
  } catch (e) {
    toast('Umbenennen fehlgeschlagen', 'error');
  }
}

async function deleteAlbum(id) {
  const a = allAlbums.find((x) => x.id === id);
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if (ico) ico.textContent = '📁';
  if (txt)
    txt.textContent = `Album „${a?.name || 'Album'}" wirklich löschen? Die Fotos bleiben erhalten.`;
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
    allAlbums = allAlbums.filter((a) => a.id !== id);
    if (curAlbum === id) {
      curAlbum = null;
      await loadPhotos(true);
    }
    renderAlbumList();
    renderSidebar();
    toast('Album gelöscht', 'success');
  } catch (e) {
    toast('Album-Löschen fehlgeschlagen', 'error');
  }
}

// ── CONTRIBUTOR MODAL ────────────────────────────────────
let _contribAlbumId = null;

async function openContributorModal(albumId) {
  _contribAlbumId = albumId;
  const a = allAlbums.find((x) => x.id === albumId);
  if (!a) return;

  const el = document.getElementById('contrib-modal');
  document.getElementById('contrib-modal-title').textContent = `„${a.name}" verwalten`;

  // Umbenennen-Feld vorbelegen
  const renameInput = document.getElementById('contrib-rename-input');
  if (renameInput) renameInput.value = a.name;

  // Creator oder Admin darf umbenennen und löschen
  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const isGroupOwner = curGroup?.createdBy === me.id;
  const isDeputy = groupDeputies.some((d) => d.id === me.id);
  const canRename = a.createdBy === me.id || me.role === 'admin' || isGroupOwner || isDeputy;
  const renameRow = document.getElementById('contrib-rename-row');
  if (renameRow) renameRow.style.display = canRename ? '' : 'none';
  const deleteRow = document.getElementById('contrib-delete-row');
  if (deleteRow) deleteRow.style.display = canRename ? '' : 'none';

  renderContributorList(a);
  renderContributorMemberPicker(a);
  show('contrib-modal');
}

function closeContributorModal() {
  _contribAlbumId = null;
  hide('contrib-modal');
}

function deleteAlbumFromModal() {
  if (!_contribAlbumId) return;
  const id = _contribAlbumId;
  closeContributorModal();
  deleteAlbum(id);
}

function renderContributorList(album) {
  const el = document.getElementById('contrib-list');
  const contributors = album.contributors || [];
  if (!contributors.length) {
    el.innerHTML =
      '<p style="font-size:13px;color:var(--muted);font-weight:300">Noch keine Contributors hinzugefügt.<br>Nur der Ersteller kann Fotos hinzufügen.</p>';
    return;
  }
  el.innerHTML = contributors
    .map(
      (c) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="width:28px;height:28px;border-radius:50%;background:${c.color || '#888'};flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700">
        ${c.avatar ? `<img src="${c.avatar}" style="width:100%;height:100%;object-fit:cover">` : getVisibleInitial(c)}
      </div>
      <span style="flex:1;font-size:13px">${esc(getVisibleName(c) || '?')}</span>
      <button onclick="removeContributor('${album.id}','${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--red,#e05555);padding:3px 6px;border-radius:6px;font-size:12px" title="Entfernen">✕</button>
    </div>`
    )
    .join('');
}

function renderContributorMemberPicker(album) {
  const sel = document.getElementById('contrib-user-select');
  if (!sel) return;
  const existingIds = new Set((album.contributors || []).map((c) => c.id));
  existingIds.add(album.createdBy); // Creator schon drin
  const eligible = groupMembers.filter((m) => !existingIds.has(m.id));
  if (!eligible.length) {
    sel.innerHTML = '<option value="">— Alle Mitglieder bereits Contributors —</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">— Mitglied auswählen —</option>' +
    eligible
      .map((m) => `<option value="${m.id}">${esc(getVisibleName(m) || '?')}</option>`)
      .join('');
}

async function addContributor() {
  const sel = document.getElementById('contrib-user-select');
  const userId = sel?.value;
  if (!userId || !_contribAlbumId) return;
  try {
    const newUser = await apiCall(`/albums/${_contribAlbumId}/contributors`, 'POST', { userId });
    const a = allAlbums.find((x) => x.id === _contribAlbumId);
    if (a) {
      a.contributors = [...(a.contributors || []), newUser];
      renderContributorList(a);
      renderContributorMemberPicker(a);
    }
    toast(`${getVisibleName(newUser) || '?'} als Contributor hinzugefügt`, 'success');
  } catch (e) {
    toast('Hinzufügen fehlgeschlagen', 'error');
  }
}

async function removeContributor(albumId, userId) {
  try {
    await apiCall(`/albums/${albumId}/contributors/${userId}`, 'DELETE');
    const a = allAlbums.find((x) => x.id === albumId);
    if (a) {
      a.contributors = (a.contributors || []).filter((c) => c.id !== userId);
      renderContributorList(a);
      renderContributorMemberPicker(a);
    }
    toast('Contributor entfernt', 'success');
  } catch (e) {
    toast('Entfernen fehlgeschlagen', 'error');
  }
}

async function saveAlbumRename() {
  const input = document.getElementById('contrib-rename-input');
  const newName = input?.value?.trim();
  if (!newName || !_contribAlbumId) return;
  const a = allAlbums.find((x) => x.id === _contribAlbumId);
  if (a && newName === a.name) return;
  try {
    await apiCall(`/albums/${_contribAlbumId}`, 'PATCH', { name: newName });
    if (a) a.name = newName;
    document.getElementById('contrib-modal-title').textContent = `„${newName}" verwalten`;
    renderSidebar();
    if (curAlbum === _contribAlbumId) $('gal-title').textContent = newName;
    renderAlbumList();
    toast('Album umbenannt', 'success');
  } catch (e) {
    toast('Umbenennen fehlgeschlagen', 'error');
  }
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
  ssPlaying = true;
  const icon = $('ss-play-icon');
  if (icon)
    icon.innerHTML =
      '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  clearInterval(ssTimer);
  ssTimer = setInterval(() => {
    if (lbIdx < photos.length - 1) lbNav(1);
    else {
      pauseSS();
      closeLB();
    }
  }, ssSpeeds[ssSpeedIdx] * 1000);
}

function pauseSS() {
  ssPlaying = false;
  clearInterval(ssTimer);
  const icon = $('ss-play-icon');
  if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
}

function ssChangeSpeed() {
  ssSpeedIdx = (ssSpeedIdx + 1) % ssSpeeds.length;
  const el = $('ss-speed');
  if (el) el.textContent = ssSpeeds[ssSpeedIdx] + 's';
  if (ssPlaying) startSS();
}

// ── PROFILE / AVATAR ──────────────────────────────────────
const PROFILE_COLORS = [
  '#b07448',
  '#c86888',
  '#8868c8',
  '#6888d4',
  '#4aacb8',
  '#5a9e7a',
  '#c8a048',
  '#c87848',
  '#7888c8',
  '#a8c858',
  '#888888',
];
const _inlineMsgTimers = {};

function flashInlineMessage(id, type, text, timeout = 5000) {
  showMsg(id, type, text);
  if (_inlineMsgTimers[id]) clearTimeout(_inlineMsgTimers[id]);
  _inlineMsgTimers[id] = setTimeout(() => {
    hide(id);
    delete _inlineMsgTimers[id];
  }, timeout);
}

async function openProfileModal() {
  if (window.innerWidth <= 900 && document.body.classList.contains('mobile-sidebar-open')) return;
  const av = $('avatar-preview');
  av.style.background = meProfile.color;
  if (meProfile.avatar) {
    av.innerHTML = `<img src="${meProfile.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    av.textContent = getVisibleInitial(meProfile, me.displayNameField);
  }
  const clearBtn = $('clear-avatar-btn');
  if (clearBtn) clearBtn.style.display = meProfile.avatar ? '' : 'none';
  renderColorSwatches();
  renderDisplayNameBtns();
  hide('avatar-msg');
  hide('color-msg');
  hide('notif-prefs-msg');
  // Reset prefs panel to collapsed state
  const col = $('notif-prefs-collapsible');
  const toggle = $('notif-prefs-toggle');
  const chevron = $('notif-prefs-chevron');
  if (col) col.style.display = 'none';
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (chevron) chevron.style.transform = '';
  const loading = $('notif-prefs-loading');
  const prefsBody = $('notif-prefs-body');
  if (loading) {
    loading.textContent = 'Laden…';
    loading.style.display = '';
  }
  if (prefsBody) hide('notif-prefs-body');
  show('profile-modal');
}

function renderColorSwatches() {
  const wrap = $('color-swatches');
  if (!wrap) return;
  const current = meProfile.color || '#888888';
  const isPreset = PROFILE_COLORS.includes(current);
  wrap.innerHTML =
    PROFILE_COLORS.map(
      (c) => `
    <div class="color-swatch${c === current ? ' active' : ''}" style="background:${c}" title="${c}" onclick="setUserColor('${c}')"></div>
  `
    ).join('') +
    `
    <div class="color-swatch-custom" title="Eigene Farbe wählen" style="position:relative">
      ${isPreset ? '<span style="pointer-events:none;font-size:14px">🎨</span>' : `<span style="pointer-events:none;display:inline-block;width:14px;height:14px;border-radius:50%;background:${current}"></span>`}
      <input type="color" value="${isPreset ? '#ff8844' : current}" oninput="setUserColor(this.value,true)" onchange="setUserColor(this.value)">
    </div>
  `;
}

async function setUserColor(color, previewOnly = false) {
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
    flashInlineMessage('color-msg', 'success', '✓ Farbe gespeichert!');
  } catch (e) {
    flashInlineMessage('color-msg', 'error', 'Fehler beim Speichern der Farbe.');
  }
}

function renderDisplayNameBtns() {
  const wrap = $('displayname-btns');
  if (!wrap) return;
  const rawName = me._origName || me.name;
  const rawUser = me._origUsername || me.username;
  const current = me.displayNameField || 'name';
  const hint = $('displayname-hint');

  // Only show toggle if both values exist and are distinct
  if (!rawName || !rawUser || rawName === rawUser) {
    const single = rawName || rawUser || '—';
    wrap.innerHTML = `<div style="width:100%;padding:8px 12px;font-size:13px;font-weight:600;color:var(--text);border:1.5px solid var(--border);border-radius:10px;text-align:center;background:var(--accent);color:#fff">${esc(single)}</div>`;
    if (hint) hint.style.display = 'none';
    return;
  }
  if (hint) hint.style.display = '';
  // Render as a segmented toggle group
  wrap.innerHTML = `
    <div style="display:flex;border:1.5px solid var(--border);border-radius:10px;overflow:hidden;width:100%">
      ${[
        { field: 'name', label: rawName },
        { field: 'username', label: rawUser },
      ]
        .map(
          ({ field, label }) => `
        <button
          onclick="setDisplayName('${field}')"
          style="flex:1;padding:8px 12px;font-size:13px;font-weight:${field === current ? '600' : '400'};border:none;cursor:pointer;transition:background .15s,color .15s;
            background:${field === current ? 'var(--accent)' : 'transparent'};
            color:${field === current ? '#fff' : 'var(--text)'};
            border-right:${field === 'name' ? '1.5px solid var(--border)' : 'none'}"
        >${esc(label)}</button>
      `
        )
        .join('')}
    </div>`;
}

async function setDisplayName(field) {
  const val = field === 'username' ? me._origUsername || me.username : me._origName || me.name;
  if (!val) return;
  try {
    await apiCall('/auth/profile', 'PATCH', { displayNameField: field });
    me.displayNameField = field;
    meProfile.displayNameField = field;
    if (allProfiles[me.id]) {
      allProfiles[me.id].displayNameField = field;
    }
    // Update header
    const nameElement = $('hname');
    if (nameElement) nameElement.textContent = getVisibleName(me, field) || me.email;
    const hav = $('hav');
    if (hav && !meProfile.avatar) hav.textContent = getVisibleInitial(meProfile, field);
    // Mitgliederliste neu laden, damit Sidebar garantiert aktuellen Wert nutzt
    if (curGroupId) {
      try {
        await loadGroupMembers();
      } catch (e) {
        /* ignore */
      }
    }
    renderSidebar();
    renderDisplayNameBtns();
    const valLabel = getVisibleName(me, field) ? `„${esc(getVisibleName(me, field))}"` : '—';
    flashInlineMessage('displayname-msg', 'success', `✓ Anzeigename auf ${valLabel} gesetzt.`);
  } catch (e) {
    flashInlineMessage('displayname-msg', 'error', 'Fehler beim Speichern des Anzeigenamens.');
  }
}

function closeProfileModal() {
  hide('profile-modal');
  hide('displayname-msg');
  hide('color-msg');
  hide('notif-prefs-msg');
}

async function uploadAvatar(file) {
  if (!file) return;
  showMsg('avatar-msg', 'info', 'Wird hochgeladen…');
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
    const freshAvatarUrl = withCacheBust(avatarUrl);
    meProfile.avatar = freshAvatarUrl;
    me.avatar = freshAvatarUrl;
    if (allProfiles[me.id]) allProfiles[me.id].avatar = freshAvatarUrl;
    $('avatar-preview').innerHTML =
      `<img src="${freshAvatarUrl}" style="width:100%;height:100%;object-fit:cover">`;
    const hav = $('hav');
    if (hav) hav.innerHTML = `<img class="av-img" src="${freshAvatarUrl}">`;
    renderSidebar();
    updateMobileAv();
    flashInlineMessage('avatar-msg', 'success', '✓ Profilfoto gespeichert!');
    $('clear-avatar-btn').style.display = '';
  } catch (e) {
    flashInlineMessage('avatar-msg', 'error', 'Fehler beim Hochladen.');
  }
}

async function clearAvatar() {
  showMsg('avatar-msg', 'info', 'Wird gelöscht…');
  try {
    await apiCall('/auth/avatar', 'DELETE');
    meProfile.avatar = null;
    if (allProfiles[me.id]) allProfiles[me.id].avatar = null;
    const av = $('avatar-preview');
    av.innerHTML = '';
    av.textContent = getVisibleInitial(meProfile, me.displayNameField);
    const hav = $('hav');
    if (hav) {
      hav.innerHTML = '';
      hav.textContent = getVisibleInitial(meProfile, me.displayNameField);
      hav.style.background = meProfile.color;
    }
    $('clear-avatar-btn').style.display = 'none';
    renderSidebar();
    updateMobileAv();
    flashInlineMessage('avatar-msg', 'success', '✓ Profilfoto entfernt.');
  } catch (e) {
    flashInlineMessage('avatar-msg', 'error', 'Fehler beim Löschen.');
  }
}

// ── ADD FROM ALL PHOTOS ──────────────────────────────────
let addPhotoSelection = new Set();

async function openAddFromAll() {
  if (!curAlbum) return;
  addPhotoSelection = new Set();
  show('add-photos-modal');
  const grid = $('add-photos-grid');
  grid.innerHTML =
    '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:30px"><div class="spinner"></div></div>';
  try {
    const { photos: allData } = await apiCall(`/photos?groupId=${curGroupId}&limit=200`, 'GET');
    if (!allData?.length) {
      grid.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:20px;grid-column:1/-1">Keine Fotos vorhanden.</p>';
      return;
    }
    allData.forEach((p) => {
      if (p.url) urlCache[p.id] = p.url;
    });
    grid.innerHTML = allData
      .map((p) => {
        const url = urlCache[p.id] || '';
        const inAlbum = (p.albumIds || []).includes(curAlbum);
        return `<div class="add-photo-thumb${inAlbum ? ' selected' : ''}" id="apt-${p.id}" onclick="toggleAddSelection('${p.id}',${inAlbum})" title="${esc(p.filename || '')}">
        <img src="${esc(photoSrc(url))}" loading="lazy">
        <div class="check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        ${inAlbum ? '<div style="position:absolute;bottom:4px;left:4px;background:var(--accent);border-radius:4px;padding:1px 5px;font-size:9px;color:#fff;font-weight:700">Im Album</div>' : ''}
      </div>`;
      })
      .join('');
    allData
      .filter((p) => (p.albumIds || []).includes(curAlbum))
      .forEach((p) => addPhotoSelection.add(p.id));
    updateAddCount();
  } catch (e) {
    grid.innerHTML =
      '<p style="color:var(--muted);text-align:center;grid-column:1/-1">Fehler beim Laden.</p>';
  }
}

function toggleAddSelection(photoId, wasInAlbum) {
  const el = document.getElementById('apt-' + photoId);
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
  if (el)
    el.textContent =
      addPhotoSelection.size === 1
        ? '1 Foto ausgewählt'
        : `${addPhotoSelection.size} Fotos ausgewählt`;
}

async function confirmAddToAlbum() {
  if (!curAlbum || !addPhotoSelection.size) {
    closeAddModal();
    return;
  }
  const btn = document.querySelector('#add-photos-modal .btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird gespeichert…';
  }
  try {
    // Alle gewählten Fotos dem Album zuordnen, nicht gewählte raus
    const { photos: albumPhotos } = await apiCall(
      `/photos?groupId=${curGroupId}&albumId=${curAlbum}&limit=200`,
      'GET'
    );
    const currentIds = new Set((albumPhotos || []).map((p) => p.id));
    const toAdd = [...addPhotoSelection].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !addPhotoSelection.has(id));
    const calls = [];
    if (toAdd.length)
      calls.push(apiCall('/photos/batch-album', 'PATCH', { photoIds: toAdd, albumId: curAlbum }));
    if (toRemove.length)
      calls.push(
        apiCall('/photos/batch-album', 'PATCH', {
          photoIds: toRemove,
          albumId: curAlbum,
          remove: true,
        })
      );
    await Promise.all(calls);
  } catch (e) {
    toast('Fehler beim Speichern', 'error');
    console.error(e);
  }
  closeAddModal();
  await loadPhotos(true);
  await loadAlbums();
}

function closeAddModal() {
  hide('add-photos-modal');
  addPhotoSelection = new Set();
  const btn = document.querySelector('#add-photos-modal .btn-primary');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Hinzufügen';
  }
}

// ── ALBUM PICKER ─────────────────────────────────────────
let pickerOpen = false;

function openAlbumPicker() {
  if (!allAlbums.length) {
    openAlbumModal(true);
    return;
  }
  // Remove existing picker
  const existing = document.getElementById('album-picker-popup');
  if (existing) {
    existing.remove();
    pickerOpen = false;
    return;
  }
  pickerOpen = true;
  const p = photos[lbIdx];
  const picker = document.createElement('div');
  picker.className = 'album-picker';
  picker.id = 'album-picker-popup';
  picker.innerHTML = `
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted2);padding:4px 10px 8px">Zum Album hinzufügen</div>
    ${allAlbums
      .map((a) => {
        const inA = (p.albumIds || []).includes(a.id);
        return `<div class="album-picker-item ${inA ? 'selected' : ''}" onclick="togglePhotoAlbum('${a.id}','${a.name}')">
        ${ICON_ALBUM}
        ${esc(a.name)}
        ${inA ? '<span style="margin-left:auto;font-size:10px">✓</span>' : ''}
      </div>`;
      })
      .join('')}
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
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!picker.contains(e.target) && e.target !== $('lb-album-btn')) {
        picker.remove();
        pickerOpen = false;
        document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

async function togglePhotoAlbum(albumId, albumName) {
  const p = photos[lbIdx];
  if (!p) return;
  document.getElementById('album-picker-popup')?.remove();
  try {
    await apiCall(`/photos/${p.id}`, 'PATCH', { albumId });
    const ids = p.albumIds || [];
    const idx = ids.indexOf(albumId);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(albumId);
    p.albumIds = ids;
    photos[lbIdx].albumIds = ids;
    updateLbAlbumTag(p);
    await loadAlbums();
  } catch (e) {
    toast('Album-Zuordnung fehlgeschlagen', 'error');
  }
}

function updateLbAlbumTag(p) {
  const tag = document.getElementById('lb-album-tag');
  if (!tag) return;
  const ids = p.albumIds || [];
  if (ids.length) {
    tag.style.display = 'block';
    tag.innerHTML = ids
      .map((aid) => {
        const a = allAlbums.find((x) => x.id === aid);
        return `<span class="album-tag-chip">${ICON_ALBUM}${esc(a?.name || 'Album')}<button onclick="togglePhotoAlbum('${aid}','')">✕</button></span>`;
      })
      .join('');
  } else {
    tag.style.display = 'none';
    tag.innerHTML = '';
  }
}

// ── HELPERS ──────────────────────────────────────────────
async function compress(file, maxW = 1400, q = 0.82) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width,
          h = img.height;
        if (w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob((b) => res(b), 'image/jpeg', q);
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}
function fmtDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('de-DE');
}
function fmtDateLong(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('de-DE');
}
function fmtRelativeTime(s) {
  if (!s) return 'nie online';
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return 'unbekannt';

  const diffMs = Date.now() - dt.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 45) return 'gerade eben';

  const units = [
    { sec: 60 * 60 * 24 * 365, label: 'Jahr' },
    { sec: 60 * 60 * 24 * 30, label: 'Monat' },
    { sec: 60 * 60 * 24 * 7, label: 'Woche' },
    { sec: 60 * 60 * 24, label: 'Tag' },
    { sec: 60 * 60, label: 'Std.' },
    { sec: 60, label: 'Min.' },
  ];

  for (const u of units) {
    if (absSec >= u.sec) {
      const v = Math.round(absSec / u.sec);
      const plural = u.label === 'Std.' || u.label === 'Min.' ? '' : v > 1 ? 'en' : '';
      return `vor ${v} ${u.label}${plural}`;
    }
  }

  return 'gerade eben';
}
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Gibt konsistentes Avatar-HTML zurück: Foto oder Initialen-Kreis
function avatarHtml(user, size = 20) {
  if (user?.avatar) {
    return `<img src="${esc(user.avatar)}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block;flex-shrink:0">`;
  }
  const initial = getVisibleInitial(user);
  const bg = esc(user?.color || '#888');
  const fs = Math.round(size * 0.52);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;font-weight:700;font-size:${fs}px;flex-shrink:0;overflow:hidden">${initial}</span>`;
}
function $(id) {
  return document.getElementById(id);
}
function V(id) {
  return $(id).value;
}
function show(id) {
  $(id)?.classList.remove('hidden');
}
function hide(id) {
  $(id)?.classList.add('hidden');
}
function showMsg(id, t, txt) {
  const e = $(id);
  if (!e) return;
  e.className = `msg msg-${t}`;
  e.textContent = txt;
  e.classList.remove('hidden');
}
function clearMsgs() {
  ['login-msg', 'reg-msg', 'forgot-msg', 'join-group-msg'].forEach((id) => {
    const e = $(id);
    if (e) e.classList.add('hidden');
  });
}
function setBL(id, l, txt) {
  const b = $(id);
  if (!b) return;
  b.disabled = l;
  b.innerHTML = l ? `<span class="spin-sm"></span>${txt}` : txt;
}

// ── GROUP MEMBERS ─────────────────────────────────────────
async function loadGroupMembers() {
  try {
    const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
    const cacheBust = Date.now();
    groupMembers = (members || []).map((m) => ({
      ...m,
      avatar: m.avatar
        ? `${m.avatar}${m.avatar.includes('?') ? '&' : '?'}v=${cacheBust}`
        : m.avatar,
    }));
    groupMembers.forEach((m) => {
      allProfiles[m.id] = m;
    });
    groupMembers.sort((a, b) => {
      if (a.id === me.id) return -1;
      if (b.id === me.id) return 1;
      return getVisibleName(a).localeCompare(getVisibleName(b), 'de', { sensitivity: 'base' });
    });
  } catch (e) {
    groupMembers = [];
  }
}

// ── GROUP SWITCHER ────────────────────────────────────────
function renderGroupSwitcher() {
  const wrap = $('group-switcher-wrap');
  if (!wrap || myGroups.length <= 0) return;
  const active = myGroups.find((g) => g.id === curGroupId);
  // Update header subtitle
  const sub = $('header-group-name');
  if (sub) sub.textContent = active?.name || 'Gruppe';
  // Auf Mobile: Icon-Button statt Dropdown (Sheet wird per openMobileGroupSwitcherSheet geöffnet)
  if (window.innerWidth <= 900) {
    wrap.innerHTML = `
      <button class="gsw-mob-btn" id="gsw-mob-btn" onclick="openMobileGroupSwitcherSheet()" aria-label="Gruppe wechseln">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </button>`;
    return;
  }
  // Only show switcher if multiple groups
  if (myGroups.length <= 1) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <div class="group-sw" id="group-sw-btn" onclick="toggleGroupDropdown()">
      <span class="g-dot"></span>
      <span>${esc(active?.name || 'Gruppe')}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>`;
}

function toggleGroupDropdown() {
  const existing = document.getElementById('group-dd');
  if (existing) {
    existing.remove();
    return;
  }
  const btn = $('group-sw-btn');
  if (!btn) return;
  const dd = document.createElement('div');
  dd.className = 'group-dd';
  dd.id = 'group-dd';
  dd.innerHTML =
    myGroups
      .map(
        (g) => `
    <div class="group-dd-item${g.id === curGroupId ? ' active' : ''}" onclick="switchGroup('${g.id}')">
      <span class="g-dot" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
      ${esc(g.name)}
      ${g.id === curGroupId ? '<span class="g-check">✓</span>' : ''}
    </div>`
      )
      .join('') +
    `
    <div class="group-dd-divider"></div>
    <div class="group-dd-join" onclick="openJoinGroup()">
      ${ICON_PLUS} Weiterer Gruppe beitreten
    </div>`;
  btn.appendChild(dd);
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

function openMobileGroupSwitcherSheet() {
  document.getElementById('gsw-mob-sheet')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'gsw-mob-sheet';
  overlay.className = 'gsw-mob-overlay';
  overlay.innerHTML = `
    <div class="gsw-mob-panel" id="gsw-mob-panel">
      <div class="gsw-mob-hdr">
        <span>Gruppe wechseln</span>
        <button class="gsw-mob-close" onclick="closeMobileGroupSwitcherSheet()">✕</button>
      </div>
      <div class="gsw-mob-list">
        ${myGroups
          .map(
            (g) => `
        <div class="gsw-mob-item${g.id === curGroupId ? ' active' : ''}" onclick="switchGroup('${g.id}');closeMobileGroupSwitcherSheet()">
          <span class="g-dot" style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
          <span class="gsw-mob-name">${esc(g.name)}</span>
          ${g.id === curGroupId ? '<span class="gsw-mob-check">✓</span>' : ''}
        </div>`
          )
          .join('')}
        <div class="gsw-mob-divider"></div>
        <div class="gsw-mob-item gsw-mob-join" onclick="openJoinGroup();closeMobileGroupSwitcherSheet()">
          ${ICON_PLUS} Weiterer Gruppe beitreten
        </div>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMobileGroupSwitcherSheet();
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeMobileGroupSwitcherSheet() {
  const el = document.getElementById('gsw-mob-sheet');
  if (!el) return;
  el.classList.remove('visible');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

// ── SUPPORT / FEEDBACK MODAL ─────────────────────────────────────────────

async function openSupportModal() {
  document.getElementById('feedback-modal')?.classList.remove('hidden');
  // Always open on "new" tab
  switchFeedbackTab('new');
  document.getElementById('feedback-msg')?.classList.add('hidden');
  const cat = document.getElementById('feedback-category');
  if (cat) cat.value = '';
  const subj = document.getElementById('feedback-subject');
  if (subj) subj.value = '';
  const bod = document.getElementById('feedback-body');
  if (bod) bod.value = '';
  const anon = document.getElementById('feedback-anonymous');
  if (anon) anon.checked = false;
  document.getElementById('feedback-reported-user-wrap')?.classList.add('hidden');
  try {
    const payload = await apiCall('/feedback/eligible-users', 'GET');
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const sel = document.getElementById('feedback-reported-user');
    if (sel) {
      sel.innerHTML =
        '<option value="">— Nutzer wählen —</option>' +
        users
          .map(
            (u) =>
              `<option value="${esc(u.id)}">${esc(getVisibleName(u, u.displayNameField) || u.name || u.username)}</option>`
          )
          .join('');
    }
  } catch (e) {}
}

function closeSupportModal() {
  document.getElementById('feedback-modal')?.classList.add('hidden');
}

function onFeedbackCategoryChange() {
  const cat = document.getElementById('feedback-category')?.value;
  const wrap = document.getElementById('feedback-reported-user-wrap');
  if (wrap) wrap.classList.toggle('hidden', cat !== 'report_user');
}

async function submitFeedback() {
  const category = document.getElementById('feedback-category')?.value;
  const subject = document.getElementById('feedback-subject')?.value?.trim();
  const body = document.getElementById('feedback-body')?.value?.trim();
  const anonymous = document.getElementById('feedback-anonymous')?.checked ?? false;
  const reportedUserId =
    category === 'report_user'
      ? document.getElementById('feedback-reported-user')?.value || null
      : null;
  const msgEl = document.getElementById('feedback-msg');
  const btn = document.getElementById('feedback-submit-btn');
  const showMsg = (text, isError, asHtml = false) => {
    if (!msgEl) return;
    if (asHtml) msgEl.innerHTML = text;
    else msgEl.textContent = text;
    msgEl.className = 'msg ' + (isError ? 'msg-error' : 'msg-success');
    if (!isError) msgEl.classList.add('feedback-msg-success');
    msgEl.classList.remove('hidden');
  };
  if (!category) return showMsg('Bitte eine Kategorie wählen.', true);
  if (!subject) return showMsg('Bitte einen Betreff eingeben.', true);
  if (!body) return showMsg('Bitte eine Nachricht eingeben.', true);
  if (category === 'report_user' && !reportedUserId)
    return showMsg('Bitte einen Nutzer auswählen.', true);
  if (btn) btn.disabled = true;
  try {
    await apiCall('/feedback', 'POST', { category, subject, body, anonymous, reportedUserId });
    showMsg(
      '<strong>Danke, angekommen!</strong><br><span>Wir haben dein Feedback erhalten und schauen es uns an.</span>',
      false,
      true
    );
    toast('Feedback erfolgreich gesendet', 'success');
    document.getElementById('feedback-subject').value = '';
    document.getElementById('feedback-body').value = '';
    document.getElementById('feedback-category').value = '';
    document.getElementById('feedback-anonymous').checked = false;
    document.getElementById('feedback-reported-user-wrap')?.classList.add('hidden');
    setTimeout(() => closeSupportModal(), 1400);
  } catch (e) {
    showMsg(e.serverMessage || 'Netzwerkfehler. Bitte versuche es später erneut.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── ADMIN FEEDBACK PANEL ─────────────────────────────────────────────────

function openAdminFeedback() {
  document.getElementById('admin-feedback-modal')?.classList.remove('hidden');
  renderAdminFeedbackList();
}

function setAdminFeedbackBadge(openCount) {
  const badge = document.getElementById('admin-feedback-badge');
  if (!badge) return;
  if (Number(openCount) > 0) {
    badge.textContent = String(openCount);
    badge.classList.remove('hidden');
    return;
  }
  badge.classList.add('hidden');
  badge.textContent = '';
}

function countFeedbackWaitingForSupport(reports) {
  if (!Array.isArray(reports)) return 0;
  return reports.filter((r) => r?.status === 'open' && r?.waitingFor === 'support').length;
}

async function refreshAdminFeedbackBadge() {
  if (me?.role !== 'admin') return;
  try {
    const { reports } = await apiCall('/feedback?status=open', 'GET');
    setAdminFeedbackBadge(countFeedbackWaitingForSupport(reports));
  } catch {
    // Sidebar rendering should stay stable even if feedback count cannot be loaded.
  }
}

function closeAdminFeedback() {
  document.getElementById('admin-feedback-modal')?.classList.add('hidden');
}

function formatFeedbackTicketId(rawId) {
  const compact = String(rawId || '').replace(/[^a-zA-Z0-9]/g, '');
  return `TKT-${compact.slice(-8).toUpperCase() || 'UNKNOWN'}`;
}

function getResolutionReasonFromLatestMessage(report) {
  const lastMsg = report?.messages?.[0];
  const prefix = 'Admin-Begründung zur Entscheidung: ';
  if (!lastMsg?.body || lastMsg.author?.role !== 'admin') return '';
  if (lastMsg.body.startsWith(prefix)) {
    return `Begründung: ${lastMsg.body.slice(prefix.length).trim()}`;
  }
  if (lastMsg.body.startsWith('Vielen Dank für deine Meldung.')) {
    return lastMsg.body.replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function renderAdminFeedbackList() {
  const list = document.getElementById('admin-feedback-list');
  if (!list) return;
  const status = document.getElementById('af-filter-status')?.value || '';
  const category = document.getElementById('af-filter-category')?.value || '';
  const ticketQuery = (document.getElementById('af-filter-ticket')?.value || '')
    .trim()
    .toUpperCase();
  list.innerHTML =
    '<div style="color:var(--muted);font-size:13px;padding:8px 0">Wird geladen…</div>';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  try {
    const qs = params.toString();
    const { reports } = await apiCall(`/feedback${qs ? `?${qs}` : ''}`, 'GET');
    const filteredReports = ticketQuery
      ? reports.filter((r) => formatFeedbackTicketId(r.id).includes(ticketQuery))
      : reports;
    refreshAdminFeedbackBadge();
    if (!filteredReports.length) {
      list.innerHTML =
        '<div style="color:var(--muted);font-size:13px;padding:8px 0">Keine Einträge gefunden.</div>';
      return;
    }
    const catLabel = {
      bug: '🐛 Bug',
      feature: '💡 Feature',
      help: '❓ Hilfe',
      report_user: '⚠️ Nutzer',
      other: '💬 Sonstiges',
    };
    const statusLabel = {
      closed: 'Geschlossen',
      open_support: 'Offen - Wartet auf Support',
      open_user: 'Offen - Wartet auf User',
    };
    list.innerHTML = filteredReports
      .map((r) => {
        const resolutionReason = getResolutionReasonFromLatestMessage(r);
        return `
        <div class="af-item ${
          r.status === 'closed'
            ? 'af-status-closed'
            : r.status === 'open' && r.unreadAdmin
              ? 'af-status-open-new'
              : r.status === 'open'
                ? 'af-status-open'
                : 'af-status-read'
        }" data-id="${esc(r.id)}">
          <div class="af-item-hdr">
            <span class="af-cat-badge af-cat-${esc(r.category)}">${catLabel[r.category] || r.category}</span>
            ${r.anonymous ? '<span class="fb-anon-icon" title="Anonym eingereicht">🕵️</span>' : ''}
            <span class="af-status-badge af-status-badge-${esc(r.status)}">${
              r.status === 'closed'
                ? statusLabel.closed
                : r.waitingFor === 'user'
                  ? statusLabel.open_user
                  : statusLabel.open_support
            }</span>
            ${r.unreadAdmin ? '<span class="fb-unread-badge">Neu</span>' : ''}
            <span class="fb-ticket-id">${esc(formatFeedbackTicketId(r.id))}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:auto">${new Date(r.createdAt).toLocaleString('de-DE')}</span>
          </div>
          <div class="af-item-subject">${esc(r.subject)}</div>
          <div class="af-item-body">${esc(r.body)}</div>
          ${
            r.anonymous
              ? '<div style="font-size:12px;color:var(--muted)">Von: anonym</div>'
              : `<div style="font-size:12px;color:var(--muted)">Von: ${esc(getVisibleName(r.user, r.user?.displayNameField) || r.user?.name || r.user?.username || '–')}</div>`
          }
          ${
            r.reportedUser
              ? `<div style="font-size:12px;color:var(--accent)">Gemeldeter Nutzer: ${esc(getVisibleName(r.reportedUser, r.reportedUser?.displayNameField) || r.reportedUser.name || r.reportedUser.username)}</div>`
              : ''
          }
          ${
            r.category === 'report_user' && r.resolution
              ? `<div style="font-size:12px;color:var(--muted)">Entscheidung: ${r.resolution === 'action_taken' ? 'Maßnahme getroffen' : 'Keine Maßnahme'}${resolutionReason ? ` — Begründung: ${esc(resolutionReason)}` : ''}</div>`
              : ''
          }
          <div class="af-item-actions">
            ${
              r.status === 'open' && r.unreadAdmin
                ? `<button class="btn btn-sm btn-ghost af-action-read" onclick="markFeedbackAdminRead('${esc(r.id)}')">Als gelesen markieren</button>`
                : ''
            }
            ${
              r.category !== 'report_user' && r.status === 'open'
                ? `<button class="btn btn-sm btn-ghost af-action-close" onclick="closeFeedbackTicket('${esc(r.id)}','${esc(r.waitingFor || 'support')}')">Erledigt</button>`
                : ''
            }
            ${
              r.category !== 'report_user' && r.status === 'closed'
                ? `<button class="btn btn-sm btn-ghost af-action-reopen" onclick="setFeedbackStatus('${esc(r.id)}','open')">Wieder öffnen</button>`
                : ''
            }
            ${
              r.category !== 'report_user'
                ? `<button class="btn btn-sm btn-ghost af-action-reply" onclick="adminOpenConversation('${esc(r.id)}','${esc(r.subject)}')">${(r._count?.messages || 0) > 0 ? `💬 ${r._count.messages}` : '💬'} Antworten</button>`
                : ''
            }
            ${
              r.category === 'report_user' && r.status === 'closed'
                ? `<button class="btn btn-sm btn-ghost af-action-reopen" onclick="setFeedbackStatus('${esc(r.id)}','open')">Wieder öffnen</button>`
                : ''
            }
            ${
              r.category === 'report_user' && r.status !== 'closed'
                ? `<button class="btn btn-sm btn-ghost af-action-resolve-none" onclick="setFeedbackResolution('${esc(r.id)}','no_action')">Keine Maßnahme</button>
                   <button class="btn btn-sm btn-ghost af-action-resolve-act" onclick="setFeedbackResolution('${esc(r.id)}','action_taken')">Maßnahme getroffen</button>`
                : ''
            }
            <button class="btn btn-sm btn-danger" onclick="deleteFeedbackEntry('${esc(r.id)}')">Löschen</button>
          </div>
        </div>
      `;
      })
      .join('');
  } catch (e) {
    list.innerHTML = '<div class="msg msg-error">Netzwerkfehler.</div>';
  }
}

async function setFeedbackStatus(id, status) {
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}`, 'PATCH', { status });
    renderAdminFeedbackList();
  } catch (e) {}
}

async function markFeedbackAdminRead(id) {
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}`, 'PATCH', { markReadAdmin: true });
    renderAdminFeedbackList();
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Markieren.', 'error');
  }
}

async function closeFeedbackTicket(id, waitingFor) {
  let closeReason = '';
  if (waitingFor === 'support') {
    const result = await showTextConfirmDlg(
      'Ticket schließen',
      'Dieses Ticket wartet aktuell auf Support. Bitte gib einen Schließungsgrund an. Der Grund wird als letzte Nachricht an den Nutzer gesendet.',
      'Schließen',
      'Abbrechen',
      true,
      'Schließungsgrund eingeben…'
    );
    if (!result?.confirmed) return;
    closeReason = (result.text || '').trim();
    if (!closeReason) {
      toast('Bitte einen Schließungsgrund angeben.', 'error');
      return;
    }
  } else {
    const confirmed = await showConfirmDlg(
      'Ticket schließen?',
      'Das Ticket wird geschlossen und der Nutzer wird benachrichtigt.',
      'Schließen',
      'Abbrechen',
      false
    );
    if (!confirmed) return;
  }

  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}`, 'PATCH', {
      status: 'closed',
      closeReason,
    });
    renderAdminFeedbackList();
    toast('Ticket geschlossen.', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Schließen.', 'error');
  }
}

async function closeOwnFeedbackTicket(id) {
  const confirmed = await showConfirmDlg(
    'Ticket schließen?',
    'Du schließt dieses Ticket endgültig. Danach sind keine weiteren Antworten möglich.',
    'Schließen',
    'Abbrechen',
    false
  );
  if (!confirmed) return;

  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}/close-by-user`, 'PATCH');
    renderMyFeedbackList();
    toast('Ticket geschlossen.', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Schließen.', 'error');
  }
}

async function deleteFeedbackEntry(id) {
  const confirmed = await showConfirmDlg(
    'Ticket endgültig löschen?',
    'Dieses Ticket wird unwiderruflich gelöscht und ist danach auch für den meldenden Nutzer nicht mehr sichtbar. Dieser Vorgang kann nicht rückgängig gemacht werden.',
    'Endgültig löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}`, 'DELETE');
    renderAdminFeedbackList();
  } catch (e) {}
}

// ── ADMIN: KONVERSATION (Popup-Modal) ────────────────────────────────────

let _afConvReportId = null;

async function adminOpenConversation(reportId, subject) {
  _afConvReportId = reportId;
  const title = document.getElementById('af-conv-title');
  if (title) title.textContent = subject || 'Konversation';
  const input = document.getElementById('af-conv-reply-input');
  if (input) input.value = '';
  // Ensure reply area visible + wired to admin submit
  const replyWrap = document.getElementById('af-conv-reply-wrap');
  if (replyWrap) replyWrap.style.display = 'flex';
  const btn = document.getElementById('af-conv-reply-btn');
  if (btn) btn.setAttribute('onclick', 'adminSubmitReply()');
  document.getElementById('af-conv-modal')?.classList.remove('hidden');
  await _afConvLoad();
}

function closeAfConvModal() {
  document.getElementById('af-conv-modal')?.classList.add('hidden');
  _afConvReportId = null;
}

async function _afConvLoad() {
  if (!_afConvReportId) return;
  const thread = document.getElementById('af-conv-thread');
  if (!thread) return;
  thread.innerHTML = '<div style="color:var(--muted);font-size:13px">Wird geladen…</div>';
  try {
    const { messages, anonymous, reportOwnerId } = await apiCall(
      `/feedback/${encodeURIComponent(_afConvReportId)}/messages`,
      'GET'
    );
    if (!messages.length) {
      thread.innerHTML =
        '<div style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">Noch keine Nachrichten in dieser Konversation.</div>';
      return;
    }
    const viewerIsAdmin = me?.role === 'admin';
    thread.innerHTML = messages
      .map((m) => {
        const isAdmin = m.author?.role === 'admin';
        const isReportOwner = m.author?.id === reportOwnerId;
        let displayName;
        let anonHint = '';
        if (anonymous && isReportOwner && !isAdmin) {
          if (viewerIsAdmin) {
            displayName = 'Anonym';
          } else {
            displayName =
              getVisibleName(m.author, m.author?.displayNameField) || m.author?.username || '–';
            anonHint =
              ' <span class="fb-anon-hint" title="Du hast anonym gemeldet — Admins sehen deinen Namen nicht">🕵️ anonym</span>';
          }
        } else {
          displayName =
            getVisibleName(m.author, m.author?.displayNameField) || m.author?.username || '–';
        }
        const time = new Date(m.createdAt).toLocaleString('de-DE');
        return `<div class="fb-msg ${isAdmin ? 'fb-msg-admin' : 'fb-msg-user'}">
          <div class="fb-msg-meta"><strong>${esc(displayName)}</strong>${isAdmin ? ' <span class="fb-admin-badge">Admin</span>' : ''}${anonHint} · <span>${esc(time)}</span></div>
          <div class="fb-msg-body">${esc(m.body)}</div>
        </div>`;
      })
      .join('');
  } catch (e) {
    thread.innerHTML = '<div class="msg msg-error">Netzwerkfehler.</div>';
  }
}

async function adminSubmitReply() {
  if (!_afConvReportId) return;
  const input = document.getElementById('af-conv-reply-input');
  const btn = document.getElementById('af-conv-reply-btn');
  const body = input?.value?.trim();
  if (!body) return;
  if (btn) btn.disabled = true;
  try {
    await apiCall(`/feedback/${encodeURIComponent(_afConvReportId)}/messages`, 'POST', { body });
    if (input) input.value = '';
    await _afConvLoad();
    renderAdminFeedbackList();
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Senden.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── ADMIN: RESOLUTION (Nutzer-Meldungen) ─────────────────────────────────

async function setFeedbackResolution(id, resolution) {
  const label = resolution === 'action_taken' ? 'Maßnahme getroffen' : 'Keine Maßnahme';
  const result = await showTextConfirmDlg(
    'Entscheidung speichern?',
    `Die Entscheidung „${label}" wird für dieses Ticket gespeichert. Optional kannst du eine Begründung angeben, die dem Nutzer als Nachricht zugestellt wird.`,
    'Speichern',
    'Abbrechen',
    false,
    'Optionale Begründung für den Nutzer…'
  );
  if (!result?.confirmed) return;
  const resolutionReason = String(result.text || '').trim();
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}`, 'PATCH', {
      resolution,
      resolutionReason,
    });
    renderAdminFeedbackList();
    toast(`Entscheidung gespeichert: ${label}`, 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Speichern.', 'error');
  }
}

// ── USER: TAB-SWITCHER ────────────────────────────────────────────────────

function switchFeedbackTab(tab) {
  const panelNew = document.getElementById('fb-panel-new');
  const panelMine = document.getElementById('fb-panel-mine');
  const tabNew = document.getElementById('fb-tab-new');
  const tabMine = document.getElementById('fb-tab-mine');
  if (tab === 'mine') {
    panelNew?.classList.add('hidden');
    panelMine?.classList.remove('hidden');
    tabNew?.classList.remove('active');
    tabMine?.classList.add('active');
    renderMyFeedbackList();
  } else {
    panelNew?.classList.remove('hidden');
    panelMine?.classList.add('hidden');
    tabNew?.classList.add('active');
    tabMine?.classList.remove('active');
  }
}

// ── USER: MEINE MELDUNGEN ─────────────────────────────────────────────────

async function renderMyFeedbackList() {
  const list = document.getElementById('my-feedback-list');
  if (!list) return;
  list.innerHTML =
    '<div style="color:var(--muted);font-size:13px;padding:8px 0">Wird geladen…</div>';
  try {
    const { reports } = await apiCall('/feedback/mine', 'GET');
    if (!reports.length) {
      list.innerHTML =
        '<div style="color:var(--muted);font-size:13px;padding:8px 0;text-align:center">Du hast noch keine Meldungen eingereicht.</div>';
      return;
    }
    const catLabel = {
      bug: '🐛 Bug',
      feature: '💡 Feature',
      help: '❓ Hilfe',
      report_user: '⚠️ Nutzer',
      other: '💬 Sonstiges',
    };
    const statusLabel = {
      closed: 'Geschlossen',
      open_support: 'Offen - Wartet auf Support',
      open_user: 'Offen - Wartet auf dich',
    };
    const resolutionLabel = { no_action: 'Keine Maßnahme', action_taken: 'Maßnahme getroffen' };
    const canReply = (r) => r.category !== 'report_user' && r.status !== 'closed';
    list.innerHTML = reports
      .map((r) => {
        const msgCount = r._count?.messages || 0;
        const lastMsg = r.messages?.[0];
        const resolutionReason = getResolutionReasonFromLatestMessage(r);
        const itemStateClass =
          r.status === 'closed'
            ? 'af-status-closed'
            : r.status === 'open' && r.unreadUser
              ? 'af-status-open-new'
              : r.status === 'open'
                ? 'af-status-open'
                : 'af-status-read';
        return `<div class="my-fb-item ${itemStateClass}" data-id="${esc(r.id)}">
          <div class="af-item-hdr">
            <span class="af-cat-badge af-cat-${esc(r.category)}">${catLabel[r.category] || r.category}</span>
            ${r.anonymous ? '<span class="fb-anon-icon" title="Anonym eingereicht">🕵️</span>' : ''}
            <span class="af-status-badge af-status-badge-${esc(r.status)}">${
              r.status === 'closed'
                ? statusLabel.closed
                : r.waitingFor === 'user'
                  ? statusLabel.open_user
                  : statusLabel.open_support
            }</span>
            ${r.unreadUser ? '<span class="fb-unread-badge">Neu</span>' : ''}
            <span class="fb-ticket-id">${esc(formatFeedbackTicketId(r.id))}</span>
            ${r.resolution ? `<span class="fb-resolution-badge">${resolutionLabel[r.resolution] || r.resolution}</span>` : ''}
            <span style="font-size:11px;color:var(--muted);margin-left:auto">${new Date(r.createdAt).toLocaleDateString('de-DE')}</span>
          </div>
          <div class="af-item-subject">${esc(r.subject)}</div>
          ${
            r.reportedUser
              ? `<div style="font-size:12px;color:var(--accent)">Gemeldeter Nutzer: ${esc(getVisibleName(r.reportedUser, r.reportedUser?.displayNameField) || r.reportedUser.name || r.reportedUser.username || '–')}</div>`
              : ''
          }
          ${
            r.category === 'report_user' && r.resolution
              ? `<div style="font-size:12px;color:var(--muted)">Entscheidung: ${resolutionLabel[r.resolution] || r.resolution}${resolutionReason ? ` — Begründung: ${esc(resolutionReason)}` : ''}</div>`
              : ''
          }
          ${msgCount > 0 ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">💬 ${msgCount} Nachricht${msgCount !== 1 ? 'en' : ''}</div>` : ''}
          ${
            lastMsg
              ? (() => {
                  const isOwnAnonMsg =
                    r.anonymous &&
                    lastMsg.author?.id === r.userId &&
                    lastMsg.author?.role !== 'admin';
                  const authorLabel = isOwnAnonMsg
                    ? 'Du (anonym)'
                    : esc(getVisibleName(lastMsg.author, lastMsg.author?.displayNameField) || '–') +
                      (lastMsg.author?.role === 'admin' ? ' (Admin)' : '');
                  return `<div class="fb-last-msg"><span class="fb-msg-meta-name">${authorLabel}:</span> ${esc(lastMsg.body.slice(0, 80))}${lastMsg.body.length > 80 ? '…' : ''}</div>`;
                })()
              : ''
          }
          <div class="af-item-actions" style="margin-top:6px">
            ${msgCount > 0 || canReply(r) ? `<button class="btn btn-sm btn-ghost" onclick="openMyConversation('${esc(r.id)}','${esc(r.subject)}')">Konversation ansehen</button>` : ''}
            ${r.status === 'open' && r.category !== 'report_user' ? `<button class="btn btn-sm btn-ghost af-action-close" onclick="closeOwnFeedbackTicket('${esc(r.id)}')">Ticket schließen</button>` : ''}
          </div>
        </div>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = '<div class="msg msg-error">Netzwerkfehler.</div>';
  }
}

// ── USER: KONVERSATION ────────────────────────────────────────────────────

let _myConvReportId = null;
let _myConvCanReply = false;

async function openMyConversation(reportId, subject) {
  _myConvReportId = reportId;
  // Determine if reply is allowed by checking report status from my-feedback-list
  const item = document.querySelector(`[data-id="${CSS.escape(reportId)}"]`);
  _myConvCanReply = !item?.classList.contains('af-status-closed');

  // Reuse admin conv modal for user too
  const title = document.getElementById('af-conv-title');
  if (title) title.textContent = subject || 'Konversation';
  const input = document.getElementById('af-conv-reply-input');
  if (input) input.value = '';

  // Hide reply area if closed or report_user
  const replyWrap = document.getElementById('af-conv-reply-wrap');
  const catEl = item?.querySelector('.af-cat-badge');
  const isReportUser = catEl?.classList.contains('af-cat-report_user');
  if (replyWrap) replyWrap.style.display = isReportUser || !_myConvCanReply ? 'none' : 'flex';

  // Override reply button to use user submit
  const btn = document.getElementById('af-conv-reply-btn');
  if (btn) btn.setAttribute('onclick', 'submitMyMessage()');

  document.getElementById('af-conv-modal')?.classList.remove('hidden');

  // Set context so _afConvLoad loads correctly
  _afConvReportId = reportId;
  await _afConvLoad();
}

async function submitMyMessage() {
  if (!_afConvReportId) return;
  const input = document.getElementById('af-conv-reply-input');
  const btn = document.getElementById('af-conv-reply-btn');
  const body = input?.value?.trim();
  if (!body) return;
  if (btn) btn.disabled = true;
  try {
    await apiCall(`/feedback/${encodeURIComponent(_afConvReportId)}/messages`, 'POST', { body });
    if (input) input.value = '';
    await _afConvLoad();
    renderMyFeedbackList();
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Senden.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function switchGroup(groupId) {
  document.getElementById('group-dd')?.remove();
  if (groupId === curGroupId) return;
  curGroupId = groupId;
  try {
    localStorage.setItem('activeGroup', groupId);
  } catch (e) {}
  invalidateCounts();
  renderGroupSwitcher();
  // Reload everything for new group
  await loadGroupMembers();
  curAlbum = null;
  curFilter = null;
  curFilterUserId = null;
  await loadAlbums();
  renderSidebar();
  renderGroupSwitcher();
  await loadPhotos(true);
  toast(`Gewechselt zu „${myGroups.find((g) => g.id === groupId)?.name}"`, 'success');
}

// ── CONFIRM DIALOG (Promise-basiert) ────────────────────
function showConfirmDlg(
  title,
  text,
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  danger = true
) {
  return new Promise((resolve) => {
    document.getElementById('confirm-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'confirm-dlg';
    dlg.className = 'dlg-bg';
    dlg.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:600;animation:fadeIn .15s ease';
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
    dlg.querySelector('#cdlg-confirm').onclick = () => {
      dlg.remove();
      resolve(true);
    };
    dlg.querySelector('#cdlg-cancel').onclick = () => {
      dlg.remove();
      resolve(false);
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) {
        dlg.remove();
        resolve(false);
      }
    };
  });
}

function showTextConfirmDlg(
  title,
  text,
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  danger = false,
  placeholder = ''
) {
  return new Promise((resolve) => {
    document.getElementById('confirm-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'confirm-dlg';
    dlg.className = 'dlg-bg';
    dlg.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:600;animation:fadeIn .15s ease';
    dlg.innerHTML = `
      <div class="dlg" style="animation:scaleIn .2s ease;max-width:520px;width:calc(100% - 28px)">
        <div class="dlg-ico">📝</div>
        <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">${esc(title)}</h3>
        <p style="font-size:13px;color:var(--muted);font-weight:300;margin:0 0 12px;line-height:1.5">${esc(text)}</p>
        <textarea id="cdlg-input" rows="4" maxlength="2000" placeholder="${esc(placeholder)}"
          style="width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;padding:10px 12px;resize:vertical;min-height:96px;margin:0 0 16px"></textarea>
        <div class="dlg-btns">
          <button id="cdlg-cancel" class="btn btn-ghost">${esc(cancelLabel)}</button>
          <button id="cdlg-confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('#cdlg-input');
    input?.focus();
    dlg.querySelector('#cdlg-confirm').onclick = () => {
      const value = String(input?.value || '').trim();
      dlg.remove();
      resolve({ confirmed: true, text: value });
    };
    dlg.querySelector('#cdlg-cancel').onclick = () => {
      dlg.remove();
      resolve({ confirmed: false, text: '' });
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) {
        dlg.remove();
        resolve({ confirmed: false, text: '' });
      }
    };
  });
}

// ── ADMIN GROUPS ─────────────────────────────────────────
async function openAdminGroups() {
  closeSidebar();
  show('admin-groups-modal');
  await renderAdminGroups();
}
function closeAdminGroups() {
  hide('admin-groups-modal');
}

// ── ADMIN USERS ──────────────────────────────────────────
const _adminUserExpanded = new Set(); // expanded user IDs
const _adminUserLoaded = {}; // cached detail data per ID

const AUTH_SOURCE_UI = {
  plex: { label: 'Plex', icon: '/media/icons/auth/plex.svg' },
  authentik: { label: 'Authentik', icon: '/media/icons/auth/authentik.svg' },
  github: { label: 'Github', icon: '/media/icons/auth/github.svg' },
  google: { label: 'Google', icon: '/media/icons/auth/google.svg' },
};

function normalizeAuthSource(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function getAuthSourceLabel(value) {
  const key = normalizeAuthSource(value);
  if (!key) return '-';
  return AUTH_SOURCE_UI[key]?.label || String(value);
}

function getAuthSourceListIcon(value) {
  const key = normalizeAuthSource(value);
  if (!key || !AUTH_SOURCE_UI[key]) return '';
  const meta = AUTH_SOURCE_UI[key];
  return `<img src="${esc(meta.icon)}" alt="${esc(meta.label)}" title="Login via ${esc(meta.label)}" style="width:18px;height:18px;object-fit:contain;opacity:.95" loading="lazy">`;
}

async function openAdminUsers() {
  closeSidebar();
  _adminUserExpanded.clear();
  Object.keys(_adminUserLoaded).forEach((k) => delete _adminUserLoaded[k]);
  show('admin-users-modal');
  await _renderAdminUserList();
}

async function _renderAdminUserList() {
  const list = $('admin-users-list');
  list.innerHTML =
    '<div style="display:flex;justify-content:center;padding:30px"><div class="spinner"></div></div>';
  try {
    const { users } = await apiCall('/admin/users', 'GET');
    if (!users?.length) {
      list.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:20px">Keine Benutzer gefunden.</p>';
      return;
    }
    list.innerHTML = users.map((u) => _adminUserRowHtml(u)).join('');
  } catch (e) {
    list.innerHTML =
      '<p style="color:var(--muted);text-align:center;padding:20px">Fehler beim Laden.</p>';
  }
}

function _adminUserRowHtml(u) {
  const isMe = u.id === me?.id;
  const lastLoginText = fmtRelativeTime(u.lastLoginAt);
  const lastLoginTitle = u.lastLoginAt
    ? `Letzter Login: ${fmtDateLong(u.lastLoginAt)}`
    : 'Noch kein Login';
  const authSourceIcon = getAuthSourceListIcon(u.auth_source);
  const migratedInfo =
    u.migratedFrom || u.migratedAt
      ? `Migriert von ${esc(u.migratedFrom || 'supabase')} am ${esc(fmtDate(u.migratedAt || u.createdAt))}`
      : '';
  return `
    <div class="au-row" id="aur-${u.id}">
      <div class="au-summary" onclick="adminToggleUser('${u.id}')">
        <div class="au-avatar" style="background:${esc(u.color || '#888')}">
          ${u.avatar ? `<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : esc((u.name || u.username || '?')[0].toUpperCase())}
        </div>
        <div class="au-info">
          <span class="au-name">${esc(u.name || u.username)}</span>
          <span class="au-email">${esc(u.email)}</span>
          ${migratedInfo ? `<span class="au-migration-note">${migratedInfo}</span>` : ''}
        </div>
        ${authSourceIcon ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:0 0 auto">${authSourceIcon}</span>` : ''}
        <span class="au-role-badge ${u.role === 'admin' ? 'au-role-admin' : 'au-role-user'}">${u.role === 'admin' ? 'Admin' : 'Nutzer'}</span>
        <span class="au-since" title="${esc(lastLoginTitle)}">${esc(lastLoginText)}</span>
        <span class="au-chevron" id="au-chev-${u.id}">›</span>
      </div>
      <div class="au-detail hidden" id="au-detail-${u.id}">
        <div class="au-detail-loading"><div class="spinner" style="width:22px;height:22px;border-width:2px"></div></div>
      </div>
    </div>`;
}

async function adminToggleUser(userId) {
  const detail = $(`au-detail-${userId}`);
  const chev = $(`au-chev-${userId}`);
  if (_adminUserExpanded.has(userId)) {
    _adminUserExpanded.delete(userId);
    detail.classList.add('hidden');
    chev.classList.remove('au-chev-open');
    return;
  }
  _adminUserExpanded.add(userId);
  detail.classList.remove('hidden');
  chev.classList.add('au-chev-open');
  if (_adminUserLoaded[userId]) {
    _renderAdminUserDetail(userId, _adminUserLoaded[userId]);
    return;
  }
  try {
    const data = await apiCall(`/admin/users/${userId}`, 'GET');
    _adminUserLoaded[userId] = data;
    _renderAdminUserDetail(userId, data);
  } catch (e) {
    $(`au-detail-${userId}`).innerHTML = `<p class="au-err">Fehler beim Laden.</p>`;
  }
}

function _renderAdminUserDetail(userId, u) {
  const isMe = userId === me?.id;
  const roleLabelMap = { owner: 'Owner', deputy: 'Deputy', member: 'Mitglied' };
  const roleClassMap = {
    owner: 'au-grole-owner',
    deputy: 'au-grole-deputy',
    member: 'au-grole-member',
  };
  const hasName = !!(u.name && u.name.trim());
  const effectiveDisplayField = hasName ? u.displayNameField || 'name' : 'username';
  const displayNameLabel = effectiveDisplayField === 'name' ? 'Vollständiger Name' : 'Benutzername';

  const groupsHtml = u.groups?.length
    ? u.groups
        .map(
          (g) => `
        <div class="au-group-item">
          <span class="au-group-name">${esc(g.name)}</span>
          <span class="au-grole-badge ${roleClassMap[g.role] || ''}">${roleLabelMap[g.role] || g.role}</span>
          <button
            class="au-mini-btn ${g.role === 'owner' ? 'au-mini-btn-disabled' : ''}"
            ${g.role === 'owner' ? 'disabled title="Owner kann nicht direkt entfernt werden"' : `onclick="event.stopPropagation();adminRemoveUserFromGroup('${userId}','${g.id}','${esc(g.name)}',false)"`}
          >Entfernen</button>
        </div>`
        )
        .join('')
    : '<span style="font-size:13px;color:var(--muted)">Keine Gruppen</span>';

  const addableGroupsOptions = (u.assignableGroups || [])
    .map((g) => `<option value="${g.id}">${esc(g.name)}</option>`)
    .join('');

  const migrationInfo =
    u.migratedFrom || u.migratedAt
      ? `Migriert von ${esc(u.migratedFrom || 'supabase')} am ${esc(fmtDate(u.migratedAt || u.createdAt))}`
      : '-';
  const authSourceLabel = getAuthSourceLabel(u.auth_source);

  $(`au-detail-${userId}`).innerHTML = `
    <div class="au-stats-grid">
      <div class="au-stat"><span class="au-stat-val">${u.stats.photos}</span><span class="au-stat-lbl">Fotos</span></div>
      <div class="au-stat"><span class="au-stat-val">${u.stats.comments}</span><span class="au-stat-lbl">Kommentare</span></div>
      <div class="au-stat"><span class="au-stat-val">${u.stats.likesReceived}</span><span class="au-stat-lbl">Likes erhalten</span></div>
      <div class="au-stat"><span class="au-stat-val">${u.stats.likesGiven}</span><span class="au-stat-lbl">Likes gegeben</span></div>
      <div class="au-stat"><span class="au-stat-val">${u.stats.albums}</span><span class="au-stat-lbl">Alben</span></div>
      <div class="au-stat"><span class="au-stat-val">${new Date(u.createdAt).toLocaleDateString('de-DE')}</span><span class="au-stat-lbl">Mitglied seit</span></div>
    </div>
    <div class="au-card">
      <div class="au-card-title">Einstellungen</div>
      <div class="au-info-row"><span class="au-info-key">Anzeigename</span><span class="au-info-val">${esc(displayNameLabel)}</span></div>
      <div class="au-info-row"><span class="au-info-key">Benutzername</span><span class="au-info-val au-mono">${esc(u.username || '-')}</span></div>
      <div class="au-info-row"><span class="au-info-key">Vollst. Name</span><span class="au-info-val">${esc(u.name || '-')}</span></div>
      <div class="au-info-row"><span class="au-info-key">E-Mail</span><span class="au-info-val au-mono">${esc(u.email)}</span></div>
      <div class="au-info-row"><span class="au-info-key">Login-Quelle</span><span class="au-info-val au-mono">${esc(authSourceLabel)}</span></div>
      <div class="au-info-row"><span class="au-info-key">Last Login</span><span class="au-info-val">${esc(u.lastLoginAt ? fmtDateLong(u.lastLoginAt) : 'Noch nie')}</span></div>
      <div class="au-info-row"><span class="au-info-key">Migration</span><span class="au-info-val">${migrationInfo}</span></div>
    </div>
    <div class="au-card">
      <div class="au-card-title">Gruppen <span class="au-card-count">${u.groups?.length || 0}</span></div>
      <div class="au-groups-list">${groupsHtml}</div>
      <div class="au-group-manage-row">
        <select id="au-add-group-sel-${userId}" class="au-role-select" ${addableGroupsOptions ? '' : 'disabled'}>
          <option value="">${addableGroupsOptions ? 'Gruppe wählen…' : 'Keine weitere Gruppe verfügbar'}</option>
          ${addableGroupsOptions}
        </select>
        <button class="au-btn" ${addableGroupsOptions ? `onclick="adminAddUserToGroup('${userId}')"` : 'disabled'}>Hinzufügen</button>
      </div>
    </div>
    <div class="au-card">
      <div class="au-card-title">Aktionen</div>
      <div class="au-action-block">
        <span class="au-info-key" style="min-width:52px">Rolle</span>
        <select id="au-role-sel-${userId}" onchange="adminSetRole('${userId}', this.value, this)" class="au-role-select"
          ${isMe ? 'title="Eigene Rolle kann nur geändert werden solange weitere Admins existieren"' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>Benutzer</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="au-btns-row">
        <button class="au-btn" onclick="adminToggleNotifyForm('${userId}')">📣 Benachrichtigung senden</button>
        ${!isMe ? `<button class="au-btn au-btn-danger" onclick="adminDeleteUser('${userId}', '${esc(u.name || u.username)}')">🗑 Benutzer löschen</button>` : ''}
      </div>
      <div class="au-notify-form hidden" id="au-notify-${userId}">
        <input id="au-ntitle-${userId}" type="text" placeholder="Titel *" maxlength="120"
          class="au-notify-input" />
        <textarea id="au-nbody-${userId}" placeholder="Nachricht (optional)" maxlength="500" rows="2"
          class="au-notify-input au-notify-textarea"></textarea>
        <input id="au-nurl-${userId}" type="url" placeholder="Link (optional)" maxlength="500"
          class="au-notify-input" />
        <div style="display:flex;justify-content:flex-end">
          <button class="au-btn" onclick="adminSendUserNotification('${userId}')">Absenden</button>
        </div>
      </div>
    </div>`;
}

function adminToggleNotifyForm(userId) {
  const form = $(`au-notify-${userId}`);
  form.classList.toggle('hidden');
}

async function adminSendUserNotification(userId) {
  const title = $(`au-ntitle-${userId}`)?.value?.trim();
  const body = $(`au-nbody-${userId}`)?.value?.trim();
  const entityUrl = $(`au-nurl-${userId}`)?.value?.trim();
  if (!title) {
    toast('Titel ist erforderlich', 'error');
    return;
  }
  try {
    await apiCall(`/admin/users/${userId}/notify`, 'POST', {
      title,
      body: body || undefined,
      entityUrl: entityUrl || undefined,
    });
    toast('Benachrichtigung gesendet', 'success');
    $(`au-notify-${userId}`).classList.add('hidden');
    $(`au-ntitle-${userId}`).value = '';
    $(`au-nbody-${userId}`).value = '';
    $(`au-nurl-${userId}`).value = '';
  } catch (e) {
    toast(e.message || 'Fehler beim Senden', 'error');
  }
}

async function adminDeleteUser(userId, userName) {
  if (
    !confirm(
      `Benutzer „${userName}" und alle zugehörigen Daten (Fotos, Kommentare, Likes) unwiderruflich löschen?`
    )
  )
    return;
  try {
    await apiCall(`/admin/users/${userId}`, 'DELETE');
    toast(`Benutzer „${userName}" gelöscht`, 'success');
    delete _adminUserLoaded[userId];
    _adminUserExpanded.delete(userId);
    const row = $(`aur-${userId}`);
    if (row) row.remove();
  } catch (e) {
    toast(e.message || 'Fehler beim Löschen', 'error');
  }
}

async function adminSetRole(userId, newRole, selectEl) {
  const prev = newRole === 'admin' ? 'user' : 'admin';
  try {
    await apiCall(`/admin/users/${userId}/role`, 'PATCH', { role: newRole });
    toast(`Rolle auf „${newRole === 'admin' ? 'Admin' : 'Benutzer'}" gesetzt`, 'success');
    // Update cached data + role badge
    if (_adminUserLoaded[userId]) _adminUserLoaded[userId].role = newRole;
    const row = $(`aur-${userId}`);
    if (row) {
      const badge = row.querySelector('.au-role-badge');
      if (badge) {
        badge.textContent = newRole === 'admin' ? 'Admin' : 'Nutzer';
        badge.className = `au-role-badge ${newRole === 'admin' ? 'au-role-admin' : 'au-role-user'}`;
      }
    }
  } catch (e) {
    toast(e.message || 'Fehler beim Ändern der Rolle', 'error');
    if (selectEl) selectEl.value = prev;
  }
}

async function adminReloadUserDetail(userId) {
  const data = await apiCall(`/admin/users/${userId}`, 'GET');
  _adminUserLoaded[userId] = data;
  _renderAdminUserDetail(userId, data);
}

async function adminAddUserToGroup(userId) {
  const sel = $(`au-add-group-sel-${userId}`);
  const groupId = sel?.value;
  if (!groupId) {
    toast('Bitte zuerst eine Gruppe auswählen', 'error');
    return;
  }
  try {
    await apiCall(`/admin/users/${userId}/groups`, 'POST', { groupId });
    await adminReloadUserDetail(userId);
    toast('Benutzer zur Gruppe hinzugefügt', 'success');
  } catch (e) {
    toast(e.message || 'Fehler beim Hinzufügen zur Gruppe', 'error');
  }
}

async function adminRemoveUserFromGroup(userId, groupId, groupName) {
  const ok = await showConfirmDlg(
    'Benutzer aus Gruppe entfernen',
    `Soll der Benutzer wirklich aus „${groupName}" entfernt werden?`,
    'Entfernen',
    'Abbrechen',
    true
  );
  if (!ok) return;

  try {
    await apiCall(`/admin/users/${userId}/groups/${groupId}`, 'DELETE');
    await adminReloadUserDetail(userId);
    toast('Benutzer aus Gruppe entfernt', 'success');
  } catch (e) {
    toast(e.message || 'Fehler beim Entfernen aus der Gruppe', 'error');
  }
}

function closeAdminUsers() {
  hide('admin-users-modal');
}

// ── ADMIN BACKUPS ─────────────────────────────────────────

async function openAdminBackups() {
  closeSidebar();
  show('admin-backups-modal');
  await renderAdminBackups();
}

function closeAdminBackups() {
  hide('admin-backups-modal');
}

async function renderAdminBackups() {
  const list = $('admin-backups-list');
  list.innerHTML =
    '<div style="display:flex;justify-content:center;padding:30px"><div class="spinner"></div></div>';
  try {
    const { backups } = await apiCall('/groups/admin/backups', 'GET');
    if (!backups?.length) {
      list.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:24px">Keine Backups vorhanden.</p>';
      return;
    }
    list.innerHTML = backups
      .map((b) => {
        const created = new Date(b.createdAt).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        const createdTime = new Date(b.createdAt).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const expiry = new Date(b.linkExpiry);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        const expired = b.expired || daysLeft <= 0;
        const expiryStr = expired
          ? '⛔ Abgelaufen'
          : `⏳ noch ${daysLeft} Tag${daysLeft !== 1 ? 'e' : ''}`;
        const expiryColor = expired
          ? 'var(--danger,#e05555)'
          : daysLeft <= 7
            ? '#f5a623'
            : 'var(--muted)';
        const sizeMB = b.sizeBytes ? (b.sizeBytes / 1024 / 1024).toFixed(1) + ' MB' : null;
        return `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📁 ${esc(b.groupName)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">
              <span style="font-size:12px;color:var(--muted)">🗓 ${created}, ${createdTime} Uhr</span>
              ${b.deletedByName ? `<span style="font-size:12px;color:var(--muted)">👤 ${esc(b.deletedByName)}</span>` : ''}
              <span style="font-size:12px;color:var(--muted)">🖼 ${b.photoCount} Foto${b.photoCount !== 1 ? 's' : ''}</span>
              ${sizeMB ? `<span style="font-size:12px;color:var(--muted)">💾 ${sizeMB}</span>` : ''}
            </div>
            <div style="font-size:12px;color:${expiryColor};margin-top:4px;font-weight:600">${expiryStr}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:flex-start">
            ${!expired ? `<a href="${esc(backupSrc(b.downloadUrl))}" target="_blank" rel="noopener" style="background:var(--accent);color:#fff;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center">📥 Download</a>` : ''}
            <button onclick="adminRefreshBackupLink('${esc(b.zipKey)}')" style="background:var(--accent-l);border:none;color:var(--accent);padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">🔗 Link erneuern</button>
            <button onclick="adminDeleteBackupEntry('${esc(b.zipKey)}','${esc(b.groupName)}')" style="background:none;border:1.5px solid var(--danger,#e05555);color:var(--danger,#e05555);padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">🗑</button>
          </div>
        </div>
      </div>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = `<p style="color:var(--danger,#e05555);text-align:center;padding:24px">${esc(e.message)}</p>`;
  }
}

async function adminRefreshBackupLink(zipKey) {
  try {
    const { linkExpiry } = await apiCall(
      `/groups/admin/backups/${encodeURIComponent(zipKey)}/refresh`,
      'POST'
    );
    const d = new Date(linkExpiry).toLocaleDateString('de-DE');
    toast(`Link verlängert bis ${d}`, 'success');
    await renderAdminBackups();
  } catch (e) {
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function adminDeleteBackupEntry(zipKey, groupName) {
  const confirmed = await showConfirmDlg(
    'Backup endgültig löschen',
    `Das Backup für „${groupName}" wird unwiderruflich aus MinIO gelöscht.`,
    'Löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;
  try {
    await apiCall(`/groups/admin/backups/${encodeURIComponent(zipKey)}`, 'DELETE');
    toast('Backup gelöscht', 'success');
    await renderAdminBackups();
  } catch (e) {
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function renderAdminGroups() {
  const list = $('ag-list');
  list.innerHTML =
    '<div style="color:var(--muted);font-size:13px;padding:8px 0">Wird geladen…</div>';
  try {
    const { groups } = await apiCall('/groups/admin/all', 'GET');
    if (!groups.length) {
      list.innerHTML =
        '<div style="color:var(--muted);font-size:13px;padding:8px 0">Keine Gruppen vorhanden.</div>';
      return;
    }

    // Owner-User + Deputies für alle Gruppen laden
    const ownerIds = [...new Set(groups.map((g) => g.createdBy).filter(Boolean))];
    const allMembersMap = {};
    const allDeputiesMap = {};
    await Promise.all(
      groups.map(async (g) => {
        try {
          const { members } = await apiCall(`/groups/${g.id}/members`, 'GET');
          allMembersMap[g.id] = members || [];
          const { deputies } = await apiCall(`/groups/${g.id}/deputies`, 'GET');
          allDeputiesMap[g.id] = deputies || [];
        } catch (e) {
          allMembersMap[g.id] = [];
          allDeputiesMap[g.id] = [];
        }
      })
    );

    list.innerHTML = groups
      .map((g) => {
        const members = allMembersMap[g.id] || [];
        const deputies = allDeputiesMap[g.id] || [];
        const owner = g.createdBy ? members.find((m) => m.id === g.createdBy) : null;
        const ownerChip = owner
          ? `<span style="font-size:11px;background:var(--accent);color:#fff;border-radius:10px;padding:2px 8px;font-weight:600" title="Gruppen-Owner">${esc(owner.name || owner.username)}</span>`
          : `<span style="font-size:11px;background:var(--border);color:var(--muted);border-radius:10px;padding:2px 8px">kein Owner</span>`;
        const deputyChips = deputies
          .map(
            (d) =>
              `<span style="font-size:11px;background:var(--accent-l);color:var(--accent);border-radius:10px;padding:2px 8px" title="Vertreter">${esc(d.name || d.username)}</span>`
          )
          .join(' ');
        const hasLimit = g.maxMembers !== null && g.maxMembers !== undefined;
        return `
      <div id="ag-row-${g.id}" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div id="ag-view-${g.id}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Code: <span style="font-family:monospace;font-weight:700;letter-spacing:1px;color:var(--accent)">${esc(g.code)}</span> · <span style="${g._count.members === 0 ? 'color:var(--danger,#e05555);font-weight:700' : ''}">${g._count.members} Mitglieder</span>${hasLimit ? ` · <span style="font-weight:600">${g._count.members}/${g.maxMembers}</span>` : ''}${g.memberLimitLocked ? ' · 🔒 Limit gesperrt' : ''} · ${g._count.photos} Fotos</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center">
              <span style="font-size:11px;color:var(--muted2);margin-right:2px">Owner:</span>${ownerChip}
              ${deputies.length ? `<span style="font-size:11px;color:var(--muted2);margin-left:6px;margin-right:2px">Vertreter:</span>${deputyChips}` : ''}
            </div>
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
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);padding:0 2px;cursor:pointer">
            <input id="ag-edit-limit-enabled-${g.id}" type="checkbox" ${hasLimit ? 'checked' : ''} onchange="adminToggleEditGroupLimit('${g.id}')" style="accent-color:var(--accent)">
            Limit aktiv
          </label>
          <input id="ag-edit-limit-${g.id}" type="number" min="${Math.max(g._count.members, 1)}" max="50" data-current="${g._count.members}" value="${hasLimit ? g.maxMembers : ''}" ${hasLimit ? '' : 'disabled'}
            style="width:120px;padding:8px 10px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);font-size:13px;color:var(--text);font-family:inherit"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);padding:0 2px;cursor:pointer">
            <input id="ag-edit-lock-${g.id}" type="checkbox" ${g.memberLimitLocked ? 'checked' : ''} style="accent-color:var(--accent)">
            Limit sperren
          </label>
          <button onclick="adminSaveGroup('${g.id}')" style="background:var(--accent);border:none;color:#fff;padding:8px 14px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600">Speichern</button>
          <button onclick="adminCancelEdit('${g.id}')" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:8px 10px;border-radius:9px;cursor:pointer;font-size:13px">✕</button>
        </div>
        <div id="ag-err-${g.id}" class="msg hidden" style="margin-top:8px"></div>
      </div>`;
      })
      .join('');
  } catch (e) {
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

function adminToggleCreateGroupLimit() {
  const enabled = !!$('ag-new-limit-enabled')?.checked;
  const input = $('ag-new-limit');
  if (!input) return;
  input.disabled = !enabled;
  if (enabled && !input.value) input.value = '1';
  if (!enabled) input.value = '';
}

function adminToggleEditGroupLimit(id) {
  const enabled = !!document.getElementById(`ag-edit-limit-enabled-${id}`)?.checked;
  const input = document.getElementById(`ag-edit-limit-${id}`);
  if (!input) return;
  input.disabled = !enabled;
  if (enabled) {
    const minValue = Number(input.dataset.current || 1);
    if (!input.value || Number(input.value) < minValue) input.value = String(minValue);
  } else {
    input.value = '';
  }
}

async function adminSaveGroup(id) {
  const name = document.getElementById(`ag-edit-name-${id}`)?.value?.trim();
  const code = document.getElementById(`ag-edit-code-${id}`)?.value?.trim();
  const limitEnabled = !!document.getElementById(`ag-edit-limit-enabled-${id}`)?.checked;
  const limitInput = document.getElementById(`ag-edit-limit-${id}`);
  const memberLimitLocked = !!document.getElementById(`ag-edit-lock-${id}`)?.checked;
  const errEl = document.getElementById(`ag-err-${id}`);
  if (!name || !code) {
    errEl.textContent = '⚠ Name und Code erforderlich';
    errEl.classList.remove('hidden');
    return;
  }

  let maxMembers = null;
  if (limitEnabled) {
    const minMembers = Number(limitInput?.dataset.current || 1);
    maxMembers = Number(limitInput?.value);
    if (!Number.isInteger(maxMembers) || maxMembers < minMembers || maxMembers > 50) {
      errEl.textContent = `⚠ Limit muss zwischen ${minMembers} und 50 liegen`;
      errEl.classList.remove('hidden');
      return;
    }
  }

  try {
    errEl.classList.add('hidden');
    await apiCall(`/groups/admin/${id}`, 'PATCH', { name, code, maxMembers, memberLimitLocked });
    await renderAdminGroups();
  } catch (e) {
    errEl.textContent = '❌ ' + (e.serverMessage || e.message);
    errEl.classList.remove('hidden');
  }
}
async function adminCreateGroup() {
  const name = $('ag-new-name')?.value?.trim();
  const code = $('ag-new-code')?.value?.trim();
  const limitEnabled = !!$('ag-new-limit-enabled')?.checked;
  const memberLimitLocked = !!$('ag-new-limit-locked')?.checked;
  const limitInput = $('ag-new-limit');
  const msgEl = $('ag-create-msg');
  if (!name || !code) {
    msgEl.textContent = '⚠ Name und Code eingeben';
    msgEl.className = 'msg msg-error';
    msgEl.classList.remove('hidden');
    return;
  }

  let maxMembers = null;
  if (limitEnabled) {
    maxMembers = Number(limitInput?.value);
    if (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 50) {
      msgEl.textContent = '⚠ Limit muss zwischen 1 und 50 liegen';
      msgEl.className = 'msg msg-error';
      msgEl.classList.remove('hidden');
      return;
    }
  }

  try {
    await apiCall('/groups/admin/create', 'POST', { name, code, maxMembers, memberLimitLocked });
    $('ag-new-name').value = '';
    $('ag-new-code').value = '';
    $('ag-new-limit-enabled').checked = false;
    $('ag-new-limit-locked').checked = false;
    if (limitInput) {
      limitInput.value = '';
      limitInput.disabled = true;
    }
    msgEl.classList.add('hidden');
    await renderAdminGroups();
    toast('Gruppe angelegt', 'success');
  } catch (e) {
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
  $('agdm-info').textContent =
    'Alle Fotos, Alben und Mitglieder dieser Gruppe werden unwiderruflich gelöscht.';

  // Buttons auf Admin-Modus zurücksetzen
  $('agdm-backup-btn').onclick = () => adminGroupDoBackup();
  $('agdm-delete-btn').onclick = () => adminGroupDoDelete();
  $('agdm-backup-btn').innerHTML =
    `📥 Backup erstellen &amp; herunterladen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Alle Fotos als ZIP sichern — Gruppe wird danach gelöscht</div>`;
  $('agdm-delete-btn').innerHTML =
    `🗑 Gruppe löschen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Kein Backup gewünscht — Gruppe wird sofort gelöscht</div>`;

  show('agdm-actions');
  hide('agdm-loading');
  hide('agdm-result');
  $('agdm-confirm-delete-btn')?.classList.add('hidden');
  $('agdm-backup-btn').disabled = false;
  $('agdm-delete-btn').disabled = false;

  show('admin-group-delete-modal');

  // Stranded-Members laden: User die nach dem Löschen in keiner Gruppe mehr sind
  try {
    hide('agdm-stranded-warning');
    $('agdm-stranded-confirm').checked = false;
    const { stranded } = await apiCall(`/groups/admin/${id}/stranded-members`, 'GET');
    if (stranded && stranded.length > 0) {
      $('agdm-stranded-names').textContent = stranded.map((u) => u.name).join(', ');
      show('agdm-stranded-warning');
      $('agdm-backup-btn').disabled = true;
      $('agdm-delete-btn').disabled = true;
    }
  } catch (e) {
    // Fehler ignorieren — Flow nicht blockieren
  }
}

function agdmStrandedCheckChange() {
  const checked = $('agdm-stranded-confirm').checked;
  $('agdm-backup-btn').disabled = !checked;
  $('agdm-delete-btn').disabled = !checked;
}

function closeAdminGroupDeleteModal() {
  hide('admin-group-delete-modal');
}

function agdmCopyLink() {
  const href = $('agdm-dl-link')?.href;
  if (!href || href === '#') return;
  // Absoluten Link zusammensetzen
  const url = href.startsWith('http') ? href : window.location.origin + href;
  navigator.clipboard.writeText(url).then(() => toast('Link kopiert', 'success'));
}

// Wird nach Erfolg vom Schließen-Button ausgelöst
let _agdm_pendingCleanup = null;
function agdmCloseAndCleanup() {
  closeAdminGroupDeleteModal();
  if (_agdm_pendingCleanup) {
    _agdm_pendingCleanup();
    _agdm_pendingCleanup = null;
  }
}

let _agdm_id = null;
let _agdm_name = null;
let _agdm_backupDone = false;

async function adminGroupDoBackup() {
  $('agdm-backup-btn').disabled = true;
  $('agdm-delete-btn').disabled = true;
  hide('agdm-actions');
  $('agdm-loading-text').textContent = 'ZIP wird erstellt, heruntergeladen & Gruppe gelöscht…';
  show('agdm-loading');
  try {
    const res = await apiCall(`/groups/admin/${_agdm_id}`, 'DELETE');
    hide('agdm-loading');
    const innerDiv = $('agdm-dl-link')?.closest('div');
    $('agdm-confirm-delete-btn')?.classList.add('hidden');
    if (res.backupUrl) {
      const expiry = res.linkExpiry
        ? new Date(res.linkExpiry)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiryStr = expiry.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      $('agdm-result-text').innerHTML =
        `✅ Backup heruntergeladen — Gruppe gelöscht<br><span style="font-size:11px;opacity:0.7">Der Link ist gültig bis ${expiryStr} — danach werden alle Daten restlos von unserem Server gelöscht.</span>`;
      $('agdm-dl-link').href = backupSrc(res.backupUrl);
      $('agdm-dl-link').style.display = '';
      // Sofort-Download
      const a = document.createElement('a');
      a.href = backupSrc(res.backupUrl);
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      innerDiv.innerHTML =
        '<p style="color:var(--text2);font-size:13px;margin:0">ℹ️ Keine Fotos in dieser Gruppe — kein Backup nötig.</p>';
    }
    show('agdm-result');
    await _agdm_afterDelete(_agdm_id, _agdm_name);
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
    const innerDiv = $('agdm-dl-link')?.closest('div');
    $('agdm-confirm-delete-btn')?.classList.add('hidden');
    if (res.backupUrl) {
      const expiry = res.linkExpiry
        ? new Date(res.linkExpiry)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiryStr = expiry.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      $('agdm-result-text').innerHTML =
        `✅ Gruppe gelöscht — über den Link kannst du alle Bilder noch bis ${expiryStr} herunterladen<br><span style="font-size:11px;opacity:0.7">Nach dem ${expiryStr} werden alle Daten restlos von unserem Server gelöscht.</span>`;
      $('agdm-dl-link').href = backupSrc(res.backupUrl);
      $('agdm-dl-link').style.display = '';
    } else {
      innerDiv.innerHTML =
        '<p style="color:var(--text2);font-size:13px;margin:0">ℹ️ Keine Fotos vorhanden — kein Backup erstellt.</p>';
    }
    show('agdm-result');
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
  // Modal bleibt offen — Cleanup wird beim Schließen-Button ausgelöst
  _agdm_pendingCleanup = async () => {
    if (id === curGroupId) {
      const { groups } = await apiCall('/groups/my', 'GET');
      myGroups = groups || [];
      const next = myGroups[0];
      if (next) {
        curGroupId = next.id;
        try {
          localStorage.setItem('activeGroup', next.id);
        } catch (e) {}
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
      myGroups = myGroups.filter((g) => g.id !== id);
    }
    await renderAdminGroups();
    toast(`Gruppe „${name}" gelöscht`, 'success');
  };
}

// ── JOIN GROUP ───────────────────────────────────────────
function showGroupCode() {
  const g = myGroups.find((x) => x.id === curGroupId);
  if (!g) return;

  const isOwner = g.createdBy === me.id;
  const isDeputy = groupDeputies.some((d) => d.id === me.id);
  if (!isOwner && !isDeputy && !g.inviteCodeVisibleToMembers) {
    toast('Der Einladungscode ist nur für Owner/Vertreter sichtbar', 'error');
    return;
  }

  // Remove any existing popup
  document.getElementById('group-code-popup')?.remove();
  const pop = document.createElement('div');
  pop.id = 'group-code-popup';
  pop.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:28px 28px 22px;z-index:500;box-shadow:var(--shadow2);min-width:280px;text-align:center;animation:fadeIn .2s ease';
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
  setTimeout(
    () =>
      document.addEventListener('click', function h(e) {
        if (!pop.contains(e.target)) {
          pop.remove();
          document.removeEventListener('click', h);
        }
      }),
    50
  );
}

function openJoinGroup() {
  document.getElementById('group-dd')?.remove();
  $('join-group-code').value = '';
  hide('join-group-msg');
  show('join-group-modal');
}
function closeJoinGroup() {
  hide('join-group-modal');
}

async function openLeaveGroup() {
  document.getElementById('group-dd')?.remove();
  const sel = $('leave-group-select');
  sel.innerHTML = myGroups
    .map(
      (g) =>
        `<option value="${g.id}"${g.id === curGroupId ? ' selected' : ''}>${esc(g.name)}</option>`
    )
    .join('');
  hide('leave-group-msg');
  hide('leave-owner-section');
  hide('leave-dissolve-section');
  hide('leave-successor-section');
  hide('leave-last-group-hint');
  $('leave-group-btn').textContent = 'Verlassen';
  $('leave-group-btn').disabled = false;
  $('leave-group-btn').style.display = '';
  show('leave-group-modal');
  await _leaveGroupUpdateOwnerUI();
}

async function _leaveGroupUpdateOwnerUI() {
  const groupId = $('leave-group-select')?.value;
  if (!groupId) return;
  const group = myGroups.find((g) => g.id === groupId);
  if (!group) return;

  // Ist aktueller User Owner dieser Gruppe?
  // Wir laden Mitglieder um Anzahl zu wissen
  hide('leave-owner-section');
  hide('leave-dissolve-section');
  hide('leave-successor-section');
  $('leave-group-btn').textContent = 'Verlassen';

  try {
    const { members } = await apiCall(`/groups/${groupId}/members`, 'GET');
    const otherMembers = (members || []).filter((m) => m.id !== me.id);

    // Gruppen-Owner-Check: Wir prüfen gegen me.id
    // me.id ist der aktuelle Nutzer; createdBy laden wir per admin/all nicht, also
    // Heuristik: wir prüfen, ob der me.id der group.createdBy entspricht —
    // dazu laden wir die Gruppen-Info neu
    const isOwner = await _isGroupOwnerCheck(groupId);

    const isLastGroup = myGroups.length <= 1;

    if (!isOwner) {
      // Nicht Owner: Hinweis + Button sperren wenn letzte Gruppe
      $('leave-last-group-hint').classList.toggle('hidden', !isLastGroup);
      $('leave-group-btn').style.display = isLastGroup ? 'none' : '';
      $('leave-group-btn').disabled = false;
      return;
    }

    // Owner
    $('leave-last-group-hint').classList.add('hidden');
    show('leave-owner-section');

    if (isLastGroup) {
      // Owner + letzte Gruppe → Auflösen/Verlassen nicht möglich
      show('leave-dissolve-section');
      $('leave-group-btn').style.display = 'none';
      $('leave-dissolve-btn').style.display = 'none';
      $('leave-dissolve-last-group-hint').classList.remove('hidden');
    } else if (otherMembers.length === 0) {
      // Owner + alleiniges Mitglied + nicht letzte Gruppe → Auflösen möglich
      show('leave-dissolve-section');
      $('leave-group-btn').style.display = 'none';
      $('leave-dissolve-btn').style.display = '';
      $('leave-dissolve-last-group-hint').classList.add('hidden');
    } else {
      // Owner + andere Mitglieder → Nachfolger wählen
      show('leave-successor-section');
      const succSel = $('leave-successor-select');
      succSel.innerHTML = otherMembers
        .map((m) => `<option value="${m.id}">${esc(m.name || m.username)}</option>`)
        .join('');
      $('leave-group-btn').style.display = '';
      $('leave-group-btn').disabled = false;
      $('leave-group-btn').textContent = 'Ownership übertragen & verlassen';
    }
  } catch (e) {
    // Fehler beim Laden ignorieren, normaler Flow
  }
}

async function _isGroupOwnerCheck(groupId) {
  // myGroups enthält createdBy aus dem /groups/my Endpoint
  const g = myGroups.find((x) => x.id === groupId);
  if (g?.createdBy) return g.createdBy === me.id;
  // Fallback: frisch laden
  try {
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || myGroups;
    const fresh = myGroups.find((x) => x.id === groupId);
    return fresh ? fresh.createdBy === me.id : false;
  } catch {
    return false;
  }
}

function closeLeaveGroup() {
  $('leave-group-btn').style.display = '';
  hide('leave-group-modal');
}

async function doLeaveGroup() {
  const groupId = $('leave-group-select').value;
  if (myGroups.length <= 1) {
    return showMsg('leave-group-msg', 'error', '⚠ Du kannst deine letzte Gruppe nicht verlassen.');
  }
  const groupName = myGroups.find((g) => g.id === groupId)?.name || 'Gruppe';

  const isOwner = await _isGroupOwnerCheck(groupId);
  const dissolveSection = $('leave-dissolve-section');
  const isDissolveFlow =
    isOwner && dissolveSection && !dissolveSection.classList.contains('hidden');

  if (isDissolveFlow) {
    // Delegieren an Auflösen-Flow (handled by dissolveGroup())
    return;
  }

  const successorId =
    isOwner &&
    $('leave-successor-section') &&
    !$('leave-successor-section').classList.contains('hidden')
      ? $('leave-successor-select')?.value
      : null;

  if (!isOwner || successorId) {
    const confirmed = await showConfirmDlg(
      `„${groupName}" verlassen`,
      successorId
        ? `Du überträgst die Ownership auf den gewählten Nachfolger und verlässt die Gruppe.`
        : 'Du verlässt diese Gruppe und siehst ihre Fotos nicht mehr. Deine hochgeladenen Fotos bleiben erhalten.',
      successorId ? 'Übertragen & Verlassen' : 'Verlassen',
      'Abbrechen',
      true
    );
    if (!confirmed) return;
  }

  setBL('leave-group-btn', true, 'Wird verlassen…');
  try {
    await apiCall(`/groups/${groupId}/leave`, 'DELETE', successorId ? { successorId } : undefined);
    myGroups = myGroups.filter((g) => g.id !== groupId);
    closeLeaveGroup();
    if (groupId === curGroupId) {
      curGroupId = myGroups[0].id;
      try {
        localStorage.setItem('activeGroup', curGroupId);
      } catch (e) {}
      renderGroupSwitcher();
      const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
      groupMembers = members || [];
      groupMembers.forEach((m) => {
        allProfiles[m.id] = m;
      });
      curAlbum = null;
      curFilter = null;
      curFilterUserId = null;
      await loadAlbums();
      renderSidebar();
      await loadPhotos(true);
      toast(`„${groupName}" verlassen. Gewechselt zu „${myGroups[0].name}".`, 'success');
    } else {
      renderGroupSwitcher();
      renderSidebar();
      toast(`„${groupName}" erfolgreich verlassen.`, 'success');
    }
  } catch (e) {
    const msg = e.serverMessage || 'Fehler beim Verlassen der Gruppe.';
    showMsg('leave-group-msg', 'error', msg);
  } finally {
    setBL('leave-group-btn', false, isOwner ? 'Ownership übertragen & verlassen' : 'Verlassen');
  }
}

// Gruppe auflösen (Owner, letztes Mitglied) — mit Backup-Flow
let _dissolveGroupId = null;
let _dissolveGroupName = null;
let _dissolveBackupDone = false;

async function dissolveGroup() {
  const groupId = $('leave-group-select').value;
  const groupName = myGroups.find((g) => g.id === groupId)?.name || 'Gruppe';
  _dissolveGroupId = groupId;
  _dissolveGroupName = groupName;
  _dissolveBackupDone = false;

  closeLeaveGroup();
  $('agdm-title').textContent = `Gruppe „${groupName}" auflösen`;
  $('agdm-info').textContent =
    'Die Gruppe wird unwiderruflich gelöscht. Ein ZIP-Backup aller Fotos wird automatisch erstellt.';

  $('agdm-backup-btn').onclick = () => _dissolveDoDelete(true);
  $('agdm-delete-btn').onclick = () => _dissolveDoDelete(false);

  $('agdm-backup-btn').innerHTML =
    `📥 Backup erstellen &amp; herunterladen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Alle Fotos als ZIP sichern — Gruppe wird danach gelöscht</div>`;
  $('agdm-delete-btn').innerHTML =
    `🗑 Gruppe löschen<div style="font-size:11px;font-weight:400;opacity:0.85;margin-top:2px">Kein Backup gewünscht — Gruppe wird sofort gelöscht</div>`;

  show('agdm-actions');
  hide('agdm-loading');
  hide('agdm-result');
  $('agdm-confirm-delete-btn')?.classList.add('hidden');
  $('agdm-backup-btn').disabled = false;
  $('agdm-delete-btn').disabled = false;

  show('admin-group-delete-modal');
}

async function _dissolveDoDelete(autoDownload = false) {
  $('agdm-backup-btn').disabled = true;
  $('agdm-delete-btn').disabled = true;
  hide('agdm-actions');
  $('agdm-loading-text').textContent = autoDownload
    ? 'ZIP wird erstellt & heruntergeladen…'
    : 'ZIP wird erstellt & Gruppe wird aufgelöst…';
  show('agdm-loading');
  try {
    const res = await apiCall(`/groups/${_dissolveGroupId}/dissolve`, 'DELETE');
    hide('agdm-loading');

    const resultBox = $('agdm-result');
    const innerDiv = $('agdm-dl-link')?.closest('div');
    $('agdm-confirm-delete-btn')?.classList.add('hidden');

    if (res.backupUrl) {
      const expiry = res.linkExpiry
        ? new Date(res.linkExpiry)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiryStr = expiry.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      if (autoDownload) {
        $('agdm-result-text').innerHTML =
          `✅ Backup heruntergeladen — Gruppe gelöscht<br><span style="font-size:11px;opacity:0.7">Der Link ist gültig bis ${expiryStr} — danach werden alle Daten restlos von unserem Server gelöscht.</span>`;
      } else {
        $('agdm-result-text').innerHTML =
          `✅ Gruppe gelöscht — über den Link kannst du alle Bilder noch bis ${expiryStr} herunterladen<br><span style="font-size:11px;opacity:0.7">Nach dem ${expiryStr} werden alle Daten restlos von unserem Server gelöscht.</span>`;
      }
      $('agdm-dl-link').href = backupSrc(res.backupUrl);
      $('agdm-dl-link').style.display = '';

      if (autoDownload) {
        // Sofort-Download auslösen
        const a = document.createElement('a');
        a.href = backupSrc(res.backupUrl);
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } else {
      innerDiv.innerHTML =
        '<p style="color:var(--text2);font-size:13px;margin:0">ℹ️ Keine Fotos vorhanden — kein Backup erstellt.</p>';
    }

    show('agdm-result');
    _dissolveBackupDone = true;
    await _dissolveAfterDelete();
  } catch (e) {
    hide('agdm-loading');
    show('agdm-actions');
    $('agdm-backup-btn').disabled = false;
    $('agdm-delete-btn').disabled = false;
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function _dissolveAfterDelete() {
  myGroups = myGroups.filter((g) => g.id !== _dissolveGroupId);
  const dissolvedId = _dissolveGroupId;
  const name = _dissolveGroupName;

  // Modal bleibt offen — Cleanup beim Schließen-Button
  _agdm_pendingCleanup = async () => {
    if (dissolvedId === curGroupId || !myGroups.find((g) => g.id === curGroupId)) {
      curGroupId = myGroups[0]?.id;
      if (curGroupId) {
        try {
          localStorage.setItem('activeGroup', curGroupId);
        } catch (e) {}
        renderGroupSwitcher();
        const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
        groupMembers = members || [];
        groupMembers.forEach((m) => {
          allProfiles[m.id] = m;
        });
        curAlbum = null;
        curFilter = null;
        curFilterUserId = null;
        await loadAlbums();
        renderSidebar();
        await loadPhotos(true);
      }
    }
    renderGroupSwitcher();
    renderSidebar();
    toast(`Gruppe „${name}" aufgelöst.`, 'success');
  };
}

async function doJoinGroup() {
  const code = V('join-group-code').trim();
  if (!code) return showMsg('join-group-msg', 'error', '⚠ Bitte Code eingeben.');
  setBL('join-group-btn', true, 'Wird beigetreten…');
  try {
    const { group } = await apiCall('/groups/join', 'POST', { code });
    const { groups } = await apiCall('/groups/my', 'GET');
    myGroups = groups || [];
    curGroupId = group.id;
    try {
      localStorage.setItem('activeGroup', group.id);
    } catch (e) {}
    closeJoinGroup();
    await loadGroupMembers();
    await loadAlbums();
    renderGroupSwitcher();
    renderSidebar();
    await loadPhotos(true);
    toast('Gruppe beigetreten!', 'success');
  } catch (e) {
    const status = e.status;
    const msg = e.serverMessage || e.message || '';
    const msgLc = msg.toLowerCase();
    let display;
    if (status === 404 || msg.toLowerCase().includes('nicht gefunden'))
      display = '❌ Ungültiger Gruppencode – bitte prüfen.';
    else if (status === 409 && (msgLc.includes('voll') || msgLc.includes('maximal')))
      display = `❌ ${msg || 'Diese Gruppe ist bereits voll.'}`;
    else if (status === 409 || msgLc.includes('bereits'))
      display = 'ℹ️ Du bist dieser Gruppe bereits beigetreten.';
    else if (status === 400) display = '⚠️ Bitte einen Gruppencode eingeben.';
    else if (msg) display = '❌ ' + msg;
    else display = '❌ Beitritt fehlgeschlagen. Bitte versuche es erneut.';
    showMsg('join-group-msg', 'error', display);
  } finally {
    setBL('join-group-btn', false, 'Beitreten →');
  }
}

// ── DARK MODE ─────────────────────────────────────────────
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  try {
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  } catch (e) {}
  updateThemeIcon();
  if (typeof syncThemeColor === 'function') syncThemeColor();
}
function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const sunSvg =
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const moonSvg = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const content = isDark ? sunSvg : moonSvg;
  ['theme-icon'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content;
  });
}
// Restore theme on load
try {
  if (localStorage.getItem('theme') === 'dark')
    document.documentElement.setAttribute('data-theme', 'dark');
} catch (e) {}

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
    document.querySelectorAll('.p-card.selected').forEach((c) => c.classList.remove('selected'));
  }
  updateBulkCount();
}

function toggleCardSelect(id, el) {
  if (!selectMode) return;
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    el.classList.remove('selected');
  } else {
    selectedIds.add(id);
    el.classList.add('selected');
  }
  updateBulkCount();
}

function updateBulkCount() {
  const el = $('bulk-count');
  if (el) el.textContent = selectedIds.size === 1 ? '1 Foto' : `${selectedIds.size} Fotos`;
}

async function bulkDelete() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  const own = ids.filter((id) => {
    const p = photos.find((x) => x.id === id);
    return p?.uploaderId === me.id;
  });
  const foreign = ids.length - own.length;
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if (ico) ico.textContent = '🗑';
  if (own.length === 0) {
    if (txt)
      txt.textContent =
        'Du kannst nur eigene Fotos löschen. Keins der ausgewählten Fotos gehört dir.';
    btns.className = 'dlg-btns';
    btns.innerHTML = `<button class="btn btn-ghost" onclick="cancelDel()">Verstanden</button>`;
  } else if (foreign > 0) {
    if (txt)
      txt.textContent = `${own.length} eigene${own.length > 1 ? ' Fotos' : ' Foto'} löschen? (${foreign} fremde${foreign > 1 ? ' Fotos' : ' Foto'} werden übersprungen)`;
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execBulkDelete()">Eigene löschen</button>`;
  } else {
    if (txt)
      txt.textContent = `${own.length} Foto${own.length > 1 ? 's' : ''} wirklich unwiderruflich löschen?`;
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execBulkDelete()">Alle löschen</button>`;
  }
  show('del-dlg');
}

async function execBulkDelete() {
  hide('del-dlg');
  const ids = [...selectedIds].filter((id) => {
    const p = photos.find((x) => x.id === id);
    return p?.uploaderId === me.id;
  });
  if (!ids.length) {
    toggleSelectMode();
    return;
  }
  for (const id of ids) {
    try {
      const p = photos.find((x) => x.id === id);
      delete urlCache[id];
      try {
        await apiCall(`/photos/${id}`, 'DELETE');
      } catch (e) {
        console.error(e);
      }
    } catch (e) {
      console.error(e);
    }
  }
  toast(`${ids.length} Foto${ids.length > 1 ? 's' : ''} gelöscht`, 'success');
  toggleSelectMode();
  await loadPhotos(true);
  renderSidebar();
}

function bulkMoveToAlbum() {
  if (!selectedIds.size) return;
  if (!allAlbums.length) {
    toast('Erstelle zuerst ein Album', 'info');
    return;
  }
  const sel = $('bulk-album-select');
  sel.innerHTML = allAlbums
    .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
    .join('');
  show('bulk-album-modal');
}
function closeBulkAlbumModal() {
  hide('bulk-album-modal');
}
async function execBulkMoveToAlbum() {
  const albumId = $('bulk-album-select').value;
  if (!albumId) return;
  hide('bulk-album-modal');
  try {
    await apiCall('/photos/batch-album', 'PATCH', { photoIds: [...selectedIds], albumId });
  } catch (e) {
    toast('Verschieben fehlgeschlagen', 'error');
    return;
  }
  toast(`${selectedIds.size} Foto${selectedIds.size > 1 ? 's' : ''} verschoben`, 'success');
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
      const p = photos.find((x) => x.id === id);
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
    } catch (e) {
      console.error(e);
    }
  }
  btn.textContent = orig;
  btn.disabled = false;
  toast(`${done} Foto${done > 1 ? 's' : ''} heruntergeladen`, 'success');
}

// ── TOUCH SWIPE (Lightbox) ──────────────────────────────
let touchStartX = 0,
  touchStartY = 0,
  touchMoved = false;

let zoomScale = 1,
  zoomX = 0,
  zoomY = 0,
  _pinchStartDist = 0;

function initLbSwipe() {
  const el = $('lb');
  if (!el) return;

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        _pinchStartDist = getTouchDist(e.touches);
        e.preventDefault();
      } else if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
      }
    },
    { passive: false }
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2) {
        const dist = getTouchDist(e.touches);
        zoomScale = Math.min(4, Math.max(1, dist / _pinchStartDist));
        const img = $('lb-img');
        if (img) {
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const rect = img.getBoundingClientRect();
          const ox = ((cx - rect.left) / rect.width) * 100;
          const oy = ((cy - rect.top) / rect.height) * 100;
          img.style.transformOrigin = `${ox}% ${oy}%`;
          img.style.transform = `scale(${zoomScale})`;
          img.style.transition = 'none';
        }
        e.preventDefault();
      } else if (e.touches.length === 1) {
        touchMoved = true;
      }
    },
    { passive: false }
  );

  el.addEventListener(
    'touchend',
    (e) => {
      if (zoomScale > 1) {
        // Snap back to normal
        const img = $('lb-img');
        if (img) {
          img.style.transition = 'transform .25s ease';
          img.style.transform = '';
          setTimeout(() => {
            img.style.transition = '';
            img.style.transformOrigin = '';
          }, 260);
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
    },
    { passive: true }
  );
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function resetZoom() {
  zoomScale = 1;
  const img = $('lb-img');
  if (img) {
    img.style.transform = '';
    img.style.transformOrigin = '';
    img.style.transition = '';
  }
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
    document.querySelectorAll('.lb-fullview-hint').forEach((e) => e.remove());
    const hint = document.createElement('div');
    hint.className = 'lb-fullview-hint';
    hint.textContent = 'Tippe auf das Bild zum Beenden';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 2500);
  } else {
    document.querySelectorAll('.lb-fullview-hint').forEach((e) => e.remove());
  }
}

function updateFullviewBtn() {
  const btn = $('lb-full-btn');
  if (!btn) return;
  const isFullview = $('lb').classList.contains('lb-fullview');
  btn.innerHTML = isFullview ? ICON_SHRINK : ICON_FULLSCREEN;
  btn.title = isFullview ? 'Verkleinern' : 'Vollbild';
}

// ── EDIT DESCRIPTION ──────────────────────────────────────
function editDesc() {
  const p = photos[lbIdx];
  if (!p || p.uploaderId !== me.id) return;
  const wrap = document.getElementById('lb-desc-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <input type="text" id="desc-edit-input" value="${esc(p.description || '')}" placeholder="Beschreibung eingeben…"
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
    const card = document.getElementById('pc-' + p.id);
    if (card) {
      const descEl = card.querySelector('.p-desc');
      if (newDesc) {
        if (descEl) descEl.textContent = newDesc;
        else {
          const meta = card.querySelector('.p-meta');
          if (meta)
            meta.insertAdjacentHTML('afterbegin', `<div class="p-desc">${esc(newDesc)}</div>`);
        }
      } else {
        if (descEl) descEl.remove();
      }
      const ovDesc = card.querySelector('.p-ov-desc');
      if (newDesc) {
        if (ovDesc) ovDesc.textContent = newDesc;
        else {
          const ov = card.querySelector('.p-ov');
          if (ov)
            ov.insertAdjacentHTML('beforeend', `<div class="p-ov-desc">${esc(newDesc)}</div>`);
        }
      } else {
        if (ovDesc) ovDesc.remove();
      }
    }
    toast('Beschreibung gespeichert', 'success');
    openLB(lbIdx);
  } catch (e) {
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
    if (!url) {
      toast('URL nicht verfügbar', 'error');
      btn.innerHTML = orig;
      return;
    }
    const resp = await fetch(photoSrc(url));
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.filename || 'foto.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error(e);
  }
  btn.innerHTML = orig;
}

// ── SERVICE WORKER – Deregistrierung ─────────────────────
// SW wurde entfernt. Bereits installierte SWs werden aktiv deregistriert.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
}

// Sync theme-color meta tag with dark mode
function syncThemeColor() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? '#141210' : '#8a6a4a';
}

// ── DEPUTY MODAL ──────────────────────────────────────────
async function openDeputyModal() {
  try {
    const { deputies } = await apiCall(`/groups/${curGroupId}/deputies`, 'GET');
    groupDeputies = deputies || [];
  } catch (e) {
    groupDeputies = [];
  }
  _renderDeputyList();

  // Mitglieder-Dropdown füllen (ohne Owner und schon ernannte Deputies)
  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const sel = document.getElementById('deputy-user-select');
  sel.innerHTML = '<option value="">— Mitglied auswählen —</option>';
  groupMembers
    .filter((m) => m.id !== curGroup?.createdBy && !groupDeputies.some((d) => d.id === m.id))
    .forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.username;
      sel.appendChild(opt);
    });

  show('deputy-modal');
}

function closeDeputyModal() {
  hide('deputy-modal');
}

function _renderDeputyList() {
  const el = document.getElementById('deputy-list');
  if (!groupDeputies.length) {
    el.innerHTML =
      '<p style="font-size:13px;color:var(--muted2);font-weight:300">Noch keine Vertreter ernannt.</p>';
    return;
  }
  el.innerHTML = groupDeputies
    .map(
      (d) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      ${avatarHtml(d, 28)}
      <span style="flex:1;font-size:13px">${esc(d.name || d.username)}</span>
      <button onclick="removeDeputy('${d.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:18px;line-height:1;padding:2px 6px" title="Entfernen">×</button>
    </div>`
    )
    .join('');
}

async function addDeputy() {
  const userId = document.getElementById('deputy-user-select').value;
  if (!userId) return;
  try {
    const deputy = await apiCall(`/groups/${curGroupId}/deputies`, 'POST', { userId });
    groupDeputies.push(deputy);
    await openDeputyModal(); // refresh
    renderSidebar();
  } catch (e) {
    toast('Fehler beim Hinzufügen', 'error');
  }
}

async function removeDeputy(userId) {
  try {
    await apiCall(`/groups/${curGroupId}/deputies/${userId}`, 'DELETE');
    groupDeputies = groupDeputies.filter((d) => d.id !== userId);
    _renderDeputyList();
    renderAlbumList();
    renderSidebar();
  } catch (e) {
    toast('Fehler beim Entfernen', 'error');
  }
}

// ── NOTIFICATIONS ────────────────────────────────────────
let _notifPanelOpen = false;
let _sseSource = null;
let _notifCursor = null;
let _notifItems = [];
const _NOTIF_LABELS = {
  groupMemberJoined: '👤',
  groupMemberLeft: '🚪',
  groupDeleted: '🗑',
  deputyAdded: '⭐',
  deputyRemoved: '⭐',
  newAlbum: '📁',
  contributorAdded: '✏️',
  contributorRemoved: '✏️',
  newPhoto: '🖼',
  photoCommented: '💬',
  photoLiked: '❤️',
  system: '📢',
};

function _notifTimeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'Gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`;
  return `vor ${Math.floor(diff / 86400)} T`;
}

function _renderNotifList() {
  const list = $('notif-list');
  const empty = $('notif-empty');
  if (!list) return;
  if (_notifItems.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      list.appendChild(empty);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = _notifItems
    .map((n) => {
      const hasTarget = !!n.entityId || !!n.entityUrl;
      return `
    <li class="notif-item${n.read ? '' : ' unread'}${hasTarget ? ' notif-item--nav' : ''}" data-id="${n.id}" onclick="_notifClick('${n.id}')">
      <div class="notif-item-body">
        <div class="notif-item-title">${_NOTIF_LABELS[n.type] || '🔔'} ${_esc(n.title)}${hasTarget ? ' <span class="notif-item-nav-hint">→</span>' : ''}</div>
        <div class="notif-item-text">${_esc(n.body || '')}</div>
        ${n.imageUrl ? `<img class="notif-item-thumb" src="${_esc(n.imageUrl)}" alt="" onclick="event.stopPropagation();window.open('${_esc(n.imageUrl)}','_blank','noopener,noreferrer')">` : ''}
        <div class="notif-item-meta">
          <span class="notif-item-time">${_notifTimeAgo(n.createdAt)}</span>
        </div>
      </div>
      <div class="notif-item-actions">
        ${!n.read ? `<button class="notif-item-read" onclick="event.stopPropagation();_notifMarkRead('${n.id}')" title="Als gelesen markieren"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
        <button class="notif-item-del" onclick="event.stopPropagation();_notifDelete('${n.id}')" title="Löschen">✕</button>
      </div>
    </li>`;
    })
    .join('');
}

function _updateNotifBadge(count) {
  const badge = $('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

async function loadNotifications() {
  try {
    const res = await apiCall('/notifications?limit=30');
    _notifItems = res.notifications || [];
    _notifCursor = res.nextCursor || null;
    _updateNotifBadge(res.unreadCount || 0);
    _renderNotifList();
  } catch (e) {
    /* ignore */
  }
}

async function _notifMarkRead(id) {
  const item = _notifItems.find((n) => n.id === id);
  if (!item || item.read) return;
  try {
    await apiCall(`/notifications/${id}/read`, 'PATCH');
    item.read = true;
  } catch (e) {
    /**/
  }
  _updateNotifBadge(_notifItems.filter((n) => !n.read).length);
  _renderNotifList();
}

async function _notifClick(id) {
  const item = _notifItems.find((n) => n.id === id);
  if (!item) return;
  // Als gelesen markieren
  if (!item.read) {
    try {
      await apiCall(`/notifications/${id}/read`, 'PATCH');
      item.read = true;
    } catch (e) {
      /**/
    }
    _updateNotifBadge(_notifItems.filter((n) => !n.read).length);
    _renderNotifList();
  }
  // Navigation
  if (item.entityId || item.entityUrl) {
    toggleNotifPanel();
    await _notifNavigate(item);
  }
}

async function _notifNavigate(item) {
  const { entityId, entityType } = item;
  try {
    if (entityType === 'photo') {
      // Foto-Details laden um groupId zu ermitteln
      const photo = await apiCall(`/photos/${entityId}`);
      if (!photo || !photo.id) return;
      // Ggf. Gruppe wechseln
      if (photo.groupId !== curGroupId) await switchGroup(photo.groupId);
      // Alle Fotos der Gruppe (aktueller Filter) laden und Lightbox öffnen
      curAlbum = null;
      curFilter = null;
      curFilterUserId = null;
      await loadPhotos(true);
      const idx = photos.findIndex((p) => p.id === entityId);
      if (idx !== -1) openLB(idx);
      else toast('Foto nicht mehr verfügbar', 'error');
    } else if (entityType === 'album') {
      const album = allAlbums.find((a) => a.id === entityId);
      if (album) {
        if (album.groupId && album.groupId !== curGroupId) await switchGroup(album.groupId);
        await switchAlbum(entityId);
      }
    } else if (entityType === 'group') {
      if (item.type === 'groupDeleted') {
        // Gruppe existiert nicht mehr — Backup-Link öffnen falls vorhanden
        if (item.entityUrl) window.open(item.entityUrl, '_blank', 'noopener,noreferrer');
      } else {
        if (entityId !== curGroupId) await switchGroup(entityId);
      }
    } else if (entityType === 'external') {
      if (item.entityUrl) window.open(item.entityUrl, '_blank', 'noopener,noreferrer');
    } else if (item.entityUrl) {
      window.open(item.entityUrl, '_blank', 'noopener,noreferrer');
    }
  } catch (e) {
    toast('Navigation fehlgeschlagen', 'error');
  }
}

async function _notifDelete(id) {
  try {
    await apiCall(`/notifications/${id}`, 'DELETE');
    _notifItems = _notifItems.filter((n) => n.id !== id);
    _updateNotifBadge(_notifItems.filter((n) => !n.read).length);
    _renderNotifList();
  } catch (e) {
    toast('Löschen fehlgeschlagen', 'error');
  }
}

async function markAllNotificationsRead() {
  try {
    await apiCall('/notifications/read-all', 'PATCH');
    _notifItems.forEach((n) => (n.read = true));
    _updateNotifBadge(0);
    _renderNotifList();
  } catch (e) {
    toast('Fehler', 'error');
  }
}

async function deleteAllNotifications() {
  if (!_notifItems.length) return;
  try {
    await apiCall('/notifications', 'DELETE');
    _notifItems = [];
    _updateNotifBadge(0);
    _renderNotifList();
  } catch (e) {
    toast('Fehler beim Löschen', 'error');
  }
}

function toggleNotifPanel() {
  if (window.innerWidth <= 900 && document.body.classList.contains('mobile-sidebar-open')) return;
  const panel = $('notif-panel');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;
  panel.style.display = _notifPanelOpen ? 'flex' : 'none';
  if (_notifPanelOpen) {
    loadNotifications();
    // Click-outside: nächsten Tick abwarten damit der aktuelle Klick nicht sofort schließt
    setTimeout(() => {
      function _notifOutside(e) {
        const bell = $('notif-bell-btn');
        if (!panel.contains(e.target) && e.target !== bell && !bell?.contains(e.target)) {
          _notifPanelOpen = false;
          panel.style.display = 'none';
          document.removeEventListener('click', _notifOutside, true);
        }
      }
      document.addEventListener('click', _notifOutside, true);
    }, 0);
  }
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initNotificationSSE() {
  const token = sessionStorage.getItem('accessToken');
  if (!token) return;
  if (_sseSource) {
    _sseSource.close();
    _sseSource = null;
  }
  const url = `/api/notifications/stream?token=${encodeURIComponent(token)}`;
  _sseSource = new EventSource(url);
  _sseSource.addEventListener('notification', (e) => {
    try {
      const notif = JSON.parse(e.data);
      // Deduplizieren: nur hinzufügen wenn ID noch nicht vorhanden
      if (_notifItems.some((n) => n.id === notif.id)) return;
      _notifItems.unshift(notif);
      if (_notifItems.length > 50) _notifItems.pop();
      _updateNotifBadge(_notifItems.filter((n) => !n.read).length);
      if (_notifPanelOpen) _renderNotifList();
      toast(`${_NOTIF_LABELS[notif.type] || '🔔'} ${notif.title}`, 'info');
    } catch (err) {
      /**/
    }
  });
  _sseSource.addEventListener('unreadCount', (e) => {
    try {
      _updateNotifBadge(parseInt(e.data, 10) || 0);
    } catch (err) {
      /**/
    }
  });
  _sseSource.onerror = () => {
    // Reconnect after 10s on error
    if (_sseSource) {
      _sseSource.close();
      _sseSource = null;
    }
    setTimeout(initNotificationSSE, 10000);
  };
}

// ── NOTIFICATION PREFERENCES ──
const _NOTIF_PREF_LABELS = {
  groupMemberJoined: {
    label: 'Mitglied beigetreten',
    hint: 'Jemand tritt einer deiner Gruppen bei (nur für Gruppen-Owner & Vertreter).',
  },
  groupMemberLeft: {
    label: 'Mitglied verlassen',
    hint: 'Ein Mitglied verlässt eine deiner Gruppen (nur für Gruppen-Owner & Vertreter).',
  },
  groupDeleted: {
    label: 'Gruppe gelöscht',
    hint: 'Ein Administrator hat eine Gruppe gelöscht, in der du Mitglied warst.',
  },
  deputyAdded: {
    label: 'Zum Vertreter ernannt',
    hint: 'Du wurdest in einer Gruppe als Vertreter (Deputy) eingesetzt und hast dort erweiterte Rechte.',
  },
  deputyRemoved: {
    label: 'Vertreter-Rolle entzogen',
    hint: 'Deine Vertreter-Rolle in einer Gruppe wurde entfernt.',
  },
  newAlbum: {
    label: 'Neues Album erstellt',
    hint: 'Ein Mitglied hat in einer deiner Gruppen ein neues Album angelegt.',
  },
  contributorAdded: {
    label: 'Contributor-Zugang erhalten',
    hint: 'Du wurdest zu einem Album als Contributor hinzugefügt und kannst dort Fotos hochladen.',
  },
  contributorRemoved: {
    label: 'Contributor-Zugang entzogen',
    hint: 'Dein Contributor-Zugang zu einem Album wurde entfernt.',
  },
  newPhoto: {
    label: 'Neues Foto hochgeladen',
    hint: 'Ein Mitglied hat ein Foto in einer deiner Gruppen hochgeladen.',
  },
  photoCommented: {
    label: 'Kommentar auf dein Foto',
    hint: 'Jemand hat einen Kommentar unter eines deiner Fotos geschrieben.',
  },
  photoLiked: {
    label: 'Like auf dein Foto',
    hint: 'Jemand hat eines deiner Fotos mit einem Like markiert.',
  },
  system: {
    label: 'System-Benachrichtigungen',
    hint: 'Ankündigungen vom Administrator (z.B. Updates, Wartungen). In-App ist immer aktiv.',
  },
};
let _notifPrefs = {};
let _notifPrefsSaveTimer = null;
let _notifPrefsSaving = false;
let _notifPrefsQueued = false;

async function loadNotifPrefs() {
  const loading = $('notif-prefs-loading');
  const body = $('notif-prefs-body');
  if (!loading || !body) return;
  try {
    const res = await apiCall('/notifications/preferences');
    _notifPrefs = res.preferences || res;
    if (loading) loading.style.display = 'none';
    show('notif-prefs-body');
    _renderPrefsTable();
  } catch (e) {
    if (loading) loading.textContent = 'Fehler beim Laden';
  }
}

function toggleNotifPrefs() {
  const col = $('notif-prefs-collapsible');
  const toggle = $('notif-prefs-toggle');
  const chevron = $('notif-prefs-chevron');
  if (!col) return;
  const open = col.style.display !== 'none';
  col.style.display = open ? 'none' : 'block';
  if (toggle) toggle.setAttribute('aria-expanded', String(!open));
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (!open) loadNotifPrefs();
}

function _renderPrefsTable() {
  const tb = $('notif-prefs-table');
  if (!tb) return;
  tb.innerHTML = Object.keys(_NOTIF_PREF_LABELS)
    .map((key) => {
      const { label, hint } = _NOTIF_PREF_LABELS[key];
      const isSystem = key === 'system';
      return `
    <tr>
      <td style="padding:7px 6px;color:var(--text2);">
        <span style="display:inline-flex;align-items:center;gap:5px">
          ${_esc(label)}
          <span class="notif-pref-hint" title="${_esc(hint)}" aria-label="${_esc(hint)}">&#x24D8;</span>
        </span>
      </td>
      <td style="text-align:center;padding:7px 6px">
        ${
          isSystem
            ? `<input type="checkbox" id="np_inApp_${key}" checked disabled title="System-Benachrichtigungen sind immer aktiv"> <span title="Nicht deaktivierbar" style="font-size:10px;opacity:.6">🔒</span>`
            : `<input type="checkbox" id="np_inApp_${key}" ${_notifPrefs['inApp_' + key] ? 'checked' : ''} onchange="handleNotifPrefToggle('${key}','inApp',this.checked)">`
        }
      </td>
      <td style="text-align:center;padding:7px 6px">
        <input type="checkbox" id="np_email_${key}" ${_notifPrefs['email_' + key] ? 'checked' : ''} onchange="handleNotifPrefToggle('${key}','email',this.checked)">
      </td>
    </tr>`;
    })
    .join('');
}

function collectNotifPrefsFromUi() {
  const prefs = {};
  for (const key of Object.keys(_NOTIF_PREF_LABELS)) {
    if (key !== 'system') {
      prefs['inApp_' + key] = !!$('np_inApp_' + key)?.checked;
    }
    prefs['email_' + key] = !!$('np_email_' + key)?.checked;
  }
  return prefs;
}

function setNotifPrefsMessage(text, type) {
  showMsg('notif-prefs-msg', type, text);
}

function scheduleNotifPrefsSave() {
  if (_notifPrefsSaveTimer) clearTimeout(_notifPrefsSaveTimer);
  _notifPrefsSaveTimer = setTimeout(() => {
    _notifPrefsSaveTimer = null;
    saveNotifPrefs();
  }, 200);
}

function handleNotifPrefToggle(key, channel, checked) {
  const prefKey = `${channel}_${key}`;
  const previousPrefs = { ..._notifPrefs };
  _notifPrefs[prefKey] = checked;
  setNotifPrefsMessage('Speichert…', 'success');
  scheduleNotifPrefsSave();
  handleNotifPrefToggle._lastPreviousPrefs = previousPrefs;
}

async function saveNotifPrefs() {
  const prefs = collectNotifPrefsFromUi();
  if (_notifPrefsSaving) {
    _notifPrefsQueued = true;
    return;
  }
  _notifPrefsSaving = true;
  const previousPrefs = handleNotifPrefToggle._lastPreviousPrefs || { ..._notifPrefs };
  try {
    await apiCall('/notifications/preferences', 'PUT', prefs);
    _notifPrefs = prefs;
    setNotifPrefsMessage('✓ Benachrichtigungseinstellungen gespeichert!', 'success');
    setTimeout(() => hide('notif-prefs-msg'), 5000);
  } catch (e) {
    _notifPrefs = previousPrefs;
    _renderPrefsTable();
    setNotifPrefsMessage('Fehler beim Speichern der Benachrichtigungseinstellungen.', 'error');
  } finally {
    _notifPrefsSaving = false;
    if (_notifPrefsQueued) {
      _notifPrefsQueued = false;
      saveNotifPrefs();
    }
  }
}
// ── END NOTIFICATIONS ────────────────────────────────────

// ── BROADCAST MODAL (Admin) ──────────────────────────────
function openBroadcastModal() {
  const modal = $('broadcast-modal');
  if (!modal) return;
  // Notif-Panel schließen damit es das Modal nicht überdeckt
  if (_notifPanelOpen) toggleNotifPanel();
  $('broadcast-title').value = '';
  $('broadcast-body').value = '';
  const attInput = $('broadcast-attachment');
  if (attInput) attInput.value = '';
  const prev = $('broadcast-attachment-preview');
  if (prev) prev.innerHTML = '';
  modal.style.display = '';
  setTimeout(() => $('broadcast-title')?.focus(), 50);
}

function closeBroadcastModal() {
  const modal = $('broadcast-modal');
  if (modal) modal.style.display = 'none';
}

// Broadcast Attachment Preview
function renderBroadcastAttachmentPreview() {
  const attInput = $('broadcast-attachment');
  const preview = $('broadcast-attachment-preview');
  if (!attInput || !preview) return;
  const val = attInput.value.trim();
  if (!val) {
    preview.innerHTML = '';
    return;
  }
  // Bild-ID: 6–36 Zeichen, nur Buchstaben/Zahlen/Bindestrich/Unterstrich (CUID/UUID)
  if (/^[a-zA-Z0-9_-]{6,36}$/.test(val) && !/^https?:\/\//.test(val)) {
    const url = photoSrc(`/api/photos/${encodeURIComponent(val)}/file`);
    preview.innerHTML = `<img src="${url}" alt="Bildvorschau" style="max-width:120px;max-height:80px;border-radius:7px;border:1.5px solid var(--border);box-shadow:var(--shadow1)" onerror="this.parentElement.innerHTML='<span style=\'font-size:12px;color:var(--danger,#e05555)\'>Bild nicht gefunden</span>'"><div style="font-size:11px;color:var(--muted2);margin-top:4px">Bild-ID: <b>${esc(val)}</b></div>`;
  } else if (/^https?:\/\//.test(val)) {
    preview.innerHTML = `<a href="${esc(val)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:13px;text-decoration:underline;word-break:break-all">${esc(val)}</a><div style="font-size:11px;color:var(--muted2);margin-top:2px">Wird als Link angezeigt</div>`;
  } else {
    preview.innerHTML = `<span style="color:var(--danger,#e05555);font-size:12px">Bild-ID oder https://… URL erwartet</span>`;
  }
}

async function sendBroadcast() {
  const title = $('broadcast-title')?.value?.trim();
  const body = $('broadcast-body')?.value?.trim();
  const att = $('broadcast-attachment')?.value?.trim();
  let imageUrl, entityUrl;
  if (!title) {
    toast('Bitte einen Titel eingeben', 'error');
    return;
  }
  if (att) {
    if (/^[a-zA-Z0-9_-]{6,36}$/.test(att) && !/^https?:\/\//.test(att)) {
      imageUrl = `/api/photos/${encodeURIComponent(att)}/file`;
      entityUrl = undefined;
    } else if (/^https?:\/\//.test(att)) {
      imageUrl = undefined;
      entityUrl = att;
    } else {
      toast('Ungültige Bild-ID oder URL', 'error');
      return;
    }
  }
  const btn = $('broadcast-send-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird gesendet…';
  }
  try {
    const res = await apiCall('/admin/broadcast', 'POST', { title, body, imageUrl, entityUrl });
    closeBroadcastModal();
    toast(`📢 Nachricht an ${res.sent} Nutzer gesendet`, 'success');
  } catch (e) {
    toast('Fehler beim Senden', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Senden';
    }
  }
}
// ── END BROADCAST MODAL ──────────────────────────────────

// ── GLOBAL EXPORTS für onclick-Handler im HTML ───────────
// ES-Module haben ihren eigenen Scope; onclick="fn()" braucht window.fn
Object.assign(window, {
  // Auth / Session
  doLogout,
  // Navigation / Sidebar
  toggleSidebar,
  openSidebar,
  closeSidebar,
  switchFolder,
  switchAlbum,
  switchToUser,
  toast,
  // Upload Modal
  openModal,
  closeModal,
  handleFiles,
  startUpload,
  _removeStagedFile,
  openRenameGroupInline,
  closeRenameGroupInline,
  saveGroupRename,
  // Gallery
  loadMore,
  toggleSelectMode,
  toggleCardSelect,
  switchView,
  openLB,
  doLike,
  // Lightbox
  closeLB,
  lbNav,
  handleLbBgClick,
  toggleLike,
  sendComment,
  deleteComment,
  showLikersList,
  toggleFullview,
  downloadPhoto,
  openAlbumPicker,
  togglePhotoAlbum,
  editDesc,
  saveDesc,
  // Delete dialogs
  askDel,
  cancelDel,
  execDel,
  removeFromAlbum,
  // Bulk actions
  bulkDelete,
  execBulkDelete,
  bulkMoveToAlbum,
  closeBulkAlbumModal,
  execBulkMoveToAlbum,
  bulkDownload,
  // Albums
  openAlbumModal,
  closeAlbumModal,
  createAlbum,
  openNewAlbumInline,
  closeNewAlbumInline,
  createAlbumInline,
  deleteAlbum,
  execDeleteAlbum,
  openAlbumSettings,
  openContributorModal,
  closeContributorModal,
  addContributor,
  removeContributor,
  saveAlbumRename,
  deleteAlbumFromModal,
  // Add-to-album modal
  openAddFromAll,
  closeAddModal,
  confirmAddToAlbum,
  toggleAddSelection,
  // Profile
  openProfileModal,
  closeProfileModal,
  uploadAvatar,
  clearAvatar,
  setUserColor,
  setDisplayName,
  // Groups
  switchGroup,
  openJoinGroup,
  closeJoinGroup,
  doJoinGroup,
  showGroupCode,
  openLeaveGroup,
  closeLeaveGroup,
  doLeaveGroup,
  dissolveGroup,
  _leaveGroupUpdateOwnerUI,
  openGroupSettingsModal,
  closeGroupSettingsModal,
  saveGroupSettingsRename,
  rotateGroupInviteCode,
  saveGroupInviteCodeVisibility,
  copyGroupSettingsCode,
  deleteGroupFromSettings,
  toggleGroupLimitInputs,
  saveGroupMemberLimit,
  openDeputyModalFromSettings,
  _loadGsDeputies,
  _renderGsDeputyList,
  addGsDeputy,
  removeGsDeputy,
  openDeputyModal,
  closeDeputyModal,
  addDeputy,
  removeDeputy,
  openAdminGroups,
  closeAdminGroups,
  adminEditGroup,
  adminCancelEdit,
  adminSaveGroup,
  adminCreateGroup,
  adminDeleteGroup,
  adminToggleCreateGroupLimit,
  adminToggleEditGroupLimit,
  closeAdminGroupDeleteModal,
  agdmCopyLink,
  agdmCloseAndCleanup,
  agdmStrandedCheckChange,
  adminGroupDoBackup,
  adminGroupDoDelete,
  adminGroupConfirmDelete,
  openAdminUsers,
  closeAdminUsers,
  adminSetRole,
  adminToggleUser,
  adminDeleteUser,
  adminToggleNotifyForm,
  adminSendUserNotification,
  adminAddUserToGroup,
  adminRemoveUserFromGroup,
  openAdminBackups,
  closeAdminBackups,
  adminRefreshBackupLink,
  adminDeleteBackupEntry,
  toggleGroupDropdown,
  openMobileGroupSwitcherSheet,
  closeMobileGroupSwitcherSheet,
  // Slideshow
  // Feedback / Support
  openSupportModal,
  closeSupportModal,
  onFeedbackCategoryChange,
  submitFeedback,
  switchFeedbackTab,
  renderMyFeedbackList,
  openMyConversation,
  submitMyMessage,
  openAdminFeedback,
  closeAdminFeedback,
  renderAdminFeedbackList,
  setFeedbackStatus,
  markFeedbackAdminRead,
  closeFeedbackTicket,
  closeOwnFeedbackTicket,
  deleteFeedbackEntry,
  adminOpenConversation,
  closeAfConvModal,
  adminSubmitReply,
  setFeedbackResolution,
  // Slideshow
  openSS,
  toggleSS,
  ssChangeSpeed,
  // Misc
  toggleDarkMode,
  changeSort,
  // Notifications
  toggleNotifPanel,
  markAllNotificationsRead,
  deleteAllNotifications,
  saveNotifPrefs,
  toggleNotifPrefs,
  handleNotifPrefToggle,
  _notifClick,
  _notifMarkRead,
  _notifDelete,
  openBroadcastModal,
  closeBroadcastModal,
  sendBroadcast,
  renderBroadcastAttachmentPreview,
  openChangelogModal,
  closeChangelogModal,
  createChangelogEntry,
  startEditChangelogEntry,
  cancelEditChangelogEntry,
  saveEditChangelogEntry,
  deleteChangelogEntry,
  copyCurrentImageId,
  toggleLbMenu,
  closeLbMenu,
  // Utility (gebraucht von HTML onclick z.B. dz-onclick)
  $,
  onThumbLoad,
});
