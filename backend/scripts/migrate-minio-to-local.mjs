import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client as MinioClient } from 'minio';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env.local') });

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function isLikelyObjectKey(value) {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return true;
}

function normalizeAvatarKey(value) {
  if (!value) return value;
  const m = String(value).match(/\/api\/auth\/avatar\/([^/?#]+)/i);
  if (m && m[1]) {
    return `avatar_${m[1]}`;
  }
  return String(value);
}

async function ensureBucket(client, bucket) {
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, 'eu-west-1');
  }
}

async function objectExists(client, bucket, key) {
  try {
    await client.statObject(bucket, key);
    return true;
  } catch {
    return false;
  }
}

async function copyObject({ sourceClient, targetClient, bucket, key }) {
  const srcStat = await sourceClient.statObject(bucket, key);
  const stream = await sourceClient.getObject(bucket, key);
  await targetClient.putObject(bucket, key, stream, srcStat.size, srcStat.metaData || {});
  await targetClient.statObject(bucket, key);
}

async function migrateBucket({
  label,
  bucket,
  keys,
  sourceClient,
  targetClient,
  dryRun,
  deleteSource,
  overwrite,
}) {
  let copied = 0;
  let skipped = 0;
  let missingInSource = 0;
  let deletedInSource = 0;
  let failed = 0;

  console.log(`\n[${label}] Bucket '${bucket}' - ${keys.length} referenzierte Keys`);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    if ((i + 1) % 50 === 0 || i === keys.length - 1) {
      console.log(`[${label}] Fortschritt: ${i + 1}/${keys.length}`);
    }

    try {
      const sourceHasObject = await objectExists(sourceClient, bucket, key);
      if (!sourceHasObject) {
        missingInSource += 1;
        continue;
      }

      const targetHasObject = await objectExists(targetClient, bucket, key);

      if (!overwrite && targetHasObject) {
        skipped += 1;
        if (deleteSource && !dryRun) {
          await sourceClient.removeObject(bucket, key);
          deletedInSource += 1;
        }
        continue;
      }

      if (dryRun) {
        copied += 1;
        continue;
      }

      await copyObject({ sourceClient, targetClient, bucket, key });
      copied += 1;

      if (deleteSource) {
        await sourceClient.removeObject(bucket, key);
        deletedInSource += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`[${label}] Fehler bei '${key}': ${err?.message || err}`);
    }
  }

  return { copied, skipped, missingInSource, deletedInSource, failed, total: keys.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourceEndpoint = args['source-endpoint'] || process.env.SOURCE_MINIO_ENDPOINT;
  const sourcePort = parsePort(args['source-port'] || process.env.SOURCE_MINIO_PORT, parsePort(process.env.MINIO_PORT, 9000));
  const sourceUseSSL = toBool(args['source-use-ssl'] || process.env.SOURCE_MINIO_USE_SSL, false);
  const sourceAccessKey = args['source-access-key'] || process.env.SOURCE_MINIO_ACCESS_KEY || process.env.MINIO_ACCESS_KEY;
  const sourceSecretKey = args['source-secret-key'] || process.env.SOURCE_MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY;

  const targetEndpoint = args['target-endpoint'] || process.env.MINIO_ENDPOINT || 'localhost';
  const targetPort = parsePort(args['target-port'] || process.env.MINIO_PORT, 9000);
  const targetUseSSL = toBool(args['target-use-ssl'] || process.env.TARGET_MINIO_USE_SSL, false);
  const targetAccessKey = args['target-access-key'] || process.env.TARGET_MINIO_ACCESS_KEY || process.env.MINIO_ACCESS_KEY;
  const targetSecretKey = args['target-secret-key'] || process.env.TARGET_MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY;

  const dryRun = toBool(args['dry-run'], false);
  const deleteSource = toBool(args['delete-source'], false);
  const overwrite = toBool(args['overwrite'], false);

  const photosBucket = process.env.MINIO_BUCKET_PHOTOS || 'photos';
  const avatarsBucket = process.env.MINIO_BUCKET_AVATARS || 'avatars';
  const backupsBucket = process.env.MINIO_BUCKET_BACKUPS || 'backups';

  if (!sourceEndpoint) {
    throw new Error('Bitte --source-endpoint oder SOURCE_MINIO_ENDPOINT setzen.');
  }
  if (!sourceAccessKey || !sourceSecretKey) {
    throw new Error('Source Credentials fehlen (MINIO/SOURCE_MINIO_ACCESS_KEY und ...SECRET_KEY).');
  }
  if (!targetAccessKey || !targetSecretKey) {
    throw new Error('Target Credentials fehlen (TARGET_MINIO_... oder MINIO_ACCESS_KEY/MINIO_SECRET_KEY).');
  }

  console.log('MinIO Migration gestartet');
  console.log(`  Source: ${sourceEndpoint}:${sourcePort}`);
  console.log(`  Target: ${targetEndpoint}:${targetPort}`);
  console.log(`  dryRun=${dryRun} deleteSource=${deleteSource} overwrite=${overwrite}`);

  const sourceClient = new MinioClient({
    endPoint: sourceEndpoint,
    port: sourcePort,
    useSSL: sourceUseSSL,
    accessKey: sourceAccessKey,
    secretKey: sourceSecretKey,
  });

  const targetClient = new MinioClient({
    endPoint: targetEndpoint,
    port: targetPort,
    useSSL: targetUseSSL,
    accessKey: targetAccessKey,
    secretKey: targetSecretKey,
  });

  await ensureBucket(targetClient, photosBucket);
  await ensureBucket(targetClient, avatarsBucket);
  await ensureBucket(targetClient, backupsBucket);

  const prisma = new PrismaClient();

  try {
    const [photos, users, backups] = await Promise.all([
      prisma.photo.findMany({ select: { path: true } }),
      prisma.user.findMany({ select: { avatar: true } }),
      prisma.groupBackup.findMany({ select: { zipKey: true } }),
    ]);

    const photoKeys = uniqueNonEmpty(photos.map((p) => p.path).filter(isLikelyObjectKey));
    const avatarKeys = uniqueNonEmpty(
      users
        .map((u) => normalizeAvatarKey(u.avatar))
        .filter(isLikelyObjectKey)
    );
    const backupKeys = uniqueNonEmpty(backups.map((b) => b.zipKey).filter(isLikelyObjectKey));

    const photoResult = await migrateBucket({
      label: 'photos',
      bucket: photosBucket,
      keys: photoKeys,
      sourceClient,
      targetClient,
      dryRun,
      deleteSource,
      overwrite,
    });

    const avatarResult = await migrateBucket({
      label: 'avatars',
      bucket: avatarsBucket,
      keys: avatarKeys,
      sourceClient,
      targetClient,
      dryRun,
      deleteSource,
      overwrite,
    });

    const backupResult = await migrateBucket({
      label: 'backups',
      bucket: backupsBucket,
      keys: backupKeys,
      sourceClient,
      targetClient,
      dryRun,
      deleteSource,
      overwrite,
    });

    const results = [photoResult, avatarResult, backupResult];
    const summary = results.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        copied: acc.copied + r.copied,
        skipped: acc.skipped + r.skipped,
        missingInSource: acc.missingInSource + r.missingInSource,
        deletedInSource: acc.deletedInSource + r.deletedInSource,
        failed: acc.failed + r.failed,
      }),
      { total: 0, copied: 0, skipped: 0, missingInSource: 0, deletedInSource: 0, failed: 0 }
    );

    console.log('\nMigration abgeschlossen');
    console.log(`  referenziert: ${summary.total}`);
    console.log(`  kopiert: ${summary.copied}`);
    console.log(`  übersprungen (bereits im Target): ${summary.skipped}`);
    console.log(`  im Source nicht gefunden: ${summary.missingInSource}`);
    console.log(`  im Source gelöscht: ${summary.deletedInSource}`);
    console.log(`  fehler: ${summary.failed}`);

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err?.message || err);
  process.exit(1);
});
