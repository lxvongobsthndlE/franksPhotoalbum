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
  'join_group_authenticated'
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

function parseListArg(name, fallback) {
  const raw = parseArg(name);
  if (!raw) return fallback;
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getCredentials() {
  const email = parseArg('email', process.env.SUPABASE_LOGIN_EMAIL || null);
  const password = parseArg('password', process.env.SUPABASE_LOGIN_PASSWORD || null);

  if (!email || !password) {
    throw new Error('Missing login credentials. Use --email/--password or SUPABASE_LOGIN_EMAIL/SUPABASE_LOGIN_PASSWORD.');
  }

  return { email, password };
}

function apiHeaders(apiKey, bearerToken = apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearerToken}`,
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
    body,
    headers: res.headers
  };
}

async function login(baseUrl, anonKey, email, password) {
  const url = `${baseUrl}/auth/v1/token?grant_type=password`;
  const result = await fetchJson(url, {
    method: 'POST',
    headers: {
      ...apiHeaders(anonKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  if (!result.ok) {
    throw new Error(`Login failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  return result.body;
}

async function probeCurrentUser(baseUrl, anonKey, accessToken) {
  return fetchJson(`${baseUrl}/auth/v1/user`, {
    headers: apiHeaders(anonKey, accessToken)
  });
}

async function crawlTable(baseUrl, anonKey, accessToken, table, limit) {
  const selectUrl = new URL(`${baseUrl}/rest/v1/${table}`);
  selectUrl.searchParams.set('select', '*');
  selectUrl.searchParams.set('limit', String(limit));

  const countUrl = new URL(`${baseUrl}/rest/v1/${table}`);
  countUrl.searchParams.set('select', 'id');
  countUrl.searchParams.set('limit', '1');

  const [sampleRes, countRes] = await Promise.all([
    fetchJson(selectUrl, {
      headers: {
        ...apiHeaders(anonKey, accessToken),
        Prefer: 'count=exact'
      }
    }),
    fetchJson(countUrl, {
      headers: {
        ...apiHeaders(anonKey, accessToken),
        Prefer: 'count=exact'
      }
    })
  ]);

  const contentRange = countRes.headers.get('content-range');
  const count = contentRange?.includes('/') ? Number(contentRange.split('/').pop()) : null;

  return {
    table,
    readable: sampleRes.ok,
    status: sampleRes.status,
    countStatus: countRes.status,
    rowCount: Number.isFinite(count) ? count : null,
    sampleSize: Array.isArray(sampleRes.body) ? sampleRes.body.length : 0,
    sample: Array.isArray(sampleRes.body) ? sampleRes.body : sampleRes.body,
    error: sampleRes.ok ? null : sampleRes.body,
    countError: countRes.ok ? null : countRes.body
  };
}

async function probeRpc(baseUrl, anonKey, accessToken, rpcName) {
  const result = await fetchJson(`${baseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      ...apiHeaders(anonKey, accessToken),
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

async function ensureOutputDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const { email, password } = getCredentials();
  const limit = Number(parseArg('limit', '25'));
  const tables = parseListArg('tables', DEFAULT_TABLES);
  const rpcs = parseListArg('rpcs', DEFAULT_RPCS);
  const skipRpc = hasFlag('skip-rpc');
  const outputPath = parseArg('out', path.resolve('tmp', 'supabase-login-crawl.json'));

  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Login user: ${email}`);
  console.log(`Table probe limit: ${limit}`);
  console.log(`Output file: ${outputPath}`);

  const session = await login(supabaseUrl, anonKey, email, password);
  const accessToken = session.access_token;
  const currentUser = await probeCurrentUser(supabaseUrl, anonKey, accessToken);
  const tableResults = [];

  for (const table of tables) {
    const result = await crawlTable(supabaseUrl, anonKey, accessToken, table, limit);
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
      const result = await probeRpc(supabaseUrl, anonKey, accessToken, rpcName);
      rpcResults.push(result);
      console.log(`[rpc] ${rpcName}: HTTP ${result.status}`);
    }
  }

  const payload = {
    crawledAt: new Date().toISOString(),
    supabaseUrl,
    email,
    user: currentUser.body,
    tables,
    rpcs: skipRpc ? [] : rpcs,
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