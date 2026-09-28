/**
 * Data access for per-hero ownership and progress.
 *
 * `level` and `prestige` are nullable and NULL means "not recorded" — which is
 * not the same as level 1. /myheroes records ownership in bulk without asking
 * for detail, so most rows will have ownership only.
 */

import { getDb, now } from '../db.js';

function toEntry(row) {
  if (!row) return null;
  return {
    heroId: row.hero_id,
    owned: row.owned === 1,
    level: row.level,
    prestige: row.prestige,
    updatedAt: row.updated_at,
  };
}

export function getHeroEntry(serverId, discordId, heroId) {
  const row = getDb()
    .prepare(
      `SELECT * FROM roster
        WHERE discord_server_id = ? AND discord_id = ? AND hero_id = ?`,
    )
    .get(serverId, discordId, heroId);
  return toEntry(row);
}

/** Every recorded hero for a member, owned or not. */
export function getMemberRoster(serverId, discordId) {
  return getDb()
    .prepare(
      `SELECT * FROM roster WHERE discord_server_id = ? AND discord_id = ?`,
    )
    .all(serverId, discordId)
    .map(toEntry);
}

/** @returns {Set<string>} hero ids the member owns */
export function getOwnedHeroIds(serverId, discordId) {
  const rows = getDb()
    .prepare(
      `SELECT hero_id FROM roster
        WHERE discord_server_id = ? AND discord_id = ? AND owned = 1`,
    )
    .all(serverId, discordId);
  return new Set(rows.map((r) => r.hero_id));
}

/** Heroes with level or prestige recorded, best progress first. */
export function getDetailedHeroes(serverId, discordId) {
  return getDb()
    .prepare(
      `SELECT * FROM roster
        WHERE discord_server_id = ? AND discord_id = ? AND owned = 1
          AND (level IS NOT NULL OR prestige IS NOT NULL)
        ORDER BY COALESCE(prestige, 0) DESC, COALESCE(level, 0) DESC`,
    )
    .all(serverId, discordId)
    .map(toEntry);
}

export function countOwned(serverId, discordId) {
  return getDb()
    .prepare(
      `SELECT count(*) AS n FROM roster
        WHERE discord_server_id = ? AND discord_id = ? AND owned = 1`,
    )
    .get(serverId, discordId).n;
}

/**
 * Unlock counts for every member in one query — /sgroster renders a page of
 * rows and must not issue one query per member.
 *
 * @returns {Map<string, number>} discord_id -> owned count
 */
export function countOwnedForAll(serverId) {
  const rows = getDb()
    .prepare(
      `SELECT discord_id, count(*) AS n FROM roster
        WHERE discord_server_id = ? AND owned = 1
        GROUP BY discord_id`,
    )
    .all(serverId);
  return new Map(rows.map((r) => [r.discord_id, r.n]));
}

/**
 * Applies one page of the /myheroes tick-list.
 *
 * Discord only tells us what is ticked, so anything on the page that is NOT in
 * `ownedIds` is explicitly un-owned. Scoping to the page matters: a member
 * editing page 1 must not wipe their page 2 answers.
 *
 * Existing level/prestige are preserved when a hero stays owned, and left in
 * place when it is un-ticked, so an accidental un-tick is not destructive.
 */
export function applyOwnershipPage(serverId, discordId, pageHeroIds, ownedIds) {
  const db = getDb();
  const ts = now();
  const owned = new Set(ownedIds);

  const upsert = db.prepare(
    `INSERT INTO roster (discord_server_id, discord_id, hero_id, owned, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (discord_server_id, discord_id, hero_id) DO UPDATE SET
       owned      = excluded.owned,
       updated_at = excluded.updated_at`,
  );

  const apply = db.transaction((heroIds) => {
    for (const heroId of heroIds) {
      upsert.run(serverId, discordId, heroId, owned.has(heroId) ? 1 : 0, ts);
    }
  });

  apply(pageHeroIds);
  return countOwned(serverId, discordId);
}

/**
 * Records detail for a single hero. Undefined fields are left untouched, so
 * setting a level does not clear a previously recorded prestige.
 */
export function upsertHero(serverId, discordId, heroId, { owned, level, prestige } = {}) {
  const db = getDb();
  const ts = now();
  const existing = getHeroEntry(serverId, discordId, heroId);

  const next = {
    owned: owned ?? existing?.owned ?? true,
    level: level === undefined ? (existing?.level ?? null) : level,
    prestige: prestige === undefined ? (existing?.prestige ?? null) : prestige,
  };

  db.prepare(
    `INSERT INTO roster (discord_server_id, discord_id, hero_id, owned, level, prestige, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (discord_server_id, discord_id, hero_id) DO UPDATE SET
       owned      = excluded.owned,
       level      = excluded.level,
       prestige   = excluded.prestige,
       updated_at = excluded.updated_at`,
  ).run(serverId, discordId, heroId, next.owned ? 1 : 0, next.level, next.prestige, ts);

  return getHeroEntry(serverId, discordId, heroId);
}

/**
 * Read model for /sgroster rows: every member's primary main plus the progress
 * they have recorded on it, in one query.
 *
 * LEFT JOIN because a main is often set before any level is recorded — those
 * members still belong in the roster, just without a level beside their hero.
 *
 * @returns {Map<string, {heroId: string, level: number|null, prestige: number|null}>}
 */
export function getPrimaryMainProgress(serverId) {
  const rows = getDb()
    .prepare(
      `SELECT m.discord_id, m.hero_id, r.level, r.prestige
         FROM mains m
         LEFT JOIN roster r
           ON  r.discord_server_id = m.discord_server_id
           AND r.discord_id        = m.discord_id
           AND r.hero_id           = m.hero_id
        WHERE m.discord_server_id = ? AND m.slot = 1`,
    )
    .all(serverId);

  return new Map(
    rows.map((r) => [r.discord_id, { heroId: r.hero_id, level: r.level, prestige: r.prestige }]),
  );
}

/**
 * Each member's highest prestige across every hero they own, in one query.
 *
 * This is the "how far has this person actually got" number — a member with a
 * Cosmic hero has done something a member with 60 White heroes has not.
 *
 * @returns {Map<string, number>} discord_id -> highest prestige
 */
export function maxPrestigeForAll(serverId) {
  const rows = getDb()
    .prepare(
      `SELECT discord_id, MAX(prestige) AS best FROM roster
        WHERE discord_server_id = ? AND owned = 1 AND prestige IS NOT NULL
        GROUP BY discord_id`,
    )
    .all(serverId);
  return new Map(rows.map((r) => [r.discord_id, r.best]));
}

/** Backs /whohas hero:<name>. Best progress first. */
export function whoOwns(serverId, heroId) {
  return getDb()
    .prepare(
      `SELECT discord_id, level, prestige FROM roster
        WHERE discord_server_id = ? AND hero_id = ? AND owned = 1
        ORDER BY COALESCE(prestige, 0) DESC, COALESCE(level, 0) DESC`,
    )
    .all(serverId, heroId);
}

export function deleteMemberRoster(serverId, discordId) {
  return getDb()
    .prepare('DELETE FROM roster WHERE discord_server_id = ? AND discord_id = ?')
    .run(serverId, discordId).changes;
}
