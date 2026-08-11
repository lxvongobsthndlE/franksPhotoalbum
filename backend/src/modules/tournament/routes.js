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
      const result = await fastify.prisma.tournamentTeam.createMany({
        data: unique.map((name) => ({ tournamentId: ctx.tournament.id, name })),
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

      const gen = generateTournament({
        teams: teams.map((t) => ({ id: t.id, name: t.name, seed: t.seed ?? null })),
        config: {
          ...config,
          numGroups: request.body?.numGroups ?? config.numGroups,
          groupSize: request.body?.groupSize ?? config.groupSize,
          mode: ctx.tournament.mode,
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
  // 4. Standings (Read)
  // ─────────────────────────────────────────────────────────

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

      return { groups: groupRows };
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
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const { scoreHome, scoreAway } = request.body ?? {};
      if (!Number.isInteger(scoreHome) || !Number.isInteger(scoreAway)) {
        return reply.code(400).send({ error: 'scoreHome und scoreAway müssen Integer sein' });
      }
      if (scoreHome < 0 || scoreAway < 0) {
        return reply.code(400).send({ error: 'Scores dürfen nicht negativ sein' });
      }

      const match = await fastify.prisma.match.findFirst({
        where: { id: request.params.matchId, tournamentId: ctx.tournament.id },
      });
      if (!match) return reply.code(404).send({ error: 'Match nicht gefunden' });
      if (!match.teamHome || !match.teamAway) {
        return reply.code(409).send({ error: 'Match hat noch keine Teams (Platzhalter offen)' });
      }

      const winnerTeamId =
        scoreHome > scoreAway ? match.teamHome : scoreAway > scoreHome ? match.awayTeam : null;
      const isDraw = scoreHome === scoreAway;

      const updated = await fastify.prisma.match.update({
        where: { id: match.id },
        data: {
          scoreHome,
          scoreAway,
          status: 'finished',
          winnerTeamId,
          isDraw,
          completedAt: new Date(),
        },
      });

      // Cascade + Propagation in KO-Matches.
      let propagated = [];
      const stage = await fastify.prisma.stage.findUnique({
        where: { id: match.stageId },
      });
      if (stage && stage.type !== 'group' && !isDraw) {
        const allMatches = await fastify.prisma.match.findMany({
          where: { tournamentId: ctx.tournament.id },
        });
        const afterReset = resetCascade(match.id, allMatches);
        const afterProp = propagateWinner(updated, afterReset);
        const byId = new Map(afterProp.map((m) => [m.id, m]));
        for (const m of afterReset) {
          const next = byId.get(m.id);
          if (!next) continue;
          const before = allMatches.find((x) => x.id === m.id);
          if (
            before &&
            (before.teamHome !== next.teamHome || before.teamAway !== next.teamAway)
          ) {
            await fastify.prisma.match.update({
              where: { id: m.id },
              data: { teamHome: next.teamHome, teamAway: next.teamAway },
            });
            propagated.push(m.id);
          }
        }
      }

      // DTO-Antwort statt Roh-Row.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      const updatedDto = view.matches.find((m) => m.id === match.id);
      return { match: updatedDto, propagated };
    } catch (err) {
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
