// Cleanup: löscht alle Turniere (und damit via CASCADE Stages,
// Groups, Memberships, Matches, Teams) für EINE Gruppe.
//
// Hintergrund: Beim Wizard-Test entstehen oft kaputte Halb-Entwürfe
// mit Status 'draft' und fehlenden Teams oder Groups (Phase 0 / Phase
// "draft" auf allen vier Phasenblöcken). Dieser Befehl räumt sie weg
// — und NUR die einer Gruppe, nicht versehentlich alle der DB.
//
// Aufruf:
//   1) Vorschau (was würde gelöscht?):
//      node backend/scripts/cleanup-tournaments.mjs \
//        --group-id=<CUID> --dry-run
//
//   2) Endgültig löschen (zweistufig mit Bestätigung):
//      node backend/scripts/cleanup-tournaments.mjs \
//        --group-id=<CUID>
//
// Verifikation danach:
//   node backend/scripts/cleanup-tournaments.mjs \
//     --group-id=<CUID> --dry-run
//   → "Gefunden: 0 Turniere" (sonst sind noch welche übrig)
//
// Sicherheit:
//   - Ohne --dry-run: Script FRAGT ZWEIMAL via stdin nach "JA" ab
//     (Tippen: erstes JA = Vorschau bestätigen, zweites JA = löschen).
//   - Stage/Group/Match-CASCADE wird genutzt — kein eigenes Aufräumen.
//   - MinIO-Objekte (Logos/Cover) werden NICHT entfernt, weil diese
//     über uploadTournamentAsset() hochgeladen wurden und ihre Keys
//     unabhängig vom Turnier sind. Wenn die Buckets volllaufen:
//     'mc ls photoalbum/tournament-assets' und manuell entscheiden.

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const DRY_RUN = process.argv.includes('--dry-run');

function parseArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function requireArg(name) {
  const value = parseArg(name);
  if (!value) {
    console.error(`\nFehler: --${name}=<WERT> fehlt.`);
    console.error('Aufruf:');
    console.error('  node backend/scripts/cleanup-tournaments.mjs --group-id=<CUID> [--dry-run]');
    console.error('\nDie Group-ID findest du z. B. via:');
    console.error('  SELECT id, name FROM "Group" ORDER BY "createdAt" DESC LIMIT 20;');
    process.exit(2);
  }
  return value;
}

async function readStdin(prompt) {
  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve) => {
    const handler = (chunk) => {
      const answer = chunk.toString().trim().toUpperCase();
      process.stdin.removeListener('data', handler);
      process.stdin.pause();
      resolve(answer);
    };
    process.stdin.on('data', handler);
  });
}

function fmtDate(d) {
  if (!d) return '–';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function main() {
  const groupId = requireArg('group-id');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // 1) Existiert die Gruppe überhaupt? Sonst „group not found"
    //    statt „0 Turniere" (Verwechslungsgefahr).
    const groupRes = await client.query('SELECT id, name, "createdAt" FROM "Group" WHERE id = $1', [
      groupId,
    ]);
    if (groupRes.rowCount === 0) {
      console.error(`\nKeine Gruppe mit ID "${groupId}" gefunden.`);
      console.error('Verfügbare Gruppen:');
      const all = await client.query(
        'SELECT id, name FROM "Group" ORDER BY "createdAt" DESC LIMIT 20'
      );
      for (const row of all.rows) {
        console.error(`  ${row.id}  ${row.name}`);
      }
      process.exit(1);
    }
    const group = groupRes.rows[0];

    // 2) Inventur: welche Turniere + Counts hängen dran?
    const tournamentsRes = await client.query(
      `SELECT t.id, t.name, t.status, t.mode, t."createdAt",
              (SELECT COUNT(*) FROM "tournament_teams"   WHERE "tournamentId" = t.id) AS teams,
              (SELECT COUNT(*) FROM "stages"             WHERE "tournamentId" = t.id) AS stages,
              (SELECT COUNT(*) FROM "matches"            WHERE "tournamentId" = t.id) AS matches
         FROM "tournaments" t
        WHERE t."groupId" = $1
        ORDER BY t."createdAt" ASC`,
      [groupId]
    );

    console.log(`\nGruppe:   ${group.name}`);
    console.log(`ID:       ${group.id}`);
    console.log(`Erstellt: ${fmtDate(group.createdAt)}`);
    console.log(`Turniere: ${tournamentsRes.rowCount}`);

    if (tournamentsRes.rowCount === 0) {
      console.log('\n→ Nichts zu tun. Gruppe ist sauber.');
      process.exit(0);
    }

    console.log('\nInventur:');
    console.log(
      '  erstellt                  | status    | name                                | teams | stages | matches | id'
    );
    console.log(
      '  --------------------------+-----------+-------------------------------------+-------+--------+---------+--------------'
    );
    for (const row of tournamentsRes.rows) {
      console.log(
        `  ${fmtDate(row.createdAt)} | ${(row.status || '–').padEnd(9)} | ${(row.name || '–').slice(0, 35).padEnd(35)} | ${String(row.teams).padStart(5)} | ${String(row.stages).padStart(6)} | ${String(row.matches).padStart(7)} | ${row.id}`
      );
    }

    // 3) --dry-run: nach Vorschau raus, ohne zu löschen
    if (DRY_RUN) {
      console.log('\n→ DRY-RUN: nichts gelöscht. Ohne --dry-run ausführen, um zu löschen.');
      process.exit(0);
    }

    // 4) Zweistufige Bestätigung (zwei separate Prompts).
    const totalT = tournamentsRes.rowCount;
    const firstAnswer = await readStdin(
      `\nACHTUNG: ${totalT} Turnier${totalT === 1 ? '' : 'e'} + alle abhängigen Stages/Groups/Matches/Teams werden unwiderruflich gelöscht.\nTippe "JA" um fortzufahren, oder irgendetwas anderes zum Abbrechen: `
    );
    if (firstAnswer !== 'JA') {
      console.log('\n→ Abgebrochen. Nichts gelöscht.');
      process.exit(0);
    }

    const secondAnswer = await readStdin(
      '\nLetzte Warnung: das betrifft auch Turniere MIT Ergebnissen (Status group_stage / finished).\nTippe erneut "JA" zum endgültigen Löschen: '
    );
    if (secondAnswer !== 'JA') {
      console.log('\n→ Abgebrochen. Nichts gelöscht.');
      process.exit(0);
    }

    // 5) Löschen in EINER Transaktion. ON DELETE CASCADE auf
    //    stages / groups / group_memberships / matches /
    //    tournament_teams / tournament_teams.teams übernimmt den Rest.
    await client.query('BEGIN');
    try {
      const result = await client.query(
        'DELETE FROM "tournaments" WHERE "groupId" = $1 RETURNING id, name, status',
        [groupId]
      );
      await client.query('COMMIT');
      console.log(`\n→ ${result.rowCount} Turnier${result.rowCount === 1 ? '' : 'e'} gelöscht.`);
      for (const row of result.rows) {
        console.log(`    - ${row.id}  ${row.name}  (${row.status})`);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    // 6) Verifikation: nochmal nachschauen, ob die Gruppe wirklich leer ist.
    const afterRes = await client.query(
      'SELECT COUNT(*)::int AS c FROM "tournaments" WHERE "groupId" = $1',
      [groupId]
    );
    if (afterRes.rows[0].c === 0) {
      console.log('\n✓ Verifikation: Gruppe enthält jetzt 0 Turniere.');
    } else {
      console.log(`\n✗ Verifikation FEHLGESCHLAGEN: noch ${afterRes.rows[0].c} Turniere übrig.`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
