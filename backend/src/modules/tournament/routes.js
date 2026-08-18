/**
 * Tournament Routes — Spec §10, §11, §13.2 (Rollenmodell).
 *
 * Aufbau:
 *   1. CRUD: create / list / get / update / delete
 *   2. Teams: bulk add (Copy-Paste aus Wizard) + remove
 *   3. Generate: Round-Robin-Schedule erstellen (Admin)
 *   4. Standings: Live-Berechnung pro Gruppe
 *   5. Schedule / Bracket: Read-Endpoints
 *   6. Result: Ergebnis eintragen + Propagation (Admin)
 *
 * Datenfluss:
 *   1. Auth-Helper prüfen Berechtigung (auth.js).
 *   2. DB-Rohdaten nur via view.js → DTOs.
 *   3. Persistenz-Logik nur via persist.js → persistGenerated().
 *
 * Niemals: Prisma-Rohzeilen aus einer Route herausgeben.
 * Niemals: Inline-Schreiblogik in einer Route.
 */

import {
  requireAuth,
  requireTournamentRead,
  requireTournamentWrite,
  isGroupAdmin,
} from './auth.js';
import {
  generateTournament,
  computeStandings,
  applyTiebreaker,
  resetCascade,
  propagateWinner,
  mergeConfig,
  generateSchedule,
} from './engine/index.js';
import {
  buildTournamentViewContext,
  buildTournamentListContext,
  buildStandingsForGroup,
} from './view.js';
import { persistGenerated } from './persist.js';
import { normalizeConfirmName } from './normalize-confirm-name.js';
import { validateConfigPatch } from './config-validator.js';
import {
  uploadTournamentLogo,
  deleteTournamentAsset,
  getTournamentAssetStream,
  getTournamentAssetStat,
} from '../../utils/storage.js';
import { resizeLogoImage } from './asset.js';
import { nextPaletteColor } from './team-colors.js';

export default async function tournamentRoutes(fastify) {
  // ─────────────────────────────────────────────────────────
  // 1. CRUD
  // ─────────────────────────────────────────────────────────

  // POST /api/tournaments — Turnier anlegen (Admin only, Pflicht-Test 1+2)
  fastify.post('/', async (request, reply) => {
    try {
      const { user } = await requireAuth(request, fastify.prisma);
      const { groupId, name, mode } = request.body ?? {};
      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });
      if (!name?.trim()) return reply.code(400).send({ error: 'name erforderlich' });

      const admin = await isGroupAdmin(fastify.prisma, groupId, user);
      if (!admin) {
        return reply
          .code(403)
          .send({ error: 'Nur Gruppen-Owner / Admins dürfen Turniere anlegen' });
      }

      const tournament = await fastify.prisma.tournament.create({
        data: {
          groupId,
          name: name.trim(),
          mode: mode ?? 'groups_ko',
          status: 'draft',
          createdById: user.id,
        },
      });
      return reply.code(201).send({ tournament });
    } catch (err) {
      return handleError(reply, err, 'Turnier anlegen fehlgeschlagen');
    }
  });

  // GET /api/tournaments/group/:groupId — Liste (Pflicht-Test 5+6)
  fastify.get('/group/:groupId', async (request, reply) => {
    try {
      const { user } = await requireAuth(request, fastify.prisma);
      const { groupId } = request.params;
      const admin = await isGroupAdmin(fastify.prisma, groupId, user);

      // Mitgliedschaft prüfen (auch für Admins nicht zwingend, aber günstig).
      const member = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: user.id, groupId } },
      });
      if (!member && !admin) {
        return reply.code(403).send({ error: 'Kein Mitglied dieser Gruppe' });
      }

      const ctx = await buildTournamentListContext(
        fastify.prisma,
        groupId,
        user,
        admin
      );
      return ctx;
    } catch (err) {
      return handleError(reply, err, 'Liste laden fehlgeschlagen');
    }
  });

  // GET /api/tournaments/:id — Detail (Pflicht-Test 3+4)
  fastify.get('/:id', async (request, reply) => {
    try {
      const auth = await requireTournamentRead(
        request,
        fastify.prisma,
        request.params.id
      );
      const view = await buildTournamentViewContext(
        fastify.prisma,
        auth.tournament.id
      );
      return {
        tournament: view.tournament,
        teams: view.teams,
        stages: view.stages,
        groups: view.groups,
        matches: view.matches,
        stats: view.stats,
        isAdmin: auth.isAdmin,
        public: auth.public,
      };
    } catch (err) {
      return handleError(reply, err, 'Turnier laden fehlgeschlagen');
    }
  });

  // PATCH /api/tournaments/:id — Update (Admin)
  //
  // Felder:
  //   - name, logoUrl, coverUrl, startsAt, endsAt   → immer erlaubt
  //   - config                                      → nur solange keine
  //                                                   Ergebnisse existieren
  //                                                   (sonst würde sich die
  //                                                   Tabelle rückwirkend
  //                                                   ändern, §5.4 + §13)
  //
  // Config wird über validateConfigPatch geprüft — unbekannte Schlüssel
  // werden verworfen, Wertebereiche geprüft, ungültige Werte → 400.
  fastify.patch('/:id', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      const body = request.body ?? {};
      const data = {};

      // --- Meta-Felder (immer erlaubt)
      for (const k of ['name', 'logoUrl', 'coverUrl', 'startsAt', 'endsAt']) {
        if (k in body) data[k] = body[k];
      }

      // --- Modus (Spec §1.2: Turniermodus — Top-Level-Spalte, nicht in
      //     config, weil die Engine sie überall erwartet). Wizard darf
      //     den Modus nachträglich wechseln, solange das Turnier noch
      //     nicht generiert ist. §13: keine stillen Annahmen — ein
      //     ungültiger Modus führt zu 400, kein Fallback auf Default.
      //
      //     Hintergrund (2026-08-17, Bug A): Vor diesem Fix konnte der
      //     Wizard in Step 3 einen anderen Modus wählen, der PATCH
      //     schickte ihn aber NICHT, weil buildPatchPayload ihn nicht
      //     serialisierte. Beim /generate wurde dann der Create-Default
      //     ('groups_ko') aus der DB gelesen — Header zeigte falsch.
      const ALLOWED_MODES = ['groups_ko', 'groups_only', 'ko_only', 'double_elim'];
      if ('mode' in body) {
        if (!ALLOWED_MODES.includes(body.mode)) {
          return reply.code(400).send({
            error: 'invalid_mode',
            message:
              'mode muss einer von ' + ALLOWED_MODES.join(', ') + ' sein.',
            field: 'mode',
          });
        }
        // Sobald Spiele existieren, ist der Modus eingefroren —
        // wechseln würde die Tabellen-Bedeutung rückwirkend ändern
        // (z. B. aus KO-Match wird Gruppen-Match mit anderer Wertung).
        const finishedCount = await fastify.prisma.match.count({
          where: {
            tournamentId: ctx.tournament.id,
            status: 'finished',
          },
        });
        if (finishedCount > 0) {
          return reply.code(409).send({
            error: 'mode_locked_results_present',
            message:
              'Der Modus kann nicht mehr geändert werden, sobald ' +
              'Ergebnisse vorliegen — die Bedeutung der Tabelle und ' +
              'des Brackets würde sich rückwirkend ändern.',
            finishedMatches: finishedCount,
          });
        }
        data.mode = body.mode;
      }

      // --- Grunddaten (Spec §1.2: Ort, Sport, Tischlabels)
      if ('location' in body) {
        if (body.location !== null && typeof body.location !== 'string') {
          return reply.code(400).send({
            error: 'invalid_location',
            message: 'location muss ein String oder null sein.',
            field: 'location',
          });
        }
        // Leere Strings werden als null behandelt (kein "  " im Druckkopf).
        if (typeof body.location === 'string' && body.location.trim() === '') {
          data.location = null;
        } else {
          data.location = body.location;
        }
      }
      if ('sport' in body) {
        if (!['becher', 'tore', 'punkte'].includes(body.sport)) {
          return reply.code(400).send({
            error: 'invalid_sport',
            message: 'sport muss einer von becher, tore, punkte sein.',
            field: 'sport',
          });
        }
        data.sport = body.sport;
      }
      if ('tableLabels' in body) {
        if (body.tableLabels !== null) {
          if (!Array.isArray(body.tableLabels)) {
            return reply.code(400).send({
              error: 'invalid_tableLabels',
              message: 'tableLabels muss ein Array von Strings oder null sein.',
              field: 'tableLabels',
            });
          }
          for (const [i, label] of body.tableLabels.entries()) {
            if (typeof label !== 'string' || label.trim() === '') {
              return reply.code(400).send({
                error: 'invalid_tableLabels',
                message:
                  `tableLabels[${i}] muss ein nicht-leerer String sein.`,
                field: 'tableLabels',
              });
            }
          }
        }
        data.tableLabels = body.tableLabels;
      }

      // --- Config (gesperrt, sobald Ergebnisse existieren —
      //     AUSNAHME: schedule.* ist auch bei Ergebnissen erlaubt,
      //     weil Zeit/Tisch das Ranking nicht beeinflussen, §5.3)
      if ('config' in body) {
        const v = validateConfigPatch(body.config);
        if (!v.ok) {
          return reply.code(400).send({
            error: v.error,
            message: v.message,
            field: v.field,
          });
        }
        if (Object.keys(v.value).length > 0) {
          const onlySchedule =
            Object.keys(v.value).length === 1 &&
            'schedule' in v.value;
          if (!onlySchedule) {
            const finishedCount = await fastify.prisma.match.count({
              where: {
                tournamentId: ctx.tournament.id,
                status: 'finished',
              },
            });
            if (finishedCount > 0) {
              return reply.code(409).send({
                error: 'config_locked_results_present',
                message:
                  'Die Turnier-Konfiguration kann nicht mehr geändert ' +
                  'werden, sobald Ergebnisse vorliegen — Punkte, ' +
                  'Tiebreaker und Qualifikation würden sich rückwirkend ' +
                  'auf die Tabelle auswirken. Zeiten und Tische ' +
                  '(schedule.*) bleiben editierbar.',
                finishedMatches: finishedCount,
              });
            }
          }
          data.config = v.value;
        }
      }

      // eslint-disable-next-line no-unused-vars
      const tournament = await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data,
      });
      // Konsistente Antwort: DTO statt Roh-Row.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return { tournament: view.tournament };
    } catch (err) {
      return handleError(reply, err, 'Update fehlgeschlagen');
    }
  });

  // DELETE /api/tournaments/:id — Löschen (Admin)
  // Räumt auch die zugehörigen MinIO-Assets (Logo, Cover) auf, damit
  // keine verwaisten Dateien im Speicher bleiben. Fehler beim
  // MinIO-Räumen werden bewusst geschluckt — die DB-Zeile ist weg,
  // und ein verlorenes Objekt ist weniger schlimm als ein hängen
  // gebliebener Turnier-Eintrag.
  fastify.delete('/:id', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const tournamentId = ctx.tournament.id;
      await fastify.prisma.tournament.delete({ where: { id: tournamentId } });
      await deleteTournamentAsset(tournamentId, 'logo').catch(() => {});
      await deleteTournamentAsset(tournamentId, 'cover').catch(() => {});
      return { ok: true };
    } catch (err) {
      return handleError(reply, err, 'Löschen fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 2. Teams
  // ─────────────────────────────────────────────────────────

  // POST /api/tournaments/:id/teams — Bulk add (Copy-Paste aus Wizard)
  // Body: { names: string[] } — eine Zeile pro Team.
  fastify.post('/:id/teams', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const { names } = request.body ?? {};
      if (!Array.isArray(names) || names.length === 0) {
        return reply.code(400).send({ error: 'names[] erforderlich' });
      }
      const clean = names.map((n) => String(n).trim()).filter(Boolean);
      if (clean.length === 0) {
        return reply.code(400).send({ error: 'Keine gültigen Teamnamen' });
      }
      const unique = [...new Set(clean)];

      // Existierende Teams laden, damit wir die nächste freie Palette-Farbe
      // bestimmen können. Teams mit explizit gesetzter Farbe werden nicht
      // überschrieben — nur neu hinzugefügte bekommen eine Default-Farbe,
      // wenn der Body keine mitliefert.
      const existingTeams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        orderBy: { createdAt: 'asc' },
      });
      const colorAssignments = [];
      const existingByName = new Map(existingTeams.map((t) => [t.name, t]));

      const newTeamsData = [];
      for (const name of unique) {
        if (existingByName.has(name)) {
          // skipDuplicates wird diesen Namen ignorieren — wir brauchen
          // keine Farbe zuweisen.
          continue;
        }
        const color = nextPaletteColor([
          ...existingTeams,
          ...colorAssignments,
        ]);
        colorAssignments.push({ name, color });
        newTeamsData.push({ tournamentId: ctx.tournament.id, name, color });
      }

      const result = await fastify.prisma.tournamentTeam.createMany({
        data: newTeamsData,
        skipDuplicates: true,
      });
      // DTO-Antwort, nicht die Roh-Teams.
      const teams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        orderBy: { createdAt: 'asc' },
      });
      return reply.code(201).send({
        added: result.count,
        teams: teams.map((t) => ({
          id: t.id,
          name: t.name,
          seed: t.seed ?? null,
          color: t.color ?? null,
        })),
      });
    } catch (err) {
      return handleError(reply, err, 'Teams hinzufügen fehlgeschlagen');
    }
  });

  // DELETE /api/tournaments/:id/teams/:teamId
  fastify.delete('/:id/teams/:teamId', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const team = await fastify.prisma.tournamentTeam.findFirst({
        where: { id: request.params.teamId, tournamentId: ctx.tournament.id },
      });
      if (!team) return reply.code(404).send({ error: 'Team nicht gefunden' });
      await fastify.prisma.tournamentTeam.delete({ where: { id: team.id } });
      return { ok: true };
    } catch (err) {
      return handleError(reply, err, 'Team löschen fehlgeschlagen');
    }
  });

  // PATCH /api/tournaments/:id/teams/:teamId — Name + Farbe
  //
  // Spec §5: "Ein Team umbenennen berührt den Spielplan nicht — nur die
  // Anzeige." D.h. der Name wird in tournament_teams.name aktualisiert,
  // und jede Anzeige (Spielplan, Standings, Bracket) liest on-the-fly
  // über den Access-Layer — also genügt die Update-Operation hier.
  //
  // Admin-only (gleicher Auth-Weg wie POST/DELETE). Erlaubt nach dem
  // Generieren (status 'generated' / 'group_stage' / 'finished'); nur
  // im Draft werden Teams noch über den Wizard verwaltet.
  //
  // Body: { name?: string, color?: string|null }
  // Antwort: aktualisierter Team-DTO (id, name, color, seed).
  fastify.patch('/:id/teams/:teamId', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const body = request.body || {};
      const patch = {};

      if (body.name !== undefined) {
        const trimmed = String(body.name).trim();
        if (trimmed === '') {
          return reply.code(400).send({
            error: 'team_name_empty',
            message: 'Teamname darf nicht leer sein.',
          });
        }
        if (trimmed.length > 128) {
          return reply.code(400).send({
            error: 'team_name_too_long',
            message: 'Teamname ist zu lang (max. 128 Zeichen).',
          });
        }
        patch.name = trimmed;
      }

      if (body.color !== undefined) {
        // color ist optional. null = explizit zurücksetzen; string = setzen.
        if (body.color !== null && typeof body.color !== 'string') {
          return reply.code(400).send({
            error: 'team_color_invalid',
            message: 'Farbe muss ein String oder null sein.',
          });
        }
        const trimmed = body.color === null ? null : String(body.color).trim();
        if (trimmed !== null && !/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
          return reply.code(400).send({
            error: 'team_color_invalid',
            message: 'Farbe muss im Format #RRGGBB sein.',
          });
        }
        patch.color = trimmed;
      }

      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({
          error: 'team_patch_empty',
          message: 'Mindestens name oder color muss gesetzt sein.',
        });
      }

      const team = await fastify.prisma.tournamentTeam.findFirst({
        where: {
          id: request.params.teamId,
          tournamentId: ctx.tournament.id,
        },
      });
      if (!team) {
        return reply.code(404).send({ error: 'Team nicht gefunden' });
      }

      // Doppelten Namen verhindern (case-insensitive, ungleich sich selbst).
      if (patch.name) {
        const dup = await fastify.prisma.tournamentTeam.findFirst({
          where: {
            tournamentId: ctx.tournament.id,
            id: { not: team.id },
            name: { equals: patch.name, mode: 'insensitive' },
          },
        });
        if (dup) {
          return reply.code(409).send({
            error: 'team_name_taken',
            message: `Ein Team mit dem Namen „${patch.name}" existiert bereits.`,
          });
        }
      }

      const updated = await fastify.prisma.tournamentTeam.update({
        where: { id: team.id },
        data: patch,
      });
      return {
        id: updated.id,
        name: updated.name,
        color: updated.color,
        seed: updated.seed ?? null,
      };
    } catch (err) {
      return handleError(reply, err, 'Team aktualisieren fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 3. Generate — Round-Robin-Schedule erstellen (Admin)
  // ─────────────────────────────────────────────────────────

  // POST /api/tournaments/:id/generate
  //
  // Sichtbarkeitswechsel (§1.2): draft → generated. Ab dann ist das
  // Turnier für Mitglieder der Gruppe sichtbar.
  //
  // Re-Generate ist erlaubt, solange das Turnier nicht im Status
  // 'finished' ist. Vorhandene Ergebnisse werden geschützt: wer ein
  // bereits laufendes Turnier neu generieren will, muss den
  // Turniernamen zur Bestätigung eintippen (§13.10).
  //
  // Body für die Bestätigung:
  //   { confirmTournamentName: "exakter Name" }
  //
  // Antwort: DTO via buildTournamentViewContext — keine Roh-Rows.
  fastify.post('/:id/generate', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      // Status 'finished' ist endgültig — auch mit Bestätigung gesperrt.
      if (ctx.tournament.status === 'finished') {
        return reply.code(409).send({
          error: 'tournament_finished',
          message: 'Beendete Turniere können nicht neu generiert werden.',
        });
      }

      // Gibt es bereits beendete Spiele? Falls ja, brauchen wir die
      // Bestätigung per Turniernamen (§13.10).
      const finishedCount = await fastify.prisma.match.count({
        where: {
          tournamentId: ctx.tournament.id,
          status: 'finished',
        },
      });
      const hasResults = finishedCount > 0;

      if (hasResults) {
        const confirmName = request.body?.confirmTournamentName;
        if (typeof confirmName !== 'string' || confirmName.length === 0) {
          return reply.code(409).send({
            error: 'results_present',
            message:
              'Es sind bereits Ergebnisse eingetragen. ' +
              'Tippe zur Bestätigung den Turniernamen in das Feld im Dialog.',
            finishedMatches: finishedCount,
            needsConfirmation: true,
          });
        }
        // Case-insensitive Vergleich nach trim() auf beiden Seiten —
        // geteilt via normalizeConfirmName() (eine Stelle für Client, Mock,
        // Server, siehe §13.10). Der Sinn der Bestätigung ist, dass der
        // Veranstalter innehält und bewusst tippt — nicht, dass er die
        // exakte Schreibweise trifft. Ein Vertipper im Namen
        // ("Sommer-Cup 2025" statt "Sommer-Cup 2026") fängt diese
        // Bedingung weiterhin ab.
        if (
          normalizeConfirmName(confirmName) !==
          normalizeConfirmName(ctx.tournament.name)
        ) {
          return reply.code(400).send({
            error: 'confirmation_mismatch',
            message: 'Der eingegebene Name stimmt nicht mit dem Turniernamen überein.',
          });
        }
      }

      const teams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        orderBy: { createdAt: 'asc' },
      });
      if (teams.length < 2) {
        return reply.code(400).send({ error: 'Mindestens 2 Teams erforderlich' });
      }

      const config = ctx.tournament.config ?? {};
      const baseDate = request.body?.baseDate ?? config.baseDate ?? null;

      // Modus-Priorität (Bug A, 2026-08-17): Body-Wert > DB-Spalte.
      //
      // Body hat Priorität, weil der Wizard den Modus bei jedem
      // Generate explizit mitschickt (buildGeneratePayload) und der
      // PATCH vor Generate als Auto-Save gilt. Wenn der PATCH
      // fehlgeschlagen ist (Race, Wizard-Regression), fängt der
      // Body-Wert das ab — Spec §13.10: keine stillen Annahmen.
      //
      // Whitelist hier statt beim Service-Layer: /generate ist nicht
      // öffentlich, sondern Admin-only (requireTournamentWrite
      // oben). Trotzdem Validierung, weil ungültige Werte sonst
      // die Engine in einen Fehlerzustand bringen würden.
      const ALLOWED_MODES_FOR_GENERATE = [
        'groups_ko', 'groups_only', 'ko_only', 'double_elim',
      ];
      let mode = ctx.tournament.mode;
      if (request.body?.mode !== undefined) {
        if (!ALLOWED_MODES_FOR_GENERATE.includes(request.body.mode)) {
          return reply.code(400).send({
            error: 'invalid_mode',
            message:
              'mode muss einer von ' +
              ALLOWED_MODES_FOR_GENERATE.join(', ') +
              ' sein.',
            field: 'mode',
          });
        }
        mode = request.body.mode;
      }

      const gen = generateTournament({
        teams: teams.map((t) => ({ id: t.id, name: t.name, seed: t.seed ?? null })),
        config: {
          ...config,
          numGroups: request.body?.numGroups ?? config.numGroups,
          groupSize: request.body?.groupSize ?? config.groupSize,
          mode,
          distribution: config.distribution ?? 'snake',
        },
        baseDate,
      });

      // Engine-Output in EINER Transaktion persistieren (persist.js).
      const persistResult = await persistGenerated(
        fastify.prisma,
        ctx.tournament.id,
        gen
      );

      // Status auf 'generated' (§1.2: macht das Turnier für Mitglieder
      // sichtbar). Wenn vorher schon 'group_stage' war und wir neu
      // generieren, bleibt es bei 'group_stage' — wir wollen den
      // Veranstalter nicht aus der laufenden Phase werfen, falls keine
      // Ergebnisse da waren.
      const newStatus = hasResults
        ? 'group_stage'
        : ctx.tournament.status === 'draft'
          ? 'generated'
          : ctx.tournament.status;

      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { status: newStatus },
      });

      // DTO-Antwort statt Roh-Counts.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );

      const warnings = [];
      if (hasResults) warnings.push('results_deleted');

      return reply.code(201).send({
        tournament: view.tournament,
        teams: view.teams,
        stages: view.stages,
        groups: view.groups,
        matches: view.matches,
        stats: view.stats,
        counts: {
          groups: persistResult.groupCount,
          matches: persistResult.matchCount,
          teams: persistResult.teamCount,
        },
        unresolvedConflicts: gen.unresolvedConflicts,
        warnings,
      });
    } catch (err) {
      return handleError(reply, err, 'Generate fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 3b. Reschedule — Zeitplan neu berechnen OHNE Datenverlust
  // ─────────────────────────────────────────────────────────
  //
  // Warum getrennt von /generate: /generate löscht alle Spiele und legt
  // sie neu an. Wenn schon Ergebnisse da sind, gehen diese verloren
  // (bzw. werden per §13.10 explizit bestätigt — das fühlt sich für
  // „nur die Zeiten sind durcheinander" übertrieben an).
  //
  // /reschedule hingegen:
  //   - lässt `status`, `scoreHome`, `scoreAway`, `winnerTeamId`,
  //     `winnerAdvancesTo`, `loserAdvancesTo`, `bracketType`, `round`,
  //     `bracketPos` UNANGETASTET
  //   - überschreibt nur `scheduledAt` und `field`
  //   - wirft KEINE Spiele weg und erzeugt auch keine neuen
  //   - ist idempotent: 2× reschedule hintereinander liefert identische
  //     Zeiten (Spec §10.9 Determinismus via Engine)
  //
  // Erwartetes Input-Shape:
  //   {
  //     baseDate?: string (ISO),     // Default: heute
  //     confirmTournamentName?: string  // Pflicht wenn finishedMatches > 0
  //   }
  //
  // Antwort: gleiches Shape wie /generate, ABER ohne `unresolvedConflicts`
  // und ohne `warnings` (wir verändern nur scheduledAt/field).
  fastify.post('/:id/reschedule', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      // 'finished' ist endgültig.
      if (ctx.tournament.status === 'finished') {
        return reply.code(409).send({
          error: 'tournament_finished',
          message: 'Beendete Turniere können nicht neu terminiert werden.',
        });
      }

      const config = mergeConfig(ctx.tournament.config ?? {});

      // Matches mit ihrer Stage laden, damit wir stage.type auswerten können.
      const rawMatches = await fastify.prisma.match.findMany({
        where: { tournamentId: ctx.tournament.id },
        include: { stage: true },
        orderBy: [{ stageId: 'asc' }, { bracketPos: 'asc' }],
      });

      if (rawMatches.length === 0) {
        return reply.code(400).send({
          error: 'no_matches',
          message: 'Keine Spiele vorhanden — bitte zuerst generieren.',
        });
      }

      // §13.10: wenn schon Ergebnisse existieren, muss der User den
      // Turniernamen tippen (Bestätigung). Das ist hier KEIN „Wirklich
      // löschen?"-Fall (wir löschen nichts), aber wir wollen den User
      // innehalten lassen, falls er aus Versehen klickt.
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      if (finishedCount > 0) {
        const confirmName = request.body?.confirmTournamentName;
        if (
          typeof confirmName !== 'string' ||
          normalizeConfirmName(confirmName) !==
            normalizeConfirmName(ctx.tournament.name)
        ) {
          return reply.code(409).send({
            error: 'results_present',
            message:
              'Es sind bereits Ergebnisse eingetragen. ' +
              'Tippe zur Bestätigung den Turniernamen in das Feld im Dialog.',
            finishedMatches: finishedCount,
            needsConfirmation: true,
          });
        }
      }

      // Engine-Input-Shape bauen.
      // generateSchedule braucht: id, teamHome, teamAway, stageType, round,
      //   roundNumber, bracketPos.
      // Wir haben in der DB: stageId, groupId, round (als String mit
      // KO-Label ODER Spieltag-Zahl), bracketPos, teamHome, teamAway.
      // Für KO-Matches: round ist „QF"/„SF"/„F"/„3RD" — direkt nutzbar.
      // Für Gruppen-Matches: round ist die Spieltag-Zahl als String.
      //   Wir parsen die Zahl UND setzen stageType='group'.
      const isGroupStage = (type) => type === 'group' || type === 'intermediate_group';

      const engineInput = rawMatches.map((m) => {
        const stageType = isGroupStage(m.stage?.type) ? 'group' : 'ko';
        if (stageType === 'ko') {
          return {
            id: m.id,
            teamHome: m.teamHome,
            teamAway: m.teamAway,
            stageType: 'ko',
            round: m.round,
            bracketPos: m.bracketPos,
          };
        }
        // group
        const roundNumber = Number.parseInt(m.round ?? '1', 10);
        return {
          id: m.id,
          teamHome: m.teamHome,
          teamAway: m.teamAway,
          stageType: 'group',
          groupKey: m.groupId, // nur fürs Logging, nicht für Sortierung
          roundNumber: Number.isFinite(roundNumber) ? roundNumber : 1,
          bracketPos: m.bracketPos,
        };
      });

      const baseDateStr = request.body?.baseDate ?? config.baseDate ?? null;
      const baseDate = baseDateStr ? new Date(baseDateStr) : new Date();

      const scheduled = generateSchedule(engineInput, config, baseDate);

      // Map: id → { scheduledAt, field }
      const updates = new Map();
      for (const s of scheduled) {
        if (s && s.scheduledAt) {
          updates.set(s.id, { scheduledAt: s.scheduledAt, field: s.field });
        }
      }

      // DB-Update: nur scheduledAt + field. ALLES andere bleibt.
      // Wir gehen Match für Match durch (kein Bulk-Update wegen
      // unterschiedlicher `field`-Werte).
      let updatedCount = 0;
      for (const m of rawMatches) {
        const u = updates.get(m.id);
        if (!u) continue;
        await fastify.prisma.match.update({
          where: { id: m.id },
          data: {
            scheduledAt: u.scheduledAt,
            field: u.field ?? null,
          },
        });
        updatedCount += 1;
      }

      // Antwort: frischer View (Renderer soll die neue Liste anzeigen).
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );

      return reply.send({
        tournament: view.tournament,
        teams: view.teams,
        stages: view.stages,
        groups: view.groups,
        matches: view.matches,
        stats: view.stats,
        rescheduledCount: updatedCount,
        finishedCountAtTimeOfReschedule: finishedCount,
      });
    } catch (err) {
      return handleError(reply, err, 'Reschedule fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 4. Standings (Read)
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  // 3c. Backfill-Team-Farben — einmaliger Migrations-Helfer
  // ─────────────────────────────────────────────────────────
  //
  // Vor dem Auto-Color-Feature hatten Teams `color = null`. Dieser
  // Endpoint weist allen Teams ohne Farbe eine Palette-Farbe zu —
  // in `createdAt asc`-Reihenfolge, damit die Zuweisung stabil ist,
  // auch wenn er mehrfach aufgerufen wird.
  //
  // Idempotent: 2× hintereinander liefert das zweite Mal `updatedCount: 0`.
  // Body: nichts. Antwort: `{ updatedCount }`.
  fastify.post('/:id/teams/backfill-colors', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      const teams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        orderBy: { createdAt: 'asc' },
      });

      // Nur Teams ohne Farbe bekommen eine Palette-Farbe. Teams, die schon
      // eine haben (z. B. durch explizites PATCH oder durch Wizard nach
      // dem Color-Feature), bleiben unangetastet.
      const palette = [];
      let updatedCount = 0;
      for (const t of teams) {
        if (t.color) continue; // schon gefärbt — überspringen
        const nextColor = nextPaletteColor(palette);
        palette.push({ color: nextColor });
        await fastify.prisma.tournamentTeam.update({
          where: { id: t.id },
          data: { color: nextColor },
        });
        updatedCount += 1;
      }

      return reply.send({ updatedCount });
    } catch (err) {
      return handleError(reply, err, 'Backfill-Team-Farben fehlgeschlagen');
    }
  });

  // GET /api/tournaments/:id/standings
  fastify.get('/:id/standings', async (request, reply) => {
    try {
      const auth = await requireTournamentRead(
        request,
        fastify.prisma,
        request.params.id
      );

      // Lookups bauen, dann pro Gruppe die Engine rufen.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        auth.tournament.id
      );
      const config = mergeConfig(auth.tournament.config ?? {});
      const teamsById = new Map(view.teams.map((t) => [t.id, t]));

      const groupRows = view.groups.map((g) => {
        const teamIds = g.members.map((m) => m.teamId);
        // Roh-Matches mit DB-Feldern für Engine holen.
        const rawGroupRows = view._lookups.groupsLookup.get(g.id);
        const rawMatches = rawGroupRows?.matches ?? [];
        const standings = buildStandingsForGroup(
          rawMatches,
          teamIds,
          config,
          { computeStandings, applyTiebreaker }
        );
        // Aufgelöste Teamnamen einsetzen.
        return {
          groupId: g.id,
          groupKey: g.key,
          groupName: g.name,
          standings: standings.map((row) => {
            const team = row.teamId ? teamsById.get(row.teamId) : null;
            return {
              ...row,
              name: team?.name ?? row.name,
            };
          }),
        };
      });

      // Sport-Steuerung der Spaltenbezeichnung (Spec §5.4, §13.7):
      //   Bierpong  → „Becher" / Kürzel B
      //   Fußball   → „Tore"   / Kürzel T
      //   Sonstiges → „Punkte" / Kürzel P
      //
      // Wir leiten Label + Kürzel aus dem `sport`-Feld des Turniers ab,
      // nicht aus gesonderten scoreLabel/scoreShort-Feldern — die gab es
      // im Schema nie und führten zu Inkonsistenzen (Bug 8, 2026-08-18:
      // Default 'Tore' obwohl Default-Sport 'becher' war).
      const sport = view.tournament.sport ?? 'becher';
      const labelBySport = { becher: 'Becher', tore: 'Tore', punkte: 'Punkte' };
      const shortBySport = { becher: 'B', tore: 'T', punkte: 'P' };
      const scoreLabel = labelBySport[sport] ?? 'Punkte';
      const scoreShort = shortBySport[sport] ?? 'P';
      return {
        groups: groupRows,
        sport,
        scoreLabel,
        scoreShort,
      };
    } catch (err) {
      return handleError(reply, err, 'Standings laden fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 5. Schedule / Bracket (Read)
  // ─────────────────────────────────────────────────────────

  // GET /api/tournaments/:id/schedule — alle Spiele (Gruppe + KO)
  fastify.get('/:id/schedule', async (request, reply) => {
    try {
      const auth = await requireTournamentRead(
        request,
        fastify.prisma,
        request.params.id
      );
      const view = await buildTournamentViewContext(
        fastify.prisma,
        auth.tournament.id
      );
      return { matches: view.matches };
    } catch (err) {
      return handleError(reply, err, 'Spielplan laden fehlgeschlagen');
    }
  });

  // GET /api/tournaments/:id/bracket — nur KO-Matches
  fastify.get('/:id/bracket', async (request, reply) => {
    try {
      const auth = await requireTournamentRead(
        request,
        fastify.prisma,
        request.params.id
      );
      const view = await buildTournamentViewContext(
        fastify.prisma,
        auth.tournament.id
      );
      const koMatches = view.matches.filter((m) => m.isKoMatch);
      return { matches: koMatches };
    } catch (err) {
      return handleError(reply, err, 'Bracket laden fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 6. Result — Ergebnis eintragen (Admin, Pflicht-Test 7+8)
  // ─────────────────────────────────────────────────────────

  // POST /api/tournaments/:id/matches/:matchId/result
  // Body: { scoreHome: number, scoreAway: number }
  fastify.post('/:id/matches/:matchId/result', async (request, reply) => {
    // Trace-ID für strukturiertes Logging (Bug 7, 2026-08-18). Frontend
    // generiert sie pro Save-Click und schickt sie als Header. So lässt
    // sich der Lebenszyklus eines Klicks über Frontend+Backend korrelieren,
    // wenn der User "Ergebnis erscheint nicht in der Liste" meldet.
    const traceId =
      request.headers['x-trace-id'] ||
      `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const log = (...args) => console.log(`[trace-${traceId}]`, ...args);
    log('POST /result enter', {
      tournamentId: request.params.id,
      matchId: request.params.matchId,
      body: request.body,
    });

    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const { scoreHome, scoreAway } = request.body ?? {};
      if (!Number.isInteger(scoreHome) || !Number.isInteger(scoreAway)) {
        log('validate:fail scores-not-integer', { scoreHome, scoreAway });
        return reply.code(400).send({ error: 'scoreHome und scoreAway müssen Integer sein' });
      }
      if (scoreHome < 0 || scoreAway < 0) {
        log('validate:fail scores-negative', { scoreHome, scoreAway });
        return reply.code(400).send({ error: 'Scores dürfen nicht negativ sein' });
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: request.params.matchId, tournamentId: ctx.tournament.id },
      });
      if (!match) {
        log('match:not-found');
        return reply.code(404).send({ error: 'Match nicht gefunden' });
      }
      if (!match.teamHome || !match.teamAway) {
        log('match:teams-missing', { teamHome: match.teamHome, teamAway: match.teamAway });
        return reply.code(409).send({ error: 'Match hat noch keine Teams (Platzhalter offen)' });
      }
      log('match:found', {
        id: match.id,
        stageId: match.stageId,
        teamHome: match.teamHome,
        teamAway: match.teamAway,
        scoreHome: match.scoreHome,
        scoreAway: match.scoreAway,
        status: match.status,
        winnerAdvancesTo: match.winnerAdvancesTo,
        loserAdvancesTo: match.loserAdvancesTo,
      });

      // KO-Matches dürfen kein Unentschieden — die nächste Runde braucht
      // einen Sieger. Vorher (Bug 2026-08-17) wurde der Score gespeichert
      // und die Propagation still übersprungen. Resultat: F-Karte leer,
      // User wusste nicht warum.
      const stage = await fastify.prisma.stage.findUnique({
        where: { id: match.stageId },
      });
      const isKo = stage && stage.type !== 'group';
      const isDraw = scoreHome === scoreAway;
      if (isKo && isDraw) {
        log('validate:fail ko-draw-rejected');
        return reply.code(400).send({
          error: 'no_draw_in_knockout',
          message:
            'In der K.-o.-Phase sind Unentschieden nicht möglich — ' +
            'bitte einen Sieger eintragen (oder Verlängerung / Elfmeter als ' +
            'eigenes Match planen).',
          field: 'scoreHome',
        });
      }

      // winnerTeamId / loserTeamId / isDraw leben NUR im DTO (siehe
      // access/match.js:prepareMatchView) — sie werden aus den Scores
      // berechnet, NICHT persistiert. Schema kennt diese Spalten nicht
      // (Schema-Drift-Bug, 2026-08-17). Daher nur scoreHome/scoreAway/
      // status in die DB schreiben.
      //
      // „completedAt" gäbe es im Schema auch nicht — falls wir das später
      // brauchen, kommt es in einer Migration. Vorerst nicht setzen.
      //
      // BUG 7 (2026-08-18): "KO-Ergebnis erscheint nicht in der Liste".
      //   Vorher: score-update und cascade-updates waren SEQUENZIELLE
      //   awaits OHNE Transaktion. Wenn die Cascade-Writes mid-loop
      //   fehlschlugen, war der Score bereits committed und der User
      //   sah einen Erfolg-Toast — beim Reload stand der Score da,
      //   aber das Folgematch leer. Jetzt: score + cascade in EINER
      //   Prisma-Transaktion → entweder beides committed oder beides
      //   zurückgerollt.
      //
      // Wir PRE-COMPUTEN die Cascade-Schreibliste außerhalb der
      // Transaktion (pure functions, kein DB-Zugriff), und führen nur
      // die Writes selbst atomar aus. Das hält die Transaktion kurz.

      let propagated = [];
      let updated;
      let updatedDto;
      let propagatedDtos = [];

      await fastify.prisma.$transaction(async (tx) => {
        updated = await tx.match.update({
          where: { id: match.id },
          data: {
            scoreHome,
            scoreAway,
            status: 'finished',
          },
        });
        log('score:updated', { id: updated.id, scoreHome, scoreAway });

        // Cascade + Propagation in KO-Matches.
        if (isKo) {
          // Für KO-Propagation brauchen wir den Sieger. Aus den Scores
          // ableiten — NICHT aus der DB lesen.
          const winnerTeamId =
            scoreHome > scoreAway
              ? match.teamHome
              : scoreAway > scoreHome
                ? match.teamAway
                : null;
          if (winnerTeamId) {
            // allMatches INNERHALB der Transaktion lesen, damit
            // eventuelle konkurrierende Writes sichtbar sind.
            const allMatches = await tx.match.findMany({
              where: { tournamentId: ctx.tournament.id },
            });
            const afterReset = resetCascade(match.id, allMatches);
            // propagateWinner braucht scoreHome/scoreAway auf `updated`, das
            // wir gerade frisch zurückbekommen haben — die DB hat sie schon.
            const afterProp = propagateWinner(updated, afterReset);
            const byId = new Map(afterProp.map((m) => [m.id, m]));
            let writesPlanned = 0;
            for (const m of afterReset) {
              const next = byId.get(m.id);
              if (!next) continue;
              const before = allMatches.find((x) => x.id === m.id);
              if (
                before &&
                (before.teamHome !== next.teamHome || before.teamAway !== next.teamAway)
              ) {
                await tx.match.update({
                  where: { id: m.id },
                  data: { teamHome: next.teamHome, teamAway: next.teamAway },
                });
                propagated.push(m.id);
                writesPlanned++;
              }
            }
            log('cascade:done', {
              writesPlanned,
              propagated,
              winnerTeamId,
            });
          } else {
            log('cascade:skip no-winner (draw?)');
          }
        } else {
          log('cascade:skip not-ko');
        }

        // DTO-Antwort statt Roh-Row. propagatedMatches enthält die
        // DTO-Repräsentation der durch die Propagation aktualisierten
        // Folgespiele — damit das Frontend den Spielplan in-place
        // aktualisieren kann, ohne die ganze View neu zu fetchen.
        // (Bug 2026-08-17: vorher waren das nur IDs, Frontend musste
        // openTournamentInstance() neu laden — spürbare Verzögerung.)
        const view = await buildTournamentViewContext(
          tx,
          ctx.tournament.id
        );
        updatedDto = view.matches.find((m) => m.id === match.id);
        propagatedDtos = propagated
          .map((id) => view.matches.find((m) => m.id === id))
          .filter(Boolean);
      });

      log('response:sent 200', {
        propagatedCount: propagated.length,
        propagatedIds: propagated,
      });
      return { match: updatedDto, propagated, propagatedMatches: propagatedDtos };
    } catch (err) {
      log('error', err?.message || err);
      return handleError(reply, err, 'Ergebnis eintragen fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 7. Logo-Upload (Spec §3 Schritt 1, §8.4 Header/PDF)
  // ─────────────────────────────────────────────────────────
  //
  // Drei Endpunkte, gleiches Muster wie /api/auth/avatar:
  //   POST   /api/tournaments/:id/logo   — Admin-Upload (multipart)
  //   DELETE /api/tournaments/:id/logo   — Admin-Entfernen (MinIO + DB)
  //   GET    /api/tournaments/:id/logo   — Bild streamen (öffentlich,
  //                                         wird in <img src> verwendet,
  //                                         daher KEIN Authorization-Header
  //                                         → Cache-freundlich)
  //
  // Der Logo-Key in MinIO ist deterministisch (logo_${id}) — ein
  // erneuter Upload überschreibt das alte Bild, ein DELETE räumt es
  // auf.

  // POST /api/tournaments/:id/logo — Multipart-Upload, Admin-only.
  fastify.post('/:id/logo', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({
          error: 'Keine Datei hochgeladen',
          code: 'no_file',
        });
      }

      const buf = await data.toBuffer();
      const { buffer, mimetype: outMime } = await resizeLogoImage(
        buf,
        data.mimetype || 'application/octet-stream'
      );

      // Vorhandenes Logo ersetzen — wir nutzen einen deterministischen
      // Key, also reicht putObject (überschreibt).
      await uploadTournamentLogo(
        buffer,
        outMime,
        ctx.tournament.id,
        'logo'
      );

      const logoUrl = `/api/tournaments/${ctx.tournament.id}/logo`;
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { logoUrl },
      });

      return { logoUrl };
    } catch (err) {
      return handleError(reply, err, 'Logo-Upload fehlgeschlagen');
    }
  });

  // DELETE /api/tournaments/:id/logo — Admin-only. Räumt MinIO + DB.
  fastify.delete('/:id/logo', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      await deleteTournamentAsset(ctx.tournament.id, 'logo');
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { logoUrl: null },
      });

      return { ok: true };
    } catch (err) {
      return handleError(reply, err, 'Logo löschen fehlgeschlagen');
    }
  });

  // GET /api/tournaments/:id/logo — Bild streamen.
  // Öffentlich: das Logo ist reines Branding und wird in <img src>
  // gerendert, wo kein Authorization-Header mitschickt. Stattdessen
  // lassen wir nur Turniere zu, die nicht im Status 'draft' sind —
  // Drafts sind ohnehin nur für Admins sichtbar (§1.2), und ein
  // Draft-Logo leaken wir auch hier nicht.
  fastify.get('/:id/logo', async (request, reply) => {
    try {
      const tournament = await fastify.prisma.tournament.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true, isPublic: true, publicToken: true, publicRevokedAt: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'Turnier nicht gefunden' });
      }
      // Drafts sind tabu — selbst wenn jemand die URL kennt.
      if (tournament.status === 'draft') {
        return reply.code(404).send({ error: 'Logo nicht verfügbar' });
      }

      const stat = await getTournamentAssetStat(tournament.id, 'logo');
      const stream = await getTournamentAssetStream(tournament.id, 'logo');
      return reply
        .header('Content-Type', stat.metaData['content-type'] || 'image/png')
        .header('Content-Length', stat.size)
        .header('Cache-Control', 'private, max-age=3600')
        .send(stream);
    } catch (err) {
      // MinIO "Not Found" → 404 nach außen, nicht 500.
      const code = err?.code || err?.Code;
      if (code === 'NoSuchKey' || code === 'NotFound' || err?.statusCode === 404) {
        return reply.code(404).send({ error: 'Logo nicht vorhanden' });
      }
      request.log?.error?.(err);
      return reply.code(500).send({ error: 'Logo konnte nicht geladen werden' });
    }
  });
}

/**
 * Einheitliche Error-Antwort. Liefert statusCode aus err oder 500.
 * Fehler-Codes (err.code) — etwa 'unsupported_format' oder
 * 'logo_too_large' — werden ans Frontend weitergegeben, damit die
 * UI darauf gezielt reagieren kann (verständliche Meldung statt
 * generischer 500).
 */
function handleError(reply, err, fallback) {
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    reply.request?.log?.error?.(err);
  }
  const body = { error: err.message ?? fallback };
  if (status < 500 && err.code) body.code = err.code;
  return reply.code(status).send(body);
}
