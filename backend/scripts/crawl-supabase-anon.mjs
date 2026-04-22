import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TABLES = [
  'profiles',
  'groups',
  'group_members',
  'albums',
  'photos',
  'likes',
  'comments'
];

const DEFAULT_RPCS = [
  'validate_group_code',
  'get_all_counts',
  'get_photo_stats',
  'join_group_authenticated',
  'join_group',
  'notify_batch_upload'
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseListArg(name, fallback) {
  const raw = parseArg(name);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function jsonHeaders(anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json'
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
    body
  };
}

async function crawlTable(baseUrl, anonKey, table, limit) {
  const selectUrl = new URL(`${baseUrl}/rest/v1/${table}`);
  selectUrl.searchParams.set('select', '*');
  selectUrl.searchParams.set('limit', String(limit));

  const countUrl = new URL(`${baseUrl}/rest/v1/${table}`);
  countUrl.searchParams.set('select', 'id');
  countUrl.searchParams.set('limit', '1');

  const [sampleRes, countRes] = await Promise.all([
    fetchJson(selectUrl, {
      headers: {
        ...jsonHeaders(anonKey),
        Prefer: 'count=exact'
      }
    }),
    fetch(`${countUrl}`, {
      headers: {
        ...jsonHeaders(anonKey),
        Prefer: 'count=exact'
      }
    })
  ]);

  const contentRange = countRes.headers.get('content-range');
  const count = contentRange?.includes('/') ? Number(contentRange.split('/').pop()) : null;
  const countBodyText = await countRes.text();

  return {
    table,
    readable: sampleRes.ok,
    status: sampleRes.status,
    countStatus: countRes.status,
    rowCount: Number.isFinite(count) ? count : null,
    sampleSize: Array.isArray(sampleRes.body) ? sampleRes.body.length : 0,
    sample: Array.isArray(sampleRes.body) ? sampleRes.body : sampleRes.body,
    error: sampleRes.ok ? null : sampleRes.body,
    countError: countRes.ok ? null : countBodyText
  };
}

async function probeRpc(baseUrl, anonKey, rpcName) {
  const url = `${baseUrl}/rest/v1/rpc/${rpcName}`;
  const result = await fetchJson(url, {
    method: 'POST',
    headers: {
      ...jsonHeaders(anonKey),
      'Content-Type': 'application/json'
    },
    body: '{}'
  });

  return {
    rpc: rpcName,
    callable: result.ok,
    status: result.status,
    response: result.body
  };
}

async function probeAuth(baseUrl, anonKey) {
  const url = `${baseUrl}/auth/v1/settings`;
  return fetchJson(url, {
    headers: jsonHeaders(anonKey)
  });
}

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const limit = Number(parseArg('limit', '25'));
  const outputPath = parseArg('out', path.resolve('tmp', 'supabase-anon-crawl.json'));
  const tables = parseListArg('tables', DEFAULT_TABLES);
  const rpcs = parseListArg('rpcs', DEFAULT_RPCS);
  const skipRpc = hasFlag('skip-rpc');

  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Table probe limit: ${limit}`);
  console.log(`Output file: ${outputPath}`);

  const authSettings = await probeAuth(supabaseUrl, anonKey);
  const tableResults = [];

  for (const table of tables) {
    const result = await crawlTable(supabaseUrl, anonKey, table, limit);
    tableResults.push(result);

    if (result.readable) {
      console.log(`[ok] ${table}: ${result.sampleSize} sample rows, count=${result.rowCount ?? 'unknown'}`);
    } else {
      console.log(`[no] ${table}: HTTP ${result.status}`);
    }
  }

  const rpcResults = [];
  if (!skipRpc) {
    for (const rpcName of rpcs) {
      const result = await probeRpc(supabaseUrl, anonKey, rpcName);
      rpcResults.push(result);
      console.log(`[rpc] ${rpcName}: HTTP ${result.status}`);
    }
  }

  const payload = {
    crawledAt: new Date().toISOString(),
    supabaseUrl,
    tables,
    rpcs: skipRpc ? [] : rpcs,
    authSettings: {
      ok: authSettings.ok,
      status: authSettings.status,
      body: authSettings.body
    },
    tableResults,
    rpcResults
  };

  await ensureOutputDir(outputPath);
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log('Finished.');
  console.log(`Readable tables: ${tableResults.filter((x) => x.readable).map((x) => x.table).join(', ') || 'none'}`);
}

main().catch((err) => {
  console.error(`Crawl failed: ${err.message}`);
  process.exit(1);
});