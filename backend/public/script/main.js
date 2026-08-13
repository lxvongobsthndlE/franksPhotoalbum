import {
  checkSession,
  startOIDCLogin,
  handleOIDCCallback,
  logout,
  apiCall,
  fetchWithAuth,
} from './auth-oidc.js';
import {
  renderWizardView,
  persistConfig,
  buildGeneratePayload,
  ensureDraftPromise,
  syncTeamsToBackend,
  tournamentStatusPhase,
  tournamentPhaseLabel,
  tournamentStatusLabel,
  TOURNAMENT_PHASE_ORDER,
} from './tournament.js';

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
  groupDeputies = [],
  groupBlockedMembers = [];
let curFilterUserId = null;
let curModule = 'feed';
let curFeedView = 'all';
let allProfiles = {},
  photos = [],
  pgFrom = 0,
  hasMore = false;
let feedPosts = [];
let feedSkip = 0;
let feedHasMore = false;
let tournamentInstances = [];
let activeTournamentInstance = null;
let curTournamentView = 'instances';
let curTournamentTab = 'overview';
let allAlbums = [];
let urlCache = {};
let lbIdx = 0,
  delTarget = null,
  delFromLb = false;
let appVersion = '...';
let changelogEntries = [];
let changelogEditingId = null;
let pendingInviteToken = null;
let pendingLoggedInInviteToken = null;
let adminGroupsCache = [];
let profileExportsLoading = false;
let profileDeletionCandidatesLoaded = false;
const sidebarUiState = {
  fotosExpanded: false,
  feedExpanded: true,
  tournamentsExpanded: false,
};
const FEED_PAGE_SIZE = 20;
const FEED_VIEWS = new Set(['all', 'mine', 'mentions', 'saved']);
const FEED_DEEP_LINK_LIST_LIMIT = 50;
const FEED_POST_QUERY_PARAM = 'feedPost';
const FEED_POST_STORAGE_KEY = 'pendingFeedPostId';

let pendingFeedPostId = null;
let pendingFeedPostNewerCount = 0;
let activeSingleFeedPost = null;
let feedTargetedPostId = null;
let resolvingFeedPostTarget = false;
let feedTargetFocusTimer = null;
let activeFeedPostMenuId = null;
let feedPostMenuOutsideCloseBound = false;
let feedCommentUiState = {};
let activeFeedCommentsPostId = null;
let activeFeedCommentMenuId = null;
let feedCommentMenuOutsideCloseBound = false;
let feedMentionState = {
  open: false,
  inputId: null,
  tokenStart: -1,
  tokenEnd: -1,
  activeIndex: 0,
  items: [],
};

function normalizeFeedView(view) {
  return FEED_VIEWS.has(view) ? view : 'all';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTournamentView(view) {
  return view === 'instances' ? view : 'dashboard';
}

function sanitizeFeedPostId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (!/^[a-zA-Z0-9]+$/.test(normalized)) return null;
  if (normalized.length < 8 || normalized.length > 64) return null;
  return normalized;
}

function readFeedPostTargetFromUrl() {
  return sanitizeFeedPostId(new URLSearchParams(window.location.search).get(FEED_POST_QUERY_PARAM));
}

