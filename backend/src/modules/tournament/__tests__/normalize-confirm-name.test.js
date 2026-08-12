// Schutztest: hält die Server-Quelle und die Browser-Quelle von
// normalizeConfirmName identisch. Wenn jemand eine der beiden Dateien
// ändert ohne die andere mitzuziehen, bricht dieser Test.
//
// Geladen werden die Dateien als reiner Text und vergleichen die Funktion
// in normalisierter Form (Whitespace egal — Minifier-robust).

import fs from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';

const SERVER = path.join(import.meta.dirname, '..', 'normalize-confirm-name.js');
const BROWSER = path.join(
  import.meta.dirname, '..', '..', '..', '..', 'public', 'script', 'normalize-confirm-name.js'
);

describe('normalizeConfirmName — Server/Browser Quellen-Identität', () => {
  test('beide Dateien existieren', () => {
    expect(fs.existsSync(SERVER)).toBe(true);
    expect(fs.existsSync(BROWSER)).toBe(true);
  });

  test('Funktions-Body ist identisch (whitespace-normalisiert)', () => {
    const serverSrc = fs.readFileSync(SERVER, 'utf8');
    const browserSrc = fs.readFileSync(BROWSER, 'utf8');

    // Extrahiere die normalize-Funktion aus beiden Quellen
    const extract = (src, exportKind) => {
      // server: function normalizeConfirmName(name) { ... } (CommonJS)
      // browser: export function normalizeConfirmName(name) { ... } (ESM)
      const m = src.match(/function\s+normalizeConfirmName\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
      if (!m) throw new Error(`Funktion in ${exportKind}-Quelle nicht gefunden`);
      return m[1].replace(/\s+/g, ' ').trim();
    };

    const serverBody = extract(serverSrc, 'Server');
    const browserBody = extract(browserSrc, 'Browser');
    expect(browserBody).toBe(serverBody);
  });

  test('Server-Funktion verhält sich korrekt', async () => {
    const { normalizeConfirmName } = await import('../normalize-confirm-name.js');
    expect(normalizeConfirmName('Sommer-Cup 2026')).toBe('sommer-cup 2026');
    expect(normalizeConfirmName('  sommer-cup 2026  ')).toBe('sommer-cup 2026');
    expect(normalizeConfirmName('SOMMER-CUP 2026')).toBe('sommer-cup 2026');
    expect(normalizeConfirmName(null)).toBe('');
    expect(normalizeConfirmName(undefined)).toBe('');
    expect(normalizeConfirmName('')).toBe('');
    // Vertipper muss weiterhin mismatch ergeben — sonst wäre die
    // Bestätigung trivial zu umgehen.
    expect(normalizeConfirmName('Sommer-Cup 2025')).not.toBe(
      normalizeConfirmName('Sommer-Cup 2026')
    );
  });
});