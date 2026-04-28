import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client as MinioClient } from 'minio';
import pg from 'pg';

const { Client } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');
const REPLACE_MODE = process.argv.includes('--replace');
const SKIP_STORAGE = process.argv.includes('--skip-storage');
const ROLLBACK_MODE = process.argv.includes('--rollback');
const MIGRATION_SOURCE_HOST = getMigrationSourceHost();
const MIGRATION_DATE_ISO = new Date().toISOString();

const DEFAULT_PAGE_SIZE = 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getOptionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

function getTargetDatabaseUrl() {
  return process.env.TARGET_DATABASE_URL || requireEnv('DATABASE_URL');
}

function getMigrationSourceHost() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function getLoginCredentials() {
  const email = parseArg('email', process.env.SUPABASE_LOGIN_EMAIL || null);
  const password = parseArg('password', process.env.SUPABASE_LOGIN_PASSWORD || null);

  if (!email || !password) {
    throw new Error(
      'Missing login credentials. Use --email/--password or SUPABASE_LOGIN_EMAIL/SUPABASE_LOGIN_PASSWORD.'
    );
  }

  return { email, password };
}

function apiHeaders(apiKey, bearerToken = apiKey, extraHeaders = {}) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json',
    ...extraHeaders,
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    body,
    headers: res.headers,
  };
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function generateUsername(email, displayName, fallbackId, used, preferredUsername = null) {
  const localPart = String(email || '').split('@')[0];
  const preferred = slugify(preferredUsername);
  const base =
    preferred ||
    slugify(localPart) ||
    slugify(displayName) ||
    `user_${String(fallbackId).slice(0, 8)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function randomColorFromId(id) {
  const seed = String(id || 'x')
    .split('')
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  return `hsl(${hue}, 50%, 55%)`;
}

async function loginSupabase(baseUrl, anonKey, email, password) {
  const url = `${baseUrl}/auth/v1/token?grant_type=password`;
  const result = await fetchJson(url, {
    method: 'POST',
    headers: apiHeaders(anonKey, anonKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });

  if (!result.ok) {
    throw new Error(`Login failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  return result.body;
}

async function fetchCurrentUser(baseUrl, anonKey, accessToken) {
  const result = await fetchJson(`${baseUrl}/auth/v1/user`, {
    headers: apiHeaders(anonKey, accessToken),
  });

  if (!result.ok) {
    throw new Error(
      `Fetching current user failed (${result.status}): ${JSON.stringify(result.body)}`
    );
  }

  return result.body;
}

async function fetchAllVisibleRows(
  baseUrl,
  anonKey,
  accessToken,
  table,
  pageSize = DEFAULT_PAGE_SIZE
) {
  const rows = [];
  let from = 0;
  let totalCount = null;

  while (true) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', '*');

    const result = await fetchJson(url, {
      headers: apiHeaders(anonKey, accessToken, {
        Prefer: 'count=exact',
        Range: `${from}-${from + pageSize - 1}`,
      }),
    });

    if (!result.ok) {
      throw new Error(
        `Fetching ${table} failed (${result.status}): ${JSON.stringify(result.body)}`
      );
    }

    const batch = Array.isArray(result.body) ? result.body : [];
    rows.push(...batch);

    const contentRange = result.headers.get('content-range');
    if (contentRange?.includes('/')) {
      const parsed = Number(contentRange.split('/').pop());
      if (Number.isFinite(parsed)) totalCount = parsed;
    }

    if (batch.length < pageSize) {
      break;
    }

    from += pageSize;
    if (totalCount !== null && from >= totalCount) {
      break;
    }
  }

  return rows;
}

async function loadVisibleSupabaseData(baseUrl, anonKey, accessToken) {
  const [profiles, groups, groupMembers, albums, photos, likes, comments] = await Promise.all([
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'profiles'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'groups'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'group_members'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'albums'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'photos'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'likes'),
    fetchAllVisibleRows(baseUrl, anonKey, accessToken, 'comments'),
  ]);

  return {
    profiles,
    authUsers: [],
    groups,
    groupMembers,
    albums,
    photos,
    likes,
    comments,
  };
}

