import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env.local');

dotenv.config({ path: envPath });

const minioEndpoint = process.env.MINIO_ENDPOINT || 'localhost';
const minioPort = Number.parseInt(process.env.MINIO_PORT || '9000', 10);
const minioExe = process.env.MINIO_BINARY_PATH || path.join(backendRoot, 'dev_tools', 'minio.exe');
const minioDataDir =
  process.env.MINIO_DATA_DIR || path.join(backendRoot, 'dev_tools', 'minio_data');

const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;

let minioProcess = null;
let backendProcess = null;
let shuttingDown = false;

function redactMinioLine(line) {
  if (!line) return line;

  let redacted = line;
  redacted = redacted.replace(/(RootUser\s*:\s*).*/i, '$1[redacted]');
  redacted = redacted.replace(/(RootPass\s*:\s*).*/i, '$1[redacted]');
  redacted = redacted.replace(
    /(mc alias set\s+'[^']+'\s+'[^']+'\s+)'[^']+'\s+'[^']+'/i,
    "$1'[redacted]' '[redacted]'"
  );

  return redacted;
}

function pipeRedactedOutput(stream, writer) {
  if (!stream) return;

  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      writer(`${redactMinioLine(line)}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      writer(redactMinioLine(buffer));
      buffer = '';
    }
  });
}

function isLocalEndpoint(host) {
  return host === 'localhost' || host === '127.0.0.1';
}

function isPortOpen(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));

    socket.connect(port, host);
  });
}

async function waitForPortOpen(host, port, attempts = 25, delayMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isPortOpen(host, port, 500)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function startBackend() {
  backendProcess = spawn('node', ['--env-file=.env.local', '--watch', 'src/app.js'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
  });

  backendProcess.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (minioProcess && !minioProcess.killed) {
      minioProcess.kill('SIGTERM');
    }

    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

function shutdownAll() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
  if (minioProcess && !minioProcess.killed) {
    minioProcess.kill('SIGTERM');
  }

  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);

async function main() {
  const localMinio = isLocalEndpoint(minioEndpoint);

  if (!localMinio) {
    console.log(
      `[dev] MINIO_ENDPOINT=${minioEndpoint} ist extern. MinIO wird nicht lokal gestartet.`
    );
    startBackend();
    return;
  }

  const alreadyRunning = await isPortOpen(minioEndpoint, minioPort);
  if (alreadyRunning) {
    console.log(`[dev] MinIO läuft bereits auf ${minioEndpoint}:${minioPort}.`);
    startBackend();
    return;
  }

  if (!fs.existsSync(minioExe)) {
    console.error(`[dev] MinIO Binary nicht gefunden: ${minioExe}`);
    console.error('[dev] Lege minio.exe unter backend/dev_tools/ ab oder setze MINIO_BINARY_PATH.');
    process.exit(1);
  }

  if (!minioAccessKey || !minioSecretKey) {
    console.error('[dev] MINIO_ACCESS_KEY und MINIO_SECRET_KEY müssen in .env.local gesetzt sein.');
    process.exit(1);
  }

  fs.mkdirSync(minioDataDir, { recursive: true });

  const minioEnv = { ...process.env };
  delete minioEnv.MINIO_ACCESS_KEY;
  delete minioEnv.MINIO_SECRET_KEY;
  minioEnv.MINIO_ROOT_USER = minioAccessKey;
  minioEnv.MINIO_ROOT_PASSWORD = minioSecretKey;

  console.log(`[dev] Starte lokales MinIO auf ${minioEndpoint}:${minioPort} ...`);
  minioProcess = spawn(minioExe, ['server', minioDataDir, '--console-address', ':9001'], {
    cwd: backendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: minioEnv,
  });

  pipeRedactedOutput(minioProcess.stdout, (msg) => process.stdout.write(msg));
  pipeRedactedOutput(minioProcess.stderr, (msg) => process.stderr.write(msg));

  minioProcess.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[dev] MinIO wurde beendet (exit code ${code ?? 0}).`);
  });

  const reachable = await waitForPortOpen(minioEndpoint, minioPort);
  if (!reachable) {
    console.error(`[dev] MinIO ist auf ${minioEndpoint}:${minioPort} nicht erreichbar.`);
    process.exit(1);
  }

  startBackend();
}

main().catch((err) => {
  console.error('[dev] Fehler beim Start:', err);
  process.exit(1);
});
