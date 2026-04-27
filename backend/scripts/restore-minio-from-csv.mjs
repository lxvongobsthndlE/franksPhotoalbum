import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client as MinioClient } from 'minio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env.local') });

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const idx = raw.indexOf('=');
    if (idx === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, idx)] = raw.slice(idx + 1);
    }
  }
  return args;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }
  values.push(current);
  return values;
}

function readRefs(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV enthält keine Datenzeilen.');
  }

  const headers = parseCsvLine(lines[0]);
  const idxType = headers.indexOf('ref_type');
  const idxBucket = headers.indexOf('bucket');
  const idxObjectKey = headers.indexOf('object_key');

  if (idxType === -1 || idxBucket === -1 || idxObjectKey === -1) {
    throw new Error('CSV Header muss ref_type, bucket und object_key enthalten.');
  }

  const entries = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const refType = values[idxType] || '';
    const bucket = values[idxBucket] || '';
    const objectKey = values[idxObjectKey] || '';

    if (!bucket || !objectKey) continue;

    entries.push({ refType, bucket, objectKey });
  }

  return entries;
}

function normalizeKey(refType, objectKey) {
  if (refType === 'avatar') {
    const m = objectKey.match(/\/api\/auth\/avatar\/([^/?#]+)/i);
    if (m && m[1]) {
      return `avatar_${m[1]}`;
    }
  }
  return objectKey;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

async function exists(client, bucket, key) {
  try {
    await client.statObject(bucket, key);
    return true;
  } catch {
    return false;
  }
}

async function copyObject(sourceClient, targetClient, bucket, key) {
  const stat = await sourceClient.statObject(bucket, key);
  const stream = await sourceClient.getObject(bucket, key);
  await targetClient.putObject(bucket, key, stream, stat.size, stat.metaData || {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const csvPath = args['refs-csv'];
  if (!csvPath) {
    throw new Error('Bitte --refs-csv=<pfad-zur-csv> angeben.');
  }

  const sourceEndpoint = args['source-endpoint'] || process.env.MINIO_ENDPOINT || 'localhost';
  const sourcePort = parsePort(args['source-port'] || process.env.MINIO_PORT, 9000);
  const sourceAccessKey = args['source-access-key'] || process.env.MINIO_ACCESS_KEY;
  const sourceSecretKey = args['source-secret-key'] || process.env.MINIO_SECRET_KEY;
  const sourceUseSSL = toBool(args['source-use-ssl'] || process.env.SOURCE_MINIO_USE_SSL, false);

  const targetEndpoint =
    args['target-endpoint'] || process.env.SOURCE_MINIO_ENDPOINT || '192.168.178.87';
  const targetPort = parsePort(args['target-port'] || process.env.SOURCE_MINIO_PORT, 9000);
  const targetAccessKey =
    args['target-access-key'] ||
    process.env.SOURCE_MINIO_ACCESS_KEY ||
    process.env.MINIO_ACCESS_KEY;
  const targetSecretKey =
    args['target-secret-key'] ||
    process.env.SOURCE_MINIO_SECRET_KEY ||
    process.env.MINIO_SECRET_KEY;
  const targetUseSSL = toBool(args['target-use-ssl'] || process.env.TARGET_MINIO_USE_SSL, false);

  const overwrite = toBool(args.overwrite, false);
  const dryRun = toBool(args['dry-run'], false);

  if (!sourceAccessKey || !sourceSecretKey) {
    throw new Error('Source Credentials fehlen (MINIO_ACCESS_KEY / MINIO_SECRET_KEY).');
  }
  if (!targetAccessKey || !targetSecretKey) {
    throw new Error(
      'Target Credentials fehlen (SOURCE_MINIO_* oder --target-access-key/--target-secret-key).'
    );
  }

  const refs = readRefs(csvPath);
  const normalized = refs.map((r) => ({ ...r, key: normalizeKey(r.refType, r.objectKey) }));

  const uniqueByBucketAndKey = [];
  const seen = new Set();
  for (const r of normalized) {
    const id = `${r.bucket}::${r.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueByBucketAndKey.push(r);
  }

  console.log(`Restore startet: ${uniqueByBucketAndKey.length} eindeutige Keys`);
  console.log(`  Source: ${sourceEndpoint}:${sourcePort}`);
  console.log(`  Target: ${targetEndpoint}:${targetPort}`);
  console.log(`  dryRun=${dryRun} overwrite=${overwrite}`);

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

  let copied = 0;
  let skipped = 0;
  let missingInSource = 0;
  let failed = 0;

  for (let i = 0; i < uniqueByBucketAndKey.length; i += 1) {
    const item = uniqueByBucketAndKey[i];

    if ((i + 1) % 25 === 0 || i === uniqueByBucketAndKey.length - 1) {
      console.log(`Fortschritt: ${i + 1}/${uniqueByBucketAndKey.length}`);
    }

    try {
      const sourceHas = await exists(sourceClient, item.bucket, item.key);
      if (!sourceHas) {
        missingInSource += 1;
        console.warn(`Nicht im lokalen Source gefunden: ${item.bucket}/${item.key}`);
        continue;
      }

      const targetHas = await exists(targetClient, item.bucket, item.key);
      if (targetHas && !overwrite) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        copied += 1;
        continue;
      }

      await copyObject(sourceClient, targetClient, item.bucket, item.key);
      copied += 1;
    } catch (err) {
      failed += 1;
      console.error(`Fehler bei ${item.bucket}/${item.key}: ${err?.message || err}`);
    }
  }

  console.log('\nRestore abgeschlossen');
  console.log(`  total: ${uniqueByBucketAndKey.length}`);
  console.log(`  kopiert: ${copied}`);
  console.log(`  übersprungen (bereits vorhanden): ${skipped}`);
  console.log(`  im Source nicht gefunden: ${missingInSource}`);
  console.log(`  fehler: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Restore fehlgeschlagen:', err?.message || err);
  process.exit(1);
});