function buildVisibleUserRows({
  currentUser,
  profiles,
  groupMembers,
  albums,
  photos,
  likes,
  comments,
  usedUsernames,
}) {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const referencedUserIds = new Set([currentUser.id]);

  for (const row of groupMembers) referencedUserIds.add(row.user_id);
  for (const row of albums) referencedUserIds.add(row.created_by || currentUser.id);
  for (const row of photos) referencedUserIds.add(row.uploader_id);
  for (const row of likes) referencedUserIds.add(row.user_id);
  for (const row of comments) referencedUserIds.add(row.user_id);

  const placeholderDomain = getOptionalEnv('VISIBLE_IMPORT_EMAIL_DOMAIN', 'visible-import.local');

  return [...referencedUserIds].map((userId) => {
    const profile = profileById.get(userId);
    const isCurrentUser = userId === currentUser.id;
    const email = isCurrentUser ? currentUser.email : `${userId}@${placeholderDomain}`;
    const displayName =
      profile?.name ||
      (isCurrentUser ? currentUser.user_metadata?.display_name || currentUser.email : null);
    const username = generateUsername(
      email,
      displayName,
      userId,
      usedUsernames,
      profile?.name_lower ||
        (isCurrentUser ? currentUser.user_metadata?.preferred_username || null : null)
    );

    return {
      id: userId,
      email,
      username,
      name: displayName,
      color: profile?.color || randomColorFromId(userId),
      avatar: null,
      displayNameField: 'name',
      role: 'user',
      migratedFrom: MIGRATION_SOURCE_HOST,
      migratedAt: MIGRATION_DATE_ISO,
      lastLoginAt: null,
      createdAt: profile?.created_at || currentUser.created_at || new Date().toISOString(),
    };
  });
}

function normalizeVisibleData(raw, currentUser) {
  const visibleUserIds = new Set(raw.profiles.map((p) => p.id));
  visibleUserIds.add(currentUser.id);

  const groupsById = new Map(raw.groups.map((g) => [g.id, g]));
  const visibleGroupIds = new Set(
    raw.groupMembers
      .filter((gm) => visibleUserIds.has(gm.user_id) && groupsById.has(gm.group_id))
      .map((gm) => gm.group_id)
  );

  const groups = raw.groups.filter((g) => visibleGroupIds.has(g.id));
  const groupMembers = raw.groupMembers.filter((gm) => visibleGroupIds.has(gm.group_id));
  const albums = raw.albums.filter((a) => visibleGroupIds.has(a.group_id));
  const albumIds = new Set(albums.map((a) => a.id));
  const photos = raw.photos.filter((p) => visibleGroupIds.has(p.group_id));
  const photoIds = new Set(photos.map((p) => p.id));
  const likes = raw.likes.filter((l) => photoIds.has(l.photo_id));
  const comments = raw.comments.filter((c) => photoIds.has(c.photo_id));
  const photoAlbums = photos
    .filter((p) => p.album_id && albumIds.has(p.album_id))
    .map((p) => ({ photoId: p.id, albumId: p.album_id }));

  return {
    profiles: raw.profiles,
    groups,
    groupMembers,
    albums,
    photos,
    likes,
    comments,
    photoAlbums,
  };
}

function normalizeGroupCodes(groups) {
  return groups.map((group) => ({
    ...group,
    code: String(group.code || '')
      .trim()
      .toUpperCase(),
  }));
}

