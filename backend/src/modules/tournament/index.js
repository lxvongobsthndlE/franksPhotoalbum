/**
 * Turniermodul — Einstiegspunkt.
 *
 * Spec §0, §12: genaue eine Stelle, an der das Modul ins Routing eingehängt
 * wird. Das passiert in `src/app.js` mit einer einzigen Zeile:
 *
 *   app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
 *
 * Hier wird die Routes-Funktion aus ./routes.js geladen und um einen
 * Health-Check ergänzt.
 */

import tournamentRoutes from './routes.js';

export default async function tournamentsRoutes(fastify) {
  // Health-Check für /api/tournaments/health (kein DB-Zugriff).
  fastify.get('/health', async () => ({
    module: 'tournament',
    status: 'ok',
    spec_step: 2,
    endpoints: [
      'POST   /',
      'GET    /group/:groupId',
      'GET    /:id',
      'PATCH  /:id',
      'DELETE /:id',
      'POST   /:id/teams',
      'POST   /:id/teams/backfill-colors',
      'DELETE /:id/teams/:teamId',
      'PATCH  /:id/teams/:teamId',
      'POST   /:id/generate',
      'POST   /:id/reschedule',
      'GET    /:id/standings',
      'GET    /:id/schedule',
      'GET    /:id/bracket',
      'POST   /:id/matches/:matchId/result',
    ],
  }));

  // Eigentliche Endpoints.
  await fastify.register(tournamentRoutes);
}