function readPersistedFeedPostTarget() {
  try {
    return sanitizeFeedPostId(sessionStorage.getItem(FEED_POST_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistFeedPostTarget(postId) {
  try {
    if (postId) sessionStorage.setItem(FEED_POST_STORAGE_KEY, postId);
    else sessionStorage.removeItem(FEED_POST_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage failures
  }
}

function replaceCurrentQueryParams(mutator) {
  const params = new URLSearchParams(window.location.search);
  mutator(params);
  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, document.title, nextUrl);
}

function removeTransientUrlParams({ keepInvite = false, keepFeedPost = true } = {}) {
  replaceCurrentQueryParams((params) => {
    params.delete('code');
    params.delete('state');
    if (!keepInvite) params.delete('invite');
    if (!keepFeedPost) params.delete(FEED_POST_QUERY_PARAM);
  });
}

window.onThumbLoad = function onThumbLoad(img) {
  img.classList.remove('loading');
  img.classList.add('loaded');
};

function updateFeedPostUrl(postId) {
  replaceCurrentQueryParams((params) => {
    params.delete('code');
    params.delete('state');
    if (postId) params.set(FEED_POST_QUERY_PARAM, postId);
    else params.delete(FEED_POST_QUERY_PARAM);
  });
}

function setPendingFeedPostTarget(postId) {
  const safePostId = sanitizeFeedPostId(postId);
  pendingFeedPostId = safePostId;
  persistFeedPostTarget(safePostId);
}

function clearFeedPostTargetState({ removeUrl = false } = {}) {
  pendingFeedPostId = null;
  pendingFeedPostNewerCount = 0;
  activeSingleFeedPost = null;
  feedTargetedPostId = null;
  persistFeedPostTarget(null);
  if (feedTargetFocusTimer) {
    clearTimeout(feedTargetFocusTimer);
    feedTargetFocusTimer = null;
  }
  if (removeUrl) updateFeedPostUrl(null);
}

function findFeedPostById(postId) {
  if (!postId) return null;
  if (activeSingleFeedPost?.id === postId) return activeSingleFeedPost;
  return feedPosts.find((post) => post.id === postId) || null;
}

function replaceFeedPostInState(updatedPost) {
  if (!updatedPost?.id) return;
  feedPosts = feedPosts.map((post) => (post.id === updatedPost.id ? updatedPost : post));
  if (activeSingleFeedPost?.id === updatedPost.id) activeSingleFeedPost = updatedPost;
}

function isOwnFeedPost(post) {
  return !!post && post.createdById === me?.id;
}

function canEditFeedPost(post) {
  return isOwnFeedPost(post);
}

function canDeleteFeedPost(post) {
  if (!post) return false;
  if (isOwnFeedPost(post)) return true;
  return isCurrentGroupModerator();
}

function buildFeedPostShareUrl(postId) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(FEED_POST_QUERY_PARAM, postId);
  return url.toString();
}

function focusTargetedFeedPost(scrollIntoView = true, targetPostId = feedTargetedPostId) {
  if (!targetPostId) return;
  window.requestAnimationFrame(() => {
    const card = document.getElementById(`feed-post-${targetPostId}`);
    if (!card) return;
    card.classList.add('is-targeted');
    if (scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (feedTargetFocusTimer) clearTimeout(feedTargetFocusTimer);
    feedTargetFocusTimer = window.setTimeout(() => {
      card.classList.remove('is-targeted');
      feedTargetFocusTimer = null;
    }, 6000);
  });
}

function getPendingFeedPostLoginTarget() {
  return pendingFeedPostId || readFeedPostTargetFromUrl() || readPersistedFeedPostTarget();
}

function startLoginWithContext() {
  const feedPostId = getPendingFeedPostLoginTarget();
  if (feedPostId) setPendingFeedPostTarget(feedPostId);
  return startOIDCLogin(pendingInviteToken, { feedPostId });
}

async function copyFeedPostLink(postId) {
  const safePostId = sanitizeFeedPostId(postId);
  if (!safePostId) return;
  navigator.clipboard
    .writeText(buildFeedPostShareUrl(safePostId))
    .then(() => toast('Beitragslink kopiert', 'success'))
    .catch(() => toast('Kopieren nicht möglich', 'error'));
}

function closeFeedPostMenu() {
  activeFeedPostMenuId = null;
  feedPostMenuOutsideCloseBound = false;
  syncFeedMenuVisibilityInDom();
}

function toggleFeedPostMenu(postId) {
  activeFeedPostMenuId = activeFeedPostMenuId === postId ? null : postId;
  feedPostMenuOutsideCloseBound = false;
  syncFeedMenuVisibilityInDom();
}

function syncFeedMenuVisibilityInDom() {
  document.querySelectorAll('[data-feed-menu-root]').forEach((root) => {
    const id = root.getAttribute('data-feed-menu-root');
    const menu = root.querySelector('.feed-post-menu');
    if (!menu) return;
    menu.style.display = id === activeFeedPostMenuId ? 'block' : 'none';
  });
  document.querySelectorAll('[data-feed-comment-menu-root]').forEach((root) => {
    const id = root.getAttribute('data-feed-comment-menu-root');
    const menu = root.querySelector('.feed-post-menu');
    if (!menu) return;
    menu.style.display = id === activeFeedCommentMenuId ? 'block' : 'none';
  });
}

function bindFeedPostMenuOutsideClose() {
  if (!activeFeedPostMenuId || feedPostMenuOutsideCloseBound) return;
  feedPostMenuOutsideCloseBound = true;
  setTimeout(() => {
    document.addEventListener('click', function handler(event) {
      const menuRoot = document.querySelector(`[data-feed-menu-root="${activeFeedPostMenuId}"]`);
      if (menuRoot && menuRoot.contains(event.target)) return;
      activeFeedPostMenuId = null;
      feedPostMenuOutsideCloseBound = false;
      document.removeEventListener('click', handler);
      syncFeedMenuVisibilityInDom();
    });
  }, 10);
}

function renderFeedDeepLinkBanner() {
  if (!activeSingleFeedPost) return '';
  return `
    <div class="feed-post-single-banner">
      <div>
        <strong>Direktlink aktiv</strong>
        <p>Dieser Beitrag wird einzeln angezeigt, weil zu viele neuere Beiträge geladen werden müssten.</p>
      </div>
      <button class="btn btn-ghost" onclick="exitFeedPostFocus()">Zur Übersicht</button>
    </div>`;
}

async function exitFeedPostFocus() {
  clearFeedPostTargetState({ removeUrl: true });
  await switchToFeed('all', { preserveTarget: false, removeTargetUrl: false });
}

async function handlePendingFeedPostTarget() {
  const targetPostId =
    pendingFeedPostId || readFeedPostTargetFromUrl() || readPersistedFeedPostTarget();
  if (!targetPostId || !me?.id || resolvingFeedPostTarget) return;

  resolvingFeedPostTarget = true;
  setPendingFeedPostTarget(targetPostId);

  try {
    const data = await apiCall(`/group-feed/${encodeURIComponent(targetPostId)}`, 'GET');
    const targetPost = data?.post;
    if (!targetPost?.id) {
      clearFeedPostTargetState({ removeUrl: true });
      return;
    }

    setPendingFeedPostTarget(targetPost.id);
    feedTargetedPostId = targetPost.id;
    pendingFeedPostNewerCount = Math.max(0, Number(data?.newerPostsCount) || 0);

    if (targetPost.groupId && targetPost.groupId !== curGroupId) {
      await switchGroup(targetPost.groupId);
    }

    curModule = 'feed';
    curFeedView = 'all';
    sidebarUiState.feedExpanded = true;
    sidebarUiState.fotosExpanded = false;
    saveLastModuleState();
    renderSidebar();

    if (pendingFeedPostNewerCount > FEED_DEEP_LINK_LIST_LIMIT) {
      activeSingleFeedPost = targetPost;
      feedPosts = [];
      renderFeedGrid();
      focusTargetedFeedPost(false, targetPost.id);
      pendingFeedPostId = null;
      pendingFeedPostNewerCount = 0;
      persistFeedPostTarget(null);
      return;
    }

    activeSingleFeedPost = null;
    await loadFeedPosts(true);
    pendingFeedPostId = null;
    pendingFeedPostNewerCount = 0;
    persistFeedPostTarget(null);
  } catch (e) {
    console.error('Feed-Direktlink fehlgeschlagen:', e);
    toast(e.serverMessage || 'Feed-Beitrag konnte nicht geöffnet werden', 'error');
    clearFeedPostTargetState({ removeUrl: true });
  } finally {
    resolvingFeedPostTarget = false;
  }
}

function getLastModuleStorageKey(groupId = curGroupId) {
  return `lastModule:${groupId || 'none'}`;
}

function readLastModuleState(groupId = curGroupId) {
  const fallback = { module: 'feed', feedView: 'all', tournamentView: 'dashboard' };
  try {
    const raw = localStorage.getItem(getLastModuleStorageKey(groupId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const allowedModules = new Set(['feed', 'photos', 'tournaments']);
    const module = allowedModules.has(parsed.module) ? parsed.module : 'feed';
    const feedView = normalizeFeedView(parsed.feedView);
    const tournamentView = normalizeTournamentView(parsed.tournamentView);
    return { module, feedView, tournamentView };
  } catch {
    return fallback;
  }
}

function applyLastModuleState(groupId = curGroupId) {
  const state = readLastModuleState(groupId);
  curModule = state.module;
  curFeedView = state.feedView;
  curTournamentView = normalizeTournamentView(state.tournamentView);
  sidebarUiState.feedExpanded = curModule === 'feed';
  sidebarUiState.fotosExpanded = curModule === 'photos';
  sidebarUiState.tournamentsExpanded = curModule === 'tournaments';
}

function saveLastModuleState(groupId = curGroupId) {
  try {
    const module = ['feed', 'photos', 'tournaments'].includes(curModule) ? curModule : 'feed';
    const payload = {
      module,
      feedView: normalizeFeedView(curFeedView),
      tournamentView: normalizeTournamentView(curTournamentView),
    };
    localStorage.setItem(getLastModuleStorageKey(groupId), JSON.stringify(payload));
  } catch {
    // Ignore localStorage failures
  }
}

async function loadInvitePreview(token) {
  try {
    const response = await fetch(`/api/invites/preview/${encodeURIComponent(token)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || 'Einladungslink ist ungültig.' };
    }
    const data = await response.json();
    return { ok: true, invite: data.invite };
  } catch (err) {
    return { ok: false, error: 'Invite-Vorschau konnte nicht geladen werden.' };
  }
}

async function redeemInviteViaApi(token) {
  try {
    const result = await apiCall(`/invites/redeem/${encodeURIComponent(token)}`, 'POST');
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err.serverMessage || 'Invite konnte nicht eingelöst werden.',
      code: err.status,
    };
  }
}

function applyInviteLoginMode(token, preview) {
  pendingInviteToken = token;
  const groupNames = (preview?.groups || []).map((group) => group?.name).filter(Boolean);
  const msg =
    groupNames.length > 0
      ? `Du wurdest zu ${groupNames.join(', ')} eingeladen. Bitte zuerst anmelden.`
      : 'Du wurdest eingeladen. Bitte zuerst anmelden.';
  showMsg('login-msg', 'info', msg);
}

function fmtInviteDate(value) {
  if (!value) return 'unbegrenzt';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unbegrenzt';
  return date.toLocaleDateString('de-DE');
}

function copyInviteUrl(url) {
  if (!url) return;
  navigator.clipboard
    .writeText(url)
    .then(() => toast('Invite-Link kopiert', 'success'))
    .catch(() => toast('Kopieren nicht möglich', 'error'));
}

window.startOIDCLogin = startLoginWithContext;

// Hängt den Access-Token als ?t= an Foto-URLs (nötig da <img src> keinen Auth-Header sendet)
function photoSrc(url) {
  if (!url) return '';
  const safeUrl = encodeURI(String(url));
  const t = sessionStorage.getItem('accessToken');
  if (!t) return safeUrl;
  return `${safeUrl}${safeUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(t)}`;
}

function revokeObjectUrlSafe(url) {
  if (!url) return;
  const api = window.URL || window.webkitURL;
  if (!api || typeof api.revokeObjectURL !== 'function') return;
  try {
    api.revokeObjectURL(url);
  } catch {}
}

/** Formatiert Sekunden als m:ss für Video-Badges. */
function formatMediaDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Für Export-Downloads wird ein API-Pfad durchgereicht
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
const ICON_LINK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20"/></svg>`;
const ICON_HISTORY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_MORE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;
const ICON_CHEVRON_RIGHT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const ICON_GEAR = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_EDIT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
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
// Issue 2: Beim Tab-Schließen das Wizard-Flag zurücksetzen.
// pagehide feuert zuverlässiger als beforeunload (auch bei Back/Forward
// und bei reload), und wir können hier kein async-Cleanup mehr
// absetzen — das Flag selbst ist die kritische Information.
window.addEventListener('pagehide', () => {
  wizardMounted = null;
});

window.addEventListener('load', async () => {
  hide('loading');
  show('auth-page');

  // Check if we're returning from OIDC callback
  const params = new URLSearchParams(window.location.search);
  const inviteTokenFromUrl = (params.get('invite') || '').trim().toUpperCase();
  const feedPostTargetFromUrl = sanitizeFeedPostId(params.get(FEED_POST_QUERY_PARAM));
  if (feedPostTargetFromUrl) setPendingFeedPostTarget(feedPostTargetFromUrl);
  else if (!pendingFeedPostId) pendingFeedPostId = readPersistedFeedPostTarget();
  if (params.has('code')) {
    const code = params.get('code');
    const state = params.get('state');

    try {
      // Process OIDC callback
      const { user, inviteResult, loginContext } = await handleOIDCCallback(code, state);
      me = user;
      if (loginContext?.feedPostId) setPendingFeedPostTarget(loginContext.feedPostId);

      // Clean up URL (remove code/state params)
      removeTransientUrlParams({ keepFeedPost: true });

      // Start app
      await startApp();
      await handlePendingFeedPostTarget();

      if (inviteResult?.status === 'joined') {
        toast('Einladung erfolgreich eingelöst.', 'success');
      } else if (inviteResult?.status === 'partial') {
        toast('Einladung teilweise eingelöst.', 'info');
      } else if (inviteResult?.status === 'already_member') {
        toast('Du bist bereits in der Zielgruppe.', 'info');
      } else if (inviteResult && inviteResult.ok === false) {
        toast(inviteResult.message || 'Einladung konnte nicht eingelöst werden.', 'error');
      }
      return;
    } catch (e) {
      console.error('OIDC callback failed:', e);
      const msg = e?.message || 'Authentifizierung fehlgeschlagen. Versuche es erneut.';
      showMsg('login-msg', 'error', `❌ ${msg}`);
      return;
    }
  }

  // Check if already logged in
  const session = await checkSession();
  if (session && session.id) {
    me = session;
    try {
      await startApp();
      await handlePendingFeedPostTarget();

      if (inviteTokenFromUrl) {
        const preview = await loadInvitePreview(inviteTokenFromUrl);
        if (preview.ok) {
          pendingLoggedInInviteToken = inviteTokenFromUrl;
          showInviteBanner(preview.invite);
        } else {
          toast(preview.error || 'Einladungslink ist ungültig.', 'error');
          removeTransientUrlParams({ keepFeedPost: true });
        }
      }
      return;
    } catch (e) {
      console.error('App start failed:', e);
      await logout();
    }
  }

  if (inviteTokenFromUrl) {
    const preview = await loadInvitePreview(inviteTokenFromUrl);
    if (preview.ok) {
      applyInviteLoginMode(inviteTokenFromUrl, preview.invite);
    } else {
      showMsg('login-msg', 'error', preview.error || 'Einladungslink ist ungültig.');
    }
  }

  // Not logged in, show login page
  show('auth-page');
});

// Make startOIDCLogin available globally for the HTML onclick handler
window.startOIDCLogin = startLoginWithContext;

function showInviteBanner(invite) {
  const groupNames = (invite?.groups || []).map((g) => g?.name).filter(Boolean);
  const expiry = invite?.expiresAt ? ` (bis ${fmtInviteDate(invite.expiresAt)})` : '';
  const msg =
    groupNames.length > 0
      ? `Du wurdest zu ${groupNames.join(', ')} eingeladen${expiry}.`
      : `Du wurdest eingeladen${expiry}.`;
  $('invite-banner-msg').textContent = msg;
  show('invite-banner');
}

async function confirmInviteJoin() {
  if (!pendingLoggedInInviteToken) return;
  $('invite-banner-btn').disabled = true;
  const token = pendingLoggedInInviteToken;
  const inviteRedeem = await redeemInviteViaApi(token);
  hide('invite-banner');
  pendingLoggedInInviteToken = null;
  removeTransientUrlParams({ keepFeedPost: true });
  if (inviteRedeem.ok) {
    const status = inviteRedeem.result?.status;
    if (status === 'joined') toast('Einladung erfolgreich eingelöst.', 'success');
    else if (status === 'partial') toast('Einladung teilweise eingelöst.', 'info');
    else if (status === 'already_member') toast('Du bist bereits in der Zielgruppe.', 'info');
    // Reload groups so the new group appears in the sidebar
    const targetGroupId = inviteRedeem.result?.joinedGroups?.[0]?.groupId ?? null;
    try {
      const { groups } = await apiCall('/groups/my', 'GET');
      myGroups = groups || [];
    } catch (e) {
      console.warn('Gruppen nach Invite-Join nicht aktualisiert:', e);
    }
    // Switch to the first joined group (or stay in current group for already_member)
    if (targetGroupId && myGroups.find((g) => g.id === targetGroupId)) {
      await switchGroup(targetGroupId);
    } else {
      renderGroupSwitcher();
      renderSidebar();
    }
  } else {
    toast(inviteRedeem.error || 'Einladung konnte nicht eingelöst werden.', 'error');
  }
}

function dismissInviteBanner() {
  hide('invite-banner');
  pendingLoggedInInviteToken = null;
  removeTransientUrlParams({ keepFeedPost: true });
}

window.confirmInviteJoin = confirmInviteJoin;
window.dismissInviteBanner = dismissInviteBanner;

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
  curModule = 'feed';
  curFeedView = 'all';
  curTournamentView = 'instances';
  sidebarUiState.fotosExpanded = false;
  sidebarUiState.feedExpanded = true;
  sidebarUiState.tournamentsExpanded = false;
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
      applyLastModuleState(curGroupId);
      saveLastModuleState(curGroupId);
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

  // Inhalt laden
  if (curGroupId) {
    if (curModule === 'feed') await loadFeedPosts(true);
    else if (curModule === 'tournaments') await loadActiveTournamentView(true);
    else await loadPhotos(true);
  } else toast('Keine Gruppe gefunden – ein Album wird automatisch erstellt.', 'info');

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
  const isAdminInCurrentGroup = me?.role === 'admin';
  const canSeeInviteCode =
    !!curGroup &&
    (isAdminInCurrentGroup ||
      isOwnerInCurrentGroup ||
      isDeputyInCurrentGroup ||
      curGroup.inviteCodeVisibleToMembers);
  const allowAlbumCreation = canCreateAlbum();
  const membersCounter =
    curGroup?.maxMembers !== null && curGroup?.maxMembers !== undefined
      ? `${allMembers.length}/${curGroup.maxMembers}`
      : null;

  const expandedModules = [
    sidebarUiState.feedExpanded ? 'feed' : null,
    sidebarUiState.fotosExpanded ? 'photos' : null,
    sidebarUiState.tournamentsExpanded ? 'tournaments' : null,
  ].filter(Boolean);
  if (expandedModules.length > 1) {
    sidebarUiState.feedExpanded = curModule === 'feed';
    sidebarUiState.fotosExpanded = curModule === 'photos';
    sidebarUiState.tournamentsExpanded = curModule === 'tournaments';
  }
  const activeHomeModule = sidebarUiState.feedExpanded
    ? 'feed'
    : sidebarUiState.fotosExpanded
      ? 'photos'
      : sidebarUiState.tournamentsExpanded
        ? 'tournaments'
        : null;
  const fotosExpanded = sidebarUiState.fotosExpanded;
  const tournamentsExpanded = sidebarUiState.tournamentsExpanded;

  $('sidebar').innerHTML = `
    <span class="sb-label">Home</span>
    <button class="fb fb-parent ${sidebarUiState.feedExpanded ? 'expanded' : ''} ${activeHomeModule === 'feed' ? 'module-active' : ''}" onclick="toggleSidebarFeed()" aria-expanded="${sidebarUiState.feedExpanded ? 'true' : 'false'}">
      <span class="fi">${ICON_COMMENT}</span>
      <span class="fn">Feed</span>
      <span class="fb-alpha-pill" aria-hidden="true">Alpha</span>
      <span class="fb-chevron" aria-hidden="true">${ICON_CHEVRON_RIGHT}</span>
    </button>
    ${
      activeHomeModule === 'feed'
        ? `
    <button class="fb fb-sub ${curModule === 'feed' && curFeedView === 'all' ? 'active' : ''}" onclick="switchToFeed('all')">
      <span class="fi">${ICON_GRID}</span>
      <span class="fn">Alle Beiträge</span>
    </button>`
        : ''
    }
    <button class="fb fb-parent ${fotosExpanded ? 'expanded' : ''} ${activeHomeModule === 'photos' ? 'module-active' : ''}" onclick="toggleSidebarFotos()" aria-expanded="${fotosExpanded ? 'true' : 'false'}">
      <span class="fi">${ICON_GRID}</span>
      <span class="fn">Fotos</span>
      <span class="fb-chevron" aria-hidden="true">${ICON_CHEVRON_RIGHT}</span>
    </button>
    ${
      activeHomeModule === 'photos'
        ? `
    <button class="fb fb-sub ${!curAlbum && !curFilter && !curFilterUserId ? 'active' : ''}" onclick="switchFolder(null)">
      <span class="fi">${ICON_GRID}</span>
      <span class="fn">Alle Fotos</span>
      <span class="fc" id="fc-all">…</span>
    </button>
    <button class="fb fb-sub ${curFilter === 'mine' && !curAlbum ? 'active' : ''}" onclick="switchFolder('mine')">
      <span class="fi">${avatarHtml(meProfile, 20)}</span>
      <span class="fn">Meine Fotos</span>
      <span class="fc" id="fc-mine">…</span>
    </button>
    <button class="fb fb-sub" onclick="openSS()${window.innerWidth <= 900 ? ';closeSidebar()' : ''}">
      <span class="fi">${ICON_PLAY}</span>
      <span class="fn">Diashow</span>
    </button>`
        : ''
    }
    <button class="fb fb-parent ${tournamentsExpanded ? 'expanded' : ''} ${activeHomeModule === 'tournaments' ? 'module-active' : ''}" onclick="toggleSidebarTournaments()" aria-expanded="${tournamentsExpanded ? 'true' : 'false'}">
      <span class="fi">🏆</span>
      <span class="fn">Turniere</span>
      <span class="fb-chevron" aria-hidden="true">${ICON_CHEVRON_RIGHT}</span>
    </button>
    ${
      activeHomeModule === 'tournaments'
        ? `
    <button class="fb fb-sub ${curModule === 'tournaments' && curTournamentView === 'dashboard' ? 'active' : ''}" onclick="switchToTournaments('dashboard')">
      <span class="fi">🏁</span>
      <span class="fn">Dashboard</span>
    </button>
    <button class="fb fb-sub ${curModule === 'tournaments' && curTournamentView === 'instances' ? 'active' : ''}" onclick="switchToTournamentInstances()">
      <span class="fi">🏆</span>
      <span class="fn">Turniere</span>
    </button>`
        : ''
    }
    <div class="sb-div"></div>
    ${
      activeHomeModule === 'feed'
        ? `
    <span class="sb-label sb-module-cat" style="padding:0 20px"><span class="sb-module-cat-icon">${ICON_COMMENT}</span>Mein Bereich</span>
    <button class="fb fb-sub ${curModule === 'feed' && curFeedView === 'mine' ? 'active' : ''}" onclick="switchToFeed('mine')">
      <span class="fi">${avatarHtml(meProfile, 20)}</span>
      <span class="fn">Meine Beiträge</span>
    </button>
    <button class="fb fb-sub ${curModule === 'feed' && curFeedView === 'mentions' ? 'active' : ''}" onclick="switchToFeed('mentions')">
      <span class="fi">@</span>
      <span class="fn">Erwähnungen</span>
    </button>
    <button class="fb fb-sub ${curModule === 'feed' && curFeedView === 'saved' ? 'active' : ''}" onclick="switchToFeed('saved')">
      <span class="fi">★</span>
      <span class="fn">Gespeichert</span>
    </button>
    <div class="sb-div"></div>`
        : activeHomeModule === 'photos'
          ? `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 20px 4px">
      <span class="sb-label sb-module-cat" style="padding:0"><span class="sb-module-cat-icon">${ICON_GRID}</span>Alben</span>
      ${
        allowAlbumCreation
          ? `<button onclick="openNewAlbumInline()" title="Neues Album" style="background:none;border:none;cursor:pointer;color:var(--accent);display:flex;align-items:center;padding:2px;border-radius:6px;transition:background .15s" onmouseover="this.style.background='var(--accent-l)'" onmouseout="this.style.background='none'">
        ${ICON_PLUS}
      </button>`
          : ''
      }
    </div>
    <div id="new-album-inline" class="hidden" style="padding:6px 10px;display:${allowAlbumCreation ? 'block' : 'none'}">
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
    <div class="sb-div"></div>`
          : ''
    }
    ${
      allMembers.length
        ? `
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
      isOwnerInCurrentGroup || isDeputyInCurrentGroup
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
      <button class="sb-profile-btn" onclick="closeSidebar();openProfileModal()">
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
  // BUGFIX Header-Button: vor jeder Auswahl in den Foto-Kontext
  // zentral aufräumen — keine Turnier-Header-Buttons stehen lassen.
  await teardownWizard();
  curModule = 'photos';
  sidebarUiState.fotosExpanded = true;
  sidebarUiState.feedExpanded = false;
  sidebarUiState.tournamentsExpanded = false;
  saveLastModuleState();
  curAlbum = null;
  curFilter = f;
  curFilterUserId = null;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}
async function switchAlbum(id) {
  await teardownWizard();
  curModule = 'photos';
  sidebarUiState.fotosExpanded = true;
  sidebarUiState.feedExpanded = false;
  sidebarUiState.tournamentsExpanded = false;
  saveLastModuleState();
  curAlbum = id;
  curFilter = null;
  curFilterUserId = null;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}
window.switchAlbum = switchAlbum;

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

function isCurrentGroupModerator() {
  if (!curGroupId) return false;
  if (me?.role === 'admin') return true;
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return false;
  if (group.createdBy === me.id) return true;
  return groupDeputies.some((d) => d.id === me.id);
}

function canManageTournamentPresetsInCurrentGroup() {
  return isCurrentGroupModerator();
}

function canDeletePhotoInCurrentGroup(photo) {
  if (!photo) return false;
  if (photo.uploaderId === me.id) return true;
  return isCurrentGroupModerator();
}

function canDeleteCommentInCurrentGroup(comment) {
  if (!comment) return false;
  if (comment.userId === me.id) return true;
  return isCurrentGroupModerator();
}

function canUpload() {
  const group = myGroups.find((g) => g.id === curGroupId);
  const uploadLockedForMembers = !!group?.uploadsRestrictedToModerators;
  if (uploadLockedForMembers && !isCurrentGroupModerator()) return false;
  if (curAlbum) return true;
  if (curFilterUserId) return false;
  return !curFilter || curFilter === 'mine';
}

function canCreateAlbum() {
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return false;
  const albumLockedForMembers = !!group.albumsRestrictedToModerators;
  if (albumLockedForMembers && !isCurrentGroupModerator()) return false;
  return true;
}

function updateUploadShortcutVisibility() {
  const btn = $('upload-shortcut-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', !canUpload());
}

function setContentMode(mode) {
  const row2 = document.querySelector('.gal-row2');
  if (row2) row2.style.display = mode === 'feed' || mode === 'tournaments' ? 'none' : '';
}

function clearModuleContentActions() {
  const albumAddBtn = document.getElementById('album-add-btn');
  if (albumAddBtn) albumAddBtn.remove();
  const albumSettingsBtn = document.getElementById('album-rename-btn');
  if (albumSettingsBtn) albumSettingsBtn.remove();
  const albumShareBtn = document.getElementById('album-share-btn');
  if (albumShareBtn) albumShareBtn.remove();
  const tournamentRefreshBtn = document.getElementById('tournament-refresh-btn');
  if (tournamentRefreshBtn) tournamentRefreshBtn.remove();
  const tournamentNewInstanceBtn = document.getElementById('tournament-new-instance-btn');
  if (tournamentNewInstanceBtn) tournamentNewInstanceBtn.remove();
}

function renderNoModuleOpenState() {
  clearModuleContentActions();
  setContentMode('none');
  hide('more-btn');
  const grid = $('grid');
  if (grid) {
    grid.innerHTML = '';
    grid.className = 'grid';
  }
  const uploadBtn = $('upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'none';
  const uploadShortcutBtn = $('upload-shortcut-btn');
  if (uploadShortcutBtn) uploadShortcutBtn.classList.add('hidden');
  const title = $('gal-title');
  if (title) title.textContent = 'Kein Modul geöffnet';

  const icon = $('empty-icon');
  const text = $('empty-text');
  const actions = $('empty-actions');
  if (icon) icon.textContent = '🧭';
  if (text) text.textContent = 'Kein Modul geöffnet. Öffne ein Modul in der Sidebar.';
  if (actions) {
    actions.innerHTML = `<p style="font-size:13px;color:var(--muted);margin-top:2px">Aktuell ist kein Modul aktiv. Klappe links „Fotos“ auf, um Inhalte anzuzeigen.</p>`;
  }
  show('empty');
}

function hasAnyOpenModule() {
  return !!(
    sidebarUiState.fotosExpanded ||
    sidebarUiState.feedExpanded ||
    sidebarUiState.tournamentsExpanded
  );
}

async function switchToFeed(view = 'all', { closeSidebarFirst = true } = {}) {
  clearFeedPostTargetState({ removeUrl: true });
  curModule = 'feed';
  curFeedView = normalizeFeedView(view);
  sidebarUiState.feedExpanded = true;
  sidebarUiState.fotosExpanded = false;
  sidebarUiState.tournamentsExpanded = false;
  saveLastModuleState();
  if (closeSidebarFirst) closeSidebar();
  renderSidebar();
  // Issue 2: Wizard zumachen, falls er noch offen war — ohne diese
  // Zeile hängt das Flag beim nächsten „Neues Turnier"-Klick.
  await teardownWizard();
  await loadFeedPosts(true);
}

async function switchToTournaments(view = 'instances', { closeSidebarFirst = true } = {}) {
  curModule = 'tournaments';
  curTournamentView = normalizeTournamentView(view);
  sidebarUiState.feedExpanded = false;
  sidebarUiState.fotosExpanded = false;
  sidebarUiState.tournamentsExpanded = true;
  saveLastModuleState();
  if (closeSidebarFirst) closeSidebar();
  renderSidebar();
  // Issue 2: Auch beim Wechsel INNERHALB des Turniermoduls (Dashboard
  // ↔ Instanzen) den Wizard zumachen, sonst zeigt der Klick auf
  // „Neues Turnier" fälschlich „Wizard ist bereits offen".
  await teardownWizard();
  await loadActiveTournamentView(true);
}

async function switchToTournamentInstances() {
  await switchToTournaments('instances');
}

/**
 * Zentraler Modul-Wechsel auf „Fotos".
 *
 * BUGFIX Header-Button: Lief der User vorher im Turniermodul und hat
 * dort auf „Neues Turnier" geklickt, blieben die Turnier-Header-Buttons
 * (über die renderTournamentHeaderActions() ans DOM gehängt wurden)
 * stehen, wenn er dann in die Foto-Ansicht wechselte. Die alte Logik
 * hatte fünf verstreute Stellen (toggleSidebarFeed/Fotos/Tournaments,
 * switchToUser, openPhotoInFotosModule), an denen curModule = 'photos'
 * gesetzt wurde — aber KEINE rief teardownWizard() auf.
 *
 * Diese Funktion ist die einzige Stelle, an der das Aufräumen passiert.
 * Wer auch immer curModule = 'photos' setzt, delegiert hierher.
 *
 * closeSidebar: false (default) — Aufrufer innerhalb einer Sidebar-Toggle
 * Logik (toggleSidebar*) wollen die Sidebar nicht schließen. Wer von
 * außerhalb kommt (z.B. ein Foto-Deep-Link), kann true übergeben.
 */
async function switchToPhotos({ closeSidebarFirst = false } = {}) {
  // Zentrales Aufräumen VOR dem Wechsel. Idempotent — wenn nichts zu
  // tun ist (kein Wizard-Mount, keine Header-Buttons), bleibt sie
  // wirkungslos. Damit ist egal, von wo aus wir kommen: feed,
  // tournaments, profil eines users, etc.
  await teardownWizard();
  curModule = 'photos';
  sidebarUiState.fotosExpanded = true;
  sidebarUiState.feedExpanded = false;
  sidebarUiState.tournamentsExpanded = false;
  saveLastModuleState();
  if (closeSidebarFirst) closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}

async function toggleSidebarFeed() {
  sidebarUiState.feedExpanded = !sidebarUiState.feedExpanded;
  if (sidebarUiState.feedExpanded) {
    await switchToFeed('all', { closeSidebarFirst: false });
    return;
  }

  if (curModule === 'feed') {
    if (sidebarUiState.fotosExpanded) {
      await switchToPhotos();
      return;
    }
    if (sidebarUiState.tournamentsExpanded) {
      await switchToTournaments('instances');
      return;
    }
    renderSidebar();
    renderNoModuleOpenState();
    return;
  }

  renderSidebar();
}

async function toggleSidebarFotos() {
  sidebarUiState.fotosExpanded = !sidebarUiState.fotosExpanded;
  if (sidebarUiState.fotosExpanded) {
    await switchToPhotos();
    return;
  }

  if (curModule === 'photos') {
    if (sidebarUiState.feedExpanded) {
      await switchToFeed('all', { closeSidebarFirst: false });
      return;
    }
    if (sidebarUiState.tournamentsExpanded) {
      await switchToTournaments('instances', { closeSidebarFirst: false });
      return;
    }
    renderSidebar();
    renderNoModuleOpenState();
    return;
  }

  if (!hasAnyOpenModule()) {
    renderSidebar();
    renderNoModuleOpenState();
    return;
  }

  renderSidebar();
}

async function toggleSidebarTournaments() {
  sidebarUiState.tournamentsExpanded = !sidebarUiState.tournamentsExpanded;
  if (sidebarUiState.tournamentsExpanded) {
    await switchToTournaments('instances', { closeSidebarFirst: false });
    return;
  }

  if (curModule === 'tournaments') {
    if (sidebarUiState.feedExpanded) {
      await switchToFeed('all', { closeSidebarFirst: false });
      return;
    }
    if (sidebarUiState.fotosExpanded) {
      await switchToPhotos();
      return;
    }
    renderSidebar();
    renderNoModuleOpenState();
    return;
  }

  if (!hasAnyOpenModule()) {
    renderSidebar();
    renderNoModuleOpenState();
    return;
  }

  renderSidebar();
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

function canShareAlbumToFeed(albumId = curAlbum) {
  if (!albumId) return false;
  const album = allAlbums.find((entry) => entry.id === albumId);
  if (!album) return false;
  if (album.createdBy === me?.id) return true;
  return (album.contributors || []).some((contributor) => contributor.id === me?.id);
}

async function switchToUser(userId) {
  // BUGFIX Header-Button: vor jedem Foto-Kontext-Wechsel zentral aufräumen.
  await teardownWizard();
  curModule = 'photos';
  sidebarUiState.fotosExpanded = true;
  sidebarUiState.feedExpanded = false;
  sidebarUiState.tournamentsExpanded = false;
  saveLastModuleState();
  curAlbum = null;
  curFilter = null;
  curFilterUserId = userId;
  closeSidebar();
  renderSidebar();
  await loadPhotos(true);
}
async function loadPhotos(reset = false) {
  if (curModule !== 'photos') return;
  if (!sidebarUiState.fotosExpanded) {
    if (!hasAnyOpenModule()) renderNoModuleOpenState();
    return;
  }
  setContentMode('photos');
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

    const albumShareBtn = document.getElementById('album-share-btn');
    if (canShareAlbumToFeed(curAlbum)) {
      if (!albumShareBtn) {
        const share = document.createElement('button');
        share.id = 'album-share-btn';
        share.className = 'btn-ghost btn';
        share.title = 'Album im Feed teilen';
        share.style.cssText =
          'padding:5px 7px;font-size:11px;display:flex;align-items:center;border:1px solid var(--border);border-radius:7px;color:var(--muted)';
        share.innerHTML = `${ICON_LINK} Teilen`;
        share.onclick = () => openShareAlbumToFeedModal(curAlbum);
        const anchor =
          document.getElementById('album-rename-btn') ||
          document.getElementById('album-add-btn') ||
          $('upload-btn');
        anchor?.after(share);
      }
    } else if (albumShareBtn) {
      albumShareBtn.remove();
    }
  } else {
    if (albumAddBtn) albumAddBtn.remove();
    const gear = document.getElementById('album-rename-btn');
    if (gear) gear.remove();
    const share = document.getElementById('album-share-btn');
    if (share) share.remove();
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
    if (err?.status === 403 && err?.serverCode === 'not_group_member') {
      toast('Du bist nicht mehr Mitglied der gewählten Gruppe.', 'error');
      try {
        const { groups } = await apiCall('/groups/my', 'GET');
        myGroups = groups || [];
      } catch (_) {
        // Kein zusätzlicher Fehlerdialog nötig.
      }

      if (myGroups.length === 0) {
        curGroupId = null;
        photos = [];
        renderGroupSwitcher();
        renderSidebar();
        renderGrid(0);
        return;
      }

      if (!myGroups.some((g) => g.id === curGroupId)) {
        curGroupId = myGroups[0].id;
        try {
          localStorage.setItem('activeGroup', curGroupId);
        } catch (_) {
          // Ignore localStorage errors
        }
        renderGroupSwitcher();
        await loadGroupMembers();
        await loadAlbums();
        renderSidebar();
        await loadPhotos(true);
        return;
      }
    }
    console.error('Fotos laden fehlgeschlagen:', err);
    renderGrid(0);
  }
}

function feedTitleByView() {
  if (curFeedView === 'mine') return 'Meine Beiträge';
  if (curFeedView === 'mentions') return 'Erwähnungen';
  if (curFeedView === 'saved') return 'Gespeicherte Beiträge';
  return 'Alle Beiträge';
}

async function loadFeedPosts(reset = false) {
  if (curModule !== 'feed') return;
  if (!sidebarUiState.feedExpanded) {
    if (!hasAnyOpenModule()) renderNoModuleOpenState();
    return;
  }

  if (curFeedView === 'all' && activeSingleFeedPost) {
    feedPosts = [];
    feedHasMore = false;
    feedSkip = 0;
    renderFeedGrid();
    focusTargetedFeedPost(false);
    return;
  }

  setContentMode('feed');
  clearModuleContentActions();
  hide('more-btn');

  if (reset) {
    feedPosts = [];
    feedSkip = 0;
    feedHasMore = false;
    feedCommentUiState = {};
    activeFeedCommentsPostId = null;
  }

  const title = $('gal-title');
  if (title) title.textContent = feedTitleByView();
  const uploadBtn = $('upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'none';
  const uploadShortcutBtn = $('upload-shortcut-btn');
  if (uploadShortcutBtn) uploadShortcutBtn.classList.add('hidden');

  const grid = $('grid');
  if (grid) {
    grid.className = 'grid';
    grid.innerHTML =
      '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }
  hide('empty');

  try {
    if (!curGroupId) {
      feedPosts = [];
      renderFeedGrid();
      return;
    }

    const pageLimit =
      reset &&
      curFeedView === 'all' &&
      pendingFeedPostId &&
      pendingFeedPostNewerCount > 0 &&
      pendingFeedPostNewerCount <= FEED_DEEP_LINK_LIST_LIMIT
        ? Math.max(FEED_PAGE_SIZE, pendingFeedPostNewerCount + 1)
        : FEED_PAGE_SIZE;

    const params = new URLSearchParams({
      groupId: curGroupId,
      view: curFeedView,
      skip: String(feedSkip),
      limit: String(pageLimit),
    });
    const data = await apiCall(`/group-feed?${params.toString()}`, 'GET');
    const batch = data.posts || [];
    feedPosts = reset ? batch : [...feedPosts, ...batch];
    feedHasMore = !!data.hasMore;
    feedSkip = feedPosts.length;
    renderFeedGrid();
    if (feedTargetedPostId) {
      const targetPostId = feedTargetedPostId;
      feedTargetedPostId = null;
      focusTargetedFeedPost(true, targetPostId);
    }
  } catch (e) {
    const icon = $('empty-icon');
    const text = $('empty-text');
    const actions = $('empty-actions');
    if (icon) icon.textContent = '⚠️';
    if (text) text.textContent = 'Feed konnte nicht geladen werden.';
    if (actions)
      actions.innerHTML =
        '<p style="font-size:13px;color:var(--muted);margin-top:2px">Bitte versuche es gleich erneut.</p>';
    show('empty');
  }
}

function renderTournamentHeaderActions() {
  const uploadBtn = $('upload-btn');
  if (!uploadBtn) return;

  const existingActionButtons = [
    'tournament-refresh-btn',
    'tournament-new-instance-btn',
  ];
  for (const id of existingActionButtons) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
  }

  const isInstancesView = normalizeTournamentView(curTournamentView) === 'instances';
  const actionButtons = isInstancesView
    ? [
        {
          id: 'tournament-refresh-btn',
          label: 'Aktualisieren',
          className: 'btn btn-ghost',
          onClick: () => loadActiveTournamentView(true),
        },
        {
          // Issue 6d (2026-08-13): normal-großer Button rechts oben statt
          // winziges Icon. Beschriftung rein beschreibend — ohne "Wizard",
          // das Wort bleibt dem gleichnamigen Issue 5 vorbehalten.
          id: 'tournament-new-instance-btn',
          label: 'Turnier erstellen',
          className: 'btn btn-primary tournament-new-instance-btn',
          onClick: openTournamentWizard,
        },
      ]
    : [];

  let anchor = uploadBtn;
  for (const item of actionButtons) {
    const btn = document.createElement('button');
    btn.id = item.id;
    btn.className = `${item.className} tournament-header-btn`;
    btn.type = 'button';
    btn.textContent = item.label;
    btn.onclick = item.onClick;
    anchor.after(btn);
    anchor = btn;
  }
}

async function loadActiveTournamentView(reset = false) {
  if (normalizeTournamentView(curTournamentView) === 'instances') {
    await loadTournamentInstances(reset);
    return;
  }
  await loadTournamentDashboard(reset);
}

async function loadTournamentDashboard(reset = false) {
  if (curModule !== 'tournaments') return;
  if (!sidebarUiState.tournamentsExpanded) {
    if (!hasAnyOpenModule()) renderNoModuleOpenState();
    return;
  }

  setContentMode('tournaments');
  clearModuleContentActions();
  renderTournamentHeaderActions();
  hasMore = false;
  hide('more-btn');
  const uploadBtn = $('upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'none';
  const uploadShortcutBtn = $('upload-shortcut-btn');
  if (uploadShortcutBtn) uploadShortcutBtn.classList.add('hidden');
  const title = $('gal-title');
  if (title) title.textContent = 'Turniere - Dashboard';

  const grid = $('grid');
  if (!grid) return;
  if (reset) {
    grid.className = 'grid tournaments-grid';
    grid.innerHTML =
      '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }
  hide('empty');

  if (!curGroupId) {
    grid.innerHTML = `
      <section class="tournament-page-shell">
        <div class="tournament-empty-state">
          <h2>Dashboard</h2>
          <p>Hier erscheint vorerst nichts.</p>
        </div>
      </section>`;
    return;
  }
  grid.innerHTML = `
    <section class="tournament-page-shell">
      <div class="tournament-empty-state">
        <h2>Dashboard</h2>
        <p>Hier erscheint vorerst nichts.</p>
      </div>
    </section>`;
}

async function loadTournamentInstances(reset = false) {
  if (curModule !== 'tournaments') return;
  if (!sidebarUiState.tournamentsExpanded) {
    if (!hasAnyOpenModule()) renderNoModuleOpenState();
    return;
  }

  setContentMode('tournaments');
  clearModuleContentActions();
  renderTournamentHeaderActions();
  hasMore = false;
  hide('more-btn');
  const uploadBtn = $('upload-btn');
  if (uploadBtn) uploadBtn.style.display = 'none';
  const uploadShortcutBtn = $('upload-shortcut-btn');
  if (uploadShortcutBtn) uploadShortcutBtn.classList.add('hidden');
  const title = $('gal-title');
  if (title) title.textContent = 'Turniere';

  const grid = $('grid');
  if (!grid) return;
  if (reset) {
    grid.className = 'grid tournaments-grid';
    grid.innerHTML =
      '<div style="grid-column:1/-1;display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }
  hide('empty');

  if (!curGroupId) {
    tournamentInstances = [];
    renderTournamentInstancesPage();
    return;
  }

  try {
    // v3: /api/tournaments/group/:groupId — flaches Array
    const instanceData = await apiCall(
      `/tournaments/group/${encodeURIComponent(curGroupId)}`,
      'GET'
    );
    tournamentInstances = Array.isArray(instanceData) ? instanceData : [];
    // Module ist aktiv — Cache-Flag setzen
    if (typeof window !== 'undefined') window.__tournamentModuleEnabled = true;

    if (activeTournamentInstance?.id) {
      const stillExists = tournamentInstances.some(
        (entry) => entry.id === activeTournamentInstance.id
      );
      if (!stillExists) activeTournamentInstance = null;
    }

    renderTournamentInstancesPage();
  } catch (e) {
    const icon = $('empty-icon');
    const text = $('empty-text');
    const actions = $('empty-actions');

    // Hinweis: Es gibt keine Modulverwaltung mehr (User-Anweisung August 2026).
    // Wenn der Backend-Call mit 403 fehlschlägt, war es vermutlich fehlende Mitgliedschaft.
    if (e?.statusCode === 403) {
      if (icon) icon.textContent = '🚫';
      if (text) text.textContent = 'Du bist nicht (mehr) Mitglied dieser Gruppe oder hast keine Berechtigung.';
      if (actions) {
        actions.innerHTML = '<p class="t-hint">Bitte einen Owner oder Deputy der Gruppe um Zugriff bitten.</p>';
      }
      show('empty');
      grid.innerHTML = '';
      return;
    }

    if (icon) icon.textContent = '⚠️';
    if (text) text.textContent = e.serverMessage || 'Turniere konnten nicht geladen werden.';
    if (actions) {
      actions.innerHTML =
        '<button class="btn" style="background:var(--accent-l);color:var(--accent);border:1px solid #dcc0a0;padding:10px 16px;border-radius:10px" onclick="loadTournamentInstances(true)">Erneut versuchen</button>';
    }
    show('empty');
    grid.innerHTML = '';
  }
}

/**
 * Hinweis: Es gibt keine Modulverwaltung mehr (User-Anweisung August 2026).
 * Die Funktion activateTournamentModule wurde entfernt — Mitglieder aller Rollen
 * sehen und nutzen das Turniermodul direkt.
 */

// tournamentStatusLabel / tournamentStatusPhase / tournamentPhaseLabel
// sind jetzt in tournament.js exportiert (v3-Mapping, Issue 6, 2026-08-13).
// Diese Zeile ist absichtlich leer — die Legacy-Funktionen sind entfernt.

function renderTournamentInstancesPage() {
  const grid = $('grid');
  if (!grid) return;

  grid.className = 'grid tournaments-grid';
  const canManageInstances = canManageTournamentPresetsInCurrentGroup();
  // v3-Phasen-Buckets in fester Reihenfolge (TOURNAMENT_PHASE_ORDER
  // aus tournament.js). Unbekannte Status landen in 'other'
  // ("Sonstige") — siehe Spec §13.5 "Keine stillen Annahmen".
  const groupedInstances = {};
  for (const phase of TOURNAMENT_PHASE_ORDER) groupedInstances[phase] = [];

  for (const instance of tournamentInstances) {
    const phase = tournamentStatusPhase(instance.status);
    groupedInstances[phase].push(instance);
  }

  const instanceGroupsHtml = Object.entries(groupedInstances)
    .map(([phase, instances]) => {
      const instanceCards = instances
        .map((instance) => {
          const matchCount = instance?._count?.matches ?? 0;
          const activeClass =
            activeTournamentInstance?.id === instance.id ? ' tournament-card-active' : '';
          // data-instance-phase und Badge zeigen die Phase (nicht den
          // rohen Status), damit Phasen-Tab-Filter und Styling auf der
          // Phase aufsetzen können, nicht auf dem v3/v2-Status.
          return `<article class="tournament-card tournament-instance-card${activeClass}" data-instance-phase="${esc(phase)}">
            <div class="tournament-card-head">
              <h3>${esc(instance.name || 'Turnier')}</h3>
              <span class="tournament-status-badge">${esc(tournamentPhaseLabel(phase))}</span>
            </div>
            <p>Matches: ${matchCount}</p>
            <div class="tournament-card-actions tournament-instance-actions">
              <button class="btn btn-ghost" onclick="openTournamentInstance('${instance.id}')">Öffnen</button>
              ${canManageInstances ? `<button class="preset-icon-btn danger" type="button" onclick="deleteTournamentInstance('${instance.id}','${esc(instance.name || 'Turnier')}')" title="Löschen" aria-label="Löschen">${ICON_TRASH}</button>` : ''}
            </div>
          </article>`;
        })
        .join('');

      return `<section class="tournament-instance-group" data-phase-group="${esc(phase)}">
        <div class="tournament-instance-group-head">
          <h2>${esc(tournamentPhaseLabel(phase))}</h2>
          <span class="tournament-meta-pill">${instances.length}</span>
        </div>
        <div class="tournament-instance-grid">
          ${instanceCards || '<p class="tournament-empty tournament-instance-empty">Keine Turniere in dieser Phase.</p>'}
        </div>
      </section>`;
    })
    .join('');

  grid.innerHTML = `
    <section class="tournament-page-shell">
      ${instanceGroupsHtml || '<div class="tournament-empty-state"><p>Noch keine Turniere vorhanden.</p></div>'}
    </section>`;
}

async function openTournamentInstance(instanceId) {
  try {
    // v3: /api/tournaments/:id — Antwort ist { tournament, teams, stages,
    // groups, matches, stats, isAdmin, public }. Wir brauchen für die
    // Detail-View das innere Tournament-DTO + die Top-Level-Listen.
    // activeTournamentInstance MUSS das innere Tournament-DTO sein, sonst
    // scheitern alle Vergleiche `activeTournamentInstance?.id ===
    // instanceId` in den Sub-Renderern (loadStandingsTab, loadScheduleTab,
    // ...). Vorher wurde die ganze Response gespeichert → .id === undefined
    // → Sub-Renderer fanden nichts.
    const res = await apiCall(
      `/tournaments/${encodeURIComponent(instanceId)}`,
      'GET'
    );
    const instance = res?.tournament ?? res;
    activeTournamentInstance = instance;
    curTournamentView = 'instances';
    saveLastModuleState();
    renderSidebar();
    // Renderer bekommt sowohl das DTO (für id/name/status/logoUrl/...)
    // als auch die Top-Level-Listen (für teams/stages/groups/matches).
    renderTournamentInstanceDetailV3({ ...instance,
      teams: Array.isArray(res?.teams) ? res.teams : (instance.teams ?? []),
      stages: Array.isArray(res?.stages) ? res.stages : (instance.stages ?? []),
      groups: Array.isArray(res?.groups) ? res.groups : (instance.groups ?? []),
      matches: Array.isArray(res?.matches) ? res.matches : (instance.matches ?? []),
      stats: res?.stats ?? instance.stats ?? null,
    });
  } catch (e) {
    toast(e.serverMessage || 'Turnier-Details konnten nicht geladen werden', 'error');
    throw e; // Issue 6: navigateToGeneratedInstance fängt diesen Throw
    // und fällt auf die Liste zurück. Vorher schluckte openTournamentInstance
    // den Fehler → Wizard-Teardown lief nie → "Wizard bleibt offen".
  }
}

/**
 * v3-Detail-View: einfacher Überblick + Tabs für Teams / Gruppen / Spielplan.
 * Spec §8-konform wird in Slice 3 zu vollständigem Layout ausgebaut.
 */
function renderTournamentInstanceDetailV3(t) {
  const grid = $('grid');
  if (!grid) return;

  const teamCount = Array.isArray(t.teams) ? t.teams.length : 0;
  const matchCount = t._count?.matches ?? 0;
  const groupsCount = Array.isArray(t.stages?.[0]?.groups) ? t.stages[0].groups.length : 0;
  const statusLabel = tournamentStatusLabel(t.status);
  const phase = tournamentStatusPhase(t.status);

  const canManage = canManageTournamentPresetsInCurrentGroup();
  const publicBadge = t.isPublic ? `<span class="t-badge t-badge-live" title="Öffentlich via Token">🔓 Public</span>` : '';
  const logoHtml = t.logoUrl
    ? `<img class="tournament-card-logo" src="${esc(t.logoUrl)}" alt="Logo" loading="lazy">`
    : '';

  const teamsHtml = (t.teams || []).map((team) =>
    `<li class="t-team-row" data-team-id="${esc(team.id)}">
      <span class="t-team-seed">${team.seed ?? '–'}</span>
      ${canManage
        ? `<input class="t-team-name-input" data-team-id="${esc(team.id)}" type="text" value="${esc(team.name)}" maxlength="80" placeholder="Teamname">`
        : `<span class="t-team-name">${esc(team.name)}</span>`}
    </li>`
  ).join('') || '<li class="t-hint">Noch keine Teams angelegt.</li>';

  // Gruppen-Tab: Zebra-Tabellen mit Qualifikations-Zonen grün/gelb
  const groupsHtml = (t.stages?.[0]?.groups || []).length > 0
    ? `<div class="t-group-grid">${(t.stages[0].groups).map((g) =>
        `<div class="t-group-card">
          <h4>Gruppe ${esc(g.key || g.name || '?')}</h4>
          <table class="t-group-table">
            <thead><tr><th>#</th><th>Team</th><th>S</th><th>U</th><th>N</th><th>TD</th><th>P</th></tr></thead>
            <tbody>${(g.memberships || []).map((m, i) => {
              const qual = i < (t.config?.advancePerGroup ?? 2);
              return `<tr class="${qual ? 't-qual-green' : (i === (t.config?.advancePerGroup ?? 2) ? 't-qual-yellow' : '')}">
                <td>${m.position ?? (i + 1)}</td>
                <td>${esc(m.team?.name || m.teamId)}</td>
                <td>–</td><td>–</td><td>–</td><td>–</td><td>–</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`).join('')}</div>`
    : '<p class="t-hint">Noch nicht generiert. Klick auf "Generate" in der Liste.</p>';

  // Bracket-Tab: aus Stufe 2 (KO) wenn vorhanden
  const koStage = (t.stages || []).find((s) => s.type === 'knockout');
  const bracketHtml = koStage
    ? `<div class="t-bracket">
        <div class="t-bracket-round">
          <h5>${esc(koStage.name || 'KO')}</h5>
          <p class="t-hint">${(koStage.matches || []).length} Spiele in dieser Phase. Klick auf ein Match für Details.</p>
        </div>
      </div>`
    : '<p class="t-hint">Noch keine KO-Phase. Bracket erscheint nach Generate + Qualifikations-Abschluss.</p>';

  // Regelwerk-Tab
  const rulesHtml = canManage
    ? `<textarea id="t-rules-text" class="t-rules-textarea" rows="10" placeholder="Regeln, Sonderwertungen, Hinweise...">${esc(t.rulesText || '')}</textarea>
       <div style="margin-top:8px"><button class="btn btn-primary" onclick="saveTournamentRules('${esc(t.id)}')">💾 Regelwerk speichern</button></div>`
    : `<pre class="t-rules-textarea" readonly>${esc(t.rulesText || '— Kein Regelwerk hinterlegt —')}</pre>`;

  grid.className = 'grid tournaments-grid';
  grid.innerHTML = `
    <article class="tournament-card tournament-instance-card tournament-instance-active" data-tournament-id="${esc(t.id)}">
      <div class="tournament-card-head">
        ${logoHtml}
        <h3>${esc(t.name || 'Turnier')}</h3>
        <div>
          <span class="tournament-status-badge">${esc(tournamentPhaseLabel(phase))}</span>
          ${publicBadge}
        </div>
      </div>
      <div class="tournament-detail-tabs">
        <div class="t-tab is-active" data-tab="overview">Übersicht</div>
        <div class="t-tab" data-tab="teams">Teams (${teamCount})</div>
        <div class="t-tab" data-tab="groups">Gruppen (${groupsCount})</div>
        <div class="t-tab" data-tab="bracket">Bracket</div>
        <div class="t-tab" data-tab="matches">Spiele (${matchCount})</div>
        <div class="t-tab" data-tab="rules">Regelwerk</div>
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="overview">
        <div class="wizard-summary-grid">
          <div class="wizard-summary-row"><span>Status</span><strong>${esc(statusLabel)}</strong></div>
          <div class="wizard-summary-row"><span>Modus</span><strong>${esc(t.mode || '-')}</strong></div>
          <div class="wizard-summary-row"><span>Teams</span><strong>${teamCount}</strong></div>
          <div class="wizard-summary-row"><span>Gruppen</span><strong>${groupsCount}</strong></div>
          <div class="wizard-summary-row"><span>Spiele</span><strong>${matchCount}</strong></div>
          ${t.startsAt ? `<div class="wizard-summary-row"><span>Beginn</span><strong>${esc(new Date(t.startsAt).toLocaleString('de-DE'))}</strong></div>` : ''}
        </div>
        <div class="tournament-card-actions" style="margin-top:16px">
          ${canManage ? `<button class="btn btn-primary" onclick="openResultEntryModal('${esc(t.id)}')">⚽ Ergebnis eintragen</button>` : ''}
          ${canManage ? `<button class="btn btn-ghost" onclick="loadStandingsTab('${esc(t.id)}')">📊 Live-Tabelle</button>` : ''}
          ${canManage ? `<button class="btn btn-ghost" onclick="loadScheduleTab('${esc(t.id)}')">📅 Spielplan</button>` : ''}
          ${canManage ? `<button class="btn btn-ghost" onclick="togglePublishV3('${esc(t.id)}', ${t.isPublic ? 'false' : 'true'})">${t.isPublic ? '🔒 Unpublish' : '🔓 Public'}</button>` : ''}
          ${canManage ? `<button class="btn btn-ghost" onclick="window.print()">🖨️ Drucken / PDF</button>` : ''}
          ${canManage ? `<a class="btn btn-ghost" href="/api/tournaments/${esc(t.id)}/export.pdf" target="_blank" rel="noopener">📄 PDF-Export</a>` : ''}
          ${canManage ? `<button class="btn btn-ghost" onclick="openTournamentBeamer('${esc(t.id)}')">📺 Beamer</button>` : ''}
          ${canManage ? `<button class="btn btn-ghost danger" onclick="deleteTournamentInstance('${esc(t.id)}','${esc(t.name)}')">${ICON_TRASH} Löschen</button>` : ''}
        </div>
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="teams" style="display:none">
        <ul class="t-team-list">${teamsHtml}</ul>
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="groups" style="display:none">
        ${groupsHtml}
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="bracket" style="display:none">
        ${bracketHtml}
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="matches" style="display:none">
        <p class="t-hint">Klick auf "Spielplan" lädt alle Spiele. Klick auf "Ergebnis eintragen" für ein einzelnes Match.</p>
      </div>
      <div class="tournament-detail-tab-body" data-tab-body="rules" style="display:none">
        ${rulesHtml}
      </div>
    </article>
  `;

  // Tab-Switching
  grid.querySelectorAll('.tournament-detail-tabs .t-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      grid.querySelectorAll('.tournament-detail-tabs .t-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const target = tab.dataset.tab;
      grid.querySelectorAll('.tournament-detail-tab-body').forEach((body) => {
        body.style.display = body.dataset.tabBody === target ? '' : 'none';
      });
      // Lazy-load tabs
      if (target === 'bracket') loadBracketTab(t.id);
      if (target === 'matches') loadScheduleTab(t.id);
    });
  });

  // Inline-Team-Rename: PATCH /tournaments/:id/teams/:teamId bei blur oder Enter
  if (canManage) {
    grid.querySelectorAll('.t-team-name-input').forEach((input) => {
      const teamId = input.dataset.teamId;
      const save = async () => {
        const newName = input.value.trim();
        if (!newName || newName === input.defaultValue) return;
        try {
          await apiCall(`/tournaments/${encodeURIComponent(t.id)}/teams/${encodeURIComponent(teamId)}`, 'PATCH', { name: newName });
          toast('Team umbenannt', 'success');
          input.defaultValue = newName;
        } catch (e) {
          toast(e.serverMessage || 'Umbenennen fehlgeschlagen', 'error');
          input.value = input.defaultValue;
        }
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = input.defaultValue; input.blur(); }
      });
    });
  }
}

/**
 * v3: Publish / Unpublish-Toggle.
 */
async function togglePublishV3(tournamentId, makePublic) {
  if (!tournamentId) return;
  try {
    const endpoint = makePublic ? 'publish' : 'unpublish';
    await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/${endpoint}`, 'POST');
    toast(makePublic ? 'Turnier veröffentlicht' : 'Öffentlich widerrufen', 'success');
    await openTournamentInstance(tournamentId);
  } catch (e) {
    toast(e.serverMessage || 'Aktion fehlgeschlagen', 'error');
  }
}

/**
 * v3: Tabelle (Standings) in das "matches"-Tab laden.
 */
async function loadStandingsTab(tournamentId) {
  if (!tournamentId) return;
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/standings`, 'GET');
    const body = document.querySelector('[data-tab-body="groups"]');
    if (!body) return;
    body.style.display = '';
    const groupsHtml = (data.groups || []).map((g) => {
      const rows = (g.standings || []).map((s, i) =>
        `<tr><td>${i + 1}.</td><td>${esc(s.teamName || s.teamId)}</td>` +
        `<td>${s.points ?? 0}</td><td>${s.wins ?? 0}</td><td>${s.draws ?? 0}</td><td>${s.losses ?? 0}</td>` +
        `<td>${s.goalDifference ?? 0}</td></tr>`
      ).join('');
      return `<h4>${esc(g.name || g.groupKey)}</h4>
        <table class="t-standings-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>S</th><th>U</th><th>N</th><th>TD</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('') || '<p class="t-hint">Noch keine Gruppenspiele absolviert.</p>';
    body.innerHTML = groupsHtml;
    // Tab umschalten
    document.querySelectorAll('.tournament-detail-tabs .t-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'groups'));
    document.querySelectorAll('.tournament-detail-tab-body').forEach((b) => {
      b.style.display = b.dataset.tabBody === 'groups' ? '' : 'none';
    });
  } catch (e) {
    toast(e.serverMessage || 'Tabelle konnte nicht geladen werden', 'error');
  }
}

/**
 * v3: Spielplan in das "matches"-Tab laden.
 */
async function loadScheduleTab(tournamentId) {
  if (!tournamentId) return;
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/schedule`, 'GET');
    const body = document.querySelector('[data-tab-body="matches"]');
    if (!body) return;
    body.style.display = '';
    const matches = data.matches || [];
    const rowsHtml = matches.map((m) =>
      `<tr>
        <td>${m.matchNumber}</td>
        <td>${esc(m.teamHome?.name || '-')}</td>
        <td>${m.scoreHome ?? '-'}</td>
        <td>:</td>
        <td>${m.scoreAway ?? '-'}</td>
        <td>${esc(m.teamAway?.name || '-')}</td>
        <td>${esc(m.status || '-')}</td>
        <td><button class="btn btn-ghost" onclick="openResultEntryModal('${esc(tournamentId)}','${esc(m.id)}')">📝</button></td>
      </tr>`
    ).join('');
    body.innerHTML = `<table class="t-schedule-table"><thead><tr><th>#</th><th>Heim</th><th></th><th></th><th></th><th>Gast</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="8" class="t-hint">Noch keine Spiele.</td></tr>'}</tbody></table>`;
    document.querySelectorAll('.tournament-detail-tabs .t-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'matches'));
    document.querySelectorAll('.tournament-detail-tab-body').forEach((b) => {
      b.style.display = b.dataset.tabBody === 'matches' ? '' : 'none';
    });
  } catch (e) {
    toast(e.serverMessage || 'Spielplan konnte nicht geladen werden', 'error');
  }
}

/**
 * v3: Bracket-Tab in das "bracket"-Tab laden.
 * Spec §8.0: 8er/16er sollen OHNE Horizontalen Scroll auf Desktop sichtbar sein.
 * Spec §6.2: Connector Lines via CSS ::after, Platzhaltertexte für TBD.
 */
async function loadBracketTab(tournamentId) {
  if (!tournamentId) return;
  const body = document.querySelector('[data-tab-body="bracket"]');
  if (!body) return;
  body.style.display = '';
  body.innerHTML = '<p class="t-hint">Lade Bracket…</p>';
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/schedule`, 'GET');
    const allMatches = data.matches || [];
    const koMatches = allMatches.filter((m) => m.bracketType === 'ko' || (m.groupId == null && m.round && m.round !== 'group'));
    if (koMatches.length === 0) {
      body.innerHTML = '<p class="t-hint">Noch keine KO-Phase. Bracket erscheint nach Generate + Qualifikations-Abschluss.</p>';
      return;
    }
    // Gruppieren nach Runde
    const byRound = new Map();
    koMatches.forEach((m) => {
      const r = m.round || 'R1';
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r).push(m);
    });
    const rounds = [...byRound.keys()].sort();
    const roundsHtml = rounds.map((r) => {
      const matches = byRound.get(r).sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));
      const matchCards = matches.map((m) => {
        const home = m.teamHome?.name || formatPlaceholder(m.placeholderHome) || 'TBD';
        const away = m.teamAway?.name || formatPlaceholder(m.placeholderAway) || 'TBD';
        const score = (m.status === 'completed' && m.scoreHome != null)
          ? `<strong>${m.scoreHome} : ${m.scoreAway}</strong>`
          : '<span class="t-hint">vs</span>';
        return `<div class="t-bracket-match${m.status === 'completed' ? ' is-completed' : ''}" data-match-id="${esc(m.id)}" onclick="openResultEntryModal('${esc(tournamentId)}','${esc(m.id)}')">
          <div class="t-bracket-match-team">${esc(home)}</div>
          <div class="t-bracket-match-score">${score}</div>
          <div class="t-bracket-match-team">${esc(away)}</div>
        </div>`;
      }).join('');
      return `<div class="t-bracket-round">
        <h5>${esc(r)}</h5>
        ${matchCards}
      </div>`;
    }).join('');
    body.innerHTML = `<div class="t-bracket">${roundsHtml}</div>`;
  } catch (e) {
    toast(e.serverMessage || 'Bracket konnte nicht geladen werden', 'error');
    body.innerHTML = '<p class="t-hint">Bracket konnte nicht geladen werden.</p>';
  }
}

/**
 * v3: Spielplan inkl. Zeitplan-Grid (Tische × Slots) in das "schedule"-Tab laden.
 * Spec §5.3: HTML5 Drag&Drop, Konflikte rot markieren, NICHT blockieren.
 */
async function loadScheduleGridTab(tournamentId) {
  if (!tournamentId) return;
  const body = document.querySelector('[data-tab-body="schedule"]');
  if (!body) return;
  body.style.display = '';
  body.innerHTML = '<p class="t-hint">Lade Zeitplan…</p>';
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/schedule`, 'GET');
    const matches = (data.matches || []).filter((m) => m.scheduledAt);
    if (matches.length === 0) {
      body.innerHTML = '<p class="t-hint">Noch keine Spiele zeitlich verplant. Klick auf "Ergebnis eintragen" oder "Auto-Planen" im Übersicht-Tab.</p>';
      return;
    }
    // Bestimme Tischanzahl (max(field) + 1)
    const maxField = matches.reduce((acc, m) => Math.max(acc, m.field || 0), 0);
    const numFields = Math.max(2, maxField + 1);
    // Gruppieren nach Slot
    const slotsSet = new Set();
    matches.forEach((m) => slotsSet.add(m.scheduledAt));
    const slots = [...slotsSet].sort();
    const grid = {};
    matches.forEach((m) => {
      const f = m.field || 0;
      const s = m.scheduledAt;
      const key = `${f}|${s}`;
      grid[key] = m;
    });
    const slotHeaders = slots.map((s) => `<th>${esc(new Date(s).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))}</th>`).join('');
    const rowsHtml = [];
    for (let f = 0; f < numFields; f++) {
      const cells = slots.map((s) => {
        const m = grid[`${f}|${s}`];
        if (!m) return '<td class="t-schedule-cell empty"></td>';
        const home = m.teamHome?.name || formatPlaceholder(m.placeholderHome) || 'TBD';
        const away = m.teamAway?.name || formatPlaceholder(m.placeholderAway) || 'TBD';
        // Konfliktprüfung: gleicher Slot, andere Heim-Mannschaft?
        const conflict = matches.some((other) =>
          other.id !== m.id &&
          other.scheduledAt === s &&
          (other.field || 0) === f &&
          other.teamHomeId && m.teamHomeId &&
          other.teamHomeId === m.teamHomeId
        );
        return `<td class="t-schedule-cell${conflict ? ' is-conflict' : ''}">
          <div class="t-schedule-match" draggable="true" data-match-id="${esc(m.id)}" data-field="${f}" data-slot="${esc(s)}">
            <span class="t-schedule-match-teams">${esc(home)} – ${esc(away)}</span>
            ${m.status === 'completed' ? `<span class="t-schedule-match-score">${m.scoreHome}:${m.scoreAway}</span>` : ''}
          </div>
        </td>`;
      }).join('');
      rowsHtml.push(`<tr><th>Tisch ${f + 1}</th>${cells}</tr>`);
    }
    body.innerHTML = `<table class="t-schedule-grid">
      <thead><tr><th></th>${slotHeaders}</tr></thead>
      <tbody>${rowsHtml.join('')}</tbody>
    </table>
    <p class="t-hint">Rote Markierung = Konflikt (gleiches Team auf gleichem Slot / Tisch). Spec §5.3: Veranstalter darf überstimmen — Konflikt wird nicht blockiert.</p>`;
    attachScheduleDragDrop();
  } catch (e) {
    toast(e.serverMessage || 'Zeitplan konnte nicht geladen werden', 'error');
    body.innerHTML = '<p class="t-hint">Zeitplan konnte nicht geladen werden.</p>';
  }
}

// ─── v3: Wizard — Delegation an tournament.js ─────────────────────────
// Etappe A (2026-08-11): v2-Wizard-Code (openTournamentWizard Body +
// renderWizardStep + parseTeamsTextarea + attachSeedListDragDrop +
// WIZARD_*-Konstanten) wurde entfernt. Die v3-Wizard-Implementierung
// lebt komplett in backend/public/script/tournament.js
// (renderWizardView, buildPatchPayload, persistConfig, buildGeneratePayload).
//
// Dieser Wrapper bleibt in main.js, weil der "Neues Turnier"-Button
// hier verdrahtet ist. Er mounted den v3-Wizard ins #grid und reicht
// onGenerate an die v3-API durch. onStateChange ruft persistConfig mit
// den geänderten Feldern auf (Draft-Auto-Save, Spec §1.2 / Schnitt 2.5).

/**
 * HTML5 Drag&Drop Handler für Zeitplan-Matches.
 * Spec §5.3: Konflikte markieren, NICHT blockieren.
 */
function attachScheduleDragDrop() {
  const matches = document.querySelectorAll('.t-schedule-match');
  let dragId = null;
  matches.forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      dragId = el.dataset.matchId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
  });
  const cells = document.querySelectorAll('.t-schedule-cell');
  cells.forEach((cell) => {
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('is-drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-target'));
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('is-drop-target');
      const matchId = e.dataTransfer.getData('text/plain') || dragId;
      if (!matchId) return;
      const row = cell.parentElement;
      const table = row?.parentElement?.parentElement;
      const fieldIndex = [...table.querySelectorAll('tbody tr')].indexOf(row);
      const slotIndex = [...row.children].indexOf(cell) - 1; // -1 für <th>
      const slotHeader = table.querySelectorAll('thead th')[slotIndex + 1];
      const slotLabel = slotHeader?.textContent || '';
      // Hole Turnier-ID aus Container — wir nehmen tournamentId vom Body-Dataset
      const tId = document.querySelector('[data-tournament-id]')?.dataset?.tournamentId
        || document.querySelector('.tournament-instance-active')?.dataset?.tournamentId;
      if (!tId) {
        toast('Turnier-Kontext fehlt — kann nicht speichern', 'error');
        return;
      }
      // Berechne scheduledAt aus Slot-Label (HH:MM)
      const [hh, mm] = slotLabel.split(':').map((n) => Number(n));
      const start = new Date();
      start.setHours(hh || 0, mm || 0, 0, 0);
      try {
        const res = await apiCall(`/tournaments/${encodeURIComponent(tId)}/matches/${encodeURIComponent(matchId)}/schedule`, 'PATCH', {
          scheduledAt: start.toISOString(),
          field: fieldIndex,
        });
        const conflictCount = (res?.conflicts || []).length;
        if (conflictCount > 0) {
          toast(`Verschoben auf Tisch ${fieldIndex + 1}, ${slotLabel} – ⚠️ ${conflictCount} Konflikt${conflictCount === 1 ? '' : 'e'} erkannt`, 'warning');
        } else {
          toast(`Verschoben auf Tisch ${fieldIndex + 1}, ${slotLabel}`, 'success');
        }
        // Re-render
        await loadScheduleGridTab(tId);
      } catch (err) {
        toast(err.serverMessage || 'Verschieben fehlgeschlagen', 'error');
      }
    });
  });
}

/**
 * v3: Regelwerk speichern.
 */
async function saveTournamentRules(tournamentId) {
  if (!tournamentId) return;
  const ta = document.getElementById('t-rules-text');
  if (!ta) return;
  try {
    await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}`, 'PATCH', { rulesText: ta.value });
    toast('Regelwerk gespeichert', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Speichern fehlgeschlagen', 'error');
  }
}

/**
 * v3: Beamer-View öffnen.
 * Spec §8.6: read-only, große Schrift, 5s auto-reload.
 */
function openTournamentBeamer(tournamentId) {
  if (!tournamentId) return;
  window.open(`/tournament/${encodeURIComponent(tournamentId)}/beamer`, `beamer-${tournamentId}`, 'noopener,noreferrer');
}

/**
 * Helper: Platzhalter-Struktur lesbar formatieren (Spec §6.3.2 z.B. "Sieger VF1")
 */
function formatPlaceholder(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (p.label) return p.label;
  if (p.fromMatch) return p.fromMatch;
  return '';
}

/**
 * v3: Modal zum Eintragen eines Ergebnisses.
 */
async function openResultEntryModal(tournamentId, matchId = null) {
  if (!tournamentId) return;
  closeTournamentDetailModalById('result-entry-modal');
  const dlg = document.createElement('div');
  dlg.id = 'result-entry-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>⚽ Ergebnis eintragen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="result-entry-form" class="tournament-detail-form">
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Match-ID <span class="t-required">*</span></span>
          <input id="re-match-id" type="text" required value="${esc(matchId || '')}" placeholder="match-cuid">
          <span class="t-hint">Match-IDs findest du im Spielplan-Tab (klick auf 📅).</span>
        </label>
        <div class="t-grid-2">
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Tore Heim</span>
            <input id="re-home" type="number" min="0" value="0">
          </label>
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Tore Gast</span>
            <input id="re-away" type="number" min="0" value="0">
          </label>
        </div>
        <div class="tournament-card-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary">💾 Ergebnis speichern</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.dataset.action === 'close') dlg.remove();
  });
  dlg.querySelector('#result-entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mId = dlg.querySelector('#re-match-id').value.trim();
    const sh = Number(dlg.querySelector('#re-home').value);
    const sa = Number(dlg.querySelector('#re-away').value);
    try {
      const result = await apiCall(
        `/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(mId)}/result`,
        'POST',
        { scoreHome: sh, scoreAway: sa }
      );
      toast(`Ergebnis gespeichert${result.cascadeAffected?.length ? ` (${result.cascadeAffected.length} Folgespiele zurückgesetzt)` : ''}`, 'success');
      dlg.remove();
      await openTournamentInstance(tournamentId);
    } catch (err) {
      toast(err.serverMessage || 'Ergebnis konnte nicht gespeichert werden', 'error');
    }
  });
}

/**
 * v3 S4.3 — Match-Detail-Panel (Spec §8.3).
 * Zeigt Match-Daten, Notizfeld, Foto-Upload, Audit-Log.
 */
async function openMatchDetailModal(tournamentId, matchId) {
  if (!tournamentId || !matchId) return;
  closeTournamentDetailModalById('match-detail-modal');
  const dlg = document.createElement('div');
  dlg.id = 'match-detail-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>📋 Match-Details</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <div id="md-body" class="tournament-detail-form">
        <p class="t-hint">Lade Match…</p>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.dataset.action === 'close') dlg.remove();
  });
  const body = dlg.querySelector('#md-body');
  try {
    const data = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}`, 'GET');
    const m = data.match || data;
    const home = m.teamHome?.name || formatPlaceholder(m.placeholderHome) || 'TBD';
    const away = m.teamAway?.name || formatPlaceholder(m.placeholderAway) || 'TBD';
    const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
    const audit = Array.isArray(meta.audit) ? meta.audit : [];
    const photos = Array.isArray(meta.photos) ? meta.photos : [];
    const auditHtml = audit.length === 0
      ? '<p class="t-hint">Noch keine Audit-Einträge.</p>'
      : `<ul class="t-match-audit">${audit.map((a) => `<li><strong>${esc(new Date(a.at).toLocaleString('de-DE'))}</strong> · ${esc(a.action)} ${a.detail ? '· ' + esc(a.detail) : ''}${a.user ? ' · ' + esc(a.user) : ''}</li>`).join('')}</ul>`;
    const photosHtml = photos.length === 0
      ? ''
      : `<div class="t-match-photos">${photos.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Match-Foto" loading="lazy"></a>`).join('')}</div>`;
    body.innerHTML = `
      <div class="t-match-card ${m.status === 'completed' ? 'is-completed' : (m.status === 'in_progress' ? 'is-live' : '')}">
        <span class="t-match-home">${esc(home)}</span>
        <span class="t-match-score">${m.scoreHome ?? '–'} : ${m.scoreAway ?? '–'}</span>
        <span class="t-match-away">${esc(away)}</span>
      </div>
      <div class="t-grid-2">
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Status</span>
          <input type="text" value="${esc(m.status || 'scheduled')}" disabled>
        </label>
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Schiedsrichter / Tisch</span>
          <input type="text" id="md-venue" value="${esc(m.venueLabel || '')}" placeholder="Tisch 1 – Schiri Max">
        </label>
      </div>
      <label class="tournament-detail-field">
        <span class="tournament-detail-label">Notiz</span>
        <textarea id="md-notes" rows="4" placeholder="Was ist passiert? Verletzungen, besondere Vorkommnisse...">${esc(meta.notes || '')}</textarea>
      </label>
      <label class="tournament-detail-field">
        <span class="tournament-detail-label">Foto(s) hochladen</span>
        <input type="file" id="md-photo" accept="image/*" multiple>
        <span class="t-hint">Max. 5 MB pro Bild. Werden in der MinIO-Bucket "tournament-assets" gespeichert.</span>
      </label>
      ${photosHtml}
      <details class="t-match-audit-details">
        <summary>📜 Audit-Log (${audit.length})</summary>
        ${auditHtml}
      </details>
      <div class="tournament-card-actions">
        <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
        <button type="button" class="btn btn-primary" id="md-save">💾 Speichern</button>
      </div>
    `;
    dlg.querySelector('#md-save').addEventListener('click', async () => {
      const notes = dlg.querySelector('#md-notes').value;
      const venue = dlg.querySelector('#md-venue').value;
      const photoFiles = dlg.querySelector('#md-photo').files;
      const newPhotos = [];
      for (const f of (photoFiles || [])) {
        if (f.size > 5 * 1024 * 1024) { toast(`Bild ${f.name} > 5MB`, 'error'); continue; }
        try {
          const up = await uploadTournamentMatchPhoto(f, tournamentId, matchId);
          newPhotos.push({ url: up.url, uploadedAt: new Date().toISOString() });
        } catch (e) {
          toast(`Upload ${f.name} fehlgeschlagen`, 'error');
        }
      }
      const mergedPhotos = [...photos, ...newPhotos];
      const newAudit = [...audit, {
        at: new Date().toISOString(),
        action: 'edit',
        detail: notes ? 'Notiz aktualisiert' : 'Felder aktualisiert',
      }];
      try {
        await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}`, 'PATCH', {
          venueLabel: venue,
          metadata: { ...meta, notes, photos: mergedPhotos, audit: newAudit },
        });
        toast('Match aktualisiert', 'success');
        dlg.remove();
        await openTournamentInstance(tournamentId);
      } catch (e) {
        toast(e.serverMessage || 'Speichern fehlgeschlagen', 'error');
      }
    });
  } catch (err) {
    body.innerHTML = `<p class="t-hint">Fehler: ${esc(err.serverMessage || err.message)}</p>`;
  }
}

/**
 * Upload eines Match-Fotos via MinIO Signed URL.
 */
async function uploadTournamentMatchPhoto(file, tournamentId, matchId) {
  // Lade Signed URL
  const sig = await apiCall(`/tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}/photo-upload`, 'POST', {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });
  if (!sig?.uploadUrl) throw new Error('Keine Upload-URL erhalten');
  const put = await fetch(sig.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload HTTP ${put.status}`);
  return { url: sig.publicUrl };
}

async function openTournamentStandings(instanceId) {
  await openTournamentInstance(instanceId);
  const standingsEl = document.getElementById('tournament-standings-section');
  if (standingsEl) standingsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteTournamentInstance(instanceId, instanceName) {
  const ok = await showConfirmDlg(
    'Turnier löschen',
    `${instanceName || 'Dieses Turnier'} wirklich löschen?`,
    'Löschen',
    'Abbrechen',
    true
  );
  if (!ok) return;

  try {
    // v3: flache Route
    await apiCall(`/tournaments/${encodeURIComponent(instanceId)}`, 'DELETE');
    if (activeTournamentInstance?.id === instanceId) activeTournamentInstance = null;
    toast('Turnier gelöscht', 'success');
    await loadTournamentInstances(true);
  } catch (e) {
    toast(e.serverMessage || 'Turnier konnte nicht gelöscht werden', 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2: Tournament UI Modals + Bracket-Visualisierung
// ──────────────────────────────────────────────────────────────────────

// Hilfsfunktion: Anzeigename für einen Teilnehmer-Slot (Match.homeParticipant etc.).
// Behandelt User-Teilnehmer, Ghost-Teilnehmer und leere Slots (TBD).
function getTournamentParticipantDisplayName(participant, instance) {
  if (!participant) return 'TBD';
  // user join (vom Backend mitgeliefert wenn vorhanden)
  if (participant.user) {
    const visible = getVisibleName(participant.user, participant.user.displayNameField);
    if (visible) return visible;
  }
  // Ghost: displayName-Snapshot
  if (participant.displayName) return participant.displayName;
  // Fallback: Team-Name (bei team/pair-Modus)
  if (participant.team?.name) return participant.team.name;
  // Letzter Fallback: ID
  return participant.id ? `Teilnehmer ${participant.id.slice(0, 6)}` : 'TBD';
}

function getTournamentInstanceParticipantById(instance, participantId) {
  if (!instance || !participantId) return null;
  return (instance.participants || []).find((entry) => entry.id === participantId) || null;
}

function getTournamentMatchDisplayNames(match, instance) {
  const home = getTournamentInstanceParticipantById(instance, match.homeParticipantId);
  const away = getTournamentInstanceParticipantById(instance, match.awayParticipantId);
  return {
    homeName: getTournamentParticipantDisplayName(home, instance),
    awayName: getTournamentParticipantDisplayName(away, instance),
  };
}

function tournamentStatusBadgeHtml(status) {
  const map = {
    planned: { label: 'Geplant', cls: 't-badge t-badge-planned' },
    in_progress: { label: 'Laufend', cls: 't-badge t-badge-live' },
    completed: { label: 'Abgeschlossen', cls: 't-badge t-badge-done' },
    void: { label: 'Ungültig', cls: 't-badge t-badge-void' },
  };
  const info = map[status] || { label: status || '-', cls: 't-badge t-badge-planned' };
  return `<span class="${info.cls}">${esc(info.label)}</span>`;
}

// ── Modal: Team anlegen ───────────────────────────────────────────────
async function openCreateTournamentTeamModal(instanceId) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  if (!instance) {
    toast('Turnier-Instanz nicht geladen', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }

  closeTournamentDetailModalById('tournament-team-modal');

  const dlg = document.createElement('div');
  dlg.id = 'tournament-team-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>Team hinzufügen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="tournament-team-form" class="tournament-detail-form">
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Teamname <span class="t-required">*</span></span>
          <input id="tt-name" type="text" maxlength="80" required placeholder="z. B. Team Nord, FC Bayern, …" autofocus>
        </label>
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Seed <span class="t-hint">(optional, 1 = Top-Seed)</span></span>
          <input id="tt-seed" type="number" min="1" step="1" placeholder="z. B. 1, 2, 3, …">
          <span class="t-hint">Wird vom Bracket-Generator für die Setzliste verwendet. Leer = unsortiert.</span>
        </label>
        <div class="tournament-detail-checkbox-row">
          <input id="tt-ghost" type="checkbox" checked>
          <label for="tt-ghost">Teilnehmer sofort als Ghost anlegen (kein User nötig)</label>
        </div>
        <p class="t-hint">Im Team-Modus bekommt jedes Team einen Teilnehmer-Slot. Mit Ghost kannst du Teams anlegen, ohne dass schon ein User zugeordnet ist.</p>
        <div id="tournament-team-msg" class="msg hidden"></div>
        <div class="tournament-detail-dlg-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary" id="tournament-team-submit">Anlegen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('#tournament-team-form');
  const msg = dlg.querySelector('#tournament-team-msg');
  const submitBtn = dlg.querySelector('#tournament-team-submit');
  const nameInput = dlg.querySelector('#tt-name');

  function close() {
    dlg.remove();
  }
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) close();
    if (event.target?.dataset?.action === 'close') close();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const seedRaw = dlg.querySelector('#tt-seed').value.trim();
    const seed = seedRaw ? Number(seedRaw) : null;
    if (!name) {
      msg.textContent = 'Teamname ist erforderlich';
      msg.classList.remove('hidden');
      msg.className = 'msg msg-error';
      return;
    }
    if (seedRaw && (!Number.isInteger(seed) || seed < 1)) {
      msg.textContent = 'Seed muss eine positive ganze Zahl sein';
      msg.classList.remove('hidden');
      msg.className = 'msg msg-error';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird angelegt…';
    try {
      const { team } = await apiCall(
        `/tournaments/instances/${encodeURIComponent(instanceId)}/teams`,
        'POST',
        { name, seed }
      );
      // Optional: Ghost-Teilnehmer direkt mit anlegen
      if (dlg.querySelector('#tt-ghost')?.checked) {
        try {
          await apiCall(
            `/tournaments/instances/${encodeURIComponent(instanceId)}/participants`,
            'POST',
            { teamId: team.id, displayName: team.name, seed }
          );
        } catch (ghostErr) {
          // Ghost-Fehler ist nicht kritisch (Team ist da)
          console.warn('Ghost-Teilnehmer konnte nicht angelegt werden', ghostErr);
        }
      }
      toast('Team angelegt', 'success');
      close();
      await openTournamentInstance(instanceId);
      await loadActiveTournamentView(false);
    } catch (e) {
      msg.textContent = e.serverMessage || 'Team konnte nicht angelegt werden';
      msg.classList.remove('hidden');
      msg.className = 'msg msg-error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anlegen';
    }
  });

  nameInput?.focus();
}

// ── Modal: Teilnehmer hinzufügen (Ghost oder User) ─────────────────────
async function openAddTournamentParticipantModal(instanceId, options = {}) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  if (!instance) {
    toast('Turnier-Instanz nicht geladen', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }
  const mode = instance?.preset?.participantMode || 'team';
  const initialMode = options.prefillUserId ? 'user' : 'ghost';

  closeTournamentDetailModalById('tournament-add-participant-modal');

  // Team-Dropdown (für team/pair-Modus)
  const teamOptions = (instance.teams || [])
    .map(
      (t) =>
        `<option value="${esc(t.id)}">${esc(t.name)}${t.seed ? ` · Seed ${t.seed}` : ''}</option>`
    )
    .join('');

  // User-Dropdown: Gruppenmitglieder, die noch NICHT Teilnehmer sind
  const takenUserIds = new Set((instance.participants || []).map((p) => p.userId).filter(Boolean));
  const memberOptions = (groupMembers || [])
    .map((m) => m?.user || m)
    .filter((u) => u?.id && !takenUserIds.has(u.id))
    .map((u) => {
      const name = getVisibleName(u, u.displayNameField) || u.name || u.username || u.email;
      return `<option value="${esc(u.id)}">${esc(name)} (${esc(u.username || u.email || '')})</option>`;
    })
    .join('');

  const dlg = document.createElement('div');
  dlg.id = 'tournament-add-participant-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>Teilnehmer hinzufügen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="tournament-add-participant-form" class="tournament-detail-form">
        <div class="tournament-detail-tab-row" role="tablist">
          <button type="button" class="t-tab ${initialMode === 'ghost' ? 'active' : ''}" data-mode="ghost" role="tab">👻 Ghost (kein User)</button>
          ${mode !== 'team' || memberOptions ? `<button type="button" class="t-tab ${initialMode === 'user' ? 'active' : ''}" data-mode="user" role="tab">👤 User zuordnen</button>` : ''}
        </div>
        <div class="tournament-detail-tab-panel ${initialMode !== 'ghost' ? 'hidden' : ''}" data-panel="ghost">
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Anzeigename <span class="t-required">*</span></span>
            <input id="tad-displayName" type="text" maxlength="80" required placeholder="z. B. Team A, Spieler 7, …">
            <span class="t-hint">Erscheint im Bracket und in den Standings, bis ein User zugeordnet wird.</span>
          </label>
          ${
            mode !== 'individual'
              ? `
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Team <span class="t-required">*</span></span>
            <select id="tad-teamId" required>
              <option value="">— Bitte wählen —</option>
              ${teamOptions}
            </select>
          </label>`
              : ''
          }
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Seed <span class="t-hint">(optional)</span></span>
            <input id="tad-seed" type="number" min="1" step="1" placeholder="z. B. 1, 2, 3, …">
          </label>
        </div>
        <div class="tournament-detail-tab-panel ${initialMode === 'ghost' ? 'hidden' : ''}" data-panel="user">
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Gruppenmitglied <span class="t-required">*</span></span>
            <select id="tad-userId" required>
              <option value="">— Bitte wählen —</option>
              ${memberOptions}
            </select>
            <span class="t-hint">Nur Mitglieder, die noch nicht Teilnehmer dieses Turniers sind.</span>
          </label>
          ${
            mode !== 'individual'
              ? `
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Team ${mode !== 'individual' ? '<span class="t-required">*</span>' : '<span class="t-hint">(optional)</span>'}</span>
            <select id="tad-teamId-user" ${mode !== 'individual' ? 'required' : ''}>
              <option value="">${mode !== 'individual' ? '— Bitte wählen —' : '— Kein Team —'}</option>
              ${teamOptions}
            </select>
            ${mode !== 'individual' ? '<span class="t-hint">Im Team-Modus ist ein Team Pflicht.</span>' : ''}
          </label>`
              : ''
          }
        </div>
        <div id="tournament-add-participant-msg" class="msg hidden"></div>
        <div class="tournament-detail-dlg-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary" id="tournament-add-participant-submit">Hinzufügen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('#tournament-add-participant-form');
  const msg = dlg.querySelector('#tournament-add-participant-msg');
  const submitBtn = dlg.querySelector('#tournament-add-participant-submit');

  // Tab-Logik
  dlg.querySelectorAll('.t-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const targetMode = tabBtn.dataset.mode;
      dlg.querySelectorAll('.t-tab').forEach((b) => b.classList.toggle('active', b === tabBtn));
      dlg.querySelectorAll('.tournament-detail-tab-panel').forEach((p) => {
        p.classList.toggle('hidden', p.dataset.panel !== targetMode);
      });
    });
  });

  // Prefill: vorausgewählten User setzen (für "Teilnehmer aus Gruppe hinzufügen")
  if (options.prefillUserId) {
    const sel = dlg.querySelector('#tad-userId');
    if (sel) sel.value = options.prefillUserId;
  }

  function close() {
    dlg.remove();
  }
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) close();
    if (event.target?.dataset?.action === 'close') close();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const activeMode = dlg.querySelector('.t-tab.active')?.dataset.mode || 'ghost';
    const body = {};
    if (activeMode === 'ghost') {
      body.displayName = dlg.querySelector('#tad-displayName').value.trim();
      const teamId = dlg.querySelector('#tad-teamId')?.value;
      if (teamId) body.teamId = teamId;
      const seedRaw = dlg.querySelector('#tad-seed').value.trim();
      if (seedRaw) body.seed = Number(seedRaw);
    } else {
      body.userId = dlg.querySelector('#tad-userId').value;
      const teamId = dlg.querySelector('#tad-teamId-user')?.value;
      if (teamId) body.teamId = teamId;
    }
    if (!body.displayName && !body.userId) {
      msg.textContent = 'Entweder Anzeigename oder User erforderlich';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird hinzugefügt…';
    try {
      await apiCall(
        `/tournaments/instances/${encodeURIComponent(instanceId)}/participants`,
        'POST',
        body
      );
      toast('Teilnehmer hinzugefügt', 'success');
      close();
      await openTournamentInstance(instanceId);
      await loadActiveTournamentView(false);
    } catch (e) {
      msg.textContent = e.serverMessage || 'Teilnehmer konnte nicht hinzugefügt werden';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Hinzufügen';
    }
  });
}

// ── Modal: Ghost-Teilnehmer nachträglich User zuordnen ───────────────
async function openAssignUserToParticipantModal(instanceId, participantId) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  const participant = getTournamentInstanceParticipantById(instance, participantId);
  if (!participant) {
    toast('Teilnehmer nicht gefunden', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }

  const takenUserIds = new Set((instance.participants || []).map((p) => p.userId).filter(Boolean));
  const memberOptions = (groupMembers || [])
    .map((m) => m?.user || m)
    .filter((u) => u?.id && !takenUserIds.has(u.id))
    .map((u) => {
      const name = getVisibleName(u, u.displayNameField) || u.name || u.username || u.email;
      return `<option value="${esc(u.id)}">${esc(name)} (${esc(u.username || u.email || '')})</option>`;
    })
    .join('');

  closeTournamentDetailModalById('tournament-assign-modal');

  const dlg = document.createElement('div');
  dlg.id = 'tournament-assign-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>User zuordnen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="tournament-assign-form" class="tournament-detail-form">
        <p class="t-hint">Aktueller Slot: <strong>${esc(participant.displayName || '(leer)')}</strong>
          ${participant.team?.name ? ` · Team ${esc(participant.team.name)}` : ''}</p>
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Gruppenmitglied <span class="t-required">*</span></span>
          <select id="tas-userId" required>
            <option value="">— Bitte wählen —</option>
            ${memberOptions}
          </select>
        </label>
        <div id="tournament-assign-msg" class="msg hidden"></div>
        <div class="tournament-detail-dlg-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Zuordnen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('#tournament-assign-form');
  const msg = dlg.querySelector('#tournament-assign-msg');
  function close() {
    dlg.remove();
  }
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) close();
    if (event.target?.dataset?.action === 'close') close();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = dlg.querySelector('#tas-userId').value;
    if (!userId) {
      msg.textContent = 'Bitte ein Mitglied auswählen';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      return;
    }
    try {
      await apiCall(
        `/tournaments/instances/${encodeURIComponent(instanceId)}/participants/${encodeURIComponent(participantId)}`,
        'PATCH',
        { op: 'assign_user', userId }
      );
      toast('User zugeordnet', 'success');
      close();
      await openTournamentInstance(instanceId);
    } catch (e) {
      msg.textContent = e.serverMessage || 'Zuordnung fehlgeschlagen';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
    }
  });
}

// ── Modal: Match anlegen (mit Dropdowns) ─────────────────────────────
async function openCreateTournamentMatchModal(instanceId) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  if (!instance) {
    toast('Turnier-Instanz nicht geladen', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }
  const participants = instance.participants || [];
  if (participants.length < 2) {
    toast('Mindestens zwei Teilnehmer erforderlich', 'error');
    return;
  }
  const rounds = (instance.rounds || []).slice().sort((a, b) => a.roundNumber - b.roundNumber);
  const roundOptions = rounds
    .map((r) => `<option value="${esc(r.id)}">Runde ${r.roundNumber} · ${esc(r.name)}</option>`)
    .join('');

  const nextMatchNumber = (instance.matches?.length || 0) + 1;
  const participantOptions = participants
    .map((p) => {
      const name = getTournamentParticipantDisplayName(p, instance);
      const seedTag = p.seed ? ` · Seed ${p.seed}` : '';
      const ghostTag = !p.userId ? ' · 👻' : '';
      return `<option value="${esc(p.id)}">${esc(name)}${seedTag}${ghostTag}</option>`;
    })
    .join('');

  closeTournamentDetailModalById('tournament-match-create-modal');

  const dlg = document.createElement('div');
  dlg.id = 'tournament-match-create-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>Match hinzufügen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="tournament-match-create-form" class="tournament-detail-form">
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Runde <span class="t-hint">(optional)</span></span>
          <select id="tmc-roundId">
            <option value="">— Keine spezifische Runde —</option>
            ${roundOptions}
          </select>
        </label>
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Match-Nummer <span class="t-required">*</span></span>
          <input id="tmc-matchNumber" type="number" min="1" step="1" required value="${nextMatchNumber}">
        </label>
        <div class="t-grid-2">
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Heim <span class="t-hint">(optional, leer = TBD)</span></span>
            <select id="tmc-home">
              <option value="">— TBD —</option>
              ${participantOptions}
            </select>
          </label>
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Gast <span class="t-hint">(optional, leer = TBD)</span></span>
            <select id="tmc-away">
              <option value="">— TBD —</option>
              ${participantOptions}
            </select>
          </label>
        </div>
        <label class="tournament-detail-field">
          <span class="tournament-detail-label">Venue / Tisch <span class="t-hint">(optional)</span></span>
          <input id="tmc-venue" type="text" maxlength="80" placeholder="z. B. Tisch 1, Feld A, …">
        </label>
        <div id="tournament-match-create-msg" class="msg hidden"></div>
        <div class="tournament-detail-dlg-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Anlegen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('#tournament-match-create-form');
  const msg = dlg.querySelector('#tournament-match-create-msg');
  function close() {
    dlg.remove();
  }
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) close();
    if (event.target?.dataset?.action === 'close') close();
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const matchNumber = Number(dlg.querySelector('#tmc-matchNumber').value);
    if (!Number.isInteger(matchNumber) || matchNumber < 1) {
      msg.textContent = 'Match-Nummer muss eine positive ganze Zahl sein';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      return;
    }
    const body = {
      matchNumber,
      status: 'planned',
    };
    const roundId = dlg.querySelector('#tmc-roundId').value;
    if (roundId) body.roundId = roundId;
    const home = dlg.querySelector('#tmc-home').value;
    const away = dlg.querySelector('#tmc-away').value;
    if (home) body.homeParticipantId = home;
    if (away) body.awayParticipantId = away;
    const venue = dlg.querySelector('#tmc-venue').value.trim();
    if (venue) body.venueLabel = venue;
    try {
      await apiCall(
        `/tournaments/instances/${encodeURIComponent(instanceId)}/matches`,
        'POST',
        body
      );
      toast('Match angelegt', 'success');
      close();
      await openTournamentInstance(instanceId);
    } catch (e) {
      msg.textContent = e.serverMessage || 'Match konnte nicht angelegt werden';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
    }
  });
}

// ── Modal: Match-Ergebnis eintragen ─────────────────────────────────
async function openRecordMatchResultModal(instanceId, matchId) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  const match = (instance?.matches || []).find((m) => m.id === matchId);
  if (!instance || !match) {
    toast('Match nicht gefunden', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }
  if (!match.homeParticipantId || !match.awayParticipantId) {
    toast('Match hat keine vollständige Teilnehmerzuordnung', 'error');
    return;
  }

  const home = getTournamentInstanceParticipantById(instance, match.homeParticipantId);
  const away = getTournamentInstanceParticipantById(instance, match.awayParticipantId);
  const homeName = getTournamentParticipantDisplayName(home, instance);
  const awayName = getTournamentParticipantDisplayName(away, instance);

  closeTournamentDetailModalById('tournament-match-result-modal');

  const dlg = document.createElement('div');
  dlg.id = 'tournament-match-result-modal';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg tournament-detail-dlg" role="dialog" aria-modal="true">
      <div class="tournament-detail-dlg-head">
        <h3>Ergebnis eintragen</h3>
        <button type="button" class="modal-x" data-action="close">✕</button>
      </div>
      <form id="tournament-match-result-form" class="tournament-detail-form">
        <div class="t-result-header">
          <div class="t-result-side">
            <span class="t-hint">Heim</span>
            <strong>${esc(homeName)}</strong>
          </div>
          <div class="t-result-vs">vs</div>
          <div class="t-result-side t-result-side-right">
            <span class="t-hint">Gast</span>
            <strong>${esc(awayName)}</strong>
          </div>
        </div>
        <div class="t-grid-2">
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Score Heim <span class="t-required">*</span></span>
            <input id="tmr-home" type="number" step="1" required value="0">
          </label>
          <label class="tournament-detail-field">
            <span class="tournament-detail-label">Score Gast <span class="t-required">*</span></span>
            <input id="tmr-away" type="number" step="1" required value="0">
          </label>
        </div>
        <div class="tournament-detail-checkbox-row">
          <input id="tmr-draw" type="checkbox">
          <label for="tmr-draw">Unentschieden (kein Sieger)</label>
        </div>
        <div class="t-hint" id="tmr-winner-preview">
          <span>Sieger: <strong>${esc(homeName)}</strong> (anhand der Scores)</span>
        </div>
        <div id="tournament-match-result-msg" class="msg hidden"></div>
        <div class="tournament-detail-dlg-actions">
          <button type="button" class="btn btn-ghost" data-action="close">Abbrechen</button>
          <button type="submit" class="btn btn-primary">Speichern</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('#tournament-match-result-form');
  const msg = dlg.querySelector('#tournament-match-result-msg');
  const homeInput = dlg.querySelector('#tmr-home');
  const awayInput = dlg.querySelector('#tmr-away');
  const drawCheckbox = dlg.querySelector('#tmr-draw');
  const previewEl = dlg.querySelector('#tmr-winner-preview');

  function updatePreview() {
    const hs = Number(homeInput.value);
    const as = Number(awayInput.value);
    if (drawCheckbox.checked) {
      previewEl.innerHTML = `<span>Unentschieden – kein Auto-Advance ins nächste Match.</span>`;
      return;
    }
    if (!Number.isFinite(hs) || !Number.isFinite(as)) {
      previewEl.innerHTML = `<span class="t-hint">Bitte gültige Zahlen eingeben.</span>`;
      return;
    }
    if (hs === as) {
      previewEl.innerHTML = `<span>Scores sind gleich – bitte "Unentschieden" anhaken oder einen Sieger festlegen.</span>`;
      return;
    }
    const winner = hs > as ? homeName : awayName;
    previewEl.innerHTML = `<span>Sieger: <strong>${esc(winner)}</strong> → wird ins nächste Match eingetragen (Auto-Advance)</span>`;
  }
  homeInput.addEventListener('input', updatePreview);
  awayInput.addEventListener('input', updatePreview);
  drawCheckbox.addEventListener('change', updatePreview);

  function close() {
    dlg.remove();
  }
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) close();
    if (event.target?.dataset?.action === 'close') close();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const homeScore = Number(homeInput.value);
    const awayScore = Number(awayInput.value);
    const isDraw = drawCheckbox.checked;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      msg.textContent = 'Scores müssen Zahlen sein';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      return;
    }
    if (!isDraw && homeScore === awayScore) {
      msg.textContent = 'Bei Gleichstand bitte "Unentschieden" anhaken';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
      return;
    }
    const winnerParticipantId = isDraw
      ? null
      : homeScore > awayScore
        ? match.homeParticipantId
        : match.awayParticipantId;
    try {
      const result = await apiCall(
        `/tournaments/instances/${encodeURIComponent(instanceId)}/matches/${encodeURIComponent(matchId)}/result`,
        'PATCH',
        {
          isDraw,
          winnerParticipantId,
          results: [
            {
              participantId: match.homeParticipantId,
              score: homeScore,
              outcome: isDraw ? 'draw' : homeScore > awayScore ? 'win' : 'loss',
            },
            {
              participantId: match.awayParticipantId,
              score: awayScore,
              outcome: isDraw ? 'draw' : awayScore > homeScore ? 'win' : 'loss',
            },
          ],
        }
      );
      toast('Ergebnis gespeichert', 'success');
      close();

      // Phase 4: Cascade-Warnung anzeigen, falls downstream-Matches betroffen sind
      if (result?.cascadeWarning && result.cascadeWarning.count > 0) {
        const affectedList = result.cascadeWarning.affected
          .map((a) => `<li>Match #${a.matchNumber}</li>`)
          .join('');
        const ok = await showConfirmDlg(
          'Cascade-Warnung',
          `<div class="t-cascade-warn-body">${result.cascadeWarning.count} nachgelagerte${result.cascadeWarning.count === 1 ? 's' : ''} Match${result.cascadeWarning.count === 1 ? '' : 'es'} hat${result.cascadeWarning.count === 1 ? '' : 'ten'} bereits ein Ergebnis und basiert auf diesem Match.<br>Möchtest du diese zurücksetzen?<ul class="t-cascade-warn-list">${affectedList}</ul></div>`,
          'Zurücksetzen',
          'Beibehalten',
          true
        );
        if (ok) {
          try {
            await apiCall(
              `/tournaments/instances/${encodeURIComponent(instanceId)}/matches/${encodeURIComponent(matchId)}/cascade-reset`,
              'POST'
            );
            toast(`${result.cascadeWarning.count} downstream Matches zurückgesetzt`, 'success');
          } catch (cascadeErr) {
            toast('Cascade-Reset fehlgeschlagen', 'error');
          }
        }
      }

      await openTournamentInstance(instanceId);
    } catch (e) {
      msg.textContent = e.serverMessage || 'Ergebnis konnte nicht gespeichert werden';
      msg.className = 'msg msg-error';
      msg.classList.remove('hidden');
    }
  });
}

// ── Confirm + Bracket generieren ─────────────────────────────────────
async function generateTournamentBracket(instanceId) {
  const instance = activeTournamentInstance?.id === instanceId ? activeTournamentInstance : null;
  if (!instance) {
    toast('Turnier-Instanz nicht geladen', 'error');
    return;
  }
  if (!canManageTournamentPresetsInCurrentGroup()) {
    toast('Keine Berechtigung', 'error');
    return;
  }
  const participantCount = (instance.participants || []).length;
  const matchCount = (instance.matches || []).length;
  const hasUncompleted = (instance.matches || []).some(
    (m) => m.status !== 'completed' && m.status !== 'void'
  );

  let warning = '';
  if (hasUncompleted) {
    warning = `\n\n⚠️ Es gibt bereits nicht abgeschlossene Matches (${matchCount} insgesamt). Diese werden ersetzt.`;
  }

  const ok = await showConfirmDlg(
    'Bracket generieren',
    `Bracket für "${instance.name}" mit ${participantCount} Teilnehmern bauen?${warning}`,
    'Generieren',
    'Abbrechen',
    true
  );
  if (!ok) return;

  try {
    const result = await apiCall(
      `/tournaments/instances/${encodeURIComponent(instanceId)}/bracket/generate`,
      'POST',
      {}
    );
    if (result?.generated) {
      const { matches, byesApplied, stageType } = result.generated;
      const byeNote = byesApplied > 0 ? ` · ${byesApplied} BYE${byesApplied === 1 ? '' : 's'}` : '';
      toast(`Bracket gebaut: ${matches} Matches (${stageType})${byeNote}`, 'success');
    } else {
      toast('Bracket generiert', 'success');
    }
    await openTournamentInstance(instanceId);
    await loadActiveTournamentView(false);
  } catch (e) {
    toast(e.serverMessage || 'Bracket konnte nicht generiert werden', 'error');
  }
}

// Helper: Modal anhand ID schließen (idempotent)
function closeTournamentDetailModalById(id) {
  document.getElementById(id)?.remove();
}

// ─── v3-Wizard-Wrapper (delegiert an tournament.js) ─────────────────
// Etappe A: openTournamentWizard ist jetzt nur noch ein Mount-Punkt für
// renderWizardView. Step-Renderer, Validierung, PATCH-Persistenz und
// Generate-Logik leben in tournament.js (buildPatchPayload, persistConfig,
// buildGeneratePayload). Hier nur:
//
//   1. Initial-State mit curGroupId aufsetzen.
//   2. #grid auf Wizard-Host umschalten (überschreibt das Foto-Grid,
//      damit der Wizard nicht in eine 260px-Spalte gezwängt wird).
//   3. Galerie-Header-Buttons (Aktualisieren / Neues Turnier) ausblenden,
//      damit man nicht versehentlich einen zweiten Wizard öffnen kann.
//   4. renderWizardView ins #grid mounten.
//   5. onStateChange → persistConfig mit changedFields (Draft-Auto-Save).
//   6. onGenerate → POST /api/tournaments/:id/generate mit buildGeneratePayload.
//   7. onCancel → #grid + Header-Buttons zurück, Listenansicht neu laden.
const WIZARD_HOST_CLASS = 't-wizard-host';
const WIZARD_HIDDEN_HEADER_BUTTONS = [
  'tournament-refresh-btn',
  'tournament-new-instance-btn',
];

function hideTournamentHeaderButtons() {
  // Buttons werden komplett entfernt statt nur display:none zu setzen.
  // Hintergrund: in der Vorgänger-Version waren die Buttons trotz
  // display:none noch als brauner Balken sichtbar — entweder durch
  // CSS-Spezifität aus einer später geladenen Regel oder durch
  // Pseudo-Elemente mit background. remove() räumt beide Risiken ab.
  // Beim Schließen ruft loadActiveTournamentView() ohnehin
  // renderTournamentHeaderActions() auf, das die Buttons neu baut.
  for (const id of WIZARD_HIDDEN_HEADER_BUTTONS) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}

function showTournamentHeaderButtons() {
  // Buttons werden NICHT wiederhergestellt — sie werden durch
  // loadActiveTournamentView() ohnehin über renderTournamentHeaderActions()
  // neu gebaut. Diese Funktion bleibt nur als API-Stub, falls ein
  // späterer Aufrufer sie vor loadActiveTournamentView() braucht.
  for (const id of WIZARD_HIDDEN_HEADER_BUTTONS) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}

async function openTournamentWizard() {
  if (!curGroupId) {
    toast('Keine aktive Gruppe ausgewählt', 'error');
    return;
  }

  // Falls der Wizard schon offen ist: nicht doppelt mounten.
  if (wizardMounted) {
    toast('Wizard ist bereits offen', 'info');
    return;
  }

  closeTournamentDetailModalById('tournament-wizard-modal');

  const initialState = {
    // step wird mit Absicht NICHT gesetzt. DEFAULT_WIZARD_STATE.step
    // (in tournament.js) ist 1, und renderWizardView korrigiert in
    // jeden Fall einen ungültigen Wert. Wenn wir hier 'step: 1'
    // setzen würden, könnte ein späterer Bug im Wrapper den Wizard
    // wieder bei Schritt 0 starten lassen — und kein Entwurf würde
    // angelegt. Daher: nur die Daten, nicht die Schritt-Nummer.
    groupId: curGroupId,
    tournamentId: null,
    name: '',
    date: new Date().toISOString().slice(0, 10),
    location: '',
    sport: 'becher',
    teams: [],
    mode: 'groups_ko',
    numGroups: 2,
    distributionMethod: 'snake',
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],
    advancePerGroup: 2,
    bestThirdsCount: 0,
    thirdPlaceMatch: false,
    numTables: 1,
    tableNames: [],
    startTime: '10:00',
    matchDuration: 30,
    pauseMinutes: 0,
  };

  const prevStep = { value: -1 };
  // Step-Keys spiegeln tournament.js: 1=Grunddaten, 2=Teams,
  // 3=Modus, 4=Qualifikation, 5=Zusammenfassung. Pro Step-Wechsel
  // senden wir die Felder, die dort erfasst werden, per PATCH ans
  // Backend (Draft-Auto-Save, Spec §1.2).
  const knownFieldsByStep = {
    1: ['name', 'date', 'location', 'sport', 'numTables', 'tableNames'],
    2: ['teams'],
    3: ['mode', 'numGroups', 'distributionMethod', 'pointsWin', 'pointsDraw', 'pointsLoss', 'tiebreakers'],
    4: ['advancePerGroup', 'bestThirdsCount', 'thirdPlaceMatch'],
    5: ['startTime', 'matchDuration', 'pauseMinutes'],
  };

  const onStateChange = async (state) => {
    if (!state.tournamentId) return;
    const stepIdx = Number(state.step) || 1;
    const prev = prevStep.value;
    if (prev === stepIdx) return;
    prevStep.value = stepIdx;

    // Beim Verlassen von Step 2 (Teams): Teams inkrementell zum Server
    // syncen. Vorher wurden nur Config/meta gepatcht, nicht die Teams
    // selbst — POST /generate brach dann mit "Mindestens 2 Teams
    // erforderlich" ab, obwohl der User Teams eingetragen hatte.
    // Ursache war: Wizard baute state.teams auf, sendete sie aber NIE.
    if (prev === 2) {
      try {
        const sync = await syncTeamsToBackend(state);
        if (!sync.ok) {
          console.warn('[wizard] syncTeamsToBackend failed:', sync);
        } else if (sync.added > 0 || sync.removed > 0) {
          console.info(
            `[wizard] teams synced: +${sync.added} / -${sync.removed} (total ${sync.teamCount})`
          );
        }
      } catch (err) {
        console.warn('[wizard] syncTeamsToBackend threw', err);
      }
    }

    const fields = knownFieldsByStep[stepIdx] || [];
    if (fields.length === 0) return;
    try {
      await persistConfig(state, { changedFields: fields });
    } catch (err) {
      console.warn('[wizard] persistConfig failed', err);
    }
  };

  const onGenerate = async (state, opts) => {
    // Wenn noch keine tournamentId da ist (z. B. weil der POST in
    // Step 1 fehlgeschlagen war und der User trotzdem durchgeklickt
    // hat), versuchen wir genau EINMAL, den Entwurf nachzureichen.
    // ensureDraftPromise ist single-flight + idempotent: legt nur an,
    // wenn noch keine ID existiert.
    if (!state.tournamentId && curGroupId) {
      const retry = await ensureDraftPromise(state, { groupId: curGroupId });
      if (!state.tournamentId) {
        // Auch der Retry hat nicht gereicht — jetzt erst blockieren.
        console.error(
          '[wizard] onGenerate: state.tournamentId fehlt nach Retry.\n' +
          '  state.groupId =', state.groupId, '\n' +
          '  opts.groupId (im Wizard) wurde übergeben =', !!curGroupId, '\n' +
          '  state.__draftError =', state.__draftError || '(leer)', '\n' +
          '  → Wahrscheinlichste Ursache: keine Berechtigung oder Server nicht erreichbar.'
        );
        return {
          ok: false,
          body: {
            error: 'draft_missing',
            message:
              'Der Turnier-Entwurf konnte nicht in der Datenbank angelegt werden. ' +
              (state.__draftError
                ? `Ursache: ${state.__draftError} `
                : '') +
              'Bitte lade die Seite neu (Strg+F5) und versuche es erneut. ' +
              'Falls der Fehler bleibt, prüfe die Browser-Konsole auf rote Fehlerzeilen.',
          },
        };
      }
    }

    // Hier ist die letzte Verteidigungslinie: ohne tournamentId geht
    // der Generate-Aufruf wirklich nicht. Mock-Modus / leerer Pfad.
    if (!state.tournamentId) {
      return {
        ok: false,
        body: {
          error: 'draft_missing',
          message:
            'Der Turnier-Entwurf fehlt — das passiert nur, wenn keine Gruppe aktiv ist. ' +
            'Bitte wechsle in eine Gruppe und versuche es erneut.',
        },
      };
    }

    const payload = buildGeneratePayload(state, opts);

    // Letzte Verteidigungslinie: einmal Teams syncen, BEVOR wir
    // /generate aufrufen. Falls onStateChange (z. B. durch schnelles
    // Durchklicken) nicht gelaufen ist, holen wir das hier nach.
    // syncTeamsToBackend ist idempotent (Server skippt Duplikate),
    // also kostet ein zweiter Sync nichts.
    try {
      const sync = await syncTeamsToBackend(state);
      if (!sync.ok) {
        return {
          ok: false,
          body: {
            error: sync.error || 'teams_sync_failed',
            message: sync.message ||
              'Die Teams konnten nicht zum Server übertragen werden. ' +
              'Bitte prüfe die Browser-Konsole und versuche es erneut.',
          },
        };
      }
    } catch (err) {
      console.warn('[wizard] pre-generate syncTeamsToBackend threw', err);
    }

    // apiCall() aus auth-oidc.js setzt Authorization: Bearer <token>
    // automatisch und macht 401-Auto-Refresh. raw fetch hier wäre
    // derselbe Bug wie in tournament.js vor diesem Fix.
    const data = await apiCall(
      `/tournaments/${encodeURIComponent(state.tournamentId)}/generate`,
      'POST',
      payload
    );
    // Diagnose: ID merken, damit der User per
    //   inspectTournament() oder
    //   GET /api/tournaments/<id>/standings
    // direkt prüfen kann, was in der DB gelandet ist.
    window.__lastGeneratedTournamentId = state.tournamentId;
    console.info(
      '%c✅ Turnier generiert',
      'color:#2c8a4f;font-weight:bold',
      '\nID:', state.tournamentId,
      '\nName:', state.name,
      '\nPrüfen mit: inspectTournament("' + state.tournamentId + '")'
    );
    // Issue 2: Mount-Flag freigeben — nach erfolgreichem Generate ist
    // der Wizard durch. Sonst blockt der nächste Klick auf
    // „Neues Turnier" mit „Wizard ist bereits offen".
    wizardMounted = null;
    return { ok: true, body: data };
  };

  // Issue 2: Letzte Verteidigungslinie für onGenerate. Wenn apiCall
  // wirft oder syncTeams mitten im Lauf eskaliert, MUSS wizardMounted
  // freigegeben werden — sonst hängt der User fest. Wir wrappen den
  // ganzen onGenerate-Body in try/catch, der am Ende das Flag löst.
  // (Innerhalb der Funktion haben wir mehrere {ok:false}-Returns für
  // Geschäftsregel-Verstöße; diese setzen das Flag NICHT — bewusst,
  // damit der User den Wizard noch bedienen kann, um z. B. fehlende
  // Teams nachzutragen.)
  //
  // Issue 6 (2026-08-13): nach erfolgreichem Generate → Wizard SOFORT
  // schließen, dann Turnier-Ansicht des NEUEN Turniers öffnen. Vorher
  // blieb der Wizard-Mount stehen und der User landete im Nirvana
  // ("TURNIER TAUCHT IN DER LISTE NICHT AUF" + "KEINE WEITERLEITUNG").
  // Reihenfolge ist wichtig:
  //   1. teardownWizard()  → räumt Wizard-Host-Klasse, innerHTML, Title
  //                          und wizardMounted-Flag auf. Macht den
  //                          "Turnier generieren"-Button sofort
  //                          unerreichbar — kein Mehrfachklick mehr.
  //   2. openTournamentInstance() / loadActiveTournamentView() →
  //                          rendert die Ziel-Ansicht in das jetzt
  //                          leere grid.
  // Ohne Schritt 1 blieb die alte Ansicht stehen und wurde nur teilweise
  // überschrieben → der User sah weiter den Wizard-Button.
  const navigateToGeneratedInstance = async (tournamentId) => {
    await teardownWizard();
    if (!tournamentId) {
      await loadActiveTournamentView(true);
      return;
    }
    try {
      await openTournamentInstance(tournamentId);
    } catch (err) {
      console.warn('[wizard] post-generate openTournamentInstance failed:', err);
      // Fallback: Liste neu laden, damit der User das neue Turnier
      // überhaupt irgendwo sieht (es ist nach Generate als 'generated'
      // status in der DB und MUSS unter "Bereit" auftauchen).
      await loadActiveTournamentView(true);
    }
  };

  const onGenerateSafe = async (state, opts) => {
    try {
      const result = await onGenerate(state, opts);
      if (result && result.ok) {
        // Wizard lebt noch, bis die Detail-View steht. Erst danach
        // wizardMounted lösen (Issue 2).
        await navigateToGeneratedInstance(state.tournamentId);
      }
      return result;
    } catch (err) {
      console.warn('[wizard] onGenerate threw (outer):', err);
      wizardMounted = null;
      return {
        ok: false,
        body: {
          error: 'generate_failed',
          message:
            'Beim Generieren ist ein unerwarteter Fehler aufgetreten. ' +
            'Bitte prüfe die Browser-Konsole und versuche es erneut.',
        },
      };
    }
  };

  const onCancel = async () => {
    // Issue 2: Aufräumen über die zentrale teardownWizard()-Funktion.
    // Damit fahren onCancel und alle externen Aufrufer (Modul-Wechsel,
    // Gruppen-Wechsel, pagehide) exakt dieselbe Sequenz — keine Drift
    // zwischen den Pfaden.
    await teardownWizard();
    await loadActiveTournamentView(true);
  };

  const wizardEl = renderWizardView({
    // groupId MUSS als Top-Level-Option übergeben werden, nicht nur
    // in initialState. tournament.js liest opts.groupId (siehe
    // ensureDraftPromise() und Step-1-„Weiter"-Handler), um den
    // Live-Modus vom Mock-Modus zu unterscheiden. Wenn opts.groupId
    // fehlt, geht der Wizard stillschweigend in den Mock-Modus und
    // legt keinen Entwurf in der DB an.
    groupId: curGroupId,
    initialState,
    onStateChange,
    onGenerate: onGenerateSafe,
    onCancel,
  });

  // Diagnose: prüft die Kette direkt am Einstieg. Wenn groupId hier
  // undefined ist, ist der Fehler im Wrapper. Wenn der Wizard dann
  // trotzdem keinen POST absetzt, liegt es in tournament.js.
  console.log('[wizard] mount: groupId=%s, tournamentId=%s',
    curGroupId || '(none)', initialState.tournamentId || '(none)');

  const grid = document.getElementById('grid');
  if (!grid) return;
  // Auf Wizard-Host umschalten (CSS t-wizard-host überschreibt das
  // Foto-Grid aus main.css). Reihenfolge: erst Klasse setzen,
  // dann leeren, dann Wizard anhängen — sonst flackert kurz das
  // alte Foto-Grid.
  grid.className = WIZARD_HOST_CLASS;
  grid.innerHTML = '';
  grid.appendChild(wizardEl);
  // Galerie-Titel auf "Neues Turnier" setzen. Vorherigen Wert
  // merken, damit onCancel ihn wiederherstellen kann. Daten-Attribute
  // statt Closure-Variable, weil onCancel als async callback
  // definiert ist und diese im Aufrufer-Scope liegt.
  const title = $('gal-title');
  if (title && !title.dataset.tWizardTitle) {
    title.dataset.tWizardPrevTitle = title.textContent;
    title.dataset.tWizardTitle = '1';
    title.textContent = 'Neues Turnier';
  }
  hideTournamentHeaderButtons();
  wizardMounted = wizardEl;
}

// Mount-Handle, damit andere Stellen (loadActiveTournamentView etc.)
// den Wizard bei Bedarf zerstören können.
let wizardMounted = null;

/**
 * Issue 2 — Zentrales Aufräumen für den Wizard-Mount.
 *
 * Wird in ALLEN Ausstiegs-Pfaden aufgerufen:
 *   1. onCancel (User klickt „Abbrechen")
 *   2. onGenerate Erfolg (Server hat das Turnier angelegt)
 *   3. onGenerate Fehler (apiCall wirft, syncTeams eskaliert, …)
 *   4. switchToFeed / switchToTournaments / switchToPhotos (User
 *      wechselt das Modul, ohne den Wizard zu schließen)
 *   5. switchToGroup (User wechselt die Gruppe)
 *   6. pagehide (Tab wird geschlossen — kein async-Cleanup möglich,
 *      aber das Flag muss konsistent sein)
 *
 * Ohne diesen Block blieb wizardMounted nach Generate-Success auf dem
 * alten Element stehen — der nächste Klick auf „Neues Turnier" zeigte
 * dann „Wizard ist bereits offen", obwohl gar keiner mehr im DOM war.
 *
 * Die Funktion ist idempotent: wenn nichts zu tun ist (kein Mount,
 * keine Daten-Attribute am Titel), läuft sie ohne Effekt durch.
 */
async function teardownWizard() {
  wizardMounted = null;
  const grid = document.getElementById('grid');
  if (grid) {
    grid.classList.remove(WIZARD_HOST_CLASS);
    grid.innerHTML = '';
  }
  const title = $('gal-title');
  if (title && title.dataset.tWizardTitle === '1') {
    title.textContent = title.dataset.tWizardPrevTitle || 'Gemeinsamer Ordner';
    delete title.dataset.tWizardTitle;
    delete title.dataset.tWizardPrevTitle;
  }
  showTournamentHeaderButtons();
}

/**
 * Diagnose-Helper: alles aus der DB zu einem Turnier in die Konsole
 * schreiben. Solange die v3-Ansicht (Etappe B) fehlt, ist das der
 * schnellste Weg für den User zu prüfen, was generate() tatsächlich
 * geschrieben hat — Teams, Gruppen, Spielzahl, Config.
 *
 * Aufruf in der DevTools-Konsole:
 *   inspectTournament('abc123')              → ein Turnier
 *   inspectTournament()                      → letztes im Wizard
 *                                              erzeugtes Turnier
 *   await inspectTournament('abc123')        → Promise, falls gewartet
 *
 * Output: 4 console.group-Blöcke (Tournament / Teams / Gruppen /
 * Matches), plus eine Kurzfassung mit Counts + wichtigen Config-Werten.
 *
 * Verwendet GET /api/tournaments/:id (liefert teams, stages, groups,
 * matches, stats in einer Antwort — kein Hin-und-Her).
 */
async function inspectTournament(tournamentId) {
  const id = tournamentId || (typeof window !== 'undefined' ? window.__lastGeneratedTournamentId : null);
  if (!id) {
    console.warn('[inspectTournament] Keine ID übergeben und kein __lastGeneratedTournamentId gesetzt.');
    return null;
  }
  let res;
  try {
    res = await apiCall(`/tournaments/${encodeURIComponent(id)}`, 'GET');
  } catch (err) {
    console.error('[inspectTournament] Fetch fehlgeschlagen:', err);
    return null;
  }
  const t = res?.tournament || res;
  const teams = res?.teams ?? [];
  const stages = res?.stages ?? [];
  const groups = res?.groups ?? [];
  const matches = res?.matches ?? [];
  const stats = res?.stats ?? {};

  console.group(`🏆 Turnier: ${t?.name || id} (${id})`);
  console.log('Status:', t?.status, '| Modus:', t?.mode);
  console.log('Sport:', t?.sport, '→ Spaltenbezeichnung:', t?.scoreLabel);
  console.log('Ort:', t?.location ?? '(leer)');
  console.log('Tische:', t?.tableLabels ?? '(automatisch)');
  console.log('Config (Engine):', t?.config);
  console.log('Stats:', stats);

  console.group(`👥 Teams (${teams.length})`);
  for (const team of teams) {
    console.log(`  • [${team.seed ?? '-'}] ${team.name}${team.color ? ' (' + team.color + ')' : ''}`);
  }
  console.groupEnd();

  console.group(`📦 Stages (${stages.length})`);
  for (const stage of stages) {
    console.log(`  • Stage ${stage.orderIndex + 1}: ${stage.name} (${stage.type})`);
  }
  console.groupEnd();

  console.group(`🗂️  Gruppen (${groups.length})`);
  for (const g of groups) {
    const mems = g.memberships || [];
    console.group(`  ${g.name || g.key} (${mems.length} Teams)`);
    for (const m of mems) {
      console.log(`    • ${m.team?.name ?? m.teamId}`);
    }
    console.groupEnd();
  }
  console.groupEnd();

  console.group(`⚽ Spiele (${matches.length})`);
  const byStatus = matches.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Nach Status:', byStatus);
  const byStage = matches.reduce((acc, m) => {
    const key = m.stageId || '?';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log('Pro Stage-ID:', byStage);
  // Erste 5 + letzte 2 Spiele
  if (matches.length > 0) {
    console.log('Erste Spiele:');
    for (const m of matches.slice(0, 5)) {
      console.log(`  #${m.matchNumber} ${m.teamHome?.name ?? 'TBD'} vs ${m.teamAway?.name ?? 'TBD'} — ${m.status}`);
    }
    if (matches.length > 7) {
      console.log(`  ... (${matches.length - 7} weitere)`);
      for (const m of matches.slice(-2)) {
        console.log(`  #${m.matchNumber} ${m.teamHome?.name ?? 'TBD'} vs ${m.teamAway?.name ?? 'TBD'} — ${m.status}`);
      }
    }
  }
  console.groupEnd();

  console.groupEnd();
  console.log('➡️  Für Detail-Tabellen: GET /api/tournaments/' + id + '/standings und /schedule');
  return res;
}
// Auf window exposen, damit der User es aus der DevTools-Konsole
// aufrufen kann, ohne es erst aus dem Modul zu importieren.
window.inspectTournament = inspectTournament;

function feedEntityHref(post) {
  if (!post) return '';
  if (post.entityType === 'photo' && post.entityId) {
    return photoSrc(`/api/photos/${post.entityId}/file`);
  }
  return '';
}

function feedPostBodyText(post) {
  if (post?.contentType === 'upload_summary' && post?.metadata?.hideBody) return '';
  const body = String(post?.body || '').trim();
  if (!body) return '';
  return esc(body).replace(/\n/g, '<br>');
}

function feedAuthorName(post) {
  const user = post?.createdBy;
  return (
    getVisibleName(user, user?.displayNameField) || user?.name || user?.username || 'Unbekannt'
  );
}

function formatFeedDate(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function getFeedMentionPopup() {
  let popup = document.getElementById('feed-mention-popup');
  if (popup) return popup;
  popup = document.createElement('div');
  popup.id = 'feed-mention-popup';
  popup.style.cssText =
    'position:fixed;z-index:5005;min-width:200px;max-width:280px;max-height:220px;overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow2);padding:4px;display:none';
  document.body.appendChild(popup);
  return popup;
}

function hideFeedMentionPopup() {
  const popup = document.getElementById('feed-mention-popup');
  if (popup) popup.style.display = 'none';
  feedMentionState.open = false;
  feedMentionState.inputId = null;
  feedMentionState.tokenStart = -1;
  feedMentionState.tokenEnd = -1;
  feedMentionState.activeIndex = 0;
  feedMentionState.items = [];
}

function getMentionCandidates(query) {
  const q = String(query || '').toLowerCase();
  const members = Array.isArray(groupMembers) ? groupMembers : [];
  const dedupe = new Set();
  return members
    .map((member) => member?.user || member)
    .filter((user) => user?.id && user?.username)
    .filter((user) => {
      if (dedupe.has(user.id)) return false;
      dedupe.add(user.id);
      return true;
    })
    .filter((user) => {
      const username = String(user.username || '').toLowerCase();
      const visibleName = String(getVisibleName(user, user?.displayNameField) || '').toLowerCase();
      if (!q) return true;
      return username.includes(q) || visibleName.includes(q);
    })
    .slice(0, 8)
    .map((user) => ({
      id: user.id,
      username: user.username,
      label: getVisibleName(user, user?.displayNameField) || user.name || user.username,
    }));
}

function getMentionTokenAtCaret(input) {
  const caret = Number(input?.selectionStart);
  if (!Number.isFinite(caret) || caret < 0) return null;
  const value = String(input?.value || '');
  const left = value.slice(0, caret);
  const match = left.match(/(^|\s)@([a-zA-Z0-9_.-]{0,32})$/);
  if (!match) return null;
  const mentionText = match[2] || '';
  const atIndex = left.lastIndexOf('@');
  if (atIndex < 0) return null;
  return {
    query: mentionText,
    start: atIndex,
    end: caret,
  };
}

function applyMentionFromPopup(index) {
  const input = document.getElementById(feedMentionState.inputId || '');
  if (!input) {
    hideFeedMentionPopup();
    return;
  }
  const item = feedMentionState.items[index];
  if (!item?.username) {
    hideFeedMentionPopup();
    return;
  }
  const value = String(input.value || '');
  const start = Math.max(0, feedMentionState.tokenStart);
  const end = Math.max(start, feedMentionState.tokenEnd);
  const insertion = `@${item.username} `;
  input.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const nextCaret = start + insertion.length;
  input.focus();
  input.setSelectionRange(nextCaret, nextCaret);
  hideFeedMentionPopup();
}

function renderFeedMentionPopup() {
  const popup = getFeedMentionPopup();
  const input = document.getElementById(feedMentionState.inputId || '');
  if (!popup || !input || !feedMentionState.items.length) {
    hideFeedMentionPopup();
    return;
  }

  popup.innerHTML = feedMentionState.items
    .map((item, idx) => {
      const active = idx === feedMentionState.activeIndex;
      return `<button type="button" data-feed-mention-index="${idx}" style="display:flex;width:100%;gap:8px;align-items:center;text-align:left;border:none;border-radius:8px;padding:7px 8px;cursor:pointer;background:${active ? 'var(--accent-l)' : 'transparent'};color:${active ? 'var(--accent)' : 'var(--text)'}">
        <span style="font-size:12px;font-weight:700">@${esc(item.username)}</span>
        <span style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.label)}</span>
      </button>`;
    })
    .join('');

  popup.querySelectorAll('[data-feed-mention-index]').forEach((btn) => {
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const idx = Number(btn.getAttribute('data-feed-mention-index'));
      if (Number.isFinite(idx)) applyMentionFromPopup(idx);
    });
  });

  const rect = input.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.round(rect.left))}px`;
  popup.style.top = `${Math.round(rect.bottom + 6)}px`;
  popup.style.display = 'block';
  feedMentionState.open = true;
}

function updateFeedMentionForInput(input) {
  if (!input?.id) return;
  const token = getMentionTokenAtCaret(input);
  if (!token) {
    if (feedMentionState.inputId === input.id) hideFeedMentionPopup();
    return;
  }

  const candidates = getMentionCandidates(token.query);
  if (!candidates.length) {
    if (feedMentionState.inputId === input.id) hideFeedMentionPopup();
    return;
  }

  feedMentionState.inputId = input.id;
  feedMentionState.tokenStart = token.start;
  feedMentionState.tokenEnd = token.end;
  feedMentionState.items = candidates;
  feedMentionState.activeIndex = Math.min(feedMentionState.activeIndex, candidates.length - 1);
  if (feedMentionState.activeIndex < 0) feedMentionState.activeIndex = 0;
  renderFeedMentionPopup();
}

function handleFeedMentionKeydown(event) {
  if (!feedMentionState.open || feedMentionState.inputId !== event.currentTarget?.id) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    feedMentionState.activeIndex =
      (feedMentionState.activeIndex + 1) % feedMentionState.items.length;
    renderFeedMentionPopup();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    feedMentionState.activeIndex =
      (feedMentionState.activeIndex - 1 + feedMentionState.items.length) %
      feedMentionState.items.length;
    renderFeedMentionPopup();
    return;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    applyMentionFromPopup(feedMentionState.activeIndex);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideFeedMentionPopup();
  }
}

function bindFeedMentionInputs() {
  document.querySelectorAll('[data-feed-mention-input="true"]').forEach((input) => {
    if (input.dataset.feedMentionBound === '1') return;
    input.dataset.feedMentionBound = '1';

    input.addEventListener('input', () => updateFeedMentionForInput(input));
    input.addEventListener('click', () => updateFeedMentionForInput(input));
    input.addEventListener('keyup', () => updateFeedMentionForInput(input));
    input.addEventListener('keydown', handleFeedMentionKeydown);
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement?.id !== feedMentionState.inputId) hideFeedMentionPopup();
      }, 120);
    });
  });
}

function ensureFeedCommentState(postId) {
  if (!postId) return null;
  if (!feedCommentUiState[postId]) {
    feedCommentUiState[postId] = {
      open: false,
      _closing: false,
      loading: false,
      loaded: false,
      error: '',
      items: [],
      nextCursor: null,
      hasMore: false,
      loadingMore: false,
      submitting: false,
    };
  }
  return feedCommentUiState[postId];
}

function pruneFeedCommentState(visiblePosts) {
  const keep = new Set((Array.isArray(visiblePosts) ? visiblePosts : []).map((post) => post?.id));
  for (const postId of Object.keys(feedCommentUiState)) {
    if (!keep.has(postId)) delete feedCommentUiState[postId];
  }
  if (activeFeedCommentsPostId && !keep.has(activeFeedCommentsPostId)) {
    activeFeedCommentsPostId = null;
  }
}

function focusFeedCommentInput(postId) {
  window.requestAnimationFrame(() => {
    const input = document.getElementById(`feed-comment-input-${postId}`);
    if (!input) return;
    input.focus();
    const len = String(input.value || '').length;
    input.setSelectionRange(len, len);
  });
}

function focusFeedReplyInput(commentId) {
  window.requestAnimationFrame(() => {
    const input = document.getElementById(`feed-reply-input-${commentId}`);
    if (!input) return;
    input.focus();
    const len = String(input.value || '').length;
    input.setSelectionRange(len, len);
  });
}

function findFeedCommentInSection(postId, commentId) {
  const section = ensureFeedCommentState(postId);
  if (!section) return null;
  for (const comment of section.items) {
    if (comment?.id === commentId) return comment;
    if (Array.isArray(comment?._replies)) {
      const reply = comment._replies.find((entry) => entry?.id === commentId);
      if (reply) return reply;
    }
  }
  return null;
}

function closeFeedCommentMenu() {
  activeFeedCommentMenuId = null;
  feedCommentMenuOutsideCloseBound = false;
  syncFeedMenuVisibilityInDom();
}

function toggleFeedCommentMenu(commentId) {
  activeFeedCommentMenuId = activeFeedCommentMenuId === commentId ? null : commentId;
  feedCommentMenuOutsideCloseBound = false;
  syncFeedMenuVisibilityInDom();
}

function bindFeedCommentMenuOutsideClose() {
  if (!activeFeedCommentMenuId || feedCommentMenuOutsideCloseBound) return;
  feedCommentMenuOutsideCloseBound = true;
  setTimeout(() => {
    function onOutside(event) {
      const root = document.querySelector(
        `[data-feed-comment-menu-root="${activeFeedCommentMenuId}"]`
      );
      if (root && root.contains(event.target)) return;
      closeFeedCommentMenu();
      document.removeEventListener('click', onOutside, true);
    }
    document.addEventListener('click', onOutside, true);
  }, 0);
}

function enrichFeedComment(item) {
  return {
    ...item,
    _replyOpen: false,
    _replySubmitting: false,
    _repliesOpen: false,
    _repliesLoaded: false,
    _repliesLoading: false,
    _repliesLoadingMore: false,
    _repliesError: '',
    _replies: [],
    _repliesNextCursor: null,
    _repliesHasMore: false,
    _editing: false,
    _editSubmitting: false,
  };
}

function mergeFeedCommentServerData(existing, server) {
  const normalized = enrichFeedComment(server || {});
  if (!existing) return normalized;
  return {
    ...normalized,
    _replyOpen: existing._replyOpen,
    _replySubmitting: false,
    _repliesOpen: existing._repliesOpen,
    _repliesLoaded: existing._repliesLoaded,
    _repliesLoading: false,
    _repliesLoadingMore: false,
    _repliesError: '',
    _replies: Array.isArray(existing._replies) ? existing._replies : [],
    _repliesNextCursor: existing._repliesNextCursor || null,
    _repliesHasMore: !!existing._repliesHasMore,
    _editing: false,
    _editSubmitting: false,
  };
}

function feedCommentAuthorName(comment) {
  const user = comment?.user;
  return (
    getVisibleName(user, user?.displayNameField) || user?.name || user?.username || 'Unbekannt'
  );
}

function feedCommentBodyHtml(comment) {
  const text = String(comment?.content || '').trim();
  if (!text || comment?.deleted)
    return '<span style="color:var(--muted);font-style:italic">Kommentar gelöscht</span>';
  return esc(text).replace(/\n/g, '<br>');
}

function bumpFeedPostCommentCount(postId, delta) {
  const post = findFeedPostById(postId);
  if (!post) return;
  replaceFeedPostInState({
    ...post,
    commentsCount: Math.max(0, (Number(post.commentsCount) || 0) + delta),
  });
}

function updateCommentInSection(postId, commentId, updater) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;
  section.items = section.items.map((comment) => {
    if (comment.id === commentId) return updater(comment);
    if (Array.isArray(comment._replies) && comment._replies.length) {
      return {
        ...comment,
        _replies: comment._replies.map((reply) =>
          reply.id === commentId ? updater(reply) : reply
        ),
      };
    }
    return comment;
  });
}

function canEditFeedComment(comment) {
  if (!comment || comment.deleted) return false;
  return comment.userId === me?.id;
}

function canDeleteFeedComment(comment) {
  if (!comment || comment.deleted) return false;
  return canDeleteCommentInCurrentGroup(comment);
}

async function loadFeedComments(postId, { reset = false } = {}) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;
  if (section.loading || section.loadingMore) return;

  section.error = '';
  if (reset) {
    section.loading = true;
    section.nextCursor = null;
  } else {
    section.loadingMore = true;
  }
  renderFeedCommentArea(postId);

  try {
    const params = new URLSearchParams({ limit: '15' });
    if (!reset && section.nextCursor) params.set('cursor', section.nextCursor);
    const data = await apiCall(
      `/group-feed/${encodeURIComponent(postId)}/comments?${params.toString()}`
    );
    const incoming = Array.isArray(data?.comments) ? data.comments.map(enrichFeedComment) : [];
    section.items = reset ? incoming : [...section.items, ...incoming];
    section.nextCursor = data?.paging?.nextCursor || null;
    section.hasMore = !!data?.paging?.hasMore;
    section.loaded = true;
  } catch (e) {
    section.error = e?.serverMessage || 'Kommentare konnten nicht geladen werden';
  } finally {
    section.loading = false;
    section.loadingMore = false;
    renderFeedCommentArea(postId);
  }
}

async function toggleFeedComments(postId) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;

  if (section.open) {
    section._closing = true;
    if (activeFeedCommentsPostId === postId) activeFeedCommentsPostId = null;
    hideFeedMentionPopup();
    closeFeedCommentMenu();
    renderFeedCommentArea(postId);
    setTimeout(() => {
      const fresh = ensureFeedCommentState(postId);
      if (!fresh) return;
      fresh._closing = false;
      fresh.open = false;
      renderFeedCommentArea(postId);
    }, 180);
    return;
  }

  if (activeFeedCommentsPostId && activeFeedCommentsPostId !== postId) {
    const currentOpenSection = ensureFeedCommentState(activeFeedCommentsPostId);
    if (currentOpenSection) {
      currentOpenSection._closing = true;
      const prevPostId = activeFeedCommentsPostId;
      setTimeout(() => {
        const prev = ensureFeedCommentState(prevPostId);
        if (!prev) return;
        prev._closing = false;
        prev.open = false;
        renderFeedCommentArea(prevPostId);
      }, 180);
    }
  }
  section.open = true;
  section._closing = false;
  activeFeedCommentsPostId = postId;
  closeFeedCommentMenu();
  renderFeedCommentArea(postId);
  focusFeedCommentInput(postId);

  if (!section.loaded) {
    await loadFeedComments(postId, { reset: true });
    focusFeedCommentInput(postId);
  }
}

async function loadOlderFeedComments(postId) {
  const section = ensureFeedCommentState(postId);
  if (!section?.hasMore || !section.nextCursor) return;
  await loadFeedComments(postId, { reset: false });
}

function toggleFeedReplyComposer(postId, commentId) {
  let nextOpen = false;
  updateCommentInSection(postId, commentId, (comment) => {
    nextOpen = !comment._replyOpen;
    return {
      ...comment,
      _replyOpen: nextOpen,
    };
  });
  renderFeedCommentArea(postId);
  if (nextOpen) focusFeedReplyInput(commentId);
}

async function submitFeedComment(postId) {
  const section = ensureFeedCommentState(postId);
  if (!section || section.submitting) return;
  const input = document.getElementById(`feed-comment-input-${postId}`);
  const content = String(input?.value || '').trim();
  if (!content) {
    toast('Bitte einen Kommentar eingeben', 'error');
    return;
  }

  section.submitting = true;
  renderFeedCommentArea(postId);
  try {
    const data = await apiCall(`/group-feed/${encodeURIComponent(postId)}/comments`, 'POST', {
      content,
    });
    const created = data?.comment ? enrichFeedComment(data.comment) : null;
    if (created) {
      section.items = [created, ...section.items];
      section.loaded = true;
      bumpFeedPostCommentCount(postId, 1);
    }
    if (input) input.value = '';
    hideFeedMentionPopup();
  } catch (e) {
    toast(e?.serverMessage || 'Kommentar konnte nicht gespeichert werden', 'error');
  } finally {
    section.submitting = false;
    renderFeedCommentArea(postId);
  }
}

async function submitFeedReply(postId, commentId) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;
  const parent = section.items.find((entry) => entry.id === commentId);
  if (!parent || parent._replySubmitting) return;

  const input = document.getElementById(`feed-reply-input-${commentId}`);
  const content = String(input?.value || '').trim();
  if (!content) {
    toast('Bitte eine Antwort eingeben', 'error');
    return;
  }

  updateCommentInSection(postId, commentId, (comment) => ({ ...comment, _replySubmitting: true }));
  renderFeedCommentArea(postId);

  try {
    const data = await apiCall(
      `/group-feed/comments/${encodeURIComponent(commentId)}/replies`,
      'POST',
      {
        content,
      }
    );
    const created = data?.comment ? enrichFeedComment(data.comment) : null;
    if (created) {
      updateCommentInSection(postId, commentId, (comment) => ({
        ...comment,
        _replyOpen: false,
        repliesCount: (Number(comment.repliesCount) || 0) + 1,
        _repliesLoaded: true,
        _repliesOpen: true,
        _replies: [...(Array.isArray(comment._replies) ? comment._replies : []), created],
      }));
      bumpFeedPostCommentCount(postId, 1);
    }
    if (input) input.value = '';
    hideFeedMentionPopup();
  } catch (e) {
    toast(e?.serverMessage || 'Antwort konnte nicht gespeichert werden', 'error');
  } finally {
    updateCommentInSection(postId, commentId, (comment) => ({
      ...comment,
      _replySubmitting: false,
    }));
    renderFeedCommentArea(postId);
  }
}

function startFeedCommentEdit(postId, commentId) {
  closeFeedCommentMenu();
  updateCommentInSection(postId, commentId, (comment) => {
    if (!canEditFeedComment(comment)) return comment;
    return {
      ...comment,
      _editing: true,
      _replyOpen: false,
    };
  });
  renderFeedCommentArea(postId);
}

function cancelFeedCommentEdit(postId, commentId) {
  updateCommentInSection(postId, commentId, (comment) => ({
    ...comment,
    _editing: false,
    _editSubmitting: false,
  }));
  renderFeedCommentArea(postId);
}

async function saveFeedCommentEdit(postId, commentId) {
  const input = document.getElementById(`feed-edit-input-${commentId}`);
  const content = String(input?.value || '').trim();
  if (!content) {
    toast('Kommentar darf nicht leer sein', 'error');
    return;
  }

  updateCommentInSection(postId, commentId, (comment) => ({
    ...comment,
    _editSubmitting: true,
  }));
  renderFeedCommentArea(postId);

  try {
    const data = await apiCall(`/group-feed/comments/${encodeURIComponent(commentId)}`, 'PATCH', {
      content,
    });
    const updated = data?.comment || null;
    if (updated) {
      updateCommentInSection(postId, commentId, (comment) =>
        mergeFeedCommentServerData(comment, updated)
      );
    } else {
      updateCommentInSection(postId, commentId, (comment) => ({
        ...comment,
        content,
        _editing: false,
        _editSubmitting: false,
      }));
    }
    hideFeedMentionPopup();
  } catch (e) {
    updateCommentInSection(postId, commentId, (comment) => ({
      ...comment,
      _editSubmitting: false,
    }));
    toast(e?.serverMessage || 'Kommentar konnte nicht gespeichert werden', 'error');
  } finally {
    renderFeedCommentArea(postId);
  }
}

async function deleteFeedComment(postId, commentId) {
  closeFeedCommentMenu();
  const confirmed = await showConfirmDlg(
    'Kommentar löschen',
    'Möchtest du diesen Kommentar wirklich löschen?',
    'Löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  try {
    await apiCall(`/group-feed/comments/${encodeURIComponent(commentId)}`, 'DELETE');
    updateCommentInSection(postId, commentId, (comment) => ({
      ...comment,
      content: null,
      deleted: true,
      deletedAt: new Date().toISOString(),
      _editing: false,
      _replyOpen: false,
    }));
    hideFeedMentionPopup();
    renderFeedCommentArea(postId);
  } catch (e) {
    toast(e?.serverMessage || 'Kommentar konnte nicht gelöscht werden', 'error');
  }
}

async function openFeedCommentHistory(postId, commentId) {
  closeFeedCommentMenu();
  const comment = findFeedCommentInSection(postId, commentId);
  if (!comment || comment.deleted || (Number(comment.historyCount) || 0) <= 0) {
    return;
  }
  document.getElementById('confirm-dlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = 'confirm-dlg';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg" style="max-width:620px;width:calc(100% - 28px);text-align:left;padding:28px 28px 24px">
      <div class="dlg-ico">🕘</div>
      <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">Kommentar-Historie</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--muted)">Frühere Versionen dieses Kommentars</p>
      <div id="feed-comment-history-list" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:auto;padding-right:4px">
        <div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>
      </div>
      <div class="dlg-btns" style="justify-content:flex-end;margin-top:18px">
        <button id="feed-comment-history-close" class="btn btn-primary">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#feed-comment-history-close').onclick = close;
  dlg.onclick = (event) => {
    if (event.target === dlg) close();
  };

  try {
    const response = await apiCall(
      `/group-feed/comments/${encodeURIComponent(commentId)}/history`,
      'GET'
    );
    const history = response?.history || [];
    const list = dlg.querySelector('#feed-comment-history-list');
    if (!list) return;
    if (!history.length) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Keine Historie vorhanden</strong><p>Für diesen Kommentar wurde noch keine frühere Version gespeichert.</p></div>';
      return;
    }
    list.innerHTML = history
      .map((entry) => {
        const editorName =
          getVisibleName(entry.editedBy, entry?.editedBy?.displayNameField) ||
          entry?.editedBy?.name ||
          entry?.editedBy?.username ||
          'Unbekannt';
        return `<div class="feed-history-entry">
          <div class="feed-history-entry-head">
            <strong>${esc(formatFeedDate(entry.createdAt))}</strong>
            <span>${esc(editorName)}</span>
          </div>
          <p>${esc(entry.previousContent || '').replace(/\n/g, '<br>')}</p>
        </div>`;
      })
      .join('');
  } catch {
    const list = dlg.querySelector('#feed-comment-history-list');
    if (list) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Fehler</strong><p>Historie konnte nicht geladen werden.</p></div>';
    }
  } finally {
    renderFeedCommentArea(postId);
    focusFeedCommentInput(postId);
  }
}

async function openFeedCommentLikers(postId, commentId) {
  closeFeedCommentMenu();
  const comment = findFeedCommentInSection(postId, commentId);
  const likesCount = Number(comment?.likesCount) || 0;
  if (!comment || likesCount <= 0) return;

  document.getElementById('confirm-dlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = 'confirm-dlg';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg" style="max-width:560px;width:calc(100% - 28px);text-align:left;padding:28px 28px 24px">
      <div class="dlg-ico">❤️</div>
      <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">Likes auf Kommentar</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--muted)">Wer hat diesen Kommentar geliked?</p>
      <div id="feed-comment-likers-list" style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding-right:4px">
        <div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>
      </div>
      <div class="dlg-btns" style="justify-content:flex-end;margin-top:18px">
        <button id="feed-comment-likers-close" class="btn btn-primary">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#feed-comment-likers-close').onclick = close;
  dlg.onclick = (event) => {
    if (event.target === dlg) close();
  };

  try {
    const response = await apiCall(
      `/group-feed/comments/${encodeURIComponent(commentId)}/likes`,
      'GET'
    );
    const likes = Array.isArray(response?.likes) ? response.likes : [];
    const list = dlg.querySelector('#feed-comment-likers-list');
    if (!list) return;

    if (!likes.length) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Noch keine Likes</strong><p>Für diesen Kommentar wurden bisher keine Likes vergeben.</p></div>';
      return;
    }

    list.innerHTML = likes
      .map((entry) => {
        const user = entry?.user || {};
        const name =
          getVisibleName(user, user?.displayNameField) ||
          user?.name ||
          user?.username ||
          'Unbekannt';
        return `<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--card)">
          <span style="flex-shrink:0">${avatarHtml(user, 28)}</span>
          <div style="min-width:0;display:flex;flex-direction:column;gap:2px">
            <strong style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</strong>
            <span style="font-size:11px;color:var(--muted)">${esc(formatFeedDate(entry?.createdAt))}</span>
          </div>
        </div>`;
      })
      .join('');
  } catch (e) {
    const list = dlg.querySelector('#feed-comment-likers-list');
    if (list) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Fehler</strong><p>Likes konnten nicht geladen werden.</p></div>';
    }
  }
}

async function toggleFeedReplies(postId, commentId) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;
  const comment = section.items.find((entry) => entry.id === commentId);
  if (!comment) return;

  if (comment._repliesLoaded) {
    updateCommentInSection(postId, commentId, (entry) => ({
      ...entry,
      _repliesOpen: !entry._repliesOpen,
    }));
    renderFeedCommentArea(postId);
    return;
  }

  updateCommentInSection(postId, commentId, (entry) => ({
    ...entry,
    _repliesLoading: true,
    _repliesError: '',
  }));
  renderFeedCommentArea(postId);

  try {
    const params = new URLSearchParams({ limit: '15' });
    const data = await apiCall(
      `/group-feed/comments/${encodeURIComponent(commentId)}/replies?${params.toString()}`
    );
    const replies = Array.isArray(data?.replies) ? data.replies.map(enrichFeedComment) : [];
    updateCommentInSection(postId, commentId, (entry) => ({
      ...entry,
      _repliesLoading: false,
      _repliesLoaded: true,
      _repliesOpen: true,
      _replies: replies,
      _repliesNextCursor: data?.paging?.nextCursor || null,
      _repliesHasMore: !!data?.paging?.hasMore,
    }));
  } catch (e) {
    updateCommentInSection(postId, commentId, (entry) => ({
      ...entry,
      _repliesLoading: false,
      _repliesError: e?.serverMessage || 'Antworten konnten nicht geladen werden',
    }));
  } finally {
    renderFeedCommentArea(postId);
  }
}

async function loadOlderFeedReplies(postId, commentId) {
  const section = ensureFeedCommentState(postId);
  if (!section) return;
  const comment = section.items.find((entry) => entry.id === commentId);
  if (!comment?._repliesHasMore || !comment?._repliesNextCursor || comment?._repliesLoadingMore) {
    return;
  }

  updateCommentInSection(postId, commentId, (entry) => ({ ...entry, _repliesLoadingMore: true }));
  renderFeedCommentArea(postId);

  try {
    const params = new URLSearchParams({ limit: '15', cursor: comment._repliesNextCursor });
    const data = await apiCall(
      `/group-feed/comments/${encodeURIComponent(commentId)}/replies?${params.toString()}`
    );
    const replies = Array.isArray(data?.replies) ? data.replies.map(enrichFeedComment) : [];
    updateCommentInSection(postId, commentId, (entry) => ({
      ...entry,
      _repliesLoadingMore: false,
      _replies: [...(Array.isArray(entry._replies) ? entry._replies : []), ...replies],
      _repliesNextCursor: data?.paging?.nextCursor || null,
      _repliesHasMore: !!data?.paging?.hasMore,
    }));
  } catch (e) {
    updateCommentInSection(postId, commentId, (entry) => ({
      ...entry,
      _repliesLoadingMore: false,
      _repliesError: e?.serverMessage || 'Weitere Antworten konnten nicht geladen werden',
    }));
  } finally {
    renderFeedCommentArea(postId);
  }
}

async function toggleFeedCommentLike(postId, commentId, likedByMe) {
  const endpoint = `/group-feed/comments/${encodeURIComponent(commentId)}/like`;
  try {
    const result = likedByMe ? await apiCall(endpoint, 'DELETE') : await apiCall(endpoint, 'POST');
    updateCommentInSection(postId, commentId, (comment) => ({
      ...comment,
      likedByMe: !likedByMe,
      likesCount: Number(result?.likesCount) || 0,
    }));
    renderFeedCommentArea(postId);
  } catch (e) {
    toast(e?.serverMessage || 'Like konnte nicht aktualisiert werden', 'error');
  }
}

function renderFeedReplies(postId, comment) {
  if (!comment?._repliesOpen) return '';
  const rows = Array.isArray(comment._replies) ? comment._replies : [];
  const list = rows
    .map((reply) => {
      const showReplyHistory = !reply.deleted && (Number(reply.historyCount) || 0) > 0;
      const replyEditedHint =
        !reply.deleted && ((Number(reply.historyCount) || 0) > 0 || reply.edited);
      const menuItems = [
        canEditFeedComment(reply)
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();${reply._editing ? `cancelFeedCommentEdit('${postId}','${reply.id}')` : `startFeedCommentEdit('${postId}','${reply.id}')`}">${ICON_ALBUM_MANAGE}<span>${reply._editing ? 'Bearbeitung abbrechen' : 'Bearbeiten'}</span></button>`
          : '',
        showReplyHistory
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();openFeedCommentHistory('${postId}','${reply.id}')">${ICON_HISTORY}<span>Historie</span></button>`
          : '',
        Number(reply.likesCount) > 0
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();openFeedCommentLikers('${postId}','${reply.id}')">❤️<span>Likes anzeigen (${Number(reply.likesCount) || 0})</span></button>`
          : '',
        canDeleteFeedComment(reply)
          ? `<button class="feed-post-menu-item danger" onclick="closeFeedCommentMenu();deleteFeedComment('${postId}','${reply.id}')">${ICON_TRASH}<span>Löschen</span></button>`
          : '',
      ]
        .filter(Boolean)
        .join('');
      return `
      <div style="border-left:2px solid var(--border);padding:8px 0 8px 10px;margin:0 0 8px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
            <span style="flex-shrink:0">${avatarHtml(reply.user || {}, 22)}</span>
            <div style="font-size:12px;color:var(--muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(feedCommentAuthorName(reply))} · ${esc(formatFeedDate(reply.createdAt))}${replyEditedHint ? ' · bearbeitet' : ''}</div>
          </div>
          <div class="feed-post-menu-anchor" data-feed-comment-menu-root="${reply.id}">
            <button class="feed-post-menu-toggle" onclick="toggleFeedCommentMenu('${reply.id}')" title="Kommentaraktionen">${ICON_MORE}</button>
            <div class="feed-post-menu" style="display:${activeFeedCommentMenuId === reply.id ? 'block' : 'none'}">${menuItems}</div>
          </div>
        </div>
        <div style="margin-top:3px;font-size:13px;line-height:1.45;color:var(--text2)">${
          reply._editing
            ? `<textarea id="feed-edit-input-${reply.id}" data-feed-mention-input="true" rows="2" maxlength="1200" style="resize:none;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:var(--card);color:var(--text);font:inherit">${esc(reply.content || '')}</textarea>`
            : feedCommentBodyHtml(reply)
        }</div>
        <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${reply._editing ? '' : `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="toggleFeedCommentLike('${postId}','${reply.id}',${reply.likedByMe ? 'true' : 'false'})">${reply.likedByMe ? '❤️' : '🤍'} ${Number(reply.likesCount) || 0}</button>`}
          ${reply._editing ? `<button class="btn btn-primary" style="font-size:11px;padding:3px 8px" onclick="saveFeedCommentEdit('${postId}','${reply.id}')" ${reply._editSubmitting ? 'disabled' : ''}>${reply._editSubmitting ? '…' : 'Speichern'}</button>` : ''}
          ${reply._editing ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="cancelFeedCommentEdit('${postId}','${reply.id}')">Abbrechen</button>` : ''}
        </div>
      </div>`;
    })
    .join('');

  const moreBtn = comment._repliesHasMore
    ? `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" onclick="loadOlderFeedReplies('${postId}','${comment.id}')" ${comment._repliesLoadingMore ? 'disabled' : ''}>${comment._repliesLoadingMore ? 'Lädt…' : 'Ältere Antworten laden'}</button>`
    : '';

  return `<div style="margin-top:8px">${list || '<div style="font-size:12px;color:var(--muted)">Noch keine Antworten.</div>'}${moreBtn}</div>`;
}

