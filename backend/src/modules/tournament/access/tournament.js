/**
 * Turnier-DTO.
 *
 * Spec §1.2, §7, §8.6, §11.
 *
 * Roh-DB-Felder (Tournament):
 *   id, groupId, name, logoUrl, coverUrl, mode, status, config,
 *   isPublic, publicToken, publicEnabledAt, publicRevokedAt,
 *   startsAt, endsAt, createdById, createdAt, updatedAt
 */

import {
  tournamentStatusLabel,
  tournamentModeLabel,
  tournamentCardStatusLabel,
} from './status.js';
import {
  formatDateShort,
  formatWeekdayDate,
} from './time.js';

/**
 * singleDay-Logik (Spec §7):
 *   "Bei einem eintägigen Turnier nur die Uhrzeit, bei mehrtägigen
 *    zusätzlich das Datum."
 *
 * Heuristik: Wenn startsAt und endsAt am selben Kalendertag liegen → eintägig.
 * Wenn keine Daten gesetzt sind → eintägig (Default), das Datum wird dann
 * ohnehin nicht angezeigt.
 */

const SPORT_LABEL = Object.freeze({
  becher: { long: 'Becher', short: 'B.' },
  tore:   { long: 'Tore',   short: 'Tore' },
  punkte: { long: 'Punkte', short: 'Pkt.' },
});

export function sportScoreLabel(sport) {
  return SPORT_LABEL[sport]?.long ?? 'Tore';
}

export function sportScoreShort(sport) {
  return SPORT_LABEL[sport]?.short ?? 'T';
}

export function detectSingleDay(startsAt, endsAt) {
  if (!startsAt && !endsAt) return true;
  if (!startsAt || !endsAt) return true;
  const a = new Date(startsAt);
  const b = new Date(endsAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return true;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Hauptfunktion: Turnier-Roh-DB-Zeile → Anzeigeobjekt.
 *
 * Optional: `stats` vom Engine-Layer anhängen:
 *   { teamCount, groupCount, matchCount, finishedCount }
 */
export function prepareTournamentView(rawTournament, opts = {}) {
  if (rawTournament == null) return null;

  const { stats = null, singleDay = null } = opts;

  const computedSingleDay =
    singleDay ?? detectSingleDay(rawTournament.startsAt, rawTournament.endsAt);

  return {
    id: rawTournament.id,
    groupId: rawTournament.groupId,
    name: rawTournament.name ?? '',
    logoUrl: rawTournament.logoUrl ?? null,
    coverUrl: rawTournament.coverUrl ?? null,

    mode: rawTournament.mode ?? 'groups_ko',
    modeLabel: tournamentModeLabel(rawTournament.mode),

    status: rawTournament.status ?? 'draft',
    statusLabel: tournamentStatusLabel(rawTournament.status),

    isPublic: rawTournament.isPublic === true,
    publicToken: rawTournament.publicToken ?? null,
    publicEnabledAt: rawTournament.publicEnabledAt ?? null,
    publicRevokedAt: rawTournament.publicRevokedAt ?? null,

    startsAt: rawTournament.startsAt ?? null,
    endsAt: rawTournament.endsAt ?? null,
    startsAtDate: computedSingleDay
      ? ''
      : formatWeekdayDate(rawTournament.startsAt),
    endsAtDate: computedSingleDay
      ? ''
      : formatWeekdayDate(rawTournament.endsAt),
    startsAtShort: formatDateShort(rawTournament.startsAt),
    endsAtShort: formatDateShort(rawTournament.endsAt),
    singleDay: computedSingleDay,

    // Grunddaten (Spec §1.2).
    location: rawTournament.location ?? null,
    // Sport steuert die Spaltenbezeichnung „Becher"/"Tore"/"Punkte".
    sport: rawTournament.sport ?? 'becher',
    scoreLabel: sportScoreLabel(rawTournament.sport ?? 'becher'),
    scoreShort: sportScoreShort(rawTournament.sport ?? 'becher'),
    // Tischlabels: eigene Tischnamen für Ausdruck/Beamer.
    tableLabels: Array.isArray(rawTournament.tableLabels)
      ? rawTournament.tableLabels
      : null,

    createdById: rawTournament.createdById ?? null,
    createdAt: rawTournament.createdAt ?? null,
    updatedAt: rawTournament.updatedAt ?? null,

    // Engine-Ergebnisse
    teamCount: stats?.teamCount ?? null,
    groupCount: stats?.groupCount ?? null,
    matchCount: stats?.matchCount ?? null,
    finishedCount: stats?.finishedCount ?? null,
  };
}

export function prepareTournamentList(rawTournaments, opts = {}) {
  if (!Array.isArray(rawTournaments)) return [];
  return rawTournaments.map((t) => {
    // Pro-Item-Stats: erwartet opts.statsById = Map<tournamentId, stats>.
    // Fallback: kein Stats → Counts bleiben null und das UI blendet die
    // Kurzinfo / den Fortschrittsbalken aus.
    const itemOpts = opts.statsById instanceof Map
      ? { ...opts, stats: opts.statsById.get(t.id) ?? null }
      : opts;
    const v = prepareTournamentView(t, itemOpts);
    v.cardStatusLabel = tournamentCardStatusLabel(t.status);
    return v;
  });
}

/**
 * Aggregiert Stats (teamCount / groupCount / matchCount / finishedCount)
 * für eine Liste von Turnieren in EINEM Aufwasch, ohne N+1.
 *
 * @param {object} prisma
 * @param {string[]} tournamentIds
 * @returns {Promise<Map<string, {teamCount, groupCount, matchCount, finishedCount}>>}
 */
export async function aggregateTournamentStats(prisma, tournamentIds) {
  const empty = new Map();
  if (!Array.isArray(tournamentIds) || tournamentIds.length === 0) return empty;

  // Teams + Stages+Groups in einem Query (per Tournament).
  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: tournamentIds } },
    select: {
      id: true,
      _count: { select: { teams: true } },
      stages: { select: { _count: { select: { groups: true } } } },
    },
  });

  // Match counts (total + finished) via groupBy in einem Query.
  const matchRows = await prisma.match.groupBy({
    by: ['tournamentId', 'status'],
    where: { tournamentId: { in: tournamentIds } },
    _count: { _all: true },
  });

  const result = new Map();
  for (const t of tournaments) {
    const stages = Array.isArray(t.stages) ? t.stages : [];
    const groupCount = stages.reduce(
      (sum, s) => sum + (s?._count?.groups ?? 0),
      0
    );
    result.set(t.id, {
      teamCount: t._count?.teams ?? 0,
      groupCount,
      matchCount: 0,
      finishedCount: 0,
    });
  }
  for (const row of matchRows) {
    const stats = result.get(row.tournamentId);
    if (!stats) continue;
    stats.matchCount += row._count._all;
    if (row.status === 'finished') stats.finishedCount = row._count._all;
  }
  return result;
}