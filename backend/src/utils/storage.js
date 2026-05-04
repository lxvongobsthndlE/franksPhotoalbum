import { Client } from 'minio';

let minioClient = null;
let BUCKET_PHOTOS = 'photos';
let BUCKET_AVATARS = 'avatars';
let BUCKET_BACKUPS = 'backups';

function getClient() {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });
    BUCKET_PHOTOS = process.env.MINIO_BUCKET_PHOTOS || 'photos';
    BUCKET_AVATARS = process.env.MINIO_BUCKET_AVATARS || 'avatars';
    BUCKET_BACKUPS = process.env.MINIO_BUCKET_BACKUPS || 'backups';
  }
  return minioClient;
}

/**
 * Stellt sicher, dass ein Bucket existiert (wird beim Start aufgerufen).
 */
async function ensureBucket(bucket) {
  const client = getClient();
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, 'eu-west-1');
  }
}

export async function initStorage() {
  await ensureBucket(BUCKET_PHOTOS);
  await ensureBucket(BUCKET_AVATARS);
  await ensureBucket(BUCKET_BACKUPS);
}

/**
 * Lädt einen Buffer in MinIO hoch.
 * @returns {string} Der Object-Key (Pfad in MinIO).
 */
export async function uploadPhoto(buffer, mimetype, originalFilename) {
  const ext = originalFilename?.split('.').pop()?.toLowerCase() || 'jpg';
  const key = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  await getClient().putObject(BUCKET_PHOTOS, key, buffer, buffer.length, {
    'Content-Type': mimetype,
  });
  return key;
}

/**
 * Löscht ein Photo-Objekt aus MinIO.
 */
export async function deletePhoto(key) {
  await getClient().removeObject(BUCKET_PHOTOS, key);
}

/**
 * Gibt eine Presigned URL zurück, die 1 Stunde gültig ist.
 * NUR serverseitig verwenden (z.B. für ZIP-interne Reads).
 */
export async function getPhotoUrl(key, expirySeconds = 3600) {
  return getClient().presignedGetObject(BUCKET_PHOTOS, key, expirySeconds);
}

/**
 * Streamt ein Foto-Objekt direkt aus MinIO.
 * Für den Backend-Proxy-Endpunkt.
 */
export async function getPhotoStream(key) {
  return getClient().getObject(BUCKET_PHOTOS, key);
}

/**
 * Gibt Content-Type und Größe eines Foto-Objekts zurück.
 */
export async function getPhotoStat(key) {
  return getClient().statObject(BUCKET_PHOTOS, key);
}

/**
 * Streamt einen Byte-Range eines Objekts aus MinIO (für HTTP Range-Requests).
 * @param {string} key - Object-Key in MinIO
 * @param {number} offset - Start-Byte (0-basiert)
 * @param {number} length - Anzahl Bytes
 */
export async function getPhotoRangeStream(key, offset, length) {
  return getClient().getPartialObject(BUCKET_PHOTOS, key, offset, length);
}

/**
 * Lädt einen Avatar-Buffer hoch.
 */
export async function uploadAvatar(buffer, mimetype, userId) {
  const key = `avatar_${userId}`;
  await getClient().putObject(BUCKET_AVATARS, key, buffer, buffer.length, {
    'Content-Type': mimetype,
  });
  return key;
}

export async function getAvatarUrl(key, expirySeconds = 3600) {
  return getClient().presignedGetObject(BUCKET_AVATARS, key, expirySeconds);
}

/**
 * Streamt ein Avatar-Objekt direkt aus MinIO.
 */
export async function getAvatarStream(userId) {
  return getClient().getObject(BUCKET_AVATARS, `avatar_${userId}`);
}

/**
 * Gibt Content-Type und Größe eines Avatar-Objekts zurück.
 */
export async function getAvatarStat(userId) {
  return getClient().statObject(BUCKET_AVATARS, `avatar_${userId}`);
}

export async function deleteAvatar(userId) {
  const key = `avatar_${userId}`;
  try {
    await getClient().removeObject(BUCKET_AVATARS, key);
  } catch (e) {
    // Object may not exist, that's fine
  }
}

/**
 * Erstellt ein ZIP-Backup aller Gruppenfotos und lädt es in den Backups-Bucket hoch.
 * Gibt eine Presigned URL zurück, die 7 Tage gültig ist.
 * @param {string} groupId
 * @param {Array<{path: string, filename: string}>} photos
 * @returns {Promise<string>} presigned download URL
 */
export async function createGroupBackupZip(groupId, photos) {
  const { default: archiver } = await import('archiver');
  const client = getClient();
  const zipKey = `backup_group_${groupId}_${Date.now()}.zip`;

  const buffer = await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const chunks = [];
    archive.on('data', (d) => chunks.push(d));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    (async () => {
      for (const photo of photos) {
        if (!photo.path) continue;
        try {
          const stream = await client.getObject(BUCKET_PHOTOS, photo.path);
          const safeName = (photo.filename || photo.path).replace(/[^a-zA-Z0-9._-]/g, '_');
          archive.append(stream, { name: safeName });
        } catch {
          // Datei nicht gefunden – überspringen
        }
      }
      archive.finalize();
    })().catch(reject);
  });

  await client.putObject(BUCKET_BACKUPS, zipKey, buffer, buffer.length, {
    'Content-Type': 'application/zip',
  });

  return zipKey;
}

/**
 * Streamt ein Backup-ZIP-Objekt direkt aus MinIO.
 */
export async function getBackupStream(zipKey) {
  return getClient().getObject(BUCKET_BACKUPS, zipKey);
}

export async function getBackupStat(zipKey) {
  return getClient().statObject(BUCKET_BACKUPS, zipKey);
}

/**
 * Löscht alle MinIO-Objekte einer Gruppe aus dem Photos-Bucket.
 * @param {string[]} keys
 */
export async function deleteGroupPhotoObjects(keys) {
  const client = getClient();
  for (const key of keys) {
    try {
      await client.removeObject(BUCKET_PHOTOS, key);
    } catch {
      // Bereits gelöscht oder nie vorhanden – ignorieren
    }
  }
}

/**
 * Löscht ein einzelnes Backup-Objekt aus MinIO.
 */
export async function deleteBackupObject(zipKey) {
  await getClient().removeObject(BUCKET_BACKUPS, zipKey);
}

/**
 * Listet alle Backup-Objekte im Backups-Bucket auf.
 * @returns {Promise<Array<{name:string, size:number, lastModified:Date}>>}
 */
export async function listBackupObjects() {
  const client = getClient();
  return new Promise((resolve, reject) => {
    const items = [];
    const stream = client.listObjects(BUCKET_BACKUPS, '', true);
    stream.on('data', (obj) =>
      items.push({ name: obj.name, size: obj.size, lastModified: obj.lastModified })
    );
    stream.on('end', () => resolve(items));
    stream.on('error', reject);
  });
}