function renderFeedCommentSection(postId, section) {
  const comments = Array.isArray(section?.items) ? section.items : [];
  const list = comments
    .map((comment) => {
      const replyInput = comment._replyOpen
        ? `<div style="margin-top:8px;display:flex;gap:8px;align-items:flex-start">
            <textarea id="feed-reply-input-${comment.id}" data-feed-mention-input="true" rows="2" maxlength="1200" placeholder="Antwort schreiben…" style="resize:none;flex:1;min-height:54px;border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:var(--bg);color:var(--text);font:inherit"></textarea>
            <button class="btn btn-primary" style="width:34px;height:34px;border-radius:999px;padding:0;display:inline-flex;align-items:center;justify-content:center" onclick="submitFeedReply('${postId}','${comment.id}')" title="Antwort senden" ${comment._replySubmitting ? 'disabled' : ''}>${comment._replySubmitting ? '…' : ICON_SEND}</button>
          </div>`
        : '';
      const repliesToggle = Number(comment.repliesCount) > 0 || comment._repliesLoaded;
      const repliesToggleBtn = repliesToggle
        ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="toggleFeedReplies('${postId}','${comment.id}')">${comment._repliesOpen ? 'Antworten ausblenden' : `Antworten (${Number(comment.repliesCount) || 0})`}</button>`
        : '';
      const repliesLoading = comment._repliesLoading
        ? '<div style="margin-top:6px;font-size:12px;color:var(--muted)">Antworten werden geladen…</div>'
        : '';
      const repliesError = comment._repliesError
        ? `<div style="margin-top:6px;font-size:12px;color:var(--danger)">${esc(comment._repliesError)}</div>`
        : '';
      const commentBody = comment._editing
        ? `<textarea id="feed-edit-input-${comment.id}" data-feed-mention-input="true" rows="3" maxlength="1200" style="resize:none;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:var(--card);color:var(--text);font:inherit">${esc(comment.content || '')}</textarea>`
        : feedCommentBodyHtml(comment);
      const showCommentHistory = !comment.deleted && (Number(comment.historyCount) || 0) > 0;
      const commentEditedHint =
        !comment.deleted && ((Number(comment.historyCount) || 0) > 0 || comment.edited);
      const menuItems = [
        canEditFeedComment(comment)
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();${comment._editing ? `cancelFeedCommentEdit('${postId}','${comment.id}')` : `startFeedCommentEdit('${postId}','${comment.id}')`}">${ICON_ALBUM_MANAGE}<span>${comment._editing ? 'Bearbeitung abbrechen' : 'Bearbeiten'}</span></button>`
          : '',
        showCommentHistory
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();openFeedCommentHistory('${postId}','${comment.id}')">${ICON_HISTORY}<span>Historie</span></button>`
          : '',
        Number(comment.likesCount) > 0
          ? `<button class="feed-post-menu-item" onclick="closeFeedCommentMenu();openFeedCommentLikers('${postId}','${comment.id}')">❤️<span>Likes anzeigen (${Number(comment.likesCount) || 0})</span></button>`
          : '',
        canDeleteFeedComment(comment)
          ? `<button class="feed-post-menu-item danger" onclick="closeFeedCommentMenu();deleteFeedComment('${postId}','${comment.id}')">${ICON_TRASH}<span>Löschen</span></button>`
          : '',
      ]
        .filter(Boolean)
        .join('');

      return `
      <div style="border:1px solid var(--border);border-radius:10px;padding:9px 10px;margin:0 0 8px;background:var(--bg)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
            <span style="flex-shrink:0">${avatarHtml(comment.user || {}, 24)}</span>
            <div style="font-size:12px;color:var(--muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(feedCommentAuthorName(comment))} · ${esc(formatFeedDate(comment.createdAt))}${commentEditedHint ? ' · bearbeitet' : ''}</div>
          </div>
          <div class="feed-post-menu-anchor" data-feed-comment-menu-root="${comment.id}">
            <button class="feed-post-menu-toggle" onclick="toggleFeedCommentMenu('${comment.id}')" title="Kommentaraktionen">${ICON_MORE}</button>
            <div class="feed-post-menu" style="display:${activeFeedCommentMenuId === comment.id ? 'block' : 'none'}">${menuItems}</div>
          </div>
        </div>
        <div style="margin-top:3px;font-size:13px;line-height:1.5;color:var(--text2)">${commentBody}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px">
          ${comment._editing ? '' : `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="toggleFeedCommentLike('${postId}','${comment.id}',${comment.likedByMe ? 'true' : 'false'})">${comment.likedByMe ? '❤️' : '🤍'} ${Number(comment.likesCount) || 0}</button>`}
          ${comment._editing ? `<button class="btn btn-primary" style="font-size:11px;padding:3px 8px" onclick="saveFeedCommentEdit('${postId}','${comment.id}')" ${comment._editSubmitting ? 'disabled' : ''}>${comment._editSubmitting ? '…' : 'Speichern'}</button>` : ''}
          ${comment._editing ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="cancelFeedCommentEdit('${postId}','${comment.id}')">Abbrechen</button>` : ''}
          ${comment.deleted || comment._editing ? '' : `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="toggleFeedReplyComposer('${postId}','${comment.id}')">${comment._replyOpen ? 'Abbrechen' : 'Antworten'}</button>`}
          ${repliesToggleBtn}
        </div>
        ${replyInput}
        ${repliesLoading}
        ${repliesError}
        ${renderFeedReplies(postId, comment)}
      </div>`;
    })
    .join('');

  return `
    <section class="feed-comment-section" style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--card2);overflow:hidden;animation:${section._closing ? 'fadeOut .18s ease' : 'fadeIn .18s ease'}">
      <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">
        <textarea id="feed-comment-input-${postId}" data-feed-mention-input="true" rows="2" maxlength="1200" placeholder="Kommentar schreiben…" style="resize:none;flex:1;min-height:60px;border:1px solid var(--border);border-radius:9px;padding:8px 10px;background:var(--bg);color:var(--text);font:inherit"></textarea>
        <button class="btn btn-primary" style="width:36px;height:36px;border-radius:999px;padding:0;display:inline-flex;align-items:center;justify-content:center" onclick="submitFeedComment('${postId}')" title="Kommentar senden" ${section.submitting ? 'disabled' : ''}>${section.submitting ? '…' : ICON_SEND}</button>
      </div>
      ${section.loading ? '<div style="font-size:12px;color:var(--muted);padding:6px 2px">Kommentare werden geladen…</div>' : ''}
      ${section.error ? `<div style="font-size:12px;color:var(--danger);padding:6px 2px">${esc(section.error)}</div>` : ''}
      ${!section.loading && !section.error ? list || '<div style="font-size:12px;color:var(--muted)">Noch keine Kommentare.</div>' : ''}
      ${section.hasMore ? `<button class="btn btn-ghost" style="margin-top:6px;font-size:11px;padding:4px 9px" onclick="loadOlderFeedComments('${postId}')" ${section.loadingMore ? 'disabled' : ''}>${section.loadingMore ? 'Lädt…' : 'Ältere Kommentare laden'}</button>` : ''}
    </section>`;
}

function renderFeedCommentArea(postId) {
  const post = findFeedPostById(postId);
  const section = ensureFeedCommentState(postId);
  const host = document.getElementById(`feed-comments-wrap-${postId}`);
  if (!post || !section || !host) {
    renderFeedGrid();
    return;
  }

  const commentCount = Math.max(
    Number(post.commentsCount) || 0,
    Array.isArray(section?.items) ? section.items.length : 0
  );
  const commentsToggle = `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" onclick="toggleFeedComments('${post.id}')">${section?.open ? 'Kommentare schließen' : `Kommentare (${commentCount})`}</button>`;

  host.innerHTML = `<div style="margin-top:2px">${commentsToggle}</div>${section?.open || section?._closing ? renderFeedCommentSection(post.id, section) : ''}`;
  bindFeedCommentMenuOutsideClose();
  bindFeedMentionInputs();
  syncFeedMenuVisibilityInDom();
}

function renderFeedComposer(isMobileFeed) {
  const canPost = canPostToFeedInCurrentGroup();
  if (curFeedView === 'saved' || curFeedView === 'mentions') return '';
  return `
    <article id="feed-compose-card" class="feed-compose-card${canPost ? '' : ' is-locked'}" style="border-radius:${isMobileFeed ? 12 : 14}px">
      <div class="feed-compose-head">
        <span class="feed-compose-title">Beitrag verfassen</span>
      </div>
      <input
        id="feed-post-title"
        class="feed-compose-input"
        type="text"
        maxlength="160"
        placeholder="Titel (optional)"
        ${canPost ? '' : 'disabled'}
      />
      <textarea
        id="feed-post-body"
        data-feed-mention-input="true"
        class="feed-compose-textarea"
        maxlength="3000"
        placeholder="Beitrag verfassen..."
        ${canPost ? '' : 'disabled'}
      ></textarea>
      <div class="feed-compose-row">
        <span class="feed-compose-hint">${
          canPost
            ? 'Tipp: Mit Strg+Enter kannst du direkt posten.'
            : 'In dieser Gruppe ist Feed-Posten für normale Mitglieder aktuell gesperrt.'
        }</span>
        <button id="feed-post-submit" class="btn btn-primary feed-compose-submit" onclick="createFeedPost()" ${canPost ? '' : 'disabled'}>Posten</button>
      </div>
      ${
        canPost
          ? ''
          : '<div class="feed-compose-locked-note">Feed-Posten ist in dieser Gruppe für Mitglieder gesperrt.</div>'
      }
    </article>`;
}

function bindFeedComposerInteractions() {
  const card = $('feed-compose-card');
  const titleEl = $('feed-post-title');
  const bodyEl = $('feed-post-body');
  if (!card || !bodyEl) return;

  const updateState = () => {
    const hasFocus = document.activeElement === bodyEl || document.activeElement === titleEl;
    const hasContent =
      String(titleEl?.value || '').trim().length > 0 ||
      String(bodyEl?.value || '').trim().length > 0;
    card.classList.toggle('is-active', hasFocus || hasContent);
  };

  bodyEl.addEventListener('focus', updateState);
  bodyEl.addEventListener('blur', updateState);
  bodyEl.addEventListener('input', updateState);
  bodyEl.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      createFeedPost();
    }
  });
  if (titleEl) {
    titleEl.addEventListener('focus', updateState);
    titleEl.addEventListener('blur', updateState);
    titleEl.addEventListener('input', updateState);
  }

  updateState();
}

async function createFeedPost() {
  if (!curGroupId) {
    toast('Keine aktive Gruppe ausgewählt', 'error');
    return;
  }
  if (!canPostToFeedInCurrentGroup()) {
    toast('Posten im Feed ist in dieser Gruppe für Mitglieder gesperrt', 'error');
    return;
  }

  const titleEl = $('feed-post-title');
  const bodyEl = $('feed-post-body');
  const submitBtn = $('feed-post-submit');
  const title = String(titleEl?.value || '').trim();
  const body = String(bodyEl?.value || '').trim();

  if (!body) {
    toast('Bitte einen Text eingeben', 'error');
    bodyEl?.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Posting...';
  }

  try {
    await apiCall('/group-feed', 'POST', {
      groupId: curGroupId,
      contentType: 'post',
      title: title || null,
      body,
    });

    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    clearFeedPostTargetState({ removeUrl: true });
    curFeedView = 'all';
    saveLastModuleState();
    renderSidebar();
    await loadFeedPosts(true);
    toast('Beitrag veröffentlicht', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Beitrag konnte nicht erstellt werden', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = !canPostToFeedInCurrentGroup();
      submitBtn.textContent = 'Posten';
    }
  }
}

async function openPhotoInFotosModule(photoId, uploaderId = null) {
  if (!photoId) return;
  try {
    const photo = await apiCall(`/photos/${encodeURIComponent(photoId)}`, 'GET');
    if (!photo || !photo.id) return;
    if (photo.groupId && photo.groupId !== curGroupId) await switchGroup(photo.groupId);
    const resolvedUploaderId = uploaderId || photo.uploaderId || photo?.uploader?.id || null;

    // BUGFIX Header-Button: vor Foto-Kontext-Wechsel zentral aufräumen.
    await teardownWizard();
    curModule = 'photos';
    sidebarUiState.fotosExpanded = true;
    sidebarUiState.feedExpanded = false;
    sidebarUiState.tournamentsExpanded = false;
    saveLastModuleState();
    curAlbum = null;
    curFilter = null;
    curFilterUserId = resolvedUploaderId;

    renderSidebar();
    await loadPhotos(true);
    const idx = photos.findIndex((p) => p.id === photo.id);
    if (idx !== -1) openLB(idx);
    else toast('Foto nicht mehr verfügbar', 'error');
  } catch (e) {
    toast('Foto konnte nicht geöffnet werden', 'error');
  }
}

async function openAlbumFromFeed(albumId, photoId = null, groupIdHint = null) {
  if (!albumId) return;

  const hintedGroupId = groupIdHint || null;
  if (hintedGroupId && hintedGroupId !== curGroupId) {
    await switchGroup(hintedGroupId);
  } else {
    const album = allAlbums.find((entry) => entry.id === albumId);
    if (album?.groupId && album.groupId !== curGroupId) {
      await switchGroup(album.groupId);
    }
  }

  await switchAlbum(albumId);

  if (!photoId) return;
  const idx = photos.findIndex((photo) => photo.id === photoId);
  if (idx === -1) {
    toast('Bild konnte nicht gefunden werden', 'error');
    return;
  }
  openLB(idx);
}
window.openAlbumFromFeed = openAlbumFromFeed;

async function openUploaderPhotosFromFeed(uploaderId) {
  if (!uploaderId) return;
  await switchToUser(uploaderId);
}

function openShareAlbumToFeedModal(albumId = curAlbum) {
  if (!albumId) return;
  if (!canPostToFeedInCurrentGroup()) {
    toast('In dieser Gruppe ist Feed-Posten für Mitglieder gesperrt', 'error');
    return;
  }
  if (!canShareAlbumToFeed(albumId)) {
    toast('Du darfst dieses Album nicht teilen', 'error');
    return;
  }

  const album = allAlbums.find((entry) => entry.id === albumId);
  if (!album) {
    toast('Album konnte nicht gefunden werden', 'error');
    return;
  }

  const modal = $('share-album-feed-modal');
  if (!modal) return;
  const albumIdInput = $('share-album-feed-album-id');
  const titleInput = $('share-album-feed-title');
  const bodyInput = $('share-album-feed-body');

  if (albumIdInput) albumIdInput.value = albumId;
  if (titleInput) titleInput.value = `Album: ${album.name}`;
  if (bodyInput) bodyInput.value = '';
  bindFeedMentionInputs();

  show('share-album-feed-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.zIndex = '4000';
  setTimeout(() => titleInput?.focus(), 50);
}

function closeShareAlbumToFeedModal() {
  const modal = $('share-album-feed-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.zIndex = '';
  }
  hide('share-album-feed-modal');
  const btn = $('share-album-feed-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Teilen';
  }
}

async function submitAlbumShareToFeed() {
  const albumId = String($('share-album-feed-album-id')?.value || '').trim();
  if (!albumId) return;

  const title = String($('share-album-feed-title')?.value || '').trim();
  const body = String($('share-album-feed-body')?.value || '').trim();
  const btn = $('share-album-feed-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird geteilt...';
  }

  const ok = await shareAlbumToFeed(albumId, { title, body });
  if (ok) {
    closeShareAlbumToFeedModal();
    return;
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Teilen';
  }
}

async function shareAlbumToFeed(albumId, options = {}) {
  if (!albumId) return;
  if (!canPostToFeedInCurrentGroup()) {
    toast('In dieser Gruppe ist Feed-Posten für Mitglieder gesperrt', 'error');
    return false;
  }
  if (!canShareAlbumToFeed(albumId)) {
    toast('Du darfst dieses Album nicht teilen', 'error');
    return false;
  }

  const btn = document.getElementById('album-share-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${ICON_LINK}`;
  }

  try {
    const album = allAlbums.find((entry) => entry.id === albumId);
    if (!album) {
      toast('Album konnte nicht gefunden werden', 'error');
      return false;
    }

    const params = new URLSearchParams({
      groupId: curGroupId,
      albumId,
      skip: '0',
      limit: '6',
      order: 'desc',
    });
    const res = await apiCall(`/photos?${params.toString()}`, 'GET');
    const albumPhotos = (res.photos || []).map((photo) => ({
      id: photo.id,
      mediaType: photo.mediaType || 'image',
      videoDuration:
        Number.isFinite(photo.videoDuration) || photo.videoDuration === 0
          ? photo.videoDuration
          : null,
      exists: true,
    }));
    if (!albumPhotos.length) {
      toast('Das Album enthält keine Fotos', 'error');
      return false;
    }

    const totalPhotos = Number.isFinite(res.total) ? res.total : albumPhotos.length;
    const coverPhotoId = albumPhotos[0]?.id || null;
    const customTitle = String(options?.title || '').trim();
    const customBody = String(options?.body || '').trim();
    const title = customTitle || `Album: ${album.name}`;
    const body =
      customBody ||
      `Schau dir mein Album „${album.name}“ an${totalPhotos ? ` mit ${totalPhotos} Fotos` : ''}`;

    await apiCall('/group-feed', 'POST', {
      groupId: curGroupId,
      contentType: 'album_share',
      title,
      body,
      entityType: 'album',
      entityId: albumId,
      imageUrl: coverPhotoId ? `/api/photos/${coverPhotoId}/file` : null,
      metadata: {
        groupId: curGroupId,
        groupName: myGroups.find((g) => g.id === curGroupId)?.name || null,
        albumId,
        albumName: album.name,
        albumPhotos,
        totalPhotos,
        albumCoverPhotoId: coverPhotoId,
      },
    });

    if (curModule === 'feed') await loadFeedPosts(true);
    toast('Album im Feed geteilt', 'success');
    return true;
  } catch (e) {
    toast(e.serverMessage || 'Album konnte nicht im Feed geteilt werden', 'error');
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${ICON_LINK} Teilen`;
    }
  }
}
window.shareAlbumToFeed = shareAlbumToFeed;
window.openShareAlbumToFeedModal = openShareAlbumToFeedModal;
window.closeShareAlbumToFeedModal = closeShareAlbumToFeedModal;
window.submitAlbumShareToFeed = submitAlbumShareToFeed;

function renderFeedGrid() {
  const grid = $('grid');
  if (!grid) return;
  grid.className = 'grid feed-grid';

  const isMobileFeed = window.matchMedia('(max-width: 640px)').matches;
  const tileGap = isMobileFeed ? 4 : 6;
  const tileRadius = isMobileFeed ? 8 : 10;
  const cardPadding = isMobileFeed ? '10px 10px 14px' : '12px 13px 16px';
  const cardRadius = isMobileFeed ? 12 : 14;
  const headerGap = isMobileFeed ? 7 : 8;
  const singlePreviewHeightVideo = isMobileFeed ? 210 : 300;
  const singlePreviewHeightImage = isMobileFeed ? 185 : 280;
  const composerHtml = renderFeedComposer(isMobileFeed);
  const displayedPosts =
    activeSingleFeedPost && curFeedView === 'all' ? [activeSingleFeedPost] : feedPosts;
  pruneFeedCommentState(displayedPosts);

  if (!displayedPosts.length) {
    grid.innerHTML = composerHtml;
    bindFeedComposerInteractions();
    const icon = $('empty-icon');
    const text = $('empty-text');
    const actions = $('empty-actions');
    if (icon) icon.textContent = '📰';
    if (text) text.textContent = 'Noch keine Beiträge im Feed.';
    if (actions)
      actions.innerHTML =
        '<p style="font-size:13px;color:var(--muted);margin-top:2px">Teile etwas aus einem Modul oder erstelle den ersten Beitrag.</p>';
    show('empty');
    return;
  }

  hide('empty');
  grid.innerHTML =
    composerHtml +
    renderFeedDeepLinkBanner() +
    displayedPosts
      .map((post) => {
        const canDelete = canDeleteFeedPost(post);
        const canEdit = canEditFeedPost(post);
        const saved = !!post.isSaved;
        const entityHref = feedEntityHref(post);
        const isTargeted = feedTargetedPostId === post.id;
        const isMenuOpen = activeFeedPostMenuId === post.id;
        const title = post.title
          ? `<h4 style="margin:0 0 6px;font-size:${isMobileFeed ? 14 : 15}px;color:var(--text)">${esc(post.title)}</h4>`
          : '';
        const bodyText = feedPostBodyText(post);
        const body = bodyText
          ? `<p style="margin:0 0 10px;font-size:${isMobileFeed ? 12 : 13}px;line-height:1.55;color:var(--text2)">${bodyText}</p>`
          : '';
        const previewSrc = post.imageUrl ? photoSrc(post.imageUrl) : '';
        const isVideoPreview =
          post?.entityMediaType === 'video' || post?.metadata?.primaryMediaType === 'video';
        const entityMissing = !!post?.entityMissing;
        const uploadedItems = Array.isArray(post?.metadata?.uploadedItems)
          ? post.metadata.uploadedItems.filter((item) => item?.id)
          : Array.isArray(post?.metadata?.uploadedIds)
            ? post.metadata.uploadedIds.filter(Boolean).map((id) => ({ id, mediaType: null }))
            : [];
        const postUploaderId = post.createdById || post?.createdBy?.id || null;
        const primaryVideoDuration =
          post?.entityVideoDuration ??
          uploadedItems.find((item) => item.id === post.entityId)?.videoDuration ??
          post?.metadata?.primaryVideoDuration ??
          null;
        const albumPhotos = Array.isArray(post?.metadata?.albumPhotos)
          ? post.metadata.albumPhotos
          : [];
        const albumShareAlbumId = post?.metadata?.albumId || post.entityId || '';
        const albumShareAlbumName = post?.metadata?.albumName || post.title || 'Album';
        const albumShareTotal = Number(post?.metadata?.totalPhotos) || albumPhotos.length;
        const albumShareGroupId = post?.metadata?.groupId || post.groupId || null;
        const videoOverlay = (seconds) => {
          const showDuration = Number.isFinite(Number(seconds));
          const playSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.45)"/><polygon points="9.5,7 19,12 9.5,17" fill="white"/></svg>`;
          return `<div class="p-thumb-play">${playSvg}</div>${showDuration ? `<span class="media-duration-badge">${formatMediaDuration(Number(seconds))}</span>` : ''}`;
        };
        const renderTile = (item, idx, options = {}) => {
          const missing = item?.exists === false;
          const tileMediaType =
            item.mediaType ||
            (item.id === post.entityId
              ? post?.entityMediaType || post?.metadata?.primaryMediaType || null
              : null) ||
            'image';
          if (missing) {
            const ratio = options.fillHeight ? '' : 'aspect-ratio:1/1;';
            return `<div title="Medium wurde gelöscht" style="position:relative;border:1px dashed var(--border2);border-radius:${tileRadius}px;overflow:hidden;background:var(--bg);padding:0;width:100%;height:100%;${ratio};display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;font-weight:700;text-align:center;line-height:1.35">${tileMediaType === 'video' ? 'Video gelöscht' : 'Bild gelöscht'}</div>`;
          }
          const tileSrc = photoSrc(`/api/photos/${encodeURIComponent(item.id)}/file`);
          const media =
            tileMediaType === 'video'
              ? `<video src="${esc(tileSrc)}#t=0.1" preload="metadata" muted playsinline webkit-playsinline style="width:100%;height:100%;object-fit:cover;background:#000"></video>`
              : `<img src="${esc(tileSrc)}" alt="Feed-Medium ${idx + 1}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`;
          const ratio = options.fillHeight ? '' : 'aspect-ratio:1/1;';
          const overlay = tileMediaType === 'video' ? videoOverlay(item?.videoDuration) : '';
          const tileHandler =
            options.onClick ||
            `openPhotoInFotosModule(${JSON.stringify(item.id)}, ${JSON.stringify(postUploaderId || null)})`;
          const tileTitle =
            options.title || `${tileMediaType === 'video' ? 'Video' : 'Bild'} in Fotos öffnen`;
          return `<button onclick="${esc(tileHandler)}" title="${esc(tileTitle)}" style="position:relative;border:1px solid var(--border);border-radius:${tileRadius}px;overflow:hidden;background:var(--bg);padding:0;cursor:pointer;width:100%;height:100%;${ratio}">${media}${overlay}</button>`;
        };
        const mediaPreview = (() => {
          if (post.contentType === 'upload_summary' && uploadedItems.length > 1) {
            const hasOverflow = uploadedItems.length > 6;
            const visibleItems = hasOverflow
              ? uploadedItems.slice(0, 5)
              : uploadedItems.slice(0, 6);
            const tiles = visibleItems.map((item, idx) => renderTile(item, idx));
            if (hasOverflow) {
              const moreCount = uploadedItems.length - 5;
              tiles.push(
                `<button onclick="openUploaderPhotosFromFeed('${postUploaderId || ''}')" title="Weitere Uploads von ${esc(feedAuthorName(post))}" style="border:1px dashed var(--border2);border-radius:${tileRadius}px;background:var(--bg);padding:0;cursor:pointer;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:${isMobileFeed ? 12 : 13}px;font-weight:700">+${moreCount}</button>`
              );
            }
            const count = tiles.length;
            if (count === 2) {
              return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
            }
            if (count === 3) {
              return `<div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:${tileGap}px;margin:0 0 10px;min-height:${isMobileFeed ? 168 : 220}px">
              <div>${renderTile(visibleItems[0], 0, { fillHeight: true })}</div>
              <div style="display:grid;grid-template-rows:repeat(2,minmax(0,1fr));gap:${tileGap}px">
                ${tiles[1]}
                ${tiles[2]}
              </div>
            </div>`;
            }
            if (count === 4) {
              return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
            }
            const cols = isMobileFeed ? 2 : 3;
            return `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
          }
          if (post.contentType === 'album_share' && albumPhotos.length) {
            const hasOverflow = albumShareTotal > 6;
            const visibleItems = hasOverflow ? albumPhotos.slice(0, 5) : albumPhotos.slice(0, 6);
            const tiles = visibleItems.map((item, idx) =>
              renderTile(item, idx, {
                onClick: `openAlbumFromFeed(${JSON.stringify(albumShareAlbumId)}, ${JSON.stringify(item.id)}, ${JSON.stringify(albumShareGroupId)})`,
                title: `${albumShareAlbumName} öffnen`,
              })
            );
            if (hasOverflow) {
              const moreCount = Math.max(0, albumShareTotal - 5);
              const openAlbumHandler = `openAlbumFromFeed(${JSON.stringify(albumShareAlbumId)}, null, ${JSON.stringify(albumShareGroupId)})`;
              tiles.push(
                `<button onclick="${esc(openAlbumHandler)}" title="Album öffnen" style="border:1px dashed var(--border2);border-radius:${tileRadius}px;background:var(--bg);padding:0;cursor:pointer;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:${isMobileFeed ? 12 : 13}px;font-weight:700">+${moreCount}</button>`
              );
            }
            const count = tiles.length;
            if (count === 1) {
              return `<div style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
            }
            if (count === 2) {
              return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
            }
            if (count === 3) {
              return `<div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:${tileGap}px;margin:0 0 10px;min-height:${isMobileFeed ? 168 : 220}px">
              <div>${tiles[0]}</div>
              <div style="display:grid;grid-template-rows:repeat(2,minmax(0,1fr));gap:${tileGap}px">
                ${tiles[1]}
                ${tiles[2]}
              </div>
            </div>`;
            }
            if (count === 4) {
              return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
            }
            const cols = isMobileFeed ? 2 : 3;
            return `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${tileGap}px;margin:0 0 10px">${tiles.join('')}</div>`;
          }
          if (post.imageUrl && post.entityType === 'photo' && post.entityId) {
            if (entityMissing) {
              return `<div title="Medium wurde gelöscht" style="width:100%;border:1px dashed var(--border2);border-radius:${tileRadius}px;margin:0 0 10px;min-height:140px;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--muted);font-size:12px;font-weight:700">${isVideoPreview ? 'Video gelöscht' : 'Bild gelöscht'}</div>`;
            }
            const media = isVideoPreview
              ? `<video src="${esc(previewSrc)}#t=0.1" preload="metadata" muted playsinline webkit-playsinline style="width:100%;height:${singlePreviewHeightVideo}px;border-radius:${tileRadius}px;border:1px solid var(--border);margin:0;background:#000;object-fit:contain;pointer-events:none"></video>`
              : `<img src="${esc(previewSrc)}" alt="Feed-Vorschau" style="width:100%;height:${singlePreviewHeightImage}px;border-radius:${tileRadius}px;border:1px solid var(--border);margin:0;object-fit:contain;background:var(--bg)">`;
            const overlay = isVideoPreview ? videoOverlay(primaryVideoDuration) : '';
            return `<button onclick="openPhotoInFotosModule('${post.entityId}','${postUploaderId || ''}')" title="${isVideoPreview ? 'Video in Fotos öffnen' : 'Bild in Fotos öffnen'}" style="position:relative;width:100%;background:none;border:none;padding:0;margin:0 0 10px;cursor:pointer">${media}${overlay}</button>`;
          }
          if (post.imageUrl) {
            return isVideoPreview
              ? `<div style="position:relative;margin:0 0 10px"><video src="${esc(previewSrc)}#t=0.1" preload="metadata" muted playsinline webkit-playsinline style="width:100%;height:${singlePreviewHeightVideo}px;border-radius:${tileRadius}px;border:1px solid var(--border);background:#000;object-fit:contain;pointer-events:none"></video>${videoOverlay(primaryVideoDuration)}</div>`
              : `<img src="${esc(previewSrc)}" alt="Feed-Vorschau" style="width:100%;height:${singlePreviewHeightImage}px;border-radius:${tileRadius}px;border:1px solid var(--border);margin:0 0 10px;object-fit:contain;background:var(--bg)">`;
          }
          return '';
        })();
        const openEntityBtn =
          post.entityType !== 'photo' && post.entityType !== 'album' && entityHref
            ? `<a href="${esc(entityHref)}" target="_blank" rel="noopener" style="font-size:${isMobileFeed ? 11 : 12}px;color:var(--accent);text-decoration:none;font-weight:600">Inhalt öffnen</a>`
            : '';
        const commentSection = ensureFeedCommentState(post.id);
        const commentCount = Math.max(
          Number(post.commentsCount) || 0,
          Array.isArray(commentSection?.items) ? commentSection.items.length : 0
        );
        const commentsToggle = `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" onclick="toggleFeedComments('${post.id}')">${commentSection?.open ? 'Kommentare schließen' : `Kommentare (${commentCount})`}</button>`;
        const likeBtn = `<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" onclick="toggleFeedPostLike('${post.id}',${post.likedByMe ? 'true' : 'false'})">${post.likedByMe ? '❤️' : '🤍'} ${Number(post.likesCount) || 0}</button>`;
        const editedHint = post.isEdited
          ? ` · <button class="feed-post-edited-btn" onclick="openFeedPostHistory('${post.id}')" title="Bearbeitungshistorie anzeigen">bearbeitet</button>`
          : '';
        const menuItems = [
          `<button class="feed-post-menu-item" onclick="closeFeedPostMenu();copyFeedPostLink('${post.id}')">${ICON_LINK}<span>Teilen</span></button>`,
          `<button class="feed-post-menu-item" onclick="closeFeedPostMenu();toggleFeedSaved('${post.id}')">★<span>${saved ? 'Gespeichert' : 'Speichern'}</span></button>`,
          Number(post.likesCount) > 0
            ? `<button class="feed-post-menu-item" onclick="closeFeedPostMenu();openFeedPostLikers('${post.id}')">❤️<span>Likes anzeigen (${Number(post.likesCount) || 0})</span></button>`
            : '',
          post.isEdited
            ? `<button class="feed-post-menu-item" onclick="closeFeedPostMenu();openFeedPostHistory('${post.id}')">${ICON_HISTORY}<span>Historie</span></button>`
            : '',
          canEdit
            ? `<button class="feed-post-menu-item" onclick="closeFeedPostMenu();editFeedPost('${post.id}')">${ICON_ALBUM_MANAGE}<span>Bearbeiten</span></button>`
            : '',
          canDelete
            ? `<button class="feed-post-menu-item danger" onclick="closeFeedPostMenu();deleteFeedPost('${post.id}')">${ICON_TRASH}<span>Löschen</span></button>`
            : '',
        ]
          .filter(Boolean)
          .join('');
        return `
      <article id="feed-post-${post.id}" class="feed-post-card${isTargeted ? ' is-targeted' : ''}" style="position:relative;border:1px solid var(--border);border-radius:${cardRadius}px;background:var(--card);padding:${cardPadding};margin:0 0 ${isMobileFeed ? 8 : 10}px;box-shadow:var(--shadow)">
        <div style="display:flex;align-items:center;gap:${headerGap}px;margin:0 0 10px">
          <span>${avatarHtml(post.createdBy || {}, 26)}</span>
          <div style="min-width:0;flex:1">
            <div style="font-size:${isMobileFeed ? 12 : 13}px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(feedAuthorName(post))}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(formatFeedDate(post.createdAt))}${editedHint}</div>
          </div>
          <div class="feed-post-menu-anchor" data-feed-menu-root="${post.id}">
            ${saved ? `<span class="feed-post-saved-indicator" title="Gespeichert">★</span>` : ''}
            <button class="feed-post-menu-toggle" onclick="toggleFeedPostMenu('${post.id}')" title="Beitragsaktionen">${ICON_MORE}</button>
            <div class="feed-post-menu" style="display:${isMenuOpen ? 'block' : 'none'}">${menuItems}</div>
          </div>
        </div>
        ${title}
        ${body}
        ${openEntityBtn ? `<div style="margin:0 0 10px">${openEntityBtn}</div>` : ''}
        ${mediaPreview}
        <div id="feed-comments-wrap-${post.id}">
          <div style="margin-top:2px;display:flex;gap:6px;flex-wrap:wrap">${likeBtn}${commentsToggle}</div>
          ${commentSection?.open || commentSection?._closing ? renderFeedCommentSection(post.id, commentSection) : ''}
        </div>
      </article>`;
      })
      .join('');
  bindFeedComposerInteractions();
  bindFeedPostMenuOutsideClose();
  bindFeedCommentMenuOutsideClose();
  bindFeedMentionInputs();
}