function findDuplicateGroupCodes(groups) {
  const seen = new Map();
  for (const group of groups) {
    const code = String(group.code || '');
    if (!code) continue;
    seen.set(code, (seen.get(code) || 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([code, count]) => ({ code, count }));
}

function validateRefs({ users, groups, photos, albums, groupMembers, likes, comments }) {
  const userIds = new Set(users.map((x) => x.id));
  const groupIds = new Set(groups.map((x) => x.id));
  const photoIds = new Set(photos.map((x) => x.id));
  const albumIds = new Set(albums.map((x) => x.id));
  const issues = [];

  for (const gm of groupMembers) {
    if (!userIds.has(gm.user_id))
      issues.push(`group_members.user_id missing in users: ${gm.user_id}`);
    if (!groupIds.has(gm.group_id))
      issues.push(`group_members.group_id missing in groups: ${gm.group_id}`);
  }

  for (const p of photos) {
    if (!userIds.has(p.uploader_id))
      issues.push(`photos.uploader_id missing in users: ${p.uploader_id}`);
    if (!groupIds.has(p.group_id)) issues.push(`photos.group_id missing in groups: ${p.group_id}`);
    if (p.album_id && !albumIds.has(p.album_id))
      issues.push(`photos.album_id missing in albums: ${p.album_id}`);
  }

  for (const l of likes) {
    if (!photoIds.has(l.photo_id)) issues.push(`likes.photo_id missing in photos: ${l.photo_id}`);
    if (!userIds.has(l.user_id)) issues.push(`likes.user_id missing in users: ${l.user_id}`);
  }

  for (const c of comments) {
    if (!photoIds.has(c.photo_id))
      issues.push(`comments.photo_id missing in photos: ${c.photo_id}`);
    if (!userIds.has(c.user_id)) issues.push(`comments.user_id missing in users: ${c.user_id}`);
  }

  return issues;
}

async function truncateTarget(target) {
  await target.query(`
    TRUNCATE TABLE
      "NotificationPreference",
      "Notification",
      "GroupBackup",
      "GroupDeputy",
      "AlbumContributor",
      "PhotoAlbum",
      "Like",
      "Comment",
      "Photo",
      "Album",
      "GroupMember",
      "Group",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

async function getExistingTargetState(target) {
  const users = await target.query(`select id, username, email, name from "User"`);
  const groups = await target.query(`select id from "Group"`);
  const albums = await target.query(`select id from "Album"`);
  const photos = await target.query(`select id, path from "Photo"`);

  const usernameToId = new Map();
  const emailToId = new Map();
  const userById = new Map();
  for (const row of users.rows) {
    userById.set(row.id, row);
    if (row.username) {
      usernameToId.set(String(row.username), row.id);
    }
    if (row.email) {
      emailToId.set(String(row.email).toLowerCase(), row.id);
    }
  }

  return {
    userIds: new Set(users.rows.map((r) => r.id)),
    usernames: new Set(users.rows.map((r) => r.username)),
    usernameToId,
    emailToId,
    userById,
    groupIds: new Set(groups.rows.map((r) => r.id)),
    albumIds: new Set(albums.rows.map((r) => r.id)),
    photoIds: new Set(photos.rows.map((r) => r.id)),
    photoPaths: new Set(photos.rows.map((r) => r.path)),
  };
}

function pickPreferredUserRecord(current, candidate) {
  if (!current) return candidate;

  // Prefer records with non-placeholder email.
  const currentPlaceholder = current.email?.includes('@visible-import.local');
  const candidatePlaceholder = candidate.email?.includes('@visible-import.local');
  if (currentPlaceholder && !candidatePlaceholder) return candidate;

  // Prefer records with a name.
  if (!current.name && candidate.name) return candidate;

  return current;
}

function applyUserIdMapping(raw, users, targetState) {
  const sourceToTargetUserId = new Map();
  const mappedUsersById = new Map();
  let matchedByEmail = 0;
  let matchedByUsername = 0;
  let remappedByEmail = 0;
  let remappedByUsername = 0;

  for (const user of users) {
    let mappedId = user.id;
    const existingByEmail = targetState.emailToId.get(String(user.email || '').toLowerCase());
    const existingByUsername = targetState.usernameToId.get(user.username);

    if (existingByEmail) {
      matchedByEmail += 1;
      if (existingByEmail !== user.id) {
        mappedId = existingByEmail;
        remappedByEmail += 1;
      }
    } else if (existingByUsername) {
      matchedByUsername += 1;
      if (existingByUsername !== user.id) {
        mappedId = existingByUsername;
        remappedByUsername += 1;
      }
    }

    sourceToTargetUserId.set(user.id, mappedId);
    const existingTargetUser = targetState.userById.get(mappedId);
    const mappedUser = {
      ...user,
      id: mappedId,
      // Avoid unique email conflicts on reruns/remaps; keep known target email if mapped.
      email: existingTargetUser?.email || user.email,
      username: existingTargetUser?.username || user.username,
      // Keep existing target display name for mapped users.
      name: existingTargetUser?.name || user.name,
    };
    const current = mappedUsersById.get(mappedId);
    mappedUsersById.set(mappedId, pickPreferredUserRecord(current, mappedUser));
  }

  const remap = (userId) => sourceToTargetUserId.get(userId) || userId;

  const remapped = {
    users: [...mappedUsersById.values()],
    groups: raw.groups,
    groupMembers: raw.groupMembers.map((gm) => ({ ...gm, user_id: remap(gm.user_id) })),
    albums: raw.albums.map((a) => ({
      ...a,
      created_by: a.created_by ? remap(a.created_by) : a.created_by,
    })),
    photos: raw.photos.map((p) => ({ ...p, uploader_id: remap(p.uploader_id) })),
    photoAlbums: raw.photoAlbums,
    likes: raw.likes.map((l) => ({ ...l, user_id: remap(l.user_id) })),
    comments: raw.comments.map((c) => ({ ...c, user_id: remap(c.user_id) })),
  };

  return {
    remapped,
    userMappingStats: {
      matchedByEmail,
      matchedByUsername,
      remappedByEmail,
      remappedByUsername,
      sourceUsers: users.length,
      effectiveUsers: remapped.users.length,
    },
  };
}

async function insertAll(target, data, targetState) {
  const { users, groups, groupMembers, albums, photos, photoAlbums, likes, comments } = data;

  const inserted = {
    users: 0,
    groups: 0,
    groupMembers: 0,
    albums: 0,
    photos: 0,
    photoAlbums: 0,
    likes: 0,
    comments: 0,
    skipped: 0,
  };

  const shouldAbortTransaction = (err) =>
    String(err?.message || '')
      .toLowerCase()
      .includes('current transaction is aborted');

  for (const u of users) {
    try {
      await target.query(
        `insert into "User" (id, email, username, name, color, avatar, "displayNameField", role, "migratedFrom", "migratedAt", "lastLoginAt", "createdAt")
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set
           email = excluded.email,
           username = excluded.username,
           name = excluded.name,
           color = excluded.color,
           avatar = excluded.avatar,
           "displayNameField" = excluded."displayNameField",
           "migratedFrom" = coalesce("User"."migratedFrom", excluded."migratedFrom"),
           "migratedAt" = coalesce("User"."migratedAt", excluded."migratedAt")`,
        [
          u.id,
          u.email,
          u.username,
          u.name,
          u.color,
          u.avatar,
          u.displayNameField,
          u.role,
          u.migratedFrom,
          u.migratedAt,
          u.lastLoginAt,
          u.createdAt,
        ]
      );

      // Create one system inbox message per migrated user (idempotent on reruns).
      await target.query(
        `insert into "Notification" (id, "userId", type, title, body, "entityId", "entityType")
         select $1, $2, 'system', $3, $4, 'supabase-migration', 'external'
         where not exists (
           select 1
           from "Notification"
           where "userId" = $2
             and type = 'system'
             and "entityType" = 'external'
             and "entityId" = 'supabase-migration'
         )`,
        [
          randomUUID(),
          u.id,
          'Dein Konto wurde migriert',
          'Dein Benutzerkonto und deine Daten wurden erfolgreich aus Supabase in das neue Fotoalbum-System übernommen.',
        ]
      );

      targetState.userIds.add(u.id);
      targetState.usernames.add(u.username);
      inserted.users += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip user ${u.id}: ${err.message}`);
    }
  }

  for (const g of groups) {
    try {
      await target.query(
        `insert into "Group" (id, name, code, "createdBy", "createdAt")
         values ($1,$2,$3,$4,$5)
         on conflict do nothing`,
        [g.id, g.name, g.code, g.created_by, g.created_at || new Date().toISOString()]
      );
      targetState.groupIds.add(g.id);
      inserted.groups += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip group ${g.id}: ${err.message}`);
    }
  }

  for (const gm of groupMembers) {
    if (!targetState.userIds.has(gm.user_id) || !targetState.groupIds.has(gm.group_id)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "GroupMember" ("userId", "groupId")
         values ($1,$2)
         on conflict do nothing`,
        [gm.user_id, gm.group_id]
      );
      inserted.groupMembers += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip group member ${gm.user_id}/${gm.group_id}: ${err.message}`);
    }
  }

  for (const a of albums) {
    if (!targetState.groupIds.has(a.group_id)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "Album" (id, name, "groupId", "createdBy", "createdAt")
         values ($1,$2,$3,$4,$5)
         on conflict do nothing`,
        [a.id, a.name, a.group_id, a.created_by, a.created_at || new Date().toISOString()]
      );
      targetState.albumIds.add(a.id);
      inserted.albums += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip album ${a.id}: ${err.message}`);
    }
  }

  for (const p of photos) {
    if (!targetState.userIds.has(p.uploader_id) || !targetState.groupIds.has(p.group_id)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "Photo" (id, "uploaderId", "groupId", filename, path, description, "createdAt")
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict do nothing`,
        [
          p.id,
          p.uploader_id,
          p.group_id,
          p.filename || 'photo.jpg',
          p.storage_path,
          p.description,
          p.created_at || new Date().toISOString(),
        ]
      );
      targetState.photoIds.add(p.id);
      targetState.photoPaths.add(p.storage_path);
      inserted.photos += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip photo ${p.id}: ${err.message}`);
    }
  }

  for (const pa of photoAlbums) {
    if (!targetState.photoIds.has(pa.photoId) || !targetState.albumIds.has(pa.albumId)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "PhotoAlbum" ("photoId", "albumId")
         values ($1,$2)
         on conflict do nothing`,
        [pa.photoId, pa.albumId]
      );
      inserted.photoAlbums += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip photo-album ${pa.photoId}/${pa.albumId}: ${err.message}`);
    }
  }

  for (const l of likes) {
    if (!targetState.photoIds.has(l.photo_id) || !targetState.userIds.has(l.user_id)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "Like" (id, "photoId", "userId", "createdAt")
         values ($1, $2, $3, $4)
         on conflict ("photoId", "userId") do nothing`,
        [randomUUID(), l.photo_id, l.user_id, l.created_at || new Date().toISOString()]
      );
      inserted.likes += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip like ${l.photo_id}/${l.user_id}: ${err.message}`);
    }
  }

  for (const c of comments) {
    if (!targetState.photoIds.has(c.photo_id) || !targetState.userIds.has(c.user_id)) {
      inserted.skipped += 1;
      continue;
    }
    try {
      await target.query(
        `insert into "Comment" (id, "photoId", "userId", content, "createdAt")
         values ($1,$2,$3,$4,$5)
         on conflict do nothing`,
        [c.id, c.photo_id, c.user_id, c.content, c.created_at || new Date().toISOString()]
      );
      inserted.comments += 1;
    } catch (err) {
      if (shouldAbortTransaction(err)) throw err;
      inserted.skipped += 1;
      console.warn(`Skip comment ${c.id}: ${err.message}`);
    }
  }

  return inserted;
}

function getMinioClient() {
  const endpoint = requireEnv('MINIO_ENDPOINT');
  const port = parseInt(process.env.MINIO_PORT || '9000', 10);
  const accessKey = requireEnv('MINIO_ACCESS_KEY');
  const secretKey = requireEnv('MINIO_SECRET_KEY');
  const useSSL = process.env.MINIO_USE_SSL === 'true';

  return new MinioClient({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
  });
}

function encodePathForUrl(path) {
  return String(path)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function copyOnePhotoToMinio({
  minio,
  supabaseUrl,
  apiKey,
  bearerToken,
  sourceBucket,
  targetBucket,
  objectPath,
}) {
  try {
    await minio.statObject(targetBucket, objectPath);
    return { status: 'exists' };
  } catch {
    // not found in MinIO, continue with download
  }

  const encodedPath = encodePathForUrl(objectPath);
  const url = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${sourceBucket}/${encodedPath}`;
  const res = await fetch(url, {
    headers: apiHeaders(apiKey, bearerToken),
  });

  if (!res.ok) {
    return { status: 'error', reason: `download failed (${res.status})` };
  }

  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';

  await minio.putObject(targetBucket, objectPath, buffer, buffer.length, {
    'Content-Type': contentType,
  });

  return { status: 'copied' };
}

