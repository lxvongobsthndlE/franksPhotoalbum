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
  rankBestThirds,
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
import { canEdit, canRevertToDraft, canStartTournament, requireConfirmForRedraw } from './locks.js';

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
      // --- Regelwerk (Spec §8.4 Info-Seite, User-Punkt 5) ---
      //
      // Plain-Text, Paragraphs only — kein HTML, kein Markdown.
      // Backend kümmert sich nur um Sanitization: Whitespace trimmen,
      // leerer String → null, hartes Längenlimit (10 KB reicht für ein
      // Turnier-Regelwerk und schützt vor Missbrauch).
      // Das Frontend splittet an Leerzeilen in <p>-Tags und escaped.
      //
      // Bewusst KEIN Lock nach Turnierstart — Regelwerk darf jederzeit
      // aktualisiert werden (Turnierleitung merkt nach 3 Spielen, dass
      // eine Sonderregel fehlt, und pflegt sie nach). Andere Felder
      // (config.*) sind aus gutem Grund gesperrt; rules ist Info, nicht
      // Spiel-Logik.
      if ('rules' in body) {
        if (body.rules !== null && typeof body.rules !== 'string') {
          return reply.code(400).send({
            error: 'invalid_rules',
            message: 'rules muss ein String oder null sein.',
            field: 'rules',
          });
        }
        const MAX_RULES_LENGTH = 10000;
        if (typeof body.rules === 'string' && body.rules.length > MAX_RULES_LENGTH) {
          return reply.code(400).send({
            error: 'rules_too_long',
            message: `Regelwerk darf maximal ${MAX_RULES_LENGTH} Zeichen lang sein.`,
            field: 'rules',
            maxLength: MAX_RULES_LENGTH,
          });
        }
        if (typeof body.rules === 'string' && body.rules.trim() === '') {
          data.rules = null;
        } else {
          data.rules = body.rules;
        }
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
  //
  // Confirm-Handshake (§13.10): wenn bereits Spiele beendet sind,
  // muss der User den Turniernamen tippen. Bei 0 finished reicht
  // das einfache DELETE — passend zur Turnier-Liste, wo der User
  // noch keine Ergebnisse eingetragen haben kann.
  fastify.delete('/:id', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      if (finishedCount > 0) {
        const provided = normalizeConfirmName(request.body?.confirmTournamentName);
        const expected = normalizeConfirmName(ctx.tournament.name);
        if (provided !== expected) {
          return reply.code(409).send({
            error: 'delete_locked_results_present',
            message:
              `${finishedCount} Spiel${finishedCount === 1 ? '' : 'e'} ` +
              `sind bereits beendet. Tippe zur Bestätigung den Turniernamen.`,
            finishedMatches: finishedCount,
            needsConfirmation: true,
          });
        }
      }
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
      // Etappe B.8: Teams add ist nur erlaubt in ENTWURF oder BEREIT
      // (startedAt === null). In LÄUFT ist die Struktur eingefroren.
      const teamsLock = canEdit(ctx.tournament, 0, 'teams');
      if (!teamsLock.allowed) {
        return reply.code(409).send({
          error: 'teams_add_locked',
          message: teamsLock.reason,
          status: ctx.tournament.status,
        });
      }
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
      // Etappe B.8: Teams remove ist nur erlaubt in ENTWURF oder BEREIT.
      const teamsLock = canEdit(ctx.tournament, 0, 'teams');
      if (!teamsLock.allowed) {
        return reply.code(409).send({
          error: 'teams_remove_locked',
          message: teamsLock.reason,
          status: ctx.tournament.status,
        });
      }
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

  // PATCH /api/tournaments/:id/teams/reorder — Setzreihenfolge per DnD (Admin)
  //
  // Etappe B.5: Teams-Tab erlaubt dem Admin die Setzreihenfolge per
  // Drag&Drop festzulegen. Atomarer Endpoint: ein Request setzt alle
  // Seeds in der angegebenen Reihenfolge, kein Drift zwischen
  // Frontend-State und DB.
  //
  // Erlaubt nur im Status 'draft' — sobald ein Spielplan generiert wurde,
  // ist die Reihenfolge fix. Member bekommen 403, andere Status-Werte 409.
  // Wenn die Generierung mit gesetztem Seed-Wert arbeitet (qualify-engine
  // liest seed), würde Reorder nach Generierung die Auslosung verändern
  // und Matches neu zuordnen. Das ist Risk-of-Corruption, deshalb 409.
  //
  // Body: { order: string[] } — Team-IDs in der neuen Reihenfolge.
  // Antwort: { ok: true, teams: TeamDTO[] } mit aktualisierten seeds.
  fastify.patch('/:id/teams/reorder', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const { order } = request.body ?? {};
      if (!Array.isArray(order) || order.length === 0) {
        return reply.code(400).send({
          error: 'teams_reorder_invalid',
          message: 'order[] ist erforderlich.',
        });
      }
      // Doppelte IDs ablehnen — sonst unklare Seed-Zuordnung.
      if (new Set(order).size !== order.length) {
        return reply.code(400).send({
          error: 'teams_reorder_duplicates',
          message: 'order[] darf keine doppelten IDs enthalten.',
        });
      }
      // Status-Gate (Etappe B.8): Reorder ist in ENTWURF und BEREIT
      // erlaubt, in LÄUFT (startedAt !== null) nicht.
      const reorderLock = canEdit(ctx.tournament, 0, 'teams');
      if (!reorderLock.allowed) {
        return reply.code(409).send({
          error: 'teams_reorder_locked',
          message: reorderLock.reason,
          status: ctx.tournament.status,
        });
      }

      // Alle Teams dieses Turniers laden + Validierung.
      const allTeams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        select: { id: true },
      });
      const allIds = new Set(allTeams.map((t) => t.id));
      // order[] muss GENAU alle Teams dieses Turniers enthalten (gleicher
      // Satz, neue Reihenfolge) — sonst hätte der Frontend-State die
      // DB-Wahrheit verloren.
      if (order.length !== allTeams.length || !order.every((id) => allIds.has(id))) {
        return reply.code(400).send({
          error: 'teams_reorder_mismatch',
          message: 'order[] muss genau die IDs aller Teams dieses Turniers enthalten.',
        });
      }

      // Atomar: jedes Team bekommt seed = Index in order[].
      // Prisma unterstützt keine batch-update mit unterschiedlichen
      // Werten pro ID, also iterieren wir in einer Transaktion.
      await fastify.prisma.$transaction(
        order.map((teamId, idx) =>
          fastify.prisma.tournamentTeam.update({
            where: { id: teamId },
            data: { seed: idx },
          })
        )
      );

      // Aktualisierte Liste mit neuen seeds zurückgeben.
      const updated = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        orderBy: { seed: 'asc' },
      });
      const { prepareTeamList } = await import('./access/team.js');
      return {
        ok: true,
        teams: prepareTeamList(updated),
      };
    } catch (err) {
      return handleError(reply, err, 'Teams-Reorder fehlgeschlagen');
    }
  });

  // ─────────────────────────────────────────────────────────
  // 2b. Einstellungen-Tab Aktionen (Etappe B.7)
  // ─────────────────────────────────────────────────────────

  // PATCH /api/tournaments/:id/groups — Manuelle Gruppenzuordnung (Admin)
  //
  // Etappe B.7: Im Einstellungen-Tab kann der Admin Teams per Drag&Drop
  // zwischen Gruppen verschieben. Diese Route schreibt atomar die
  // GroupMembership.position neu. Match-Paarungen bleiben UNVERÄNDERT
  // (Spec §5.1: Round-Robin wurde bei der Generierung festgelegt) — das
  // wird im Frontend per Warn-Banner kommuniziert.
  //
  // Body: { groups: [{ key: string, teamIds: string[] }, …] }
  //   - groups.length muss exakt der aktuellen Gruppen-Anzahl entsprechen
  //   - Summe aller teamIds muss exakt der Team-Anzahl entsprechen
  //   - Jede Gruppe muss ≥ 1 Team enthalten
  //   - Alle teamIds müssen zu Teams dieses Turniers gehören
  //
  // Lock: ≥1 beendetes Match → 409 (Spec §13.7 + §5.4: Konsistenz).
  // Auth: requireTournamentWrite (Admin-only per §1.2).
  // Atomar: $transaction. Bei Fehler in einer Gruppe bleibt der State
  //         unverändert (alle Memberships entweder neu oder alt).
  fastify.patch('/:id/groups', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const body = request.body ?? {};
      const incoming = body.groups;

      if (!Array.isArray(incoming) || incoming.length === 0) {
        return reply.code(400).send({
          error: 'groups_invalid',
          message: 'groups[] ist erforderlich.',
        });
      }

      // Lock (Etappe B.8): Gruppen sind in LÄUFT (startedAt !== null)
      // eingefroren — unabhängig vom finishedCount. Strikt nach Status.
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      const groupsLock = canEdit(ctx.tournament, finishedCount, 'groups');
      if (!groupsLock.allowed) {
        return reply.code(409).send({
          error: 'groups_locked_results_present',
          message: groupsLock.reason,
          finishedMatches: finishedCount,
          status: ctx.tournament.status,
        });
      }

      // Aktuelle Gruppen + Teams laden.
      const [currentGroups, currentTeams] = await Promise.all([
        fastify.prisma.group_.findMany({
          where: { stage: { tournamentId: ctx.tournament.id } },
          orderBy: { key: 'asc' },
          select: { id: true, key: true },
        }),
        fastify.prisma.tournamentTeam.findMany({
          where: { tournamentId: ctx.tournament.id },
          select: { id: true },
        }),
      ]);

      if (incoming.length !== currentGroups.length) {
        return reply.code(400).send({
          error: 'groups_count_mismatch',
          message: `Erwartet ${currentGroups.length} Gruppen, erhalten ${incoming.length}.`,
          expected: currentGroups.length,
          received: incoming.length,
        });
      }

      const groupKeyToId = new Map(currentGroups.map((g) => [g.key, g.id]));
      const teamIds = new Set(currentTeams.map((t) => t.id));

      // Validierung pro Eintrag.
      const seenTeamIds = new Set();
      for (const entry of incoming) {
        if (!entry || typeof entry.key !== 'string' || !groupKeyToId.has(entry.key)) {
          return reply.code(400).send({
            error: 'groups_invalid_key',
            message: `Unbekannte Gruppe "${entry?.key ?? '(undefiniert)'}".`,
          });
        }
        if (!Array.isArray(entry.teamIds) || entry.teamIds.length === 0) {
          return reply.code(400).send({
            error: 'group_must_have_team',
            message: `Gruppe "${entry.key}" braucht mindestens ein Team.`,
          });
        }
        for (const tid of entry.teamIds) {
          if (!teamIds.has(tid)) {
            return reply.code(400).send({
              error: 'team_not_in_tournament',
              message: `Team "${tid}" gehört nicht zu diesem Turnier.`,
            });
          }
          if (seenTeamIds.has(tid)) {
            return reply.code(400).send({
              error: 'team_in_multiple_groups',
              message: `Team "${tid}" ist in mehreren Gruppen.`,
            });
          }
          seenTeamIds.add(tid);
        }
      }

      if (seenTeamIds.size !== currentTeams.length) {
        return reply.code(400).send({
          error: 'teams_group_count_mismatch',
          message: `Summe der teamIds (${seenTeamIds.size}) ≠ Anzahl Teams (${currentTeams.length}).`,
        });
      }

      // Atomar: alte Memberships löschen, neue anlegen.
      await fastify.prisma.$transaction(async (tx) => {
        for (const entry of incoming) {
          const groupId = groupKeyToId.get(entry.key);
          await tx.groupMembership.deleteMany({ where: { groupId } });
          await tx.groupMembership.createMany({
            data: entry.teamIds.map((teamId, idx) => ({
              groupId,
              teamId,
              position: idx,
            })),
          });
        }
      });

      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return {
        ok: true,
        groups: view.groups,
      };
    } catch (err) {
      return handleError(reply, err, 'Gruppenzuordnung fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/redraw — Setzreihenfolge neu auslosen (Admin)
  //
  // Etappe B.7: Im Einstellungen-Tab kann der Admin die Setzreihenfolge
  // (seed-Spalte) neu würfeln. Wird die KO-Phase mit einbezogen?
  //   - Wenn KEIN beendetes Match existiert: direkter Shuffle, kein
  //     Confirm. KO-Phase wird nicht angefasst — die Paarungen wurden
  //     aus dem ursprünglichen seed berechnet, das bleibt.
  //   - Wenn ≥1 beendetes Match existiert: confirmTournamentName
  //     erforderlich (§13.10). KO-Bracket wird NICHT regeneriert — wir
  //     teilen dem Frontend via `requiresKoRegeneration: true` mit, dass
  //     der User es manuell über „Zeitplan neu terminieren" anstoßen
  //     sollte. Hintergrund: ein Seed-Shuffle ohne Bracket-Reset würde
  //     inkonsistente Slot-Belegung erzeugen (Bug 6-Lektion).
  fastify.post('/:id/redraw', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });

      // Etappe B.8: read-only-Gate.
      const drawLock = canEdit(ctx.tournament, finishedCount, 'draw');
      if (!drawLock.allowed) {
        return reply.code(409).send({
          error: 'redraw_locked_readonly',
          message: drawLock.reason,
          status: ctx.tournament.status,
        });
      }

      // Confirm-Handshake (Spec §13.10) bei LÄUFT + finishedCount > 0.
      // Hinweis: in ENTWURF/BEREIT ist finishedCount === 0 (kein Match
      // kann finished sein ohne dass gestartet wurde), aber wir prüfen
      // requireConfirmForRedraw trotzdem defensiv.
      if (requireConfirmForRedraw(ctx.tournament, finishedCount)) {
        const provided = normalizeConfirmName(request.body?.confirmTournamentName);
        const expected = normalizeConfirmName(ctx.tournament.name);
        if (provided !== expected) {
          return reply.code(409).send({
            error: 'redraw_locked_results_present',
            message: `Setzreihenfolge kann nicht geändert werden — ${finishedCount} Spiel${finishedCount === 1 ? '' : 'e'} bereits beendet. Tippe zur Bestätigung den Turniernamen.`,
            finishedMatches: finishedCount,
            needsConfirmation: true,
            requiresKoRegeneration: true,
          });
        }
      }

      // Teams laden, Fisher-Yates shuffeln, Seeds neu setzen.
      const teams = await fastify.prisma.tournamentTeam.findMany({
        where: { tournamentId: ctx.tournament.id },
        select: { id: true },
      });
      const shuffled = [...teams];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      await fastify.prisma.$transaction(
        shuffled.map((team, idx) =>
          fastify.prisma.tournamentTeam.update({
            where: { id: team.id },
            data: { seed: idx },
          })
        )
      );

      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return {
        ok: true,
        teams: view.teams,
        requiresKoRegeneration: finishedCount > 0,
      };
    } catch (err) {
      return handleError(reply, err, 'Setzreihenfolge-Auslosung fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/balance-shuffle-groups — Gruppenzuordnung neu mischen (Admin)
  //
  // Etappe B.8 (User-Feedback 2026-08-20): Im Einstellungen-Tab.
  // "Zufällig verteilen" mischt die Teams zwischen Gruppen neu — aber
  // **Gruppengrößen bleiben gleich** (User-Anforderung: "ich will ja nicht
  // Teams in andere Gruppen schieben, sondern tauschen, die Gruppengröße
  // muss gleich bleiben"). Hintergrund: das alte DnD-System erlaubte
  // beliebige Moves, was zu unausgeglichenen Gruppen führt. Diese Route
  // ersetzt das für die "Zufällig verteilen"-Aktion.
  //
  // Algorithmus:
  //   1. Aktuelle Gruppe-Struktur (mit Teamanzahl pro Gruppe) lesen —
  //      die IST-Größen sind die SOLL-Größen.
  //   2. Alle Team-IDs (Memberships) des Turniers flach einsammeln.
  //   3. Fisher-Yates auf der flachen Liste.
  //   4. In Chunks der ursprünglichen Gruppengrößen aufschneiden und
  //      einer Gruppe zuweisen.
  //   5. Atomar: alte Memberships löschen, neue einfügen.
  //
  // Lock: gleicher Lock wie PATCH /:id/groups (`canEdit(..., 'groups')`).
  //       In LÄUFT (startedAt !== null) gesperrt, weil das die Pairings
  //       verändert.
  // Kein Confirm-Handshake nötig: gleiche Operation wie PATCH /:id/groups,
  //       aber mit server-seitig generierter Ziel-Zuordnung.
  // Result: keine Team-, Match- oder Stage-Änderungen — NUR die
  //         GroupMembership-position/teamId-Zuordnung.
  fastify.post('/:id/balance-shuffle-groups', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      // Lock (Etappe B.8): Gruppen-Mapping ist in LÄUFT eingefroren.
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      const lock = canEdit(ctx.tournament, finishedCount, 'groups');
      if (!lock.allowed) {
        return reply.code(409).send({
          error: 'groups_locked_results_present',
          message: lock.reason,
          finishedMatches: finishedCount,
          status: ctx.tournament.status,
        });
      }

      // 1) Aktuelle Gruppen laden (in stabiler Key-Reihenfolge).
      const groups = await fastify.prisma.group_.findMany({
        where: { stage: { tournamentId: ctx.tournament.id } },
        orderBy: { key: 'asc' },
        select: { id: true, key: true },
      });
      if (groups.length === 0) {
        return reply.code(409).send({
          error: 'no_groups',
          message: 'Es gibt noch keine Gruppen — Turnier muss generiert sein.',
        });
      }

      // 2) Aktuelle Memberships lesen.
      const memberships = await fastify.prisma.groupMembership.findMany({
        where: { group: { stage: { tournamentId: ctx.tournament.id } } },
        select: { id: true, groupId: true, teamId: true, position: true },
      });
      if (memberships.length === 0) {
        return reply.code(409).send({
          error: 'no_memberships',
          message: 'Es gibt noch keine Team-Zuordnungen — Turnier muss generiert sein.',
        });
      }

      // 3) Fisher-Yates auf der flachen Teamliste.
      const teamIds = memberships.map((m) => m.teamId);
      const shuffled = [...teamIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // 4) In Chunks der ursprünglichen Gruppengrößen aufschneiden.
      const groupSizes = groups.map(
        (g) => memberships.filter((m) => m.groupId === g.id).length
      );
      if (groupSizes.reduce((a, b) => a + b, 0) !== shuffled.length) {
        // Defensive — sollte nie passieren (group_.memberships + flat list
        // sind per Konstrukt identisch), aber falls doch: Serverfehler.
        return reply.code(500).send({
          error: 'group_size_mismatch',
          message: 'Interner Fehler: Gruppengrößen passen nicht zur Team-Anzahl.',
        });
      }
      const newAssignments = []; // [{ groupId, teamId, position }]
      let cursor = 0;
      for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const size = groupSizes[gIdx];
        for (let p = 0; p < size; p++) {
          newAssignments.push({
            groupId: groups[gIdx].id,
            teamId: shuffled[cursor],
            position: p,
          });
          cursor++;
        }
      }

      // 5) Atomar: alte Memberships löschen, neue einfügen.
      await fastify.prisma.$transaction(async (tx) => {
        await tx.groupMembership.deleteMany({
          where: {
            groupId: { in: groups.map((g) => g.id) },
          },
        });
        await tx.groupMembership.createMany({
          data: newAssignments,
        });
      });

      // Antwort: frische View.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return {
        ok: true,
        shuffledTeamCount: shuffled.length,
        groups: view.groups,
      };
    } catch (err) {
      return handleError(reply, err, 'Gruppeneinteilung konnte nicht gemischt werden');
    }
  });

  // POST /api/tournaments/:id/groups/swaps — Paar-Tausch (Admin, Etappe B.8.1)
  //
  // User-Forderung (2026-08-20): „Ich will nur einen Teamtausch ermöglichen.
  // Wenn drag and drop dafür nicht gut ist, schlag mir eine andere Option
  // vor." — Pair-Swap statt DnD. Garantie: keine Gruppe verliert/gewinnt
  // ein Team, weil beide Teams gemeinsam die Plätze tauschen.
  //
  // Body: { swaps: [[teamAId, teamBId], ...] }
  //   - Genau ZWEI verschiedene teamIds pro Swap.
  //   - Beide Teams müssen in VERSCHIEDENEN Gruppen sein, sonst 400.
  //   - Idempotent: zweimal hintereinander denselben Swap aufrufen
  //     macht nichts kaputt (Network-Retry-Sicherheit).
  //
  // Lock: gleicher Lock wie PATCH /:id/groups und /balance-shuffle-groups.
  // In LÄUFT eingefroren, in BEENDET read-only. Kein Confirm-Handshake —
  // Swap ist destruktionsfrei (kein Team verschwindet, kein Spiel verliert
  // Daten).
  fastify.post('/:id/groups/swaps', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );

      const body = request.body ?? {};
      const swaps = Array.isArray(body.swaps) ? body.swaps : null;
      if (!swaps || swaps.length === 0) {
        return reply.code(400).send({
          error: 'invalid_swaps',
          message: 'Body muss ein Array `swaps: [[teamAId, teamBId], ...]` enthalten.',
        });
      }

      // Lock (Etappe B.8).
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      const lock = canEdit(ctx.tournament, finishedCount, 'groups');
      if (!lock.allowed) {
        return reply.code(409).send({
          error: 'groups_locked',
          message: lock.reason,
          finishedMatches: finishedCount,
          status: ctx.tournament.status,
        });
      }

      // 1) Alle betroffenen GroupMemberships lesen.
      //    Pro Team genau eine Membership (per Schema).
      const allTeamIds = new Set();
      for (const pair of swaps) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          return reply.code(400).send({
            error: 'invalid_swap_pair',
            message: 'Jeder Swap muss ein Array mit genau zwei Team-IDs sein.',
          });
        }
        const [a, b] = pair;
        if (typeof a !== 'string' || typeof b !== 'string') {
          return reply.code(400).send({
            error: 'invalid_swap_team_id',
            message: 'Team-IDs müssen Strings sein.',
          });
        }
        if (a === b) {
          return reply.code(400).send({
            error: 'swap_same_team',
            message: 'Die zwei Teams eines Swaps müssen verschieden sein.',
          });
        }
        allTeamIds.add(a);
        allTeamIds.add(b);
      }

      const memberships = await fastify.prisma.groupMembership.findMany({
        where: {
          teamId: { in: [...allTeamIds] },
          group: { stage: { tournamentId: ctx.tournament.id } },
        },
        select: { id: true, groupId: true, teamId: true, position: true },
      });
      const byTeam = new Map(memberships.map((m) => [m.teamId, m]));

      // 2) Für jedes Swap-Paar: validierung + Prepare.
      //    Wir bauen eine Map `MembershipId → newGroupId` auf und apply
      //    alle Updates in einer einzigen Transaction.
      const updates = []; // { membershipId, newGroupId }
      for (const pair of swaps) {
        const [a, b] = pair;
        const mA = byTeam.get(a);
        const mB = byTeam.get(b);
        if (!mA || !mB) {
          return reply.code(400).send({
            error: 'swap_team_not_found',
            message: 'Mindestens ein Team ist nicht in diesem Turnier eingeteilt.',
          });
        }
        if (mA.groupId === mB.groupId) {
          return reply.code(400).send({
            error: 'swap_same_group',
            message:
              'Die zwei Teams sind bereits in derselben Gruppe — ein Tausch ' +
              'bringt nichts. Wähle Teams aus zwei verschiedenen Gruppen.',
          });
        }
        // Kein Duplikat-Update: gleiches Team kann in mehreren Swaps
        // auftauchen (z.B. A↔B und B↔C), dann gewinnt der letzte.
        updates.push({ membershipId: mA.id, newGroupId: mB.groupId });
        updates.push({ membershipId: mB.id, newGroupId: mA.groupId });
      }

      if (updates.length === 0) {
        return { ok: true, swapCount: 0 };
      }

      // 3) Atomar updaten.
      await fastify.prisma.$transaction(
        updates.map((u) =>
          fastify.prisma.groupMembership.update({
            where: { id: u.membershipId },
            data: { groupId: u.newGroupId },
          })
        )
      );

      // Antwort: frische View.
      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return {
        ok: true,
        swapCount: swaps.length,
        groups: view.groups,
      };
    } catch (err) {
      return handleError(reply, err, 'Team-Tausch fehlgeschlagen');
    }
  });

  // PATCH /api/tournaments/:id/schedule — Einzel-Match-Zeit/Platte ändern (Admin)
  //
  // Etappe B.7: Im Spielplan-Tab mit „Bearbeiten"-Toggle kann der Admin
  // pro Match die Zeit (scheduledAt) und/oder die Platte (field) anpassen.
  //
  // Body: { updates: [{ matchId, scheduledAt, field }, …] }
  //   - scheduledAt: ISO-8601 string oder null (leer = ungeplant)
  //   - field: integer 1..N oder null
  //
  // Lock: nur `status='scheduled'`-Matches editierbar. Auch gemischt
  //       (scheduled + live) → 409 für gesamten Batch. KO-Matches
  //       (bracket-Slots) sind NICHT editierbar — sie hängen an
  //       `bracketPos` und werden über /generate neu aufgebaut.
  // Atomar: $transaction. detectScheduleConflicts aus engine/schedule.js.
  fastify.patch('/:id/schedule', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const body = request.body ?? {};
      const updates = body.updates;

      if (!Array.isArray(updates) || updates.length === 0) {
        return reply.code(400).send({
          error: 'schedule_invalid',
          message: 'updates[] ist erforderlich.',
        });
      }

      // Aktuelle Matches laden (für Konflikt-Detection und Validation).
      const currentMatches = await fastify.prisma.match.findMany({
        where: { tournamentId: ctx.tournament.id },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          field: true,
          stage: { select: { type: true } },
        },
      });
      const matchById = new Map(currentMatches.map((m) => [m.id, m]));

      // Pro Update validieren.
      const nextMatches = [...currentMatches];
      for (const u of updates) {
        if (!u || typeof u.matchId !== 'string') {
          return reply.code(400).send({
            error: 'schedule_match_id_missing',
            message: 'Jedes Update braucht eine matchId.',
          });
        }
        const m = matchById.get(u.matchId);
        if (!m) {
          return reply.code(404).send({
            error: 'match_not_found',
            message: `Match "${u.matchId}" gehört nicht zu diesem Turnier.`,
          });
        }
        if (m.status !== 'scheduled') {
          return reply.code(409).send({
            error: 'match_locked',
            message: `Match "${u.matchId}" ist ${m.status} und kann nicht verschoben werden.`,
            matchId: u.matchId,
          });
        }
        if (m.stage?.type && m.stage.type !== 'group') {
          return reply.code(409).send({
            error: 'ko_match_not_editable',
            message: 'KO-Matches werden über die Generierung verwaltet — bitte Turnier neu generieren.',
            matchId: u.matchId,
          });
        }
        // scheduledAt validieren (ISO-8601 oder null).
        let nextScheduled = m.scheduledAt;
        if (u.scheduledAt !== undefined) {
          if (u.scheduledAt === null) {
            nextScheduled = null;
          } else if (typeof u.scheduledAt === 'string') {
            const ts = Date.parse(u.scheduledAt);
            if (Number.isNaN(ts)) {
              return reply.code(400).send({
                error: 'schedule_iso_invalid',
                message: `scheduledAt "${u.scheduledAt}" ist kein gültiges ISO-8601.`,
                matchId: u.matchId,
              });
            }
            nextScheduled = new Date(ts);
          } else {
            return reply.code(400).send({
              error: 'schedule_iso_invalid',
              message: 'scheduledAt muss string oder null sein.',
              matchId: u.matchId,
            });
          }
        }
        // field validieren.
        let nextField = m.field;
        if (u.field !== undefined) {
          if (u.field === null) {
            nextField = null;
          } else if (typeof u.field === 'number' && Number.isInteger(u.field) && u.field >= 1) {
            nextField = u.field;
          } else {
            return reply.code(400).send({
              error: 'schedule_field_invalid',
              message: 'field muss integer ≥ 1 oder null sein.',
              matchId: u.matchId,
            });
          }
        }
        // Für Konflikt-Check: virtuell aktualisieren.
        const idx = nextMatches.findIndex((nm) => nm.id === u.matchId);
        nextMatches[idx] = { ...m, scheduledAt: nextScheduled, field: nextField };
      }

      // Konflikt-Detection: zwei scheduled Matches mit gleichem
      // (scheduledAt, field) → Konflikt.
      const conflicts = [];
      const map = new Map();
      for (const m of nextMatches) {
        if (m.status !== 'scheduled') continue;
        if (!m.scheduledAt) continue;
        const key = `${m.scheduledAt.toISOString()}|${m.field ?? ''}`;
        if (map.has(key)) {
          conflicts.push([map.get(key), m.id]);
        } else {
          map.set(key, m.id);
        }
      }
      if (conflicts.length > 0) {
        return reply.code(409).send({
          error: 'schedule_conflict',
          message: 'Mehrere Matches auf demselben Zeitslot und derselben Platte.',
          conflicts,
        });
      }

      // Atomar anwenden.
      await fastify.prisma.$transaction(
        updates.map((u) => {
          const data = {};
          if (u.scheduledAt !== undefined) {
            data.scheduledAt =
              u.scheduledAt === null
                ? null
                : new Date(Date.parse(u.scheduledAt));
          }
          if (u.field !== undefined) {
            data.field = u.field;
          }
          return fastify.prisma.match.update({
            where: { id: u.matchId },
            data,
          });
        })
      );

      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return { ok: true, matches: view.matches };
    } catch (err) {
      return handleError(reply, err, 'Spielplan-Edit fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/finish — Turnier abschließen (Admin)
  //
  // Etappe B.7: Regulärer Abschluss eines Turniers. KEIN
  // confirmTournamentName — das ist eine alltägliche Aktion, nicht
  // destruktiv. Scores und Matches bleiben unverändert.
  //
  // Idempotent: bereits finished → 409 (Frontend kann das abfangen
  // und als „schon abgeschlossen" anzeigen).
  fastify.post('/:id/finish', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      if (ctx.tournament.status === 'finished') {
        return reply.code(409).send({
          error: 'tournament_already_finished',
          message: 'Turnier ist bereits abgeschlossen.',
        });
      }
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { status: 'finished' },
      });
      return { ok: true, status: 'finished' };
    } catch (err) {
      return handleError(reply, err, 'Turnier-Abschluss fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/reset-results — Alle Ergebnisse löschen (Admin)
  //
  // Etappe B.7: Destruktive Aktion in der Gefahrenzone. Spec §13.10:
  // confirmTournamentName ist Pflicht. Setzt alle Match-Scores + Status
  // zurück und resettet die KO-Slots (Teams auf null, Placeholders neu
  // berechnet). Hintergrund: nach dem Reset soll der User die
  // Ergebnisse erneut eingeben können, ohne das Turnier neu zu
  // generieren.
  fastify.post('/:id/reset-results', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      if (finishedCount === 0) {
        return reply.code(400).send({
          error: 'no_results_to_reset',
          message: 'Es gibt keine beendeten Spiele zum Zurücksetzen.',
        });
      }
      // Confirm-Handshake (Spec §13.10).
      const provided = normalizeConfirmName(request.body?.confirmTournamentName);
      const expected = normalizeConfirmName(ctx.tournament.name);
      if (provided !== expected) {
        return reply.code(409).send({
          error: 'reset_results_locked',
          message: `${finishedCount} Spiel${finishedCount === 1 ? '' : 'e'} beendet. Tippe zur Bestätigung den Turniernamen.`,
          finishedMatches: finishedCount,
          needsConfirmation: true,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        // Scores + Status für alle Matches zurücksetzen.
        await tx.match.updateMany({
          where: { tournamentId: ctx.tournament.id },
          data: { scoreHome: null, scoreAway: null, status: 'scheduled' },
        });
        // KO-Slots: Teams + Winner-Felder zurücksetzen.
        await tx.match.updateMany({
          where: {
            tournamentId: ctx.tournament.id,
            stage: { type: { not: 'group' } },
          },
          data: {
            teamHome: null,
            teamAway: null,
          },
        });
      });

      const view = await buildTournamentViewContext(
        fastify.prisma,
        ctx.tournament.id
      );
      return {
        ok: true,
        resetCount: finishedCount,
        matches: view.matches,
      };
    } catch (err) {
      return handleError(reply, err, 'Ergebnisse-Reset fehlgeschlagen');
    }
  });

  // PATCH /api/tournaments/:id/fields — Spielfelder konfigurieren (Admin)
  //
  // Etappe B.7 (Anmerkung 4): Anzahl UND Namen der Spielfelder sind
  // konfigurierbar. Die Namen erscheinen auf dem Ausdruck und im
  // Spielplan (statt nur einer Nummer). Lock: nach Generierung
  // gesperrt — sonst zeigen Ausdruck + Spielplan auf ungültige
  // Feld-IDs.
  //
  // Body: { fields: [{ name: string, order: number }, …] }
  // Antwort: { ok, fields: [{ id, name, order }], warnings: [] }
  //
  // Stable IDs: bei wiederholtem PATCH behalten wir IDs für Felder
  // mit gleichem Index — Match.field referenziert diese IDs. Wird die
  // Anzahl verringert, werden match.field für wegfallende Felder auf
  // null gesetzt (Warning).
  fastify.patch('/:id/fields', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const body = request.body ?? {};
      const incoming = body.fields;

      if (!Array.isArray(incoming) || incoming.length === 0 || incoming.length > 12) {
        return reply.code(400).send({
          error: 'fields_count_out_of_range',
          message: 'fields[] muss 1–12 Einträge haben.',
          received: Array.isArray(incoming) ? incoming.length : 0,
        });
      }

      // Lock (Etappe B.8): Spielfelder sind in LÄUFT (startedAt !== null)
      // UND in ENTWURF/BEREIT editierbar. Nur im Status 'finished' sind
      // sie gesperrt. Grund: User kann am Turniertag den Tischnamen
      // noch anpassen (z.B. „Platte 3" → „Beach Court").
      const fieldsLock = canEdit(ctx.tournament, 0, 'fields');
      if (!fieldsLock.allowed) {
        return reply.code(409).send({
          error: 'fields_locked',
          message: fieldsLock.reason,
          status: ctx.tournament.status,
        });
      }

      // Pro Feld validieren.
      const seenNames = new Set();
      const seenOrders = new Set();
      for (let i = 0; i < incoming.length; i++) {
        const f = incoming[i];
        if (!f || typeof f.name !== 'string' || f.name.trim().length === 0) {
          return reply.code(400).send({
            error: 'fields_name_empty',
            message: `Feld #${i + 1} hat keinen Namen.`,
          });
        }
        const name = f.name.trim();
        if (name.length > 32) {
          return reply.code(400).send({
            error: 'fields_name_too_long',
            message: `Feld "${name}" hat mehr als 32 Zeichen.`,
          });
        }
        if (seenNames.has(name)) {
          return reply.code(400).send({
            error: 'fields_name_duplicate',
            message: `Feld-Name "${name}" ist doppelt.`,
          });
        }
        seenNames.add(name);
        if (typeof f.order !== 'number' || !Number.isInteger(f.order) || f.order < 0 || f.order >= incoming.length) {
          return reply.code(400).send({
            error: 'fields_order_invalid',
            message: `Feld "${name}" hat eine ungültige order (0..${incoming.length - 1}).`,
          });
        }
        if (seenOrders.has(f.order)) {
          return reply.code(400).send({
            error: 'fields_order_duplicate',
            message: `Feld "${name}" hat eine doppelte order.`,
          });
        }
        seenOrders.add(f.order);
      }

      // Stable IDs: bestehende IDs (gleicher Index) erhalten, neue
      // ergänzen, überzählige verwerfen.
      const existing = ctx.tournament.config?.fields ?? [];
      const next = incoming.map((f, idx) => {
        const old = existing[idx];
        return {
          id: old?.id ?? `f_${idx + 1}_${Math.random().toString(36).slice(2, 8)}`,
          name: f.name.trim(),
          order: f.order,
        };
      });
      // Nach order sortieren, damit Render immer stabil ist.
      next.sort((a, b) => a.order - b.order);

      const nextConfig = {
        ...(ctx.tournament.config ?? {}),
        fields: next,
      };
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { config: nextConfig },
      });

      const warnings = [];
      if (existing.length > next.length) {
        // match.field für wegfallende IDs auf null setzen.
        const droppedIds = existing.slice(next.length).map((f) => f.id);
        await fastify.prisma.match.updateMany({
          where: { tournamentId: ctx.tournament.id, field: { in: droppedIds } },
          data: { field: null },
        });
        warnings.push({
          type: 'fields_dropped',
          message: `${droppedIds.length} Feld${droppedIds.length === 1 ? '' : 'er'} entfernt — referenzierende Spiele haben jetzt keine Platten-Zuordnung.`,
          droppedIds,
        });
      }

      return { ok: true, fields: next, warnings };
    } catch (err) {
      return handleError(reply, err, 'Spielfelder-Update fehlgeschlagen');
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
      let baseDate = baseDateStr ? new Date(baseDateStr) : new Date();

      // Etappe B.8.1: Wenn der User vorher schon `shift-open-matches`
      // benutzt hat, soll der Versatz den Reschedule überleben. Sonst
      // wäre der Bug: User schiebt um +10 Min (z.B. weil das Turnier
      // sich um 10 Min verspätet), ändert dann die Spieldauer → alle
      // Zeiten werden neu ab Turnier-Start berechnet → der +10-Versatz
      // ist futsch. Lösung: wenn `baseDate` nicht explizit gesetzt ist
      // UND es bereits scheduledAt-Werte gibt, nehmen wir die früheste
      // bestehende scheduledAt als Bezugspunkt.
      if (!baseDateStr) {
        const earliest = rawMatches
          .filter((m) => m.scheduledAt != null)
          .reduce((acc, m) => {
            const t = new Date(m.scheduledAt).getTime();
            return acc === null || t < acc ? t : acc;
          }, null);
        if (earliest !== null) {
          baseDate = new Date(earliest);
        }
      }

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
  // 3b. Turnier-Lebenszyklus (Etappe B.8) — start, revert, shift
  // ─────────────────────────────────────────────────────────

  // POST /api/tournaments/:id/start — Turnier offiziell starten.
  //
  // Übergang von BEREIT (status='generated', startedAt=null) zu LÄUFT
  // (startedAt gesetzt). Sperrt ab dann alle Bracket-validierenden
  // Aktionen (Teams add/remove/reorder, Modus, Gruppen, Reorder).
  // Spielfeld-Namen, Dauer, Plattenzahl und per-match-Schedule bleiben
  // editierbar.
  //
  // Antwort: { ok: true, startedAt: ISO }.
  // Locks:
  //   - status !== 'generated' → 409 tournament_not_generated
  //   - startedAt !== null → 409 tournament_already_started
  fastify.post('/:id/start', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const startCheck = canStartTournament(ctx.tournament);
      if (!startCheck.allowed) {
        // startedAt hat Vorrang vor status — wenn bereits gestartet,
        // ist es immer "already_started", auch wenn der Status wieder
        // auf "generated" zurückspringen würde.
        const code = ctx.tournament.startedAt !== null
          ? 'tournament_already_started'
          : 'tournament_not_generated';
        return reply.code(409).send({
          error: code,
          message: startCheck.reason,
          status: ctx.tournament.status,
          startedAt: ctx.tournament.startedAt ?? null,
        });
      }
      const startedAt = new Date();
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { startedAt },
      });
      return { ok: true, startedAt: startedAt.toISOString() };
    } catch (err) {
      return handleError(reply, err, 'Turnier starten fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/revert-to-draft — Zurück zu Entwurf.
  //
  // Übergang von LÄUFT zurück zu ENTWURF. **Matches und Stages bleiben
  // unverändert** (Spec §B.8: User-Use-Case „Team kommt zu spät, ich
  // will den Spielplan behalten"). Setzt startedAt = null und
  // status = 'draft'.
  //
  // Locks:
  //   - status === 'finished' → 409 (sowieso nicht aufrufbar)
  //   - startedAt === null → 409 tournament_not_started
  //   - finishedCount > 0 → 409 revert_locked_results_present
  //     mit needsConfirmation + confirmTournamentName (§13.10).
  fastify.post('/:id/revert-to-draft', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      const finishedCount = await fastify.prisma.match.count({
        where: { tournamentId: ctx.tournament.id, status: 'finished' },
      });
      const revertCheck = canRevertToDraft(ctx.tournament, finishedCount);
      if (!revertCheck.allowed) {
        // 409 mit needsConfirmation wenn finishedCount > 0 (analog §13.10).
        if (finishedCount > 0) {
          const provided = normalizeConfirmName(request.body?.confirmTournamentName);
          const expected = normalizeConfirmName(ctx.tournament.name);
          if (provided !== expected) {
            return reply.code(409).send({
              error: 'revert_locked_results_present',
              message: `Zurücksetzen nicht möglich — ${finishedCount} Spiel${finishedCount === 1 ? '' : 'e'} bereits beendet. Tippe zur Bestätigung den Turniernamen.`,
              finishedMatches: finishedCount,
              needsConfirmation: true,
            });
          }
          // Confirm vorhanden und korrekt: durchwinken.
        } else {
          // startedAt === null oder status === 'finished' (selten).
          return reply.code(409).send({
            error: ctx.tournament.status === 'finished'
              ? 'tournament_finished'
              : 'tournament_not_started',
            message: revertCheck.reason,
            status: ctx.tournament.status,
          });
        }
      }
      await fastify.prisma.tournament.update({
        where: { id: ctx.tournament.id },
        data: { startedAt: null, status: 'draft' },
      });
      return { ok: true, status: 'draft' };
    } catch (err) {
      return handleError(reply, err, 'Zurücksetzen fehlgeschlagen');
    }
  });

  // POST /api/tournaments/:id/shift-open-matches — offene Spiele verschieben.
  //
  // Body: { minutes: number } — positiv (später) oder negativ (früher),
  // Range ±24h. Verschiebt alle Matches mit status='scheduled' und
  // scheduledAt !== null. Locked Spiele (status='finished' oder
  // 'live') bleiben unverändert.
  //
  // Antwort: { ok: true, shiftedCount }.
  // Locks:
  //   - status === 'finished' → 409 tournament_finished
  //   - minutes ungültig → 400 invalid_minutes
  fastify.post('/:id/shift-open-matches', async (request, reply) => {
    try {
      const ctx = await requireTournamentWrite(
        request,
        fastify.prisma,
        request.params.id
      );
      if (ctx.tournament.status === 'finished') {
        return reply.code(409).send({
          error: 'tournament_finished',
          message: 'Turnier ist beendet — Spiele können nicht mehr verschoben werden.',
          status: ctx.tournament.status,
        });
      }
      const minutes = Number(request.body?.minutes);
      if (
        !Number.isFinite(minutes) ||
        minutes === 0 ||
        minutes < -1440 ||
        minutes > 1440
      ) {
        return reply.code(400).send({
          error: 'invalid_minutes',
          message: 'minutes muss eine Zahl ungleich 0 sein, im Bereich ±1440 (24 Stunden).',
          received: request.body?.minutes,
        });
      }
      const ms = minutes * 60_000;
      // Prisma unterstützt kein Date-Increment in updateMany ohne Raw,
      // also: betroffene Matches lesen, neuen Zeitstempel berechnen,
      // einzeln updaten. Bei vielen Matches ginge das per Raw-SQL
      // effizienter, aber für Turnier-Größenordnung (≤500 Spiele) ist
      // die JS-Schleife schnell genug.
      const targets = await fastify.prisma.match.findMany({
        where: {
          tournamentId: ctx.tournament.id,
          status: 'scheduled',
          scheduledAt: { not: null },
        },
        select: { id: true, scheduledAt: true },
      });
      if (targets.length === 0) {
        return { ok: true, shiftedCount: 0 };
      }
      await fastify.prisma.$transaction(
        targets.map((m) =>
          fastify.prisma.match.update({
            where: { id: m.id },
            data: { scheduledAt: new Date(m.scheduledAt.getTime() + ms) },
          })
        )
      );
      return { ok: true, shiftedCount: targets.length };
    } catch (err) {
      return handleError(reply, err, 'Verschieben fehlgeschlagen');
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

      // Beste Dritte (Spec §6.3.1, §13.7). Nur wenn das Turnier überhaupt
      // welche zulässt (config.bestThirds > 0) — sonst wäre die Tabelle
      // bei single-group-Turnieren leer oder irreführend. rankBestThirds
      // liefert die Drittplatzierten ALLER Gruppen, normalisiert nach
      // Punkten/Spiel (Spec §10.4 — IMMER pro Spiel). Wir hängen die
      // Top-N aus config.bestThirds als "qualifiziert" an.
      //
      // Bug #13 (User-Punkt 2, 2026-08-18): Die alte Variante mit nur
      // „Pkt/Sp / Diff/Sp" war für den User nicht intuitiv — das wirkte
      // wie eine ganz andere Sportart. Neue Renderer-Logik zeigt die
      // ZEILEN in einer Tabelle mit denselben Spalten wie die normale
      // Gruppentabelle (Team, Sp, S, U, N, Becher, Diff, Pkt) plus
      // Gruppe. Dafür brauchen wir hier die groupKey pro Row.
      //
      // Wir mappen manuell über die groupRows, weil rankBestThirds nur
      // die Standings-Zeilen zurückgibt — ohne ihren Gruppen-Key.
      let bestThirds = null;
      if ((config.bestThirds ?? 0) > 0) {
        const rowsPerGroup = groupRows.map((g) => g.standings);
        const ranked = rankBestThirds(rowsPerGroup);
        // Hilfs-Index: (teamId → groupKey) für die nachträgliche Anreicherung.
        const teamIdToGroupKey = new Map();
        for (const g of groupRows) {
          for (const sr of g.standings) {
            if (sr?.teamId) teamIdToGroupKey.set(sr.teamId, g.groupKey);
          }
        }
        bestThirds = {
          qualifyCount: config.bestThirds,
          rows: ranked.map((r, idx) => ({
            ...r,
            groupKey: teamIdToGroupKey.get(r.teamId) ?? null,
            qualifies: idx < config.bestThirds,
          })),
        };
      }

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
        bestThirds,
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