async function toggleFeedSaved(postId) {
  const post = findFeedPostById(postId);
  if (!post) return;

  try {
    if (post.isSaved) {
      await apiCall(`/group-feed/${encodeURIComponent(postId)}/save`, 'DELETE');
      if (curFeedView === 'saved') {
        feedPosts = feedPosts.filter((item) => item.id !== postId);
        if (activeSingleFeedPost?.id === postId) activeSingleFeedPost = null;
      } else {
        replaceFeedPostInState({ ...post, isSaved: false });
      }
      toast('Beitrag aus Gespeichert entfernt', 'success');
    } else {
      await apiCall(`/group-feed/${encodeURIComponent(postId)}/save`, 'POST');
      replaceFeedPostInState({ ...post, isSaved: true });
      toast('Beitrag gespeichert', 'success');
    }
    renderFeedGrid();
  } catch (e) {
    toast(e.serverMessage || 'Speicherstatus konnte nicht geändert werden', 'error');
  }
}

async function toggleFeedPostLike(postId, likedByMe) {
  const endpoint = `/group-feed/${encodeURIComponent(postId)}/like`;
  try {
    const result = likedByMe ? await apiCall(endpoint, 'DELETE') : await apiCall(endpoint, 'POST');
    const post = findFeedPostById(postId);
    if (!post) return;
    replaceFeedPostInState({
      ...post,
      likedByMe: !likedByMe,
      likesCount: Number(result?.likesCount) || 0,
    });
    renderFeedGrid();
  } catch (e) {
    toast(e?.serverMessage || 'Like konnte nicht aktualisiert werden', 'error');
  }
}

async function openFeedPostLikers(postId) {
  closeFeedPostMenu();
  const post = findFeedPostById(postId);
  const likesCount = Number(post?.likesCount) || 0;
  if (!post || likesCount <= 0) return;

  document.getElementById('confirm-dlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = 'confirm-dlg';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg" style="max-width:560px;width:calc(100% - 28px);text-align:left;padding:28px 28px 24px">
      <div class="dlg-ico">❤️</div>
      <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">Likes auf Beitrag</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--muted)">Wer hat diesen Feed-Post geliked?</p>
      <div id="feed-post-likers-list" style="display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding-right:4px">
        <div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>
      </div>
      <div class="dlg-btns" style="justify-content:flex-end;margin-top:18px">
        <button id="feed-post-likers-close" class="btn btn-primary">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#feed-post-likers-close').onclick = close;
  dlg.onclick = (event) => {
    if (event.target === dlg) close();
  };

  try {
    const response = await apiCall(`/group-feed/${encodeURIComponent(postId)}/likes`, 'GET');
    const likes = Array.isArray(response?.likes) ? response.likes : [];
    const list = dlg.querySelector('#feed-post-likers-list');
    if (!list) return;

    if (!likes.length) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Noch keine Likes</strong><p>Für diesen Beitrag wurden bisher keine Likes vergeben.</p></div>';
      return;
    }

    list.innerHTML = likes
      .map((entry) => {
        const user = entry?.user || {};
        const name =
          getVisibleName(user, user?.displayNameField) ||
          user?.name ||
          user?.username ||
          'Unbekannt';
        return `<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--card)">
          <span style="flex-shrink:0">${avatarHtml(user, 28)}</span>
          <div style="min-width:0;display:flex;flex-direction:column;gap:2px">
            <strong style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</strong>
            <span style="font-size:11px;color:var(--muted)">${esc(formatFeedDate(entry?.createdAt))}</span>
          </div>
        </div>`;
      })
      .join('');
  } catch {
    const list = dlg.querySelector('#feed-post-likers-list');
    if (list) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Fehler</strong><p>Likes konnten nicht geladen werden.</p></div>';
    }
  }
}