async function migratePhotosToMinio(photos, authContext) {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const sourceBucket = process.env.SUPABASE_STORAGE_BUCKET || 'photos';
  const targetBucket = process.env.MINIO_BUCKET_PHOTOS || 'photos';
  const minio = getMinioClient();

  const uniquePaths = [...new Set(photos.map((p) => p.storage_path).filter(Boolean))];
  const stats = { total: uniquePaths.length, copied: 0, exists: 0, error: 0 };

  for (const objectPath of uniquePaths) {
    try {
      const result = await copyOnePhotoToMinio({
        minio,
        supabaseUrl,
        apiKey: authContext.apiKey,
        bearerToken: authContext.bearerToken,
        sourceBucket,
        targetBucket,
        objectPath,
      });

      if (result.status === 'copied') stats.copied += 1;
      else if (result.status === 'exists') stats.exists += 1;
      else stats.error += 1;

      if (result.status === 'error') {
        console.warn(`Storage copy failed for ${objectPath}: ${result.reason}`);
      }
    } catch (err) {
      stats.error += 1;
      console.warn(`Storage copy failed for ${objectPath}: ${err.message}`);
    }
  }

  return stats;
}

async function rollbackPhotosFromMinio(photos) {
  const targetBucket = process.env.MINIO_BUCKET_PHOTOS || 'photos';
  const minio = getMinioClient();
  const uniquePaths = [...new Set(photos.map((p) => p.storage_path).filter(Boolean))];
  const stats = { total: uniquePaths.length, removed: 0, missing: 0, error: 0 };

  for (const objectPath of uniquePaths) {
    try {
      await minio.removeObject(targetBucket, objectPath);
      stats.removed += 1;
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no such key')) {
        stats.missing += 1;
      } else {
        stats.error += 1;
        console.warn(`Storage rollback failed for ${objectPath}: ${msg}`);
      }
    }
  }

  return stats;
}