async function deleteFeedPost(postId) {
  const post = findFeedPostById(postId);
  if (!canDeleteFeedPost(post)) {
    toast('Du darfst diesen Beitrag nicht löschen', 'error');
    return;
  }

  const confirmed = await showConfirmDlg(
    'Feed-Beitrag löschen',
    'Möchtest du diesen Beitrag wirklich löschen?',
    'Löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  try {
    await apiCall(`/group-feed/${encodeURIComponent(postId)}`, 'DELETE');
    feedPosts = feedPosts.filter((post) => post.id !== postId);
    if (activeSingleFeedPost?.id === postId) activeSingleFeedPost = null;
    if (feedTargetedPostId === postId || pendingFeedPostId === postId) {
      clearFeedPostTargetState({ removeUrl: true });
    }
    renderFeedGrid();
    toast('Feed-Beitrag gelöscht', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Beitrag konnte nicht gelöscht werden', 'error');
  }
}

function showFeedPostEditorDlg(post) {
  return new Promise((resolve) => {
    document.getElementById('confirm-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'confirm-dlg';
    dlg.className = 'dlg-bg';
    dlg.innerHTML = `
      <div class="dlg" style="max-width:560px;width:calc(100% - 28px);text-align:left;padding:28px 28px 24px">
        <div class="dlg-ico">✏️</div>
        <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 12px">Beitrag bearbeiten</h3>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted2);margin:0 0 6px">Titel</label>
        <input id="feed-edit-title" type="text" maxlength="160" value="${esc(post?.title || '')}" style="width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;padding:10px 12px;margin:0 0 14px;font:inherit">
        <label style="display:block;font-size:12px;font-weight:600;color:var(--muted2);margin:0 0 6px">Text</label>
        <textarea id="feed-edit-body" rows="6" maxlength="3000" style="width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;padding:10px 12px;resize:vertical;min-height:140px;margin:0 0 18px;font:inherit">${esc(post?.body || '')}</textarea>
        <div class="dlg-btns dlg-btns--feed-edit">
          <button id="feed-edit-cancel" class="btn btn-ghost">Abbrechen</button>
          <button id="feed-edit-save" class="btn btn-primary">Speichern</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    const titleInput = dlg.querySelector('#feed-edit-title');
    const bodyInput = dlg.querySelector('#feed-edit-body');
    titleInput?.focus();

    const close = (payload) => {
      dlg.remove();
      resolve(payload);
    };

    dlg.querySelector('#feed-edit-save').onclick = () => {
      close({
        confirmed: true,
        title: String(titleInput?.value || '').trim(),
        body: String(bodyInput?.value || '').trim(),
      });
    };
    dlg.querySelector('#feed-edit-cancel').onclick = () => close({ confirmed: false });
    dlg.onclick = (event) => {
      if (event.target === dlg) close({ confirmed: false });
    };
  });
}

async function editFeedPost(postId) {
  const post = findFeedPostById(postId);
  if (!canEditFeedPost(post)) return;

  const result = await showFeedPostEditorDlg(post);
  if (!result?.confirmed) return;
  if (!result.body) {
    toast('Bitte einen Text eingeben', 'error');
    return;
  }

  try {
    const response = await apiCall(`/group-feed/${encodeURIComponent(postId)}`, 'PATCH', {
      title: result.title || null,
      body: result.body,
    });
    replaceFeedPostInState(response.post);
    renderFeedGrid();
    focusTargetedFeedPost(false);
    toast('Beitrag aktualisiert', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Beitrag konnte nicht bearbeitet werden', 'error');
  }
}

async function openFeedPostHistory(postId) {
  const post = findFeedPostById(postId);
  if (!post) return;

  document.getElementById('confirm-dlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = 'confirm-dlg';
  dlg.className = 'dlg-bg';
  dlg.innerHTML = `
    <div class="dlg" style="max-width:620px;width:calc(100% - 28px);text-align:left;padding:28px 28px 24px">
      <div class="dlg-ico">🕘</div>
      <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">Bearbeitungshistorie</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--muted)">Frühere Versionen von „${esc(post.title || 'Beitrag')}“</p>
      <div id="feed-history-list" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow:auto;padding-right:4px">
        <div style="display:flex;justify-content:center;padding:20px"><div class="spinner"></div></div>
      </div>
      <div class="dlg-btns" style="justify-content:flex-end;margin-top:18px">
        <button id="feed-history-close" class="btn btn-primary">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#feed-history-close').onclick = close;
  dlg.onclick = (event) => {
    if (event.target === dlg) close();
  };

  try {
    const response = await apiCall(`/group-feed/${encodeURIComponent(postId)}/history`, 'GET');
    const history = response.history || [];
    const list = dlg.querySelector('#feed-history-list');
    if (!list) return;
    if (!history.length) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Keine Historie vorhanden</strong><p>Für diesen Beitrag wurde noch keine frühere Version gespeichert.</p></div>';
      return;
    }
    list.innerHTML = history
      .map((entry) => {
        const editorName =
          getVisibleName(entry.editedBy, entry?.editedBy?.displayNameField) ||
          entry?.editedBy?.name ||
          entry?.editedBy?.username ||
          'Unbekannt';
        return `
          <div class="feed-history-entry">
            <div class="feed-history-entry-head">
              <strong>${esc(formatFeedDate(entry.createdAt))}</strong>
              <span>${esc(editorName)}</span>
            </div>
            ${entry.previousTitle ? `<div class="feed-history-entry-title">${esc(entry.previousTitle)}</div>` : ''}
            <p>${esc(entry.previousBody || '').replace(/\n/g, '<br>')}</p>
          </div>`;
      })
      .join('');
  } catch (e) {
    const list = dlg.querySelector('#feed-history-list');
    if (list) {
      list.innerHTML =
        '<div class="feed-history-entry"><strong>Fehler</strong><p>Historie konnte nicht geladen werden.</p></div>';
    }
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
      const u = allProfiles[p.uploaderId] || p.uploader || {};
      const url = urlCache[p.id] || '';
      const canDel = canDeletePhotoInCurrentGroup(p);
      const liked = p._liked || false;
      const likes = p._likes || 0;
      const comms = p._comments || 0;
      const isVideo = p.mediaType === 'video';
      const descText = typeof p.description === 'string' ? p.description.trim() : '';
      const durationBadge =
        isVideo && Number.isFinite(Number(p.videoDuration)) && Number(p.videoDuration) > 0
          ? `<span class="media-duration-badge">${formatMediaDuration(p.videoDuration)}</span>`
          : '';
      const PLAY_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.45)"/><polygon points="9.5,7 19,12 9.5,17" fill="white"/></svg>`;
      return `<div class="p-card${selectedIds.has(p.id) ? ' selected' : ''}" id="pc-${p.id}" onclick="if(window.selectMode){event.stopPropagation();toggleCardSelect('${p.id}',this)}else{openLB(${i})}">
      <div class="p-thumb">
        <div class="sel-check" onclick="event.stopPropagation();toggleCardSelect('${p.id}',this.closest('.p-card'))">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        ${
          isVideo
            ? url
              ? `<video class="p-thumb-vid loading" src="${esc(photoSrc(url))}#t=0.1" preload="metadata" muted playsinline webkit-playsinline onloadedmetadata="this.currentTime=0.1;this.classList.remove('loading');this.classList.add('loaded')" onloadeddata="this.classList.remove('loading');this.classList.add('loaded')" onseeked="this.classList.remove('loading');this.classList.add('loaded')"></video><div class="p-thumb-play">${PLAY_SVG}</div>${durationBadge}`
              : `<div class="p-thumb-video"></div><div class="p-thumb-play">${PLAY_SVG}</div>${durationBadge}`
            : url
              ? `<img src="${esc(photoSrc(url))}" alt="" loading="lazy" class="loading" onload="onThumbLoad(this)">`
              : `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="spinner"></div></div>`
        }
        <div class="p-ov">
          <div class="p-ov-stats">
            <span class="p-ov-stat">${ICON_HEART_LG_EMPTY} ${likes}</span>
            <span class="p-ov-stat">${ICON_COMMENT} ${comms}</span>
          </div>
          ${p.description ? `<div class="p-ov-desc">${esc(p.description)}</div>` : ''}
        </div>
      </div>
      <div class="p-meta">
        ${descText ? `<div class="p-desc">${esc(descText)}</div>` : ''}
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
const UPLOAD_FEED_DEFAULT_TEXT = 'Schau dir meine neuen Bilder an';
let _stagedFiles = [];
let uploadShareToFeedEnabled = true;

function canPostToFeedInCurrentGroup() {
  const group = myGroups.find((g) => g.id === curGroupId);
  if (!group) return false;
  if (isCurrentGroupModerator()) return true;
  return !group.feedPostingRestrictedToModerators;
}

async function postUploadSummaryToFeed({ uploadedItems, failedCount, albumId, description }) {
  if (!uploadedItems?.length || !curGroupId) return;
  const uploadedIds = uploadedItems.map((item) => item.id).filter(Boolean);
  if (!uploadedIds.length) return;
  const count = uploadedIds.length;
  const primaryMediaType = uploadedItems[0]?.mediaType || 'image';
  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const album = albumId ? allAlbums.find((a) => a.id === albumId) : null;
  const trimmedDescription = description ? String(description).trim() : '';
  const title = 'Neuer Upload in Fotos';
  const body = trimmedDescription || UPLOAD_FEED_DEFAULT_TEXT;

  await apiCall('/group-feed', 'POST', {
    groupId: curGroupId,
    contentType: 'upload_summary',
    title,
    body,
    entityType: 'photo',
    entityId: uploadedIds[0],
    imageUrl: `/api/photos/${uploadedIds[0]}/file`,
    metadata: {
      groupId: curGroupId,
      groupName: curGroup?.name || null,
      albumId: albumId || null,
      albumName: album?.name || null,
      uploadedIds,
      uploadedItems: uploadedItems.map((item) => ({
        id: item.id,
        mediaType: item.mediaType || 'image',
        videoDuration: Number.isFinite(item.videoDuration) ? item.videoDuration : null,
      })),
      uploadedCount: count,
      failedCount: failedCount || 0,
      primaryMediaType,
      primaryVideoDuration: Number.isFinite(uploadedItems[0]?.videoDuration)
        ? uploadedItems[0].videoDuration
        : null,
      hideBody: false,
    },
  });
}

function syncUploadShareFeedUi() {
  const shareChk = $('upload-share-feed');
  const shareHint = $('upload-share-feed-hint');
  const shareFields = $('upload-share-feed-fields');
  const canShareFeed = canPostToFeedInCurrentGroup();
  const shareEnabled = !!(shareChk?.checked && canShareFeed);

  if (shareChk) {
    shareChk.disabled = !canShareFeed;
    if (!canShareFeed) shareChk.checked = false;
  }

  if (shareHint) {
    if (canShareFeed) {
      shareHint.classList.add('hidden');
      shareHint.textContent = '';
    } else {
      shareHint.classList.remove('hidden');
      shareHint.textContent =
        'In dieser Gruppe ist Feed-Posten für normale Mitglieder aktuell gesperrt.';
    }
  }

  if (shareFields) {
    shareFields.classList.toggle('hidden', !shareEnabled);
  }
}

function openModal() {
  const asel = $('asel');
  asel.innerHTML =
    `<option value="">— Kein Album —</option>` +
    allAlbums.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  if (curAlbum) asel.value = curAlbum;
  if ($('desc-input')) $('desc-input').value = '';
  if ($('upload-share-feed-body')) $('upload-share-feed-body').value = '';
  const shareChk = $('upload-share-feed');
  const canShareFeed = canPostToFeedInCurrentGroup();
  if (shareChk) {
    shareChk.checked = uploadShareToFeedEnabled && canShareFeed;
    shareChk.onchange = syncUploadShareFeedUi;
  }
  syncUploadShareFeedUi();
  bindFeedMentionInputs();
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
  _fetchVideoQuota();
}
async function _fetchVideoQuota() {
  try {
    const data = await apiCall('/photos/video-quota', 'GET');
    const el = $('video-quota-hint');
    if (el) el.textContent = `${data.current} / ${data.max} Videos genutzt`;
  } catch {
    // non-critical
  }
}
function closeModal() {
  const shareChk = $('upload-share-feed');
  if (shareChk) uploadShareToFeedEnabled = !!shareChk.checked;
  hide('up-modal');
  $('fi').value = '';
  _stagedFiles = [];
  if ($('upload-share-feed-body')) $('upload-share-feed-body').value = '';
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
  const isOwner = group.createdBy === me.id;
  const isDeputy = groupDeputies.some((d) => d.id === me.id);
  if (!isOwner && !isDeputy) {
    toast('Nur Owner oder Vertreter können die Gruppe verwalten', 'error');
    return;
  }

  const renameInp = $('group-settings-rename-input');
  const codeDisplay = $('group-settings-code-display');
  const visibilityChk = $('group-settings-code-visible');
  const uploadLockChk = $('group-settings-upload-lock');
  const albumLockChk = $('group-settings-album-lock');
  const feedLockChk = $('group-settings-feed-lock');
  const limitEnabled = $('group-settings-limit-enabled');
  const limitInput = $('group-settings-limit-input');
  const lockHint = $('group-settings-limit-lock-hint');
  const limitSaveBtn = $('group-settings-limit-save-btn');
  const memberCount = Math.max(groupMembers.length, 1);
  if (renameInp) renameInp.value = group.name || '';
  if (codeDisplay) codeDisplay.textContent = group.code || '';
  if (visibilityChk) visibilityChk.checked = !!group.inviteCodeVisibleToMembers;
  if (uploadLockChk) uploadLockChk.checked = !!group.uploadsRestrictedToModerators;
  if (albumLockChk) albumLockChk.checked = !!group.albumsRestrictedToModerators;
  if (feedLockChk) feedLockChk.checked = !!group.feedPostingRestrictedToModerators;
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

  const inviteMaxUses = $('gs-invite-max-uses');
  const inviteExpiry = $('gs-invite-expiry');
  const inviteNotif = $('gs-invite-with-notification');
  const deputyNote = $('group-settings-deputy-note');
  const ownerControls = $('group-settings-owner-controls');
  const deputyWrap = $('gs-deputy-wrap');
  const blockedWrap = $('gs-blocked-wrap');
  const inviteWrap = $('gs-invite-wrap');
  const deleteWrap = $('group-settings-delete-wrap');
  if (inviteMaxUses) inviteMaxUses.value = '';
  if (inviteExpiry) inviteExpiry.value = '';
  if (inviteNotif) inviteNotif.checked = false;

  if (deputyNote) deputyNote.classList.toggle('hidden', isOwner);
  if (ownerControls) ownerControls.style.display = isOwner ? '' : 'none';
  if (deputyWrap) deputyWrap.style.display = isOwner ? '' : 'none';
  if (blockedWrap) blockedWrap.style.display = '';
  if (inviteWrap) inviteWrap.style.display = isOwner ? '' : 'none';
  if (deleteWrap) deleteWrap.style.display = isOwner ? '' : 'none';

  toggleGroupLimitInputs();

  _loadGsDeputies();
  _loadGsBlockedMembers();
  _renderGsRemovableMembers();
  if (isOwner) refreshGroupInviteList();
  show('group-settings-modal');
}

function _renderGsRemovableMembers() {
  const sel = $('gs-remove-user-select');
  const empty = $('gs-remove-empty');
  const btn = $('gs-remove-user-btn');
  if (!sel) return;

  const curGroup = myGroups.find((g) => g.id === curGroupId);
  const deputyIds = new Set((groupDeputies || []).map((d) => d.id));
  const requesterIsOwner = curGroup?.createdBy === me.id;
  const requesterIsDeputy = deputyIds.has(me.id);

  const members = (groupMembers || []).filter((m) => {
    if (m.id === me.id) return false;
    if (requesterIsDeputy && m.id === curGroup?.createdBy) return false;
    if (requesterIsOwner && deputyIds.has(m.id)) return false;
    return true;
  });

  sel.innerHTML = '<option value="">— Mitglied auswählen —</option>';
  members.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    const roleHint = deputyIds.has(m.id) ? ' (Vertreter)' : '';
    opt.textContent = `${m.name || m.username}${roleHint}`;
    sel.appendChild(opt);
  });

  if (empty) empty.style.display = members.length ? 'none' : 'block';
  sel.disabled = members.length === 0;
  if (btn) btn.disabled = members.length === 0;
}

async function removeGroupMemberFromSettings() {
  const userId = $('gs-remove-user-select')?.value;
  const blockUser = !!$('gs-remove-block-user')?.checked;
  if (!userId) return;

  const member = groupMembers.find((m) => m.id === userId);
  const memberName = member?.name || member?.username || 'dieses Mitglied';
  let blockReason = '';
  if (blockUser) {
    const reasonResult = await showTextConfirmDlg(
      'Mitglied entfernen und blockieren',
      `${memberName} wird aus der Gruppe entfernt, Gruppen-Content wird gelöscht und ein Wiederbeitritt wird blockiert. Bitte nenne den Grund für den Block.`,
      'Entfernen',
      'Abbrechen',
      true,
      'Begründung für den Block'
    );
    if (!reasonResult.confirmed) return;
    blockReason = reasonResult.text.trim();
    if (!blockReason) {
      toast('Ein Block-Grund ist erforderlich', 'error');
      return;
    }
  } else {
    const confirmed = await showConfirmDlg(
      'Mitglied entfernen',
      `${memberName} wird aus der Gruppe entfernt und Gruppen-Content wird gelöscht.`,
      'Entfernen',
      'Abbrechen',
      true
    );
    if (!confirmed) return;
  }

  const btn = $('gs-remove-user-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Entferne…';
  }

  try {
    const result = await apiCall(`/groups/${curGroupId}/members/${userId}/remove`, 'POST', {
      blockUser,
      blockReason,
    });

    if (result?.status === 'admin_removal_requested') {
      toast('Admin-Ziel: Anfrage wurde als Benachrichtigung gesendet.', 'info');
    } else {
      toast(
        `${memberName} entfernt. ${result?.deletedPhotos || 0} Fotos, ${result?.deletedComments || 0} Kommentare, ${result?.deletedLikes || 0} Likes gelöscht.`,
        'success'
      );
    }

    try {
      const { members } = await apiCall(`/groups/${curGroupId}/members`, 'GET');
      groupMembers = members || [];
      groupMembers.forEach((m) => {
        allProfiles[m.id] = m;
      });
    } catch (e) {
      /* ignore */
    }

    $('gs-remove-user-select').value = '';
    const blockChk = $('gs-remove-block-user');
    if (blockChk) blockChk.checked = false;

    await _loadGsDeputies();
    await _loadGsBlockedMembers();
    _renderGsRemovableMembers();
    renderSidebar();
  } catch (e) {
    toast(e.serverMessage || 'Mitglied konnte nicht entfernt werden', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Mitglied entfernen';
    }
  }
}

async function _loadGsBlockedMembers() {
  try {
    const { blockedMembers } = await apiCall(`/groups/${curGroupId}/blocks`, 'GET');
    groupBlockedMembers = blockedMembers || [];
  } catch (e) {
    groupBlockedMembers = [];
  }
  _renderGsBlockedList();
}

function _renderGsBlockedList() {
  const el = $('gs-blocked-list');
  const empty = $('gs-blocked-empty');
  if (!el) return;

  if (!groupBlockedMembers.length) {
    el.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';
  el.innerHTML = groupBlockedMembers
    .map((entry) => {
      const blockedUser = entry.user || {};
      const blockerUser = entry.blockedByUser || {};
      const blockedName = blockedUser.name || blockedUser.username || entry.userId;
      const blockedByName =
        blockerUser.name || blockerUser.username || entry.blockedBy || 'Unbekannt';
      const reason = entry.blockedReason?.trim() || 'Kein Grund hinterlegt';
      const blockedAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString('de-DE') : '';
      return `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="flex-shrink:0">${avatarHtml(blockedUser, 26)}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(blockedName)}</div>
          <button onclick="unblockGsMember('${entry.userId}')" style="background:none;border:1.5px solid var(--border);color:var(--accent);padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Entblocken</button>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;line-height:1.5">Grund: ${esc(reason)}</div>
        <div style="font-size:12px;color:var(--muted2);margin-top:2px">Geblockt von ${esc(blockedByName)}${blockedAt ? ` · ${esc(blockedAt)}` : ''}</div>
      </div>
    </div>`;
    })
    .join('');
}

async function unblockGsMember(userId) {
  const member = groupBlockedMembers.find((entry) => entry.userId === userId);
  const memberName = member?.user?.name || member?.user?.username || 'diesen User';
  const confirmed = await showConfirmDlg(
    'Blockierung aufheben',
    `${memberName} darf danach wieder über Code oder Invite der Gruppe beitreten.`,
    'Entblocken',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  try {
    await apiCall(`/groups/${curGroupId}/blocks/${userId}`, 'DELETE');
    toast('Blockierung aufgehoben', 'success');
    await _loadGsBlockedMembers();
  } catch (e) {
    toast(e.serverMessage || 'Blockierung konnte nicht aufgehoben werden', 'error');
  }
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
  _renderGsRemovableMembers();

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

async function saveGroupUploadRestriction() {
  const enabled = !!$('group-settings-upload-lock')?.checked;

  try {
    const { group } = await apiCall(`/groups/${curGroupId}/settings`, 'PATCH', {
      uploadsRestrictedToModerators: enabled,
    });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    const uploadBtn = $('upload-btn');
    if (uploadBtn) uploadBtn.style.display = canUpload() ? '' : 'none';
    updateUploadShortcutVisibility();
    toast(
      enabled
        ? 'Uploads für Mitglieder gesperrt (Owner/Vertreter/Admin weiterhin erlaubt)'
        : 'Uploads für Mitglieder wieder erlaubt',
      'success'
    );
  } catch (e) {
    const chk = $('group-settings-upload-lock');
    if (chk) chk.checked = !enabled;
    toast('Upload-Sperre konnte nicht gespeichert werden', 'error');
  }
}

async function saveGroupAlbumRestriction() {
  const enabled = !!$('group-settings-album-lock')?.checked;

  try {
    const { group } = await apiCall(`/groups/${curGroupId}/settings`, 'PATCH', {
      albumsRestrictedToModerators: enabled,
    });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    closeNewAlbumInline();
    renderSidebar();
    const createInput = $('new-album-name');
    const createBtn = $('new-album-create-btn');
    const createHint = $('new-album-lock-hint');
    const allowAlbumCreation = canCreateAlbum();
    if (createInput) {
      createInput.disabled = !allowAlbumCreation;
      createInput.placeholder = allowAlbumCreation
        ? 'Neues Album benennen…'
        : 'Album-Erstellung ist für Mitglieder gesperrt';
      if (!allowAlbumCreation) createInput.value = '';
    }
    if (createBtn) createBtn.disabled = !allowAlbumCreation;
    if (createHint) createHint.classList.toggle('hidden', allowAlbumCreation);
    toast(
      enabled
        ? 'Neue Alben für Mitglieder gesperrt (Owner/Vertreter/Admin weiterhin erlaubt)'
        : 'Neue Alben für Mitglieder wieder erlaubt',
      'success'
    );
  } catch (e) {
    const chk = $('group-settings-album-lock');
    if (chk) chk.checked = !enabled;
    toast('Album-Sperre konnte nicht gespeichert werden', 'error');
  }
}

async function saveGroupFeedPostingRestriction() {
  const enabled = !!$('group-settings-feed-lock')?.checked;

  try {
    const { group } = await apiCall(`/groups/${curGroupId}/settings`, 'PATCH', {
      feedPostingRestrictedToModerators: enabled,
    });
    const idx = myGroups.findIndex((g) => g.id === curGroupId);
    if (idx !== -1) myGroups[idx] = { ...myGroups[idx], ...group };
    toast(
      enabled
        ? 'Feed-Posts für Mitglieder gesperrt (Owner/Vertreter/Admin weiterhin erlaubt)'
        : 'Feed-Posts für Mitglieder wieder erlaubt',
      'success'
    );
  } catch (e) {
    const chk = $('group-settings-feed-lock');
    if (chk) chk.checked = !enabled;
    toast('Feed-Sperre konnte nicht gespeichert werden', 'error');
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

function renderGroupInviteList(invites = []) {
  const listEl = $('gs-invite-list');
  if (!listEl) return;

  if (!invites.length) {
    listEl.innerHTML =
      '<p style="font-size:12px;color:var(--muted2);font-weight:300;margin:0">Noch keine Invite-Links erstellt.</p>';
    return;
  }

  listEl.innerHTML = invites
    .map((invite) => {
      const usageText =
        invite.maxUses === null || invite.maxUses === undefined
          ? `${invite.useCount} Nutzungen`
          : `${invite.useCount}/${invite.maxUses} Nutzungen`;
      return `
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text);font-weight:600">${usageText}</span>
          <span style="font-size:11px;color:var(--muted)">gültig bis ${fmtInviteDate(invite.expiresAt)}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;word-break:break-all">${esc(invite.url || '')}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-ghost" style="padding:6px 9px;font-size:12px" data-url="${esc(invite.url || '')}" onclick="copyInviteUrl(this.dataset.url)">Link kopieren</button>
          <button class="btn btn-danger" style="padding:6px 9px;font-size:12px" onclick="deleteGroupInvite('${invite.id}')">Löschen</button>
        </div>
      </div>`;
    })
    .join('');
}

async function refreshGroupInviteList() {
  if (!curGroupId) return;
  const listEl = $('gs-invite-list');
  if (listEl) {
    listEl.innerHTML =
      '<div style="color:var(--muted);font-size:12px;padding:6px 0">Invite-Links werden geladen…</div>';
  }
  try {
    const { invites } = await apiCall(`/invites/group/${curGroupId}`, 'GET');
    renderGroupInviteList(invites || []);
  } catch (e) {
    if (listEl) {
      listEl.innerHTML =
        '<div style="color:var(--danger,#e05555);font-size:12px;padding:6px 0">Invite-Liste konnte nicht geladen werden.</div>';
    }
  }
}

async function createGroupInvite() {
  if (!curGroupId) return;
  const maxUsesRaw = $('gs-invite-max-uses')?.value?.trim();
  const expiryRaw = $('gs-invite-expiry')?.value;
  const withNotif = !!$('gs-invite-with-notification')?.checked;
  const btn = $('gs-invite-create-btn');

  const body = { groupIds: [curGroupId] };
  if (maxUsesRaw) {
    const maxUses = Number(maxUsesRaw);
    if (!Number.isInteger(maxUses) || maxUses < 1) {
      toast('Max Nutzungen muss eine ganze Zahl >= 1 sein', 'error');
      return;
    }
    body.maxUses = maxUses;
  }
  if (expiryRaw) {
    body.expiresAt = new Date(`${expiryRaw}T23:59:59`).toISOString();
  }
  if (withNotif) body.notificationText = true;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Erstelle…';
  }

  try {
    const { invite } = await apiCall('/invites', 'POST', body);
    toast('Invite-Link erstellt', 'success');
    if (invite?.url) copyInviteUrl(invite.url);
    const gsSection = document.getElementById('gs-invite-section');
    if (gsSection) gsSection.open = true;
    await refreshGroupInviteList();
  } catch (e) {
    toast(e.serverMessage || 'Invite konnte nicht erstellt werden', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Invite-Link erstellen';
    }
  }
}

async function deleteGroupInvite(inviteId) {
  if (!inviteId) return;
  try {
    await apiCall(`/invites/${inviteId}`, 'DELETE');
    toast('Invite-Link gelöscht', 'success');
    await refreshGroupInviteList();
  } catch (e) {
    toast(e.serverMessage || 'Invite-Link konnte nicht gelöscht werden', 'error');
  }
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
      _stagedFiles.length === 1 ? '1 Datei hochladen' : `${_stagedFiles.length} Dateien hochladen`;
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
        const isVideo = f.type.startsWith('video/');
        const url = URL.createObjectURL(f);
        const durationBadge =
          isVideo && Number.isFinite(f._videoDurationSeconds)
            ? `<span class="media-duration-badge">${formatMediaDuration(f._videoDurationSeconds)}</span>`
            : '';
        if (isVideo) {
          return `<div class="dz-thumb" id="dz-thumb-${i}">
      <video src="${url}#t=0.1" style="width:100%;height:100%;object-fit:cover" preload="auto" muted playsinline webkit-playsinline></video>
      <div class="dz-thumb-play"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.4)"/><polygon points="9.5,7 18,12 9.5,17" fill="white"/></svg></div>
      ${durationBadge}
      <button class="dz-thumb-del" onclick="_removeStagedFile(${i})" title="Entfernen">✕</button>
    </div>`;
        }
        return `<div class="dz-thumb" id="dz-thumb-${i}">
      <img src="${url}" alt="${esc(f.name)}" onload="revokeObjectUrlSafe(this.src)">
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

/** Liest die Dauer eines Video-Files via HTML5-Video-Element aus. */
function getVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

async function handleFiles(fileList) {
  const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime'];
  const allFiles = Array.from(fileList).filter(
    (f) => f.type.startsWith('image/') || ALLOWED_VIDEO.includes(f.type)
  );
  if (!allFiles.length) return;

  const oversized = allFiles.filter(
    (f) => ALLOWED_VIDEO.includes(f.type) && f.size > 200 * 1024 * 1024
  );
  if (oversized.length) {
    toast('Videos dürfen maximal 200 MB groß sein.', 'error');
    $('fi').value = '';
    return;
  }

  const validFiles = [];
  for (const f of allFiles) {
    if (ALLOWED_VIDEO.includes(f.type)) {
      const duration = await getVideoDuration(f);
      if (duration === null) {
        toast(`„${f.name}" konnte nicht gelesen werden.`, 'error');
        continue;
      }
      if (duration > 60) {
        toast(`„${f.name}" ist zu lang (${Math.round(duration)}s, max. 60 Sek.).`, 'error');
        continue;
      }
      f._videoDurationSeconds = Math.ceil(duration);
    }
    validFiles.push(f);
  }

  const remaining = UPLOAD_MAX_FILES - _stagedFiles.length;
  if (remaining <= 0) {
    toast(`Maximal ${UPLOAD_MAX_FILES} Dateien pro Upload erlaubt.`, 'error');
    $('fi').value = '';
    return;
  }
  const toAdd = validFiles.slice(0, remaining);
  if (validFiles.length > remaining) {
    toast(
      `Nur ${toAdd.length} von ${validFiles.length} Dateien hinzugefügt (Limit: ${UPLOAD_MAX_FILES}).`,
      'error'
    );
  }
  _stagedFiles.push(...toAdd);
  $('fi').value = '';
  _renderStagedPreviews();
}

async function startUpload() {
  const files = _stagedFiles;
  if (!files.length) return;
  const folder = SHARED;
  const desc = $('desc-input')?.value?.trim() || null;
  const feedBody = $('upload-share-feed-body')?.value?.trim() || null;
  const albumId = $('asel')?.value || null;
  const shareToFeed = !!$('upload-share-feed')?.checked;
  uploadShareToFeedEnabled = shareToFeed;
  hide('dz-wrap');
  show('prog-wrap');
  const PARALLEL = 3;
  let done = 0,
    failed = 0;
  const uploadedItems = [];

  // Process in parallel batches of 3
  async function uploadWithProgress(file) {
    try {
      const uploaded = await uploadOne(file, folder, desc, albumId);
      if (uploaded?.id) uploadedItems.push(uploaded);
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
    : `Fertig! ${done - failed} Dateien hochgeladen`;

  if (uploadedItems.length > 0) invalidateCounts();
  if (uploadedItems.length > 0 && shareToFeed && canPostToFeedInCurrentGroup()) {
    try {
      await postUploadSummaryToFeed({
        uploadedItems,
        failedCount: failed,
        albumId,
        description: feedBody || desc,
      });
      if (curModule === 'feed') await loadFeedPosts(true);
      toast('Upload im Feed geteilt', 'success');
    } catch (e) {
      toast(e.serverMessage || 'Upload konnte nicht im Feed geteilt werden', 'error');
    }
  }
  setTimeout(closeModal, 800);
  if (curFolder === folder) await loadPhotos(true);
  renderSidebar();
  _stagedFiles = [];
  $('fi').value = '';
  if (failed)
    toast(`${failed} Datei${failed > 1 ? 'en' : ''} konnten nicht hochgeladen werden`, 'error');
  else toast(`${done} Datei${done > 1 ? 'en' : ''} hochgeladen`, 'success');
}

async function uploadOne(file, folder = SHARED, desc = null, albumId = null) {
  const isVideo = file.type.startsWith('video/');
  let uploadFile;
  if (isVideo) {
    uploadFile = file;
  } else {
    const blob = await compress(file);
    uploadFile = new File([blob], file.name, { type: 'image/jpeg' });
  }

  const formData = new FormData();
  formData.append('file', uploadFile);
  formData.append('groupId', curGroupId);
  if (albumId) formData.append('albumId', albumId);
  if (desc) formData.append('description', desc);
  if (isVideo) {
    const duration = await getVideoDuration(file);
    if (duration !== null) formData.append('videoDuration', Math.ceil(duration).toString());
  }

  const storedToken = sessionStorage.getItem('accessToken');
  const resp = await fetch('/api/photos', {
    method: 'POST',
    headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
    body: formData,
  });
  if (!resp.ok) {
    let errMsg;
    try {
      const errData = await resp.json();
      errMsg = errData.error || 'Upload fehlgeschlagen';
    } catch {
      errMsg = 'Upload fehlgeschlagen';
    }
    throw new Error(errMsg);
  }
  const { photo } = await resp.json();
  return {
    id: photo?.id,
    mediaType: photo?.mediaType || (isVideo ? 'video' : 'image'),
    videoDuration:
      photo?.videoDuration !== undefined && photo?.videoDuration !== null
        ? photo.videoDuration
        : Number.isFinite(file?._videoDurationSeconds)
          ? file._videoDurationSeconds
          : null,
  };
}
// Drag&Drop-Listener werden in openModal() registriert (DOM erst dann vorhanden)

function resetLbVideoElement() {
  const oldVideo = $('lb-video');
  if (!oldVideo) return null;
  const newVideo = oldVideo.cloneNode(false);
  newVideo.id = 'lb-video';
  newVideo.setAttribute('controls', '');
  newVideo.setAttribute('playsinline', '');
  newVideo.setAttribute('webkit-playsinline', '');
  newVideo.preload = 'metadata';
  newVideo.style.display = 'none';
  oldVideo.replaceWith(newVideo);
  return newVideo;
}

// ── LIGHTBOX ─────────────────────────────────────────────
async function openLB(i) {
  lbIdx = i;
  const p = photos[i],
    u = allProfiles[p.uploaderId] || p.uploader || {};
  show('lb');
  initLbSwipe();
  // Lightbox: Foto-URL aus Cache
  const url = urlCache[p.id] || p.url || '';
  const lbImg = $('lb-img');
  let lbVideo = $('lb-video');
  const mediaUrl = url ? photoSrc(url) : '';
  if (p.mediaType === 'video') {
    lbVideo = resetLbVideoElement() || lbVideo;
    lbImg.style.display = 'none';
    lbImg.removeAttribute('src');
    lbVideo.currentTime = 0;
    lbVideo.autoplay = false;
    lbVideo.onended = null;
    if (mediaUrl) {
      lbVideo.src = mediaUrl;
      lbVideo.load();
      lbVideo.pause();
      lbVideo.style.display = 'block';
    } else {
      lbVideo.removeAttribute('src');
      lbVideo.style.display = 'none';
    }
  } else {
    if (lbVideo) {
      lbVideo.pause();
      lbVideo.removeAttribute('src');
      lbVideo.load();
      lbVideo.style.display = 'none';
    }
    lbImg.style.display = '';
    if (mediaUrl) lbImg.src = mediaUrl;
    else lbImg.removeAttribute('src');
  }
  $('lb-av').innerHTML = avatarHtml(u, 32);
  $('lb-av').style.background = u.avatar ? 'transparent' : u.color || '#888';
  $('lb-who').textContent = getVisibleName(u) || '?';
  $('lb-dt').textContent = fmtDateLong(p.created_at);
  $('lb-cnt').textContent = `${i + 1} / ${photos.length}`;
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
  if (ssPlaying) startSS();
  $('lb-prv').style.display = i > 0 ? '' : 'none';
  $('lb-nxt').style.display = i < photos.length - 1 ? '' : 'none';
  // Action buttons
  const d = $('lb-del-btn');
  if (d) {
    d.innerHTML = ICON_TRASH;
    canDeletePhotoInCurrentGroup(p) ? d.classList.remove('hidden') : d.classList.add('hidden');
  }
  const dn = $('lb-down-btn');
  if (dn) dn.innerHTML = ICON_DOWNLOAD;
  const ab = $('lb-album-btn');
  if (ab) ab.innerHTML = ICON_ALBUM;
  const shareBtn = $('lb-share-btn');
  if (shareBtn) {
    shareBtn.innerHTML = ICON_LINK;
    shareBtn.classList.toggle('hidden', !canPostToFeedInCurrentGroup() || p.uploaderId !== me.id);
    shareBtn.type = 'button';
    shareBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSharePhotoToFeedModal();
    };
  }
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

function openSharePhotoToFeedModal() {
  const p = photos[lbIdx];
  if (!p) return;
  if (p.uploaderId !== me.id) {
    toast('Du kannst nur deine eigenen Bilder teilen', 'error');
    return;
  }
  if (!canPostToFeedInCurrentGroup()) {
    toast('In dieser Gruppe ist Feed-Posten für Mitglieder gesperrt', 'error');
    return;
  }

  const modal = $('share-photo-feed-modal');
  if (!modal) return;
  const titleInput = $('share-photo-feed-title');
  const bodyInput = $('share-photo-feed-body');
  if (titleInput) {
    titleInput.value = p.description?.trim() ? `Foto: ${p.description.trim().slice(0, 80)}` : '';
  }
  if (bodyInput) bodyInput.value = '';
  bindFeedMentionInputs();
  show('share-photo-feed-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.zIndex = '4000';
  setTimeout(() => titleInput?.focus(), 50);
}

function closeSharePhotoToFeedModal() {
  const modal = $('share-photo-feed-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.style.zIndex = '';
  }
  hide('share-photo-feed-modal');
  const btn = $('share-photo-feed-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Teilen';
  }
}

async function submitPhotoShareToFeed() {
  const p = photos[lbIdx];
  if (!p) return;
  if (!canPostToFeedInCurrentGroup()) {
    toast('In dieser Gruppe ist Feed-Posten für Mitglieder gesperrt', 'error');
    return;
  }

  const titleInput = $('share-photo-feed-title');
  const bodyInput = $('share-photo-feed-body');
  const btn = $('share-photo-feed-btn');
  const title = String(titleInput?.value || '').trim();
  const body = String(bodyInput?.value || '').trim() || 'Schau dir dieses Bild an';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird geteilt...';
  }

  try {
    await apiCall('/group-feed', 'POST', {
      groupId: curGroupId,
      contentType: 'photo_share',
      title: title || null,
      body,
      entityType: 'photo',
      entityId: p.id,
      imageUrl: `/api/photos/${p.id}/file`,
      metadata: {
        groupId: curGroupId,
        photoId: p.id,
        mediaType: p.mediaType || 'image',
        videoDuration: Number.isFinite(p.videoDuration) ? p.videoDuration : null,
        uploaderId: p.uploaderId || null,
      },
    });
    closeSharePhotoToFeedModal();
    if (curModule === 'feed') await loadFeedPosts(true);
    toast('Bild im Feed geteilt', 'success');
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Teilen';
    }
    toast(e.serverMessage || 'Bild konnte nicht im Feed geteilt werden', 'error');
  }
}

window.openSharePhotoToFeedModal = openSharePhotoToFeedModal;
window.closeSharePhotoToFeedModal = closeSharePhotoToFeedModal;
window.submitPhotoShareToFeed = submitPhotoShareToFeed;
window.openShareAlbumToFeedModal = openShareAlbumToFeedModal;
window.closeShareAlbumToFeedModal = closeShareAlbumToFeedModal;
window.submitAlbumShareToFeed = submitAlbumShareToFeed;
window.openAlbumFromFeed = openAlbumFromFeed;
window.shareAlbumToFeed = shareAlbumToFeed;

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
      const canDel = canDeleteCommentInCurrentGroup(c);
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
  const lbVideo = $('lb-video');
  const isVideo = p.mediaType === 'video';
  const isFullview = isVideo
    ? document.fullscreenElement === lbVideo
    : $('lb').classList.contains('lb-fullview');
  const canDel = canDeletePhotoInCurrentGroup(p);
  const isAdmin = me?.role === 'admin';

  const items = [
    { icon: ICON_DOWNLOAD, label: 'Herunterladen', fn: 'downloadPhoto()', cls: '' },
    { icon: ICON_ALBUM, label: 'Album', fn: 'openAlbumPicker()', cls: '' },
    {
      icon: isFullview ? ICON_SHRINK : ICON_FULLSCREEN,
      label: isVideo
        ? isFullview
          ? 'Vollbild beenden'
          : 'Browser-Vollbild'
        : isFullview
          ? 'Verkleinern'
          : 'Vollbild',
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
  const lbVideo = $('lb-video');
  if (document.fullscreenElement === lbVideo) {
    document.exitFullscreen().catch(() => {});
  }
  if (lbVideo) {
    lbVideo.pause();
    lbVideo.removeAttribute('src');
    lbVideo.style.display = 'none';
  }
  resetLbVideoElement();
  $('lb-img').style.display = '';
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
    if (e?.status === 403 && e?.serverCode === 'not_group_member') {
      try {
        const { groups } = await apiCall('/groups/my', 'GET');
        myGroups = groups || [];
      } catch (_) {
        myGroups = myGroups || [];
      }
      if (myGroups.length > 0 && !myGroups.some((g) => g.id === curGroupId)) {
        curGroupId = myGroups[0].id;
        try {
          localStorage.setItem('activeGroup', curGroupId);
        } catch (_) {
          // Ignore localStorage errors
        }
      }
    }
    allAlbums = [];
  }
}

function openAlbumModal(fromLightbox = false) {
  renderAlbumList();
  const allowAlbumCreation = canCreateAlbum();
  const createInput = $('new-album-name');
  const createBtn = $('new-album-create-btn');
  const createHint = $('new-album-lock-hint');
  if (createInput) {
    createInput.disabled = !allowAlbumCreation;
    createInput.placeholder = allowAlbumCreation
      ? 'Neues Album benennen…'
      : 'Album-Erstellung ist für Mitglieder gesperrt';
    if (!allowAlbumCreation) createInput.value = '';
  }
  if (createBtn) createBtn.disabled = !allowAlbumCreation;
  if (createHint) createHint.classList.toggle('hidden', allowAlbumCreation);
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
  if (!canCreateAlbum()) {
    toast('Album-Erstellung ist in dieser Gruppe für Mitglieder gesperrt', 'error');
    return;
  }
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
  if (!canCreateAlbum()) {
    toast('Album-Erstellung ist in dieser Gruppe für Mitglieder gesperrt', 'error');
    return;
  }
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
  if (!canCreateAlbum()) {
    toast('Album-Erstellung ist in dieser Gruppe für Mitglieder gesperrt', 'error');
    return;
  }
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
  clearTimeout(ssTimer);

  const current = photos[lbIdx];
  const lbVideo = $('lb-video');
  if (current?.mediaType === 'video' && lbVideo && lbVideo.style.display !== 'none') {
    lbVideo.onended = () => {
      if (!ssPlaying) return;
      if (lbIdx < photos.length - 1) lbNav(1);
      else {
        pauseSS();
        closeLB();
      }
    };
    lbVideo.play().catch(() => {});
    return;
  }

  if (lbVideo) lbVideo.onended = null;
  ssTimer = setTimeout(() => {
    if (lbIdx < photos.length - 1) lbNav(1);
    else {
      pauseSS();
      closeLB();
    }
  }, ssSpeeds[ssSpeedIdx] * 1000);
}

function pauseSS() {
  ssPlaying = false;
  clearTimeout(ssTimer);
  const lbVideo = $('lb-video');
  if (lbVideo) lbVideo.onended = null;
  const icon = $('ss-play-icon');
  if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
}

document.addEventListener('fullscreenchange', () => {
  if ($('lb') && !$('lb').classList.contains('hidden')) updateFullviewBtn();
});

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

  // Reset export panel to collapsed state
  const exportCol = $('profile-export-collapsible');
  const exportToggle = $('profile-export-toggle');
  const exportChevron = $('profile-export-chevron');
  if (exportCol) exportCol.style.display = 'none';
  if (exportToggle) exportToggle.setAttribute('aria-expanded', 'false');
  if (exportChevron) exportChevron.style.transform = '';

  hide('profile-export-msg');

  // Reset account deletion panel to collapsed state
  const delCol = $('profile-delete-collapsible');
  const delToggle = $('profile-delete-toggle');
  const delChevron = $('profile-delete-chevron');
  if (delCol) delCol.style.display = 'none';
  if (delToggle) delToggle.setAttribute('aria-expanded', 'false');
  if (delChevron) delChevron.style.transform = '';
  hide('profile-delete-msg');

  show('profile-modal');
}

function fmtProfileDateTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function exportStatusLabel(status) {
  if (status === 'ready') return 'Bereit';
  if (status === 'running') return 'Wird erstellt';
  if (status === 'failed') return 'Fehlgeschlagen';
  return 'Eingeplant';
}

function exportStatusBadge(status) {
  const map = {
    ready: { label: 'Bereit', bg: '#1a7f4e', color: '#fff' },
    running: { label: 'Wird erstellt', bg: '#1a5fa8', color: '#fff' },
    failed: { label: 'Fehlgeschlagen', bg: '#c0392b', color: '#fff' },
    queued: { label: 'Eingeplant', bg: '#666', color: '#fff' },
  };
  const s = map[status] || map.queued;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:${s.bg};color:${s.color}">${s.label}</span>`;
}

async function downloadExportAuthenticated(downloadUrl, fallbackName = 'export.zip') {
  try {
    const response = await fetchWithAuth(backupSrc(downloadUrl), { method: 'GET' });

    if (!response.ok) {
      let serverMsg = '';
      try {
        const data = await response.json();
        serverMsg = data?.error || '';
      } catch (_) {}
      throw new Error(serverMsg || `Download fehlgeschlagen (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fallbackName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (e) {
    toast(e.message || 'Export konnte nicht heruntergeladen werden.', 'error');
  }
}

function renderProfileExports(exports = []) {
  const list = $('profile-export-list');
  if (!list) return;

  if (profileExportsLoading) {
    list.innerHTML =
      '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Exporte werden geladen…</div>';
    return;
  }

  if (!exports.length) {
    list.innerHTML =
      '<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Noch keine Exporte vorhanden.</div>';
    return;
  }

  list.innerHTML = exports
    .map((entry) => {
      const size = Number.isFinite(entry.sizeBytes)
        ? `${Math.max(1, Math.round(entry.sizeBytes / 1024 / 1024))} MB`
        : '—';
      const canDownload = !!entry.downloadUrl && !entry.expired;
      const downloadButton = canDownload
        ? `<button class="btn btn-ghost" onclick="downloadExportAuthenticated('${esc(entry.downloadUrl)}','export_${esc(entry.id)}.zip')" style="font-size:11px;padding:5px 10px">Download</button>`
        : `<button class="btn btn-ghost" disabled style="font-size:11px;padding:5px 10px;opacity:.55;cursor:not-allowed">Download</button>`;
      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel2)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div>${exportStatusBadge(entry.status)}</div>
            ${downloadButton}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px;display:grid;gap:3px">
            <div>Erstellt: ${esc(fmtProfileDateTime(entry.createdAt))}</div>
            <div>Gültig bis: ${esc(fmtProfileDateTime(entry.linkExpiry))}</div>
            <div>Dateien: ${esc(String(entry.photoCount || 0))}, Größe: ${esc(size)}</div>
            ${entry.errorMessage ? `<div style="color:#d46f6f">Fehler: ${esc(entry.errorMessage)}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadMyExports() {
  const btn = $('profile-export-refresh-btn');
  profileExportsLoading = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Lade…';
  }
  renderProfileExports([]);
  let exportsList = [];
  let loadError = null;

  try {
    const data = await apiCall('/exports/mine', 'GET');
    exportsList = data?.exports || [];
  } catch (e) {
    loadError = e;
  } finally {
    profileExportsLoading = false;
    renderProfileExports(exportsList);
    if (loadError) {
      flashInlineMessage(
        'profile-export-msg',
        'error',
        loadError.serverMessage || 'Exporte konnten nicht geladen werden.'
      );
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Aktualisieren';
    }
  }
}

async function requestMyContentExport() {
  const btn = $('profile-export-request-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird angefordert…';
  }

  try {
    const data = await apiCall('/exports/request', 'POST');
    const status = data?.export?.status
      ? ` (Status: ${exportStatusLabel(data.export.status)})`
      : '';
    flashInlineMessage('profile-export-msg', 'success', `✓ Export angefordert${status}`);
    toast('Export wurde gestartet.', 'success');
    await loadMyExports();
  } catch (e) {
    const err = e.serverMessage || e.message || 'Export konnte nicht angefordert werden.';
    flashInlineMessage('profile-export-msg', 'error', err);
    toast(err, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Export anfordern';
    }
  }
}

function toggleProfileExports() {
  const col = $('profile-export-collapsible');
  const toggle = $('profile-export-toggle');
  const chevron = $('profile-export-chevron');
  if (!col) return;
  const open = col.style.display !== 'none';
  col.style.display = open ? 'none' : 'block';
  if (toggle) toggle.setAttribute('aria-expanded', String(!open));
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (!open) loadMyExports();
}

function onProfileDeleteSuccessorChange() {
  const successorId = $('profile-delete-successor')?.value || '';
  const keepContent = $('profile-delete-keep-content');
  if (!keepContent) return;
  if (successorId) {
    keepContent.checked = true;
    keepContent.disabled = true;
  } else {
    keepContent.disabled = false;
  }
}

async function loadProfileDeletionCandidates() {
  const sel = $('profile-delete-successor');
  if (!sel || profileDeletionCandidatesLoaded) return;

  try {
    const { users } = await apiCall('/feedback/eligible-users', 'GET');
    const entries = (users || []).filter((u) => u?.id && u.id !== me?.id);
    sel.innerHTML =
      '<option value="">— Kein Erbe —</option>' +
      entries
        .map(
          (u) =>
            `<option value="${esc(u.id)}">${esc(getVisibleName(u, u.displayNameField) || u.username || u.name || 'Unbekannt')}</option>`
        )
        .join('');
    profileDeletionCandidatesLoaded = true;
  } catch {
    sel.innerHTML = '<option value="">— Erben-Liste konnte nicht geladen werden —</option>';
  }
}

async function loadAccountDeletionStatus() {
  try {
    const status = await apiCall('/account-deletion/status', 'GET');
    if (status?.status === 'scheduled' && status.purgeAt) {
      flashInlineMessage(
        'profile-delete-msg',
        'info',
        `Löschung geplant für ${fmtProfileDateTime(status.purgeAt)} (${status.daysRemaining} Tage verbleibend).`,
        8000
      );
    }
  } catch {
    // Kein harter Fehler für den Status-Check
  }
}

function toggleProfileAccountDeletion() {
  const col = $('profile-delete-collapsible');
  const toggle = $('profile-delete-toggle');
  const chevron = $('profile-delete-chevron');
  if (!col) return;

  const open = col.style.display !== 'none';
  col.style.display = open ? 'none' : 'block';
  if (toggle) toggle.setAttribute('aria-expanded', String(!open));
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';

  if (!open) {
    void loadProfileDeletionCandidates();
    void loadAccountDeletionStatus();
  }
}

async function requestAccountDeletionCode() {
  const btn = $('profile-delete-send-code-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Fordere an…';
  }

  try {
    const result = await apiCall('/account-deletion/request', 'POST');
    flashInlineMessage(
      'profile-delete-msg',
      'success',
      result.message || 'Bestätigungscode wurde angefordert.'
    );
    toast('Bestätigungscode wurde angefordert.', 'success');
  } catch (e) {
    const msg = e.serverMessage || e.message || 'Code konnte nicht angefordert werden.';
    flashInlineMessage('profile-delete-msg', 'error', msg, 7000);
    toast(msg, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Bestätigungscode anfordern';
    }
  }
}

async function confirmAccountDeletion() {
  const code = String($('profile-delete-code')?.value || '').trim();
  const successorUserId = $('profile-delete-successor')?.value || '';
  const keepContent = !!$('profile-delete-keep-content')?.checked;
  const btn = $('profile-delete-confirm-btn');

  if (!code) {
    flashInlineMessage('profile-delete-msg', 'error', 'Bitte gib den Bestätigungscode ein.');
    return;
  }

  const confirmed = await showConfirmDlg(
    'Account deaktivieren',
    'Dein Account wird für 14 Tage deaktiviert und danach endgültig gelöscht. Möchtest du fortfahren?',
    'Jetzt deaktivieren',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird deaktiviert…';
  }

  try {
    const payload = {
      code,
      successorUserId: successorUserId || null,
      keepContent: successorUserId ? false : keepContent,
    };
    const result = await apiCall('/account-deletion/confirm', 'POST', payload);
    flashInlineMessage(
      'profile-delete-msg',
      'success',
      result.message || 'Account wurde deaktiviert.'
    );
    toast('Account wurde deaktiviert. Du wirst jetzt abgemeldet.', 'success');
    await logout();
  } catch (e) {
    const msg = e.serverMessage || e.message || 'Account konnte nicht deaktiviert werden.';
    flashInlineMessage('profile-delete-msg', 'error', msg, 7000);
    toast(msg, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Account jetzt deaktivieren';
    }
  }
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
        '<p style="color:var(--muted);text-align:center;padding:20px;grid-column:1/-1">Keine Medien vorhanden.</p>';
      return;
    }
    allData.forEach((p) => {
      if (p.url) urlCache[p.id] = p.url;
    });
    grid.innerHTML = allData
      .map((p) => {
        const url = urlCache[p.id] || '';
        const isVideo = p.mediaType === 'video';
        const durationBadge =
          isVideo && Number.isFinite(Number(p.videoDuration)) && Number(p.videoDuration) > 0
            ? `<span class="media-duration-badge">${formatMediaDuration(p.videoDuration)}</span>`
            : '';
        const PLAY_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.45)"/><polygon points="9.5,7 19,12 9.5,17" fill="white"/></svg>`;
        const inAlbum = (p.albumIds || []).includes(curAlbum);
        return `<div class="add-photo-thumb${inAlbum ? ' selected' : ''}" id="apt-${p.id}" onclick="toggleAddSelection('${p.id}',${inAlbum})" title="${esc(p.filename || '')}">
        ${isVideo ? `<video class="add-photo-vid" src="${esc(photoSrc(url))}#t=0.1" preload="metadata" muted playsinline webkit-playsinline onloadedmetadata="this.currentTime=0.1" onloadeddata="this.classList.add('loaded')" onseeked="this.classList.add('loaded')"></video><div class="add-thumb-play">${PLAY_SVG}</div>${durationBadge}` : `<img src="${esc(photoSrc(url))}" loading="lazy">`}
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
  applyFeedbackCategoryConfig('default');
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

const FEEDBACK_CATEGORY_CONFIG = {
  default: {
    intro: 'Hast du ein Problem entdeckt, eine Idee oder brauchst Hilfe? Schreib uns!',
    hint: '',
    subjectPlaceholder: 'Kurze Zusammenfassung…',
    bodyPlaceholder: 'Beschreibe dein Anliegen möglichst genau…',
    anonymousLabel: 'Anonym einreichen (kein Name in der Nachricht an Admins)',
    successHtml:
      '<strong>Danke, angekommen!</strong><br><span>Wir haben dein Feedback erhalten und schauen es uns an.</span>',
  },
  bug: {
    intro: 'Melde Bugs so konkret wie möglich, damit wir sie sauber nachstellen können.',
    hint: 'Hilfreich sind: erwartetes Verhalten, tatsächliches Verhalten und die letzten Schritte davor.',
    subjectPlaceholder: 'z. B. Export bricht bei großen Alben ab',
    bodyPlaceholder: 'Was genau ist passiert? Wie lässt sich der Fehler reproduzieren?',
    anonymousLabel: 'Anonym melden (dein Name bleibt in der Nachricht an Admins verborgen)',
    successHtml:
      '<strong>Bug-Meldung eingereicht.</strong><br><span>Wir prüfen den Fehler und melden uns bei Rückfragen im Ticket.</span>',
  },
  feature: {
    intro: 'Beschreibe den gewünschten Mehrwert möglichst konkret, nicht nur die Idee.',
    hint: 'Hilfreich sind: Problem, gewünschtes Ergebnis und wer von der Änderung profitiert.',
    subjectPlaceholder: 'z. B. Export mit Album-Auswahl',
    bodyPlaceholder: 'Welche Funktion fehlt dir und warum wäre sie hilfreich?',
    anonymousLabel: 'Anonym einreichen (dein Name bleibt im Admin-Ticket verborgen)',
    successHtml:
      '<strong>Feature-Wunsch eingereicht.</strong><br><span>Wir prüfen, ob und wie der Vorschlag in die Planung passt.</span>',
  },
  help: {
    intro: 'Wenn du Hilfe brauchst, beschreibe kurz dein Ziel und wo du gerade festhängst.',
    hint: 'Je klarer dein Ziel beschrieben ist, desto schneller können wir helfen.',
    subjectPlaceholder: 'z. B. Wie teile ich ein Album mit einer Gruppe?',
    bodyPlaceholder: 'Was möchtest du erreichen und an welcher Stelle kommst du nicht weiter?',
    anonymousLabel: 'Anonym fragen (dein Name bleibt im Admin-Ticket verborgen)',
    successHtml:
      '<strong>Hilfe-Anfrage eingereicht.</strong><br><span>Wir melden uns über das Ticket bei dir zurück.</span>',
  },
  report_user: {
    intro: 'Nutzer-Meldungen werden als Moderationsfall behandelt.',
    hint: 'Beschreibe den Vorfall sachlich und konkret. Diese Ticket-Art hat einen separaten Prüfprozess.',
    subjectPlaceholder: 'z. B. Unangemessener Kommentar im Album',
    bodyPlaceholder: 'Was ist passiert, wann ist es passiert und warum meldest du den Vorfall?',
    anonymousLabel: 'Anonym melden (Admins sehen deinen Namen in der Nachricht nicht)',
    successHtml:
      '<strong>Nutzer-Meldung eingereicht.</strong><br><span>Der Fall wird geprüft. Antworten im Ticket sind bei dieser Kategorie nicht vorgesehen.</span>',
  },
  other: {
    intro:
      'Für Anliegen, die in keine andere Kategorie passen, kannst du hier ein freies Ticket erstellen.',
    hint: 'Wenn sich dein Anliegen später besser einordnen lässt, kann ein Admin die Ticket-Art anpassen.',
    subjectPlaceholder: 'Worum geht es?',
    bodyPlaceholder: 'Beschreibe dein Anliegen möglichst klar und vollständig…',
    anonymousLabel: 'Anonym einreichen (dein Name bleibt im Admin-Ticket verborgen)',
    successHtml:
      '<strong>Ticket eingereicht.</strong><br><span>Wir schauen uns dein Anliegen an und ordnen es bei Bedarf intern neu ein.</span>',
  },
};

function applyFeedbackCategoryConfig(category) {
  const config = FEEDBACK_CATEGORY_CONFIG[category] || FEEDBACK_CATEGORY_CONFIG.default;
  const intro = document.getElementById('feedback-intro');
  if (intro) intro.textContent = config.intro;

  const hint = document.getElementById('feedback-category-hint');
  if (hint) {
    hint.textContent = config.hint;
    hint.classList.toggle('hidden', !config.hint);
  }

  const subject = document.getElementById('feedback-subject');
  if (subject) subject.placeholder = config.subjectPlaceholder;

  const body = document.getElementById('feedback-body');
  if (body) body.placeholder = config.bodyPlaceholder;

  const anonymousLabel = document.getElementById('feedback-anonymous-label');
  if (anonymousLabel) anonymousLabel.textContent = config.anonymousLabel;
}

function onFeedbackCategoryChange() {
  const cat = document.getElementById('feedback-category')?.value;
  const wrap = document.getElementById('feedback-reported-user-wrap');
  if (wrap) wrap.classList.toggle('hidden', cat !== 'report_user');
  applyFeedbackCategoryConfig(cat || 'default');
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
  const successHtml =
    FEEDBACK_CATEGORY_CONFIG[category]?.successHtml || FEEDBACK_CATEGORY_CONFIG.default.successHtml;
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
    showMsg(successHtml, false, true);
    toast('Feedback erfolgreich gesendet', 'success');
    document.getElementById('feedback-subject').value = '';
    document.getElementById('feedback-body').value = '';
    document.getElementById('feedback-category').value = '';
    document.getElementById('feedback-anonymous').checked = false;
    document.getElementById('feedback-reported-user-wrap')?.classList.add('hidden');
    applyFeedbackCategoryConfig('default');
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
  const statusFilter = document.getElementById('af-filter-status');
  if (statusFilter) statusFilter.value = 'open';
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

function getFeedbackStatusLabel(report, viewer = 'admin') {
  if (report?.status === 'accepted') return 'Angenommen';
  if (report?.status === 'rejected') return 'Abgelehnt';
  if (report?.status === 'closed') return 'Geschlossen';
  if (report?.waitingFor === 'user') {
    return viewer === 'user' ? 'Offen - Wartet auf dich' : 'Offen - Wartet auf User';
  }
  return 'Offen - Wartet auf Support';
}

function getFeedbackItemStateClass(report, unreadFlag) {
  if (report?.status === 'accepted') return 'af-status-accepted';
  if (report?.status === 'rejected') return 'af-status-rejected';
  if (report?.status === 'closed') return 'af-status-closed';
  if (report?.status === 'open' && unreadFlag) return 'af-status-open-new';
  if (report?.status === 'open') return 'af-status-open';
  return 'af-status-read';
}

function canAdminReplyToFeedback(report) {
  return report?.category !== 'report_user' && report?.status === 'open';
}

function canUserReplyToFeedback(report) {
  return report?.category !== 'report_user' && report?.status === 'open';
}

async function showFeedbackDecisionDialog({ title, text, confirmLabel, checkboxLabel }) {
  return new Promise((resolve) => {
    document.getElementById('feedback-decision-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'feedback-decision-dlg';
    dlg.className = 'dlg-bg';
    dlg.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:600;animation:fadeIn .15s ease';
    dlg.innerHTML = `
      <div class="dlg" style="animation:scaleIn .2s ease;max-width:520px;width:min(92vw,520px)">
        <div class="dlg-ico">📝</div>
        <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">${esc(title)}</h3>
        <p style="font-size:13px;color:var(--muted);font-weight:300;margin:0 0 14px;line-height:1.5">${esc(text)}</p>
        <textarea id="fdd-note" placeholder="Begründung eingeben…" style="width:100%;min-height:120px;resize:vertical"></textarea>
        ${checkboxLabel ? `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:var(--text)"><input type="checkbox" id="fdd-checkbox"> ${esc(checkboxLabel)}</label>` : ''}
        <div class="dlg-btns" style="margin-top:16px">
          <button id="fdd-cancel" class="btn btn-ghost">Abbrechen</button>
          <button id="fdd-confirm" class="btn btn-primary">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#fdd-confirm').onclick = () => {
      const note = String(dlg.querySelector('#fdd-note')?.value || '').trim();
      const checked = dlg.querySelector('#fdd-checkbox')?.checked === true;
      dlg.remove();
      resolve({ confirmed: true, note, checked });
    };
    dlg.querySelector('#fdd-cancel').onclick = () => {
      dlg.remove();
      resolve({ confirmed: false, note: '', checked: false });
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) {
        dlg.remove();
        resolve({ confirmed: false, note: '', checked: false });
      }
    };
  });
}