async function rollbackAll(target, data) {
  const { users, groups, groupMembers, albums, photos, photoAlbums, likes, comments } = data;

  const stats = {
    notifications: 0,
    usersMetaCleared: 0,
    likes: 0,
    comments: 0,
    photoAlbums: 0,
    photos: 0,
    albumContributors: 0,
    albums: 0,
    groupDeputies: 0,
    groupMembers: 0,
    groups: 0,
  };

  const userIds = [...new Set(users.map((u) => u.id))];
  const photoIds = [...new Set(photos.map((p) => p.id))];
  const albumIds = [...new Set(albums.map((a) => a.id))];
  const groupIds = [...new Set(groups.map((g) => g.id))];

  if (userIds.length) {
    const res = await target.query(
      `delete from "Notification"
       where "userId" = any($1::text[])
         and type = 'system'
         and "entityType" = 'external'
         and "entityId" = 'supabase-migration'`,
      [userIds]
    );
    stats.notifications += res.rowCount || 0;

    const metaRes = await target.query(
      `update "User"
       set "migratedFrom" = null,
           "migratedAt" = null
       where id = any($1::text[])`,
      [userIds]
    );
    stats.usersMetaCleared += metaRes.rowCount || 0;
  }

  for (const l of likes) {
    const res = await target.query(`delete from "Like" where "photoId" = $1 and "userId" = $2`, [
      l.photo_id,
      l.user_id,
    ]);
    stats.likes += res.rowCount || 0;
  }

  if (comments.length) {
    const commentIds = comments.map((c) => c.id);
    const res = await target.query(`delete from "Comment" where id = any($1::text[])`, [
      commentIds,
    ]);
    stats.comments += res.rowCount || 0;
  }

  for (const pa of photoAlbums) {
    const res = await target.query(
      `delete from "PhotoAlbum" where "photoId" = $1 and "albumId" = $2`,
      [pa.photoId, pa.albumId]
    );
    stats.photoAlbums += res.rowCount || 0;
  }

  if (photoIds.length) {
    const res = await target.query(`delete from "Photo" where id = any($1::text[])`, [photoIds]);
    stats.photos += res.rowCount || 0;
  }

  if (albumIds.length) {
    const contribRes = await target.query(
      `delete from "AlbumContributor" where "albumId" = any($1::text[])`,
      [albumIds]
    );
    stats.albumContributors += contribRes.rowCount || 0;

    const albumRes = await target.query(`delete from "Album" where id = any($1::text[])`, [
      albumIds,
    ]);
    stats.albums += albumRes.rowCount || 0;
  }

  if (groupIds.length) {
    const deputyRes = await target.query(
      `delete from "GroupDeputy" where "groupId" = any($1::text[])`,
      [groupIds]
    );
    stats.groupDeputies += deputyRes.rowCount || 0;
  }

  for (const gm of groupMembers) {
    const res = await target.query(
      `delete from "GroupMember" where "userId" = $1 and "groupId" = $2`,
      [gm.user_id, gm.group_id]
    );
    stats.groupMembers += res.rowCount || 0;
  }

  if (groupIds.length) {
    const res = await target.query(`delete from "Group" where id = any($1::text[])`, [groupIds]);
    stats.groups += res.rowCount || 0;
  }

  return stats;
}

function printSummary(summary) {
  console.log('Migration summary:');
  console.log(`- users: ${summary.users}`);
  console.log(`- groups: ${summary.groups}`);
  console.log(`- groupMembers: ${summary.groupMembers}`);
  console.log(`- albums: ${summary.albums}`);
  console.log(`- photos: ${summary.photos}`);
  console.log(`- photoAlbums: ${summary.photoAlbums}`);
  console.log(`- likes: ${summary.likes}`);
  console.log(`- comments: ${summary.comments}`);
}

function printSection(title, lines = []) {
  console.log(title);
  if (!lines.length) {
    console.log('- none');
    return;
  }
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function sampleLines(items, formatter, limit = 10) {
  return items.slice(0, limit).map(formatter);
}

function buildDryRunDetails({
  users,
  groups,
  groupMembers,
  albums,
  photos,
  photoAlbums,
  likes,
  comments,
  issues,
  targetState,
  replaceMode,
  skipStorage,
}) {
  const existingUserCount = users.filter((u) => targetState.userIds.has(u.id)).length;
  const existingGroupCount = groups.filter((g) => targetState.groupIds.has(g.id)).length;
  const existingAlbumCount = albums.filter((a) => targetState.albumIds.has(a.id)).length;
  const existingPhotoIdCount = photos.filter((p) => targetState.photoIds.has(p.id)).length;
  const existingPhotoPathCount = photos.filter((p) =>
    targetState.photoPaths.has(p.storage_path)
  ).length;

  const photosPerGroup = new Map();
  for (const photo of photos) {
    photosPerGroup.set(photo.group_id, (photosPerGroup.get(photo.group_id) || 0) + 1);
  }

  const albumCounts = new Map();
  for (const rel of photoAlbums) {
    albumCounts.set(rel.albumId, (albumCounts.get(rel.albumId) || 0) + 1);
  }

  const usersWithoutRealEmail = users.filter((u) =>
    u.email.endsWith(`@${getOptionalEnv('VISIBLE_IMPORT_EMAIL_DOMAIN', 'visible-import.local')}`)
  );

  printSection('Dry-run mode:', [
    `mode: login-visible-import`,
    `target strategy: ${replaceMode ? 'replace existing target data' : 'merge into existing target data'}`,
    `storage step: ${skipStorage ? 'skipped' : 'would copy visible photos to MinIO'}`,
  ]);

  printSection('Target overlap:', [
    `existing users by id: ${existingUserCount}/${users.length}`,
    `existing groups by id: ${existingGroupCount}/${groups.length}`,
    `existing albums by id: ${existingAlbumCount}/${albums.length}`,
    `existing photos by id: ${existingPhotoIdCount}/${photos.length}`,
    `existing photos by path: ${existingPhotoPathCount}/${photos.length}`,
  ]);

  printSection(
    'Groups:',
    sampleLines(
      groups,
      (g) => `${g.name} (${g.id}) code=${g.code} photos=${photosPerGroup.get(g.id) || 0}`
    )
  );
  printSection(
    'Users:',
    sampleLines(users, (u) => `${u.name || '(no name)'} <${u.email}> username=${u.username}`)
  );
  printSection(
    'Albums:',
    sampleLines(
      albums,
      (a) => `${a.name} (${a.id}) group=${a.group_id} photos=${albumCounts.get(a.id) || 0}`
    )
  );
  printSection(
    'Photos:',
    sampleLines(
      photos,
      (p) => `${p.filename || 'photo.jpg'} id=${p.id} group=${p.group_id} path=${p.storage_path}`
    )
  );

  printSection('Relations:', [
    `group memberships: ${groupMembers.length}`,
    `photo-album links: ${photoAlbums.length}`,
    `likes: ${likes.length}`,
    `comments: ${comments.length}`,
  ]);

  if (usersWithoutRealEmail.length) {
    printSection(
      'Users with placeholder emails:',
      sampleLines(usersWithoutRealEmail, (u) => `${u.id} -> ${u.email}`)
    );
  }

  if (issues.length) {
    printSection(
      'Reference warnings:',
      sampleLines(issues, (issue) => issue, 20)
    );
  }

  if (!skipStorage) {
    const uniquePaths = [...new Set(photos.map((p) => p.storage_path).filter(Boolean))];
    printSection('Storage preview:', [
      `objects considered: ${uniquePaths.length}`,
      ...sampleLines(uniquePaths, (p) => p, 10),
    ]);
  }
}

function printRollbackSummary(summary) {
  console.log('Rollback scope:');
  console.log(`- users (kept): ${summary.users}`);
  console.log(`- groups: ${summary.groups}`);
  console.log(`- groupMembers: ${summary.groupMembers}`);
  console.log(`- albums: ${summary.albums}`);
  console.log(`- photos: ${summary.photos}`);
  console.log(`- photoAlbums: ${summary.photoAlbums}`);
  console.log(`- likes: ${summary.likes}`);
  console.log(`- comments: ${summary.comments}`);
}

async function main() {
  const target = new Client({ connectionString: getTargetDatabaseUrl() });
  await target.connect();

  if (ROLLBACK_MODE && REPLACE_MODE) {
    throw new Error('Flags --rollback und --replace koennen nicht kombiniert werden.');
  }

  try {
    const targetState = await getExistingTargetState(target);
    // Keep source-side username generation stable; existing target username matching
    // is handled later via applyUserIdMapping.
    const usedUsernames = new Set();
    let raw;
    let users;
    let photoAlbums;
    let storageAuthContext;
    let userMappingStats = null;

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const anonKey = requireEnv('SUPABASE_ANON_KEY');
    const { email, password } = getLoginCredentials();
    const session = await loginSupabase(supabaseUrl, anonKey, email, password);
    const currentUser = await fetchCurrentUser(supabaseUrl, anonKey, session.access_token);
    const visibleRaw = await loadVisibleSupabaseData(supabaseUrl, anonKey, session.access_token);
    const normalized = normalizeVisibleData(visibleRaw, currentUser);

    raw = {
      ...normalized,
      authUsers: [],
    };
    photoAlbums = normalized.photoAlbums;
    users = buildVisibleUserRows({
      currentUser,
      profiles: normalized.profiles,
      groupMembers: normalized.groupMembers,
      albums: normalized.albums,
      photos: normalized.photos,
      likes: normalized.likes,
      comments: normalized.comments,
      usedUsernames,
    });
    storageAuthContext = {
      apiKey: anonKey,
      bearerToken: session.access_token,
    };

    raw.groups = normalizeGroupCodes(raw.groups);

    const duplicateNormalizedCodes = findDuplicateGroupCodes(raw.groups);
    if (duplicateNormalizedCodes.length > 0) {
      console.warn('Found duplicate group codes after uppercase normalization:');
      duplicateNormalizedCodes.forEach((item) => {
        console.warn(`- ${item.code}: ${item.count}`);
      });
      if (STRICT) {
        throw new Error('Strict mode enabled and duplicate normalized group codes were found.');
      }
    }

    const { remapped, userMappingStats: mappingStats } = applyUserIdMapping(
      {
        groups: raw.groups,
        groupMembers: raw.groupMembers,
        albums: raw.albums,
        photos: raw.photos,
        photoAlbums,
        likes: raw.likes,
        comments: raw.comments,
      },
      users,
      targetState
    );
    userMappingStats = mappingStats;

    users = remapped.users;
    raw = {
      ...raw,
      groups: remapped.groups,
      groupMembers: remapped.groupMembers,
      albums: remapped.albums,
      photos: remapped.photos,
      likes: remapped.likes,
      comments: remapped.comments,
    };
    photoAlbums = remapped.photoAlbums;

    const issues = validateRefs({
      users,
      groups: remapped.groups,
      photos: remapped.photos,
      albums: remapped.albums,
      groupMembers: remapped.groupMembers,
      likes: remapped.likes,
      comments: remapped.comments,
    });

    if (issues.length > 0) {
      console.warn(`Found ${issues.length} data integrity warnings.`);
      issues.slice(0, 20).forEach((x) => console.warn(`- ${x}`));
      if (STRICT) {
        throw new Error('Strict mode enabled and data integrity warnings were found.');
      }
    }

    const summary = {
      users: users.length,
      groups: raw.groups.length,
      groupMembers: raw.groupMembers.length,
      albums: raw.albums.length,
      photos: raw.photos.length,
      photoAlbums: photoAlbums.length,
      likes: raw.likes.length,
      comments: raw.comments.length,
    };

    if (ROLLBACK_MODE) {
      printRollbackSummary(summary);
    } else {
      printSummary(summary);
    }

    if (DRY_RUN) {
      if (userMappingStats) {
        printSection('User identity mapping:', [
          `matched by email to existing target users: ${userMappingStats.matchedByEmail}`,
          `matched by username to existing target users: ${userMappingStats.matchedByUsername}`,
          `remapped to different existing user id by email: ${userMappingStats.remappedByEmail}`,
          `remapped to different existing user id by username: ${userMappingStats.remappedByUsername}`,
          `source users: ${userMappingStats.sourceUsers}`,
          `effective users after merge: ${userMappingStats.effectiveUsers}`,
        ]);
      }
      buildDryRunDetails({
        users,
        groups: raw.groups,
        groupMembers: raw.groupMembers,
        albums: raw.albums,
        photos: raw.photos,
        photoAlbums,
        likes: raw.likes,
        comments: raw.comments,
        issues,
        targetState,
        replaceMode: REPLACE_MODE,
        skipStorage: SKIP_STORAGE,
      });
      if (ROLLBACK_MODE) {
        console.log('Dry-run mode enabled. Kein Rollback wurde ausgefuehrt.');
      } else {
        console.log('Dry-run mode enabled. No target writes were executed.');
      }
      return;
    }

    await target.query('begin');
    if (!ROLLBACK_MODE && REPLACE_MODE) {
      await truncateTarget(target);
    }

    let inserted = null;
    let rollbackStats = null;
    if (ROLLBACK_MODE) {
      rollbackStats = await rollbackAll(target, {
        users,
        groups: raw.groups,
        groupMembers: raw.groupMembers,
        albums: raw.albums,
        photos: raw.photos,
        photoAlbums,
        likes: raw.likes,
        comments: raw.comments,
      });
    } else {
      inserted = await insertAll(
        target,
        {
          users,
          groups: raw.groups,
          groupMembers: raw.groupMembers,
          albums: raw.albums,
          photos: raw.photos,
          photoAlbums,
          likes: raw.likes,
          comments: raw.comments,
        },
        targetState
      );
    }

    await target.query('commit');
    if (ROLLBACK_MODE) {
      console.log('Database rollback completed successfully.');
      console.log(`Rollback result: ${JSON.stringify(rollbackStats)}`);

      if (!SKIP_STORAGE) {
        const storageRollbackStats = await rollbackPhotosFromMinio(raw.photos);
        console.log('Photo storage rollback completed.');
        console.log(`- total: ${storageRollbackStats.total}`);
        console.log(`- removed: ${storageRollbackStats.removed}`);
        console.log(`- missing: ${storageRollbackStats.missing}`);
        console.log(`- errors: ${storageRollbackStats.error}`);
      } else {
        console.log('Photo storage rollback skipped (--skip-storage).');
      }
    } else {
      console.log('Database migration completed successfully.');
      console.log(`Inserted/updated rows (best effort): ${JSON.stringify(inserted)}`);

      if (!SKIP_STORAGE) {
        const storageStats = await migratePhotosToMinio(raw.photos, storageAuthContext);
        console.log('Photo storage migration completed.');
        console.log(`- total: ${storageStats.total}`);
        console.log(`- copied: ${storageStats.copied}`);
        console.log(`- already existed: ${storageStats.exists}`);
        console.log(`- errors: ${storageStats.error}`);
      } else {
        console.log('Photo storage migration skipped (--skip-storage).');
      }
    }
  } catch (err) {
    try {
      await target.query('rollback');
    } catch {
      // ignored
    }
    throw err;
  } finally {
    await target.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