async function showFeedbackRecategorizeDialog(currentCategory) {
  const { users } = await apiCall('/feedback/eligible-users', 'GET');
  return new Promise((resolve) => {
    document.getElementById('feedback-recateg-dlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'feedback-recateg-dlg';
    dlg.className = 'dlg-bg';
    dlg.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:600;animation:fadeIn .15s ease';
    dlg.innerHTML = `
      <div class="dlg" style="animation:scaleIn .2s ease;max-width:520px;width:min(92vw,520px)">
        <div class="dlg-ico">🔀</div>
        <h3 style="font-size:16px;font-weight:700;color:var(--text);margin:0 0 8px">Ticket-Art ändern</h3>
        <p style="font-size:13px;color:var(--muted);font-weight:300;margin:0 0 14px;line-height:1.5">Lege fest, wie dieses Ticket weitergeführt werden soll.</p>
        <div class="field" style="margin-bottom:12px">
          <label>Ziel-Kategorie</label>
          <select id="frd-category" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px">
            <option value="bug" ${currentCategory === 'bug' ? 'selected' : ''}>🐛 Bug</option>
            <option value="feature" ${currentCategory === 'feature' ? 'selected' : ''}>💡 Feature</option>
            <option value="help" ${currentCategory === 'help' ? 'selected' : ''}>❓ Hilfe</option>
            <option value="report_user" ${currentCategory === 'report_user' ? 'selected' : ''}>⚠️ Nutzer melden</option>
            <option value="other" ${currentCategory === 'other' ? 'selected' : ''}>💬 Sonstiges</option>
          </select>
        </div>
        <div class="field ${currentCategory === 'report_user' ? '' : 'hidden'}" id="frd-user-wrap" style="margin-bottom:12px">
          <label>Gemeldeter Nutzer</label>
          <select id="frd-user" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px">
            <option value="">— Bitte wählen —</option>
            ${users.map((user) => `<option value="${esc(user.id)}">${esc(getVisibleName(user, user.displayNameField) || user.name || user.username || user.id)}</option>`).join('')}
          </select>
        </div>
        <div class="dlg-btns">
          <button id="frd-cancel" class="btn btn-ghost">Abbrechen</button>
          <button id="frd-confirm" class="btn btn-primary">Speichern</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const categorySelect = dlg.querySelector('#frd-category');
    const userWrap = dlg.querySelector('#frd-user-wrap');
    categorySelect?.addEventListener('change', () => {
      const wantsReportedUser = categorySelect.value === 'report_user';
      userWrap?.classList.toggle('hidden', !wantsReportedUser);
    });
    dlg.querySelector('#frd-confirm').onclick = () => {
      const category = String(categorySelect?.value || '').trim();
      const reportedUserId = String(dlg.querySelector('#frd-user')?.value || '').trim();
      dlg.remove();
      resolve({ confirmed: true, category, reportedUserId });
    };
    dlg.querySelector('#frd-cancel').onclick = () => {
      dlg.remove();
      resolve({ confirmed: false, category: '', reportedUserId: '' });
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) {
        dlg.remove();
        resolve({ confirmed: false, category: '', reportedUserId: '' });
      }
    };
  });
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
    list.innerHTML = filteredReports
      .map((r) => {
        const resolutionReason = getResolutionReasonFromLatestMessage(r);
        return `
        <div class="af-item ${getFeedbackItemStateClass(r, r.unreadAdmin)}" data-id="${esc(r.id)}" data-status="${esc(r.status)}" data-category="${esc(r.category)}">
          <div class="af-item-hdr">
            <span class="af-cat-badge af-cat-${esc(r.category)}">${catLabel[r.category] || r.category}</span>
            ${r.anonymous ? '<span class="fb-anon-icon" title="Anonym eingereicht">🕵️</span>' : ''}
            <span class="af-status-badge af-status-badge-${esc(r.status)}">${esc(getFeedbackStatusLabel(r, 'admin'))}</span>
            ${r.unreadAdmin ? `<button class="af-read-indicator" onclick="markFeedbackAdminRead('${esc(r.id)}')" title="Als gelesen markieren" aria-label="Als gelesen markieren">✓</button>` : ''}
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
          ${r.githubIssueUrl ? `<div style="font-size:12px;color:var(--muted)">GitHub-Issue: <a href="${esc(r.githubIssueUrl)}" target="_blank" rel="noopener noreferrer">#${esc(r.githubIssueNumber || 'Issue')}</a></div>` : ''}
          <div class="af-item-actions">
            ${
              r.category !== 'report_user' && r.status === 'open'
                ? `<button class="btn btn-sm btn-ghost af-action-close" onclick="closeFeedbackTicket('${esc(r.id)}','${esc(r.waitingFor || 'support')}')">Erledigt</button>`
                : ''
            }
            ${
              (r.category === 'help' || r.category === 'other') && r.status === 'closed'
                ? `<button class="btn btn-sm btn-ghost af-action-reopen" onclick="setFeedbackStatus('${esc(r.id)}','open')">Wieder öffnen</button>`
                : ''
            }
            ${
              canAdminReplyToFeedback(r)
                ? `<button class="btn btn-sm btn-ghost af-action-reply" onclick="adminOpenConversation('${esc(r.id)}','${esc(r.subject)}')">${(r._count?.messages || 0) > 0 ? `💬 ${r._count.messages}` : '💬'} Antworten</button>`
                : ''
            }
            ${
              (r.category === 'bug' || r.category === 'feature') && r.status === 'open'
                ? `<button class="btn btn-sm btn-ghost af-action-accept" onclick="acceptFeedbackTicket('${esc(r.id)}')">Annehmen</button>
                   <button class="btn btn-sm btn-ghost af-action-reject" onclick="rejectFeedbackTicket('${esc(r.id)}')">Ablehnen</button>`
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
            ${
              r.category === 'other' || r.category === 'help'
                ? `<button class="btn btn-sm btn-ghost af-action-recateg" onclick="recategorizeFeedbackTicket('${esc(r.id)}','${esc(r.category)}')">Ticket-Art ändern</button>`
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

async function acceptFeedbackTicket(id) {
  const result = await showFeedbackDecisionDialog({
    title: 'Ticket annehmen',
    text: 'Halte kurz fest, warum dieses Ticket angenommen wird. Optional kann direkt ein GitHub-Issue erstellt werden.',
    confirmLabel: 'Annehmen',
    checkboxLabel: 'Zusätzlich GitHub-Issue erstellen',
  });
  if (!result?.confirmed) return;
  if (!result.note) {
    toast('Bitte eine Begründung angeben.', 'error');
    return;
  }
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}/accept`, 'PATCH', {
      decisionNote: result.note,
      createGithubIssue: result.checked,
    });
    renderAdminFeedbackList();
    toast('Ticket angenommen.', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Annehmen.', 'error');
  }
}

async function rejectFeedbackTicket(id) {
  const result = await showFeedbackDecisionDialog({
    title: 'Ticket ablehnen',
    text: 'Lege eine kurze, nachvollziehbare Begründung für die Ablehnung fest.',
    confirmLabel: 'Ablehnen',
  });
  if (!result?.confirmed) return;
  if (!result.note) {
    toast('Bitte eine Begründung angeben.', 'error');
    return;
  }
  try {
    await apiCall(`/feedback/${encodeURIComponent(id)}/reject`, 'PATCH', {
      decisionNote: result.note,
    });
    renderAdminFeedbackList();
    toast('Ticket abgelehnt.', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Ablehnen.', 'error');
  }
}

async function recategorizeFeedbackTicket(id, currentCategory) {
  try {
    const result = await showFeedbackRecategorizeDialog(currentCategory);
    if (!result?.confirmed) return;
    if (!result.category) {
      toast('Bitte eine Ziel-Kategorie auswählen.', 'error');
      return;
    }
    if (result.category === 'report_user' && !result.reportedUserId) {
      toast('Bitte einen gemeldeten Nutzer auswählen.', 'error');
      return;
    }
    await apiCall(`/feedback/${encodeURIComponent(id)}/recategorize`, 'PATCH', {
      category: result.category,
      reportedUserId: result.reportedUserId || undefined,
    });
    renderAdminFeedbackList();
    toast('Ticket-Art geändert.', 'success');
  } catch (e) {
    toast(e.serverMessage || 'Fehler beim Ändern der Ticket-Art.', 'error');
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
    const resolutionLabel = { no_action: 'Keine Maßnahme', action_taken: 'Maßnahme getroffen' };
    const canReply = (r) => canUserReplyToFeedback(r);
    list.innerHTML = reports
      .map((r) => {
        const msgCount = r._count?.messages || 0;
        const lastMsg = r.messages?.[0];
        const resolutionReason = getResolutionReasonFromLatestMessage(r);
        const itemStateClass = getFeedbackItemStateClass(r, r.unreadUser);
        return `<div class="my-fb-item ${itemStateClass}" data-id="${esc(r.id)}" data-status="${esc(r.status)}" data-category="${esc(r.category)}">
          <div class="af-item-hdr">
            <span class="af-cat-badge af-cat-${esc(r.category)}">${catLabel[r.category] || r.category}</span>
            ${r.anonymous ? '<span class="fb-anon-icon" title="Anonym eingereicht">🕵️</span>' : ''}
            <span class="af-status-badge af-status-badge-${esc(r.status)}">${esc(getFeedbackStatusLabel(r, 'user'))}</span>
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
          ${r.githubIssueUrl ? `<div style="font-size:12px;color:var(--muted)">GitHub-Issue: <a href="${esc(r.githubIssueUrl)}" target="_blank" rel="noopener noreferrer">#${esc(r.githubIssueNumber || 'Issue')}</a></div>` : ''}
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
  const item = document.querySelector(`[data-id="${CSS.escape(reportId)}"]`);
  const status = item?.getAttribute('data-status') || '';
  const category = item?.getAttribute('data-category') || '';
  _myConvCanReply = status === 'open' && category !== 'report_user';

  // Reuse admin conv modal for user too
  const title = document.getElementById('af-conv-title');
  if (title) title.textContent = subject || 'Konversation';
  const input = document.getElementById('af-conv-reply-input');
  if (input) input.value = '';

  // Hide reply area if closed or report_user
  const replyWrap = document.getElementById('af-conv-reply-wrap');
  const catEl = item?.querySelector('.af-cat-badge');
  const isReportUser =
    category === 'report_user' || catEl?.classList.contains('af-cat-report_user');
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
  // Issue 2: Wenn der Wizard gerade offen war, beim Gruppenwechsel
  // sauber zumachen — sonst zeigt der nächste Klick auf „Neues Turnier"
  // fälschlich „Wizard ist bereits offen".
  await teardownWizard();
  // Reload everything for new group
  await loadGroupMembers();
  curAlbum = null;
  curFilter = null;
  curFilterUserId = null;
  feedPosts = [];
  feedSkip = 0;
  feedHasMore = false;
  await loadAlbums();
  applyLastModuleState(curGroupId);
  saveLastModuleState(curGroupId);
  renderSidebar();
  renderGroupSwitcher();
  if (curModule === 'feed' && sidebarUiState.feedExpanded) {
    await loadFeedPosts(true);
  } else if (curModule === 'tournaments' && sidebarUiState.tournamentsExpanded) {
    await loadActiveTournamentView(true);
  } else {
    await loadPhotos(true);
  }
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
  placeholder = '',
  options = {}
) {
  return new Promise((resolve) => {
    const checkboxLabel =
      typeof options?.checkboxLabel === 'string' ? options.checkboxLabel.trim() : '';
    const checkboxDefault = options?.checkboxDefault === true;
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
        ${
          checkboxLabel
            ? `<label style="display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--text);margin:0 0 14px;line-height:1.45;cursor:pointer">
                <input id="cdlg-checkbox" type="checkbox" ${checkboxDefault ? 'checked' : ''}
                  style="margin-top:2px;accent-color:var(--danger,#e05555)">
                <span>${esc(checkboxLabel)}</span>
              </label>`
            : ''
        }
        <div class="dlg-btns">
          <button id="cdlg-cancel" class="btn btn-ghost">${esc(cancelLabel)}</button>
          <button id="cdlg-confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('#cdlg-input');
    const checkbox = dlg.querySelector('#cdlg-checkbox');
    input?.focus();
    dlg.querySelector('#cdlg-confirm').onclick = () => {
      const value = String(input?.value || '').trim();
      dlg.remove();
      resolve({ confirmed: true, text: value, checked: !!checkbox?.checked });
    };
    dlg.querySelector('#cdlg-cancel').onclick = () => {
      dlg.remove();
      resolve({ confirmed: false, text: '', checked: false });
    };
    dlg.onclick = (e) => {
      if (e.target === dlg) {
        dlg.remove();
        resolve({ confirmed: false, text: '', checked: false });
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
  const reasonPrompt = await showTextConfirmDlg(
    'Benutzer dauerhaft löschen',
    `Bitte einen Löschgrund für „${userName}" eingeben. Dieser wird protokolliert.`,
    'Weiter',
    'Abbrechen',
    true,
    'Löschgrund (Pflichtfeld)',
    {
      checkboxLabel:
        'Zusätzlich Login mit demselben Auth-Account blockieren (empfohlen bei Missbrauch/Fake-Accounts).',
    }
  );
  if (!reasonPrompt.confirmed) return;

  const reason = String(reasonPrompt.text || '').trim();
  const blockAuthIdentity = reasonPrompt.checked === true;
  if (!reason) {
    toast('Ein Löschgrund ist erforderlich', 'error');
    return;
  }

  const finalConfirm = await showConfirmDlg(
    'Endgültig und irreversibel löschen',
    `Diese Aktion löscht „${userName}" inklusive Fotos, Kommentaren und Likes dauerhaft. Sie ist nicht reversibel und kann nicht rückgängig gemacht werden.`,
    'Endgültig löschen',
    'Abbrechen',
    true
  );
  if (!finalConfirm) return;

  try {
    await apiCall(`/admin/users/${userId}`, 'DELETE', {
      reason,
      irreversibleConfirmed: true,
      blockAuthIdentity,
    });
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

let _adminExportsCache = [];

function _filterAdminExports() {
  const input = document.getElementById('admin-exports-filter');
  const query = (input?.value || '').trim().toLowerCase();
  const inner = document.getElementById('admin-exports-inner-list');
  if (!inner) return;

  const filtered = query
    ? _adminExportsCache.filter(
        (e) =>
          (e.userLabel || e.userId || '').toLowerCase().includes(query) ||
          (e.status || '').toLowerCase().includes(query)
      )
    : _adminExportsCache;

  const buildExportCard = (e) => {
    const created = new Date(e.createdAt).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const createdTime = new Date(e.createdAt).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const expiry = new Date(e.linkExpiry);
    const now = new Date();
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    const expired = e.expired || daysLeft <= 0;
    const expiryStr = expired ? 'Abgelaufen' : `noch ${daysLeft} Tag${daysLeft !== 1 ? 'e' : ''}`;
    const sizeMB = e.sizeBytes ? (e.sizeBytes / 1024 / 1024).toFixed(1) + ' MB' : null;
    return `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:700;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">👤 ${esc(e.userLabel || e.userId)}</span>
              ${exportStatusBadge(e.status)}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">
              <span style="font-size:12px;color:var(--muted)">🗓 ${created}, ${createdTime} Uhr</span>
              <span style="font-size:12px;color:var(--muted)">🖼️ ${e.photoCount || 0} Datei${e.photoCount === 1 ? '' : 'en'}</span>
              ${sizeMB ? `<span style="font-size:12px;color:var(--muted)">💾 ${sizeMB}</span>` : ''}
            </div>
            <div style="font-size:12px;color:${expired ? 'var(--danger,#e05555)' : 'var(--muted)'};margin-top:4px;font-weight:600">${expiryStr}</div>
            ${e.errorMessage ? `<div style="font-size:12px;color:var(--danger,#e05555);margin-top:4px">${esc(e.errorMessage)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:flex-start">
            ${e.downloadUrl && !expired ? `<button onclick="downloadExportAuthenticated('${esc(e.downloadUrl)}','export_${esc(e.id)}.zip')" style="background:var(--accent);border:none;color:#fff;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Download</button>` : ''}
            <button onclick="adminRefreshUserExportLink('${esc(e.id)}')" style="background:var(--accent-l);border:none;color:var(--accent);padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Link erneuern</button>
            <button onclick="adminDeleteUserExport('${esc(e.id)}','${esc(e.userLabel || e.userId)}')" style="background:none;border:1.5px solid var(--danger,#e05555);color:var(--danger,#e05555);padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Löschen</button>
          </div>
        </div>
      </div>`;
  };

  if (!filtered.length) {
    inner.innerHTML = query
      ? `<div style="font-size:12px;color:var(--muted)">Keine Ergebnisse für „${esc(query)}“.</div>`
      : '<div style="font-size:12px;color:var(--muted)">Keine User-Exporte vorhanden.</div>';
    return;
  }
  inner.innerHTML = filtered.map(buildExportCard).join('');
}

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
    const [{ backups }, exportsPayload] = await Promise.all([
      apiCall('/groups/admin/backups', 'GET'),
      apiCall('/exports/admin/exports', 'GET'),
    ]);
    _adminExportsCache = exportsPayload?.exports || [];

    const backupHtml = (backups || [])
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
          ? 'Abgelaufen'
          : `noch ${daysLeft} Tag${daysLeft !== 1 ? 'e' : ''}`;
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
            ${!expired ? `<a href="${esc(backupSrc(b.downloadUrl))}" target="_blank" rel="noopener" style="background:var(--accent);color:#fff;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center">Download</a>` : ''}
            <button onclick="adminRefreshBackupLink('${esc(b.zipKey)}')" style="background:var(--accent-l);border:none;color:var(--accent);padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Link erneuern</button>
            <button onclick="adminDeleteBackupEntry('${esc(b.zipKey)}','${esc(b.groupName)}')" style="background:none;border:1.5px solid var(--danger,#e05555);color:var(--danger,#e05555);padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Löschen</button>
          </div>
        </div>
      </div>`;
      })
      .join('');

    if (!backupHtml && !_adminExportsCache.length) {
      list.innerHTML =
        '<p style="color:var(--muted);text-align:center;padding:24px">Keine Backups oder Exporte vorhanden.</p>';
      return;
    }

    list.innerHTML = `
      <div style="display:grid;gap:14px">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--muted2);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Gruppen-Backups</div>
          <div style="display:flex;flex-direction:column;gap:10px">${backupHtml || '<div style="font-size:12px;color:var(--muted)">Keine Gruppen-Backups vorhanden.</div>'}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
            <div style="font-size:12px;font-weight:700;color:var(--muted2);letter-spacing:1px;text-transform:uppercase">User-Exporte</div>
            <button onclick="adminCleanupExpiredExports()" style="background:none;border:1.5px solid var(--border);color:var(--muted);padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Abgelaufene aufräumen</button>
          </div>
          <input
            id="admin-exports-filter"
            type="search"
            placeholder="Suche nach Nutzer oder Status…"
            oninput="_filterAdminExports()"
            style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:var(--input,var(--panel2));color:var(--text);margin-bottom:10px"
          >
          <div id="admin-exports-inner-list" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>
      </div>
    `;
    _filterAdminExports();
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

async function adminRefreshUserExportLink(exportId) {
  try {
    const { linkExpiry } = await apiCall(
      `/exports/admin/exports/${encodeURIComponent(exportId)}/refresh`,
      'POST'
    );
    const d = new Date(linkExpiry).toLocaleDateString('de-DE');
    toast(`Export-Link verlängert bis ${d}`, 'success');
    await renderAdminBackups();
  } catch (e) {
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function adminDeleteUserExport(exportId, userLabel) {
  const confirmed = await showConfirmDlg(
    'Export endgültig löschen',
    `Der Export von „${userLabel}" wird unwiderruflich gelöscht.`,
    'Löschen',
    'Abbrechen',
    true
  );
  if (!confirmed) return;

  try {
    await apiCall(`/exports/admin/exports/${encodeURIComponent(exportId)}`, 'DELETE');
    toast('Export gelöscht', 'success');
    await renderAdminBackups();
  } catch (e) {
    toast('❌ ' + (e.serverMessage || e.message), 'error');
  }
}

async function adminCleanupExpiredExports() {
  try {
    const result = await apiCall('/exports/admin/exports/cleanup', 'POST');
    toast(`Cleanup: ${result.removed} gelöscht, ${result.errors} Fehler`, 'success');
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
    adminGroupsCache = groups || [];
    renderAdminInviteGroupOptions(adminGroupsCache);
    populateAdminInviteGroupSelector(adminGroupsCache);
    if (!groups.length) {
      list.innerHTML =
        '<div style="color:var(--muted);font-size:13px;padding:8px 0">Keine Gruppen vorhanden.</div>';
      const inviteOptions = $('ag-invite-group-options');
      const inviteList = $('ag-invite-list');
      if (inviteOptions) inviteOptions.innerHTML = '';
      if (inviteList) inviteList.innerHTML = '';
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

function renderAdminInviteGroupOptions(groups = []) {
  const container = $('ag-invite-group-options');
  if (!container) return;
  if (!groups.length) {
    container.innerHTML =
      '<span style="font-size:12px;color:var(--muted)">Keine Gruppen verfügbar.</span>';
    return;
  }
  container.innerHTML = groups
    .map(
      (g) => `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);padding:4px 0;cursor:pointer">
        <input type="checkbox" class="ag-invite-group-checkbox" value="${g.id}" style="accent-color:var(--accent)">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</span>
      </label>`
    )
    .join('');
}

function populateAdminInviteGroupSelector(groups = []) {
  const select = $('ag-invite-list-group');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">— Gruppe wählen —</option>';
  groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  });
  if (current && groups.some((g) => g.id === current)) {
    select.value = current;
  } else if (!select.value && groups.length) {
    select.value = groups[0].id;
  }
  adminLoadInvitesForSelectedGroup();
}

function getSelectedAdminInviteGroupIds() {
  return Array.from(document.querySelectorAll('.ag-invite-group-checkbox:checked'))
    .map((el) => el.value)
    .filter(Boolean);
}

async function adminCreateInvite() {
  const msgEl = $('ag-invite-msg');
  const btn = $('ag-invite-create-btn');
  const groupIds = getSelectedAdminInviteGroupIds();
  const maxUsesRaw = $('ag-invite-max-uses')?.value?.trim();
  const expiryRaw = $('ag-invite-expiry')?.value;
  const notificationText = $('ag-invite-notification')?.value?.trim();

  if (!groupIds.length) {
    if (msgEl) {
      msgEl.textContent = '⚠ Mindestens eine Gruppe auswählen';
      msgEl.className = 'msg msg-error';
      msgEl.classList.remove('hidden');
    }
    return;
  }

  const body = { groupIds };
  if (maxUsesRaw) {
    const maxUses = Number(maxUsesRaw);
    if (!Number.isInteger(maxUses) || maxUses < 1) {
      if (msgEl) {
        msgEl.textContent = '⚠ Max Nutzungen muss eine ganze Zahl >= 1 sein';
        msgEl.className = 'msg msg-error';
        msgEl.classList.remove('hidden');
      }
      return;
    }
    body.maxUses = maxUses;
  }
  if (expiryRaw) body.expiresAt = new Date(`${expiryRaw}T23:59:59`).toISOString();
  if (notificationText) body.notificationText = notificationText;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Erstelle…';
  }

  try {
    const { invite } = await apiCall('/invites', 'POST', body);
    const agSection = document.getElementById('ag-invite-section');
    if (agSection) agSection.open = true;
    if (msgEl) {
      msgEl.textContent = `✅ Invite erstellt: ${invite.url}`;
      msgEl.className = 'msg msg-success';
      msgEl.classList.remove('hidden');
    }
    if ($('ag-invite-max-uses')) $('ag-invite-max-uses').value = '';
    if ($('ag-invite-expiry')) $('ag-invite-expiry').value = '';
    if ($('ag-invite-notification')) $('ag-invite-notification').value = '';
    document.querySelectorAll('.ag-invite-group-checkbox').forEach((el) => {
      el.checked = false;
    });
    await adminLoadInvitesForSelectedGroup();
  } catch (e) {
    if (msgEl) {
      msgEl.textContent =
        '❌ ' + (e.serverMessage || e.message || 'Invite konnte nicht erstellt werden');
      msgEl.className = 'msg msg-error';
      msgEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Invite-Link erstellen';
    }
  }
}

function renderAdminInviteList(invites = []) {
  const listEl = $('ag-invite-list');
  if (!listEl) return;
  if (!invites.length) {
    listEl.innerHTML =
      '<span style="font-size:12px;color:var(--muted)">Keine Invite-Links in dieser Gruppe.</span>';
    return;
  }
  listEl.innerHTML = invites
    .map((invite) => {
      const usage =
        invite.maxUses === null || invite.maxUses === undefined
          ? `${invite.useCount} Nutzungen`
          : `${invite.useCount}/${invite.maxUses} Nutzungen`;
      const creator = invite.creator?.name || invite.creator?.username || 'Unbekannt';
      return `
      <div style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span style="font-size:12px;color:var(--text);font-weight:600">${usage} · ${esc(creator)}</span>
          <span style="font-size:11px;color:var(--muted)">bis ${fmtInviteDate(invite.expiresAt)}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;word-break:break-all">${esc(invite.url || '')}</div>
        <div style="display:flex;gap:6px;margin-top:7px">
          <button class="btn btn-ghost" style="padding:6px 8px;font-size:12px" data-url="${esc(invite.url || '')}" onclick="copyInviteUrl(this.dataset.url)">Kopieren</button>
          <button class="btn btn-danger" style="padding:6px 8px;font-size:12px" onclick="adminDeleteInvite('${invite.id}')">Löschen</button>
        </div>
      </div>`;
    })
    .join('');
}

async function adminLoadInvitesForSelectedGroup() {
  const groupId = $('ag-invite-list-group')?.value;
  const listEl = $('ag-invite-list');
  if (!listEl) return;
  if (!groupId) {
    listEl.innerHTML =
      '<span style="font-size:12px;color:var(--muted)">Bitte eine Gruppe auswählen.</span>';
    return;
  }
  listEl.innerHTML =
    '<span style="font-size:12px;color:var(--muted)">Invite-Links werden geladen…</span>';
  try {
    const { invites } = await apiCall(`/invites/group/${groupId}`, 'GET');
    renderAdminInviteList(invites || []);
  } catch (e) {
    listEl.innerHTML =
      '<span style="font-size:12px;color:var(--danger,#e05555)">Invite-Liste konnte nicht geladen werden.</span>';
  }
}

async function adminDeleteInvite(inviteId) {
  if (!inviteId) return;
  try {
    await apiCall(`/invites/${inviteId}`, 'DELETE');
    toast('Invite-Link gelöscht', 'success');
    await adminLoadInvitesForSelectedGroup();
    if (curGroupId) await refreshGroupInviteList();
  } catch (e) {
    toast(e.serverMessage || 'Invite-Link konnte nicht gelöscht werden', 'error');
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
  const createInvite = !!$('ag-new-create-invite')?.checked;
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
    const group = await apiCall('/groups/admin/create', 'POST', {
      name,
      code,
      maxMembers,
      memberLimitLocked,
    });

    let createdInviteUrl = null;
    if (createInvite && group?.id) {
      const inviteRes = await apiCall('/invites', 'POST', { groupIds: [group.id] });
      createdInviteUrl = inviteRes?.invite?.url || null;
    }

    $('ag-new-name').value = '';
    $('ag-new-code').value = '';
    $('ag-new-limit-enabled').checked = false;
    $('ag-new-limit-locked').checked = false;
    if ($('ag-new-create-invite')) $('ag-new-create-invite').checked = false;
    if (limitInput) {
      limitInput.value = '';
      limitInput.disabled = true;
    }

    if (createdInviteUrl && msgEl) {
      msgEl.textContent = `✅ Gruppe angelegt + Invite erstellt: ${createdInviteUrl}`;
      msgEl.className = 'msg msg-success';
      msgEl.classList.remove('hidden');
    } else {
      msgEl.classList.add('hidden');
    }

    await renderAdminGroups();
    toast(createInvite ? 'Gruppe + Invite angelegt' : 'Gruppe angelegt', 'success');
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
  if (me?.role !== 'admin' && !isOwner && !isDeputy && !g.inviteCodeVisibleToMembers) {
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
  hide('leave-delete-content-wrap');
  const delOwnChk = $('leave-delete-content');
  if (delOwnChk) delOwnChk.checked = false;
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
      if (!isLastGroup) show('leave-delete-content-wrap');
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
      hide('leave-delete-content-wrap');
    } else if (otherMembers.length === 0) {
      // Owner + alleiniges Mitglied + nicht letzte Gruppe → Auflösen möglich
      show('leave-dissolve-section');
      $('leave-group-btn').style.display = 'none';
      $('leave-dissolve-btn').style.display = '';
      $('leave-dissolve-last-group-hint').classList.add('hidden');
      hide('leave-delete-content-wrap');
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
      show('leave-delete-content-wrap');
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
  const deleteOwnContent = !!$('leave-delete-content')?.checked;

  if (!isOwner || successorId) {
    const confirmed = await showConfirmDlg(
      `„${groupName}" verlassen`,
      successorId
        ? `Du überträgst die Ownership auf den gewählten Nachfolger und verlässt die Gruppe.`
        : deleteOwnContent
          ? 'Du verlässt diese Gruppe. Dein eigener Content in dieser Gruppe wird gelöscht.'
          : 'Du verlässt diese Gruppe und siehst ihre Fotos nicht mehr. Deine hochgeladenen Fotos bleiben erhalten.',
      successorId ? 'Übertragen & Verlassen' : 'Verlassen',
      'Abbrechen',
      true
    );
    if (!confirmed) return;
  }

  setBL('leave-group-btn', true, 'Wird verlassen…');
  try {
    const leavePayload = {
      ...(successorId ? { successorId } : {}),
      ...(deleteOwnContent ? { deleteOwnContent: true } : {}),
    };
    const leaveResult = await apiCall(
      `/groups/${groupId}/leave`,
      'DELETE',
      Object.keys(leavePayload).length ? leavePayload : undefined
    );
    const albumSummary = `Alben: ${leaveResult?.deletedOwnedAlbums || 0} gelöscht, ${leaveResult?.transferredOwnedAlbums || 0} übertragen, ${leaveResult?.removedAlbumContributorLinks || 0} Contributor entfernt`;
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
      if (deleteOwnContent) {
        toast(
          `„${groupName}" verlassen. Content: ${leaveResult?.deletedPhotos || 0} Fotos, ${leaveResult?.deletedComments || 0} Kommentare, ${leaveResult?.deletedLikes || 0} Likes. ${albumSummary}. Jetzt in „${myGroups[0].name}".`,
          'success'
        );
      } else {
        toast(
          `„${groupName}" verlassen. ${albumSummary}. Jetzt in „${myGroups[0].name}".`,
          'success'
        );
      }
    } else {
      renderGroupSwitcher();
      renderSidebar();
      if (deleteOwnContent) {
        toast(
          `„${groupName}" verlassen. Content: ${leaveResult?.deletedPhotos || 0} Fotos, ${leaveResult?.deletedComments || 0} Kommentare, ${leaveResult?.deletedLikes || 0} Likes. ${albumSummary}.`,
          'success'
        );
      } else {
        toast(`„${groupName}" verlassen. ${albumSummary}.`, 'success');
      }
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
  const removable = ids.filter((id) => {
    const p = photos.find((x) => x.id === id);
    return canDeletePhotoInCurrentGroup(p);
  });
  const foreign = ids.length - removable.length;
  const dlg = $('del-dlg');
  const ico = dlg.querySelector('.dlg-ico');
  const txt = dlg.querySelector('p');
  const btns = dlg.querySelector('.dlg-btns');
  if (ico) ico.textContent = '🗑';
  if (removable.length === 0) {
    if (txt) txt.textContent = 'Keines der ausgewählten Fotos kann von dir gelöscht werden.';
    btns.className = 'dlg-btns';
    btns.innerHTML = `<button class="btn btn-ghost" onclick="cancelDel()">Verstanden</button>`;
  } else if (foreign > 0) {
    if (txt)
      txt.textContent = `${removable.length} löschbare${removable.length > 1 ? ' Fotos' : ' Foto'} löschen? (${foreign} nicht erlaubte${foreign > 1 ? ' Fotos' : ' Foto'} werden übersprungen)`;
    btns.className = 'dlg-btns';
    btns.innerHTML = `
      <button class="btn btn-ghost" onclick="cancelDel()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execBulkDelete()">Löschbare löschen</button>`;
  } else {
    if (txt)
      txt.textContent = `${removable.length} Foto${removable.length > 1 ? 's' : ''} wirklich unwiderruflich löschen?`;
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
    return canDeletePhotoInCurrentGroup(p);
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

let zoomScale = 1;
let _lbSwipeInited = false;
let _isPinching = false,
  _pinchStartDist = 0,
  _pinchStartScale = 1,
  _pinchBaseRect = null,
  _pinchOriginX = 50,
  _pinchOriginY = 50,
  _lastTapTs = 0;

function initLbSwipe() {
  const el = $('lb');
  if (!el || _lbSwipeInited) return;
  _lbSwipeInited = true;

  el.addEventListener(
    'touchstart',
    (e) => {
      const target = e.target;
      if (target?.closest('#lb-video') || target?.closest('.lb-panel')) return;
      if (e.touches.length === 2) {
        // Nur das Bild darf gezoomt werden (nicht die ganze Seite).
        if (!target?.closest('#lb-img')) return;
        const img = $('lb-img');
        if (!img || img.style.display === 'none') return;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        _pinchStartDist = Math.hypot(dx, dy) || 1;
        _pinchStartScale = zoomScale;
        _pinchBaseRect = img.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = _pinchBaseRect;
        _pinchOriginX = ((cx - rect.left) / Math.max(rect.width, 1)) * 100;
        _pinchOriginY = ((cy - rect.top) / Math.max(rect.height, 1)) * 100;
        img.style.transformOrigin = `${_pinchOriginX}% ${_pinchOriginY}%`;
        _isPinching = true;
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
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
      const target = e.target;
      if (target?.closest('#lb-video') || target?.closest('.lb-panel')) return;
      if (_isPinching && e.touches.length === 2) {
        const img = $('lb-img');
        if (!img || img.style.display === 'none') return;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy) || 1;
        zoomScale = Math.min(4, Math.max(1, _pinchStartScale * (dist / _pinchStartDist)));

        // Ursprung darf sich während der Geste bewegen, aber relativ zum Start-Rect.
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = _pinchBaseRect || img.getBoundingClientRect();
        _pinchOriginX = ((cx - rect.left) / Math.max(rect.width, 1)) * 100;
        _pinchOriginY = ((cy - rect.top) / Math.max(rect.height, 1)) * 100;
        _pinchOriginX = Math.max(0, Math.min(100, _pinchOriginX));
        _pinchOriginY = Math.max(0, Math.min(100, _pinchOriginY));
        img.style.transformOrigin = `${_pinchOriginX}% ${_pinchOriginY}%`;
        img.style.transform = `scale(${zoomScale})`;
        img.style.transition = 'none';
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        if (zoomScale > 1) return;
        touchMoved = true;
      }
    },
    { passive: false }
  );

  el.addEventListener(
    'touchend',
    (e) => {
      const target = e.target;
      if (target?.closest('#lb-video') || target?.closest('.lb-panel')) return;

      if (!_isPinching && !touchMoved && target?.closest('#lb-img')) {
        const now = Date.now();
        if (now - _lastTapTs < 280) {
          resetZoom();
          _lastTapTs = 0;
          return;
        }
        _lastTapTs = now;
      }

      if (_isPinching && e.touches.length < 2) {
        _isPinching = false;
        _pinchBaseRect = null;
        if (zoomScale <= 1.01) resetZoom();
        return;
      }

      if (zoomScale > 1) return;
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
window.onThumbLoad = onThumbLoad;

// ── FULLVIEW MODE ─────────────────────────────────────────
async function toggleFullview() {
  const p = photos[lbIdx];
  const lbVideo = $('lb-video');
  if (p?.mediaType === 'video' && lbVideo && lbVideo.style.display !== 'none') {
    try {
      if (document.fullscreenElement === lbVideo) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement) {
        await lbVideo.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
    updateFullviewBtn();
    return;
  }

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
  const p = photos[lbIdx];
  const lbVideo = $('lb-video');
  if (p?.mediaType === 'video' && lbVideo && lbVideo.style.display !== 'none') {
    const inFs = document.fullscreenElement === lbVideo;
    btn.innerHTML = inFs ? ICON_SHRINK : ICON_FULLSCREEN;
    btn.title = inFs ? 'Vollbild beenden' : 'Browser-Vollbild';
    return;
  }
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
  feedPostCommented: '💬',
  feedPostLiked: '❤️',
  feedCommentMentioned: '@',
  feedCommentReplied: '↩️',
  feedCommentLiked: '❤️',
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

function _notifExtractGroupIdFromEntityUrl(entityUrl) {
  if (!entityUrl) return null;
  try {
    const parsed = new URL(entityUrl, window.location.origin);
    const groupId = parsed.searchParams.get('groupId');
    return groupId ? String(groupId).trim() : null;
  } catch (_) {
    return null;
  }
}

async function _notifResolveFeedPostGroupId(item) {
  if (item?.groupId) return item.groupId;

  const fromUrl = _notifExtractGroupIdFromEntityUrl(item?.entityUrl);
  if (fromUrl) return fromUrl;

  if (!item?.entityId) return null;

  try {
    const data = await apiCall(`/group-feed/${encodeURIComponent(item.entityId)}`, 'GET');
    return data?.post?.groupId || null;
  } catch (_) {
    return null;
  }
}

async function _notifNavigate(item) {
  const { entityId, entityType } = item;
  try {
    if (entityType === 'photo') {
      await openPhotoInFotosModule(entityId);
    } else if (entityType === 'album') {
      const album = allAlbums.find((a) => a.id === entityId);
      if (album) {
        if (album.groupId && album.groupId !== curGroupId) await switchGroup(album.groupId);
        await switchAlbum(entityId);
      }
    } else if (entityType === 'groupFeedPost') {
      const targetGroupId = await _notifResolveFeedPostGroupId(item);
      if (targetGroupId && targetGroupId !== curGroupId) {
        await switchGroup(targetGroupId);
      }
      if (entityId) {
        setPendingFeedPostTarget(entityId);
        await handlePendingFeedPostTarget();
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
  feedPostCommented: {
    label: 'Kommentar auf deinen Feed-Post',
    hint: 'Jemand hat einen Kommentar unter deinen Feed-Post geschrieben.',
  },
  feedPostLiked: {
    label: 'Like auf deinen Feed-Post',
    hint: 'Jemand hat deinen Feed-Post geliked.',
  },
  feedCommentMentioned: {
    label: 'Erwähnung in Feed-Kommentar',
    hint: 'Du wurdest in einem Feed-Kommentar mit @username erwähnt.',
  },
  feedCommentReplied: {
    label: 'Antwort auf deinen Feed-Kommentar',
    hint: 'Jemand hat auf deinen Feed-Kommentar geantwortet.',
  },
  feedCommentLiked: {
    label: 'Like auf deinen Feed-Kommentar',
    hint: 'Jemand hat deinen Feed-Kommentar geliked.',
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
  toggleSidebarFotos,
  toggleSidebarFeed,
  toggleSidebarTournaments,
  switchToFeed,
  switchToTournaments,
  switchToPhotos,
  switchToTournamentInstances,
  loadActiveTournamentView,
  loadTournamentDashboard,
  loadTournamentInstances,
  openTournamentInstance,
  openTournamentStandings,
  deleteTournamentInstance,
  openResultEntryModal,
  loadStandingsTab,
  loadScheduleTab,
  togglePublishV3,
  renderTournamentInstanceDetailV3,
  openPhotoInFotosModule,
  openUploaderPhotosFromFeed,
  openSharePhotoToFeedModal,
  closeSharePhotoToFeedModal,
  submitPhotoShareToFeed,
  openShareAlbumToFeedModal,
  closeShareAlbumToFeedModal,
  submitAlbumShareToFeed,
  createFeedPost,
  toggleFeedComments,
  loadOlderFeedComments,
  submitFeedComment,
  toggleFeedReplyComposer,
  submitFeedReply,
  toggleFeedReplies,
  loadOlderFeedReplies,
  toggleFeedCommentLike,
  toggleFeedCommentMenu,
  closeFeedCommentMenu,
  openFeedCommentHistory,
  openFeedCommentLikers,
  startFeedCommentEdit,
  cancelFeedCommentEdit,
  saveFeedCommentEdit,
  deleteFeedComment,
  copyFeedPostLink,
  toggleFeedPostMenu,
  closeFeedPostMenu,
  toggleFeedSaved,
  editFeedPost,
  openFeedPostHistory,
  toggleFeedPostLike,
  openFeedPostLikers,
  exitFeedPostFocus,
  deleteFeedPost,
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
  toggleProfileExports,
  toggleProfileAccountDeletion,
  onProfileDeleteSuccessorChange,
  requestAccountDeletionCode,
  confirmAccountDeletion,
  loadMyExports,
  requestMyContentExport,
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
  saveGroupUploadRestriction,
  saveGroupAlbumRestriction,
  saveGroupFeedPostingRestriction,
  copyGroupSettingsCode,
  copyInviteUrl,
  createGroupInvite,
  refreshGroupInviteList,
  deleteGroupInvite,
  removeGroupMemberFromSettings,
  deleteGroupFromSettings,
  toggleGroupLimitInputs,
  saveGroupMemberLimit,
  openDeputyModalFromSettings,
  _loadGsDeputies,
  _loadGsBlockedMembers,
  _renderGsDeputyList,
  _renderGsBlockedList,
  addGsDeputy,
  removeGsDeputy,
  unblockGsMember,
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
  adminCreateInvite,
  adminLoadInvitesForSelectedGroup,
  adminDeleteInvite,
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
  downloadExportAuthenticated,
  adminRefreshUserExportLink,
  adminDeleteUserExport,
  adminCleanupExpiredExports,
  _filterAdminExports,
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
  acceptFeedbackTicket,
  rejectFeedbackTicket,
  recategorizeFeedbackTicket,
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
  // Phase 2: neue Turnier-Modals + Bracket-Generator
  openCreateTournamentTeamModal,
  openAddTournamentParticipantModal,
  openAssignUserToParticipantModal,
  openCreateTournamentMatchModal,
  openRecordMatchResultModal,
  generateTournamentBracket,
  // Phase 4: Wizard + Scheduling
  openTournamentWizard,
  // Utility (gebraucht von HTML onclick z.B. dz-onclick)
  $,
  onThumbLoad,
});
