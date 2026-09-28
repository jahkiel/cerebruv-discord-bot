/**
 * Data access for members' main heroes.
 *
 * Slot 1 is the primary main — that is the one `/sgroster` shows in its rows,
 * to keep them narrow. `/roster [user]` shows all of them.
 */

import { getDb, now } from '../db.js';

/**
 * @returns {string[]} hero ids in slot order, 0-3 entries
 */
export function getMains(serverId, discordId) {
  return getDb()
    .prepare(
      `SELECT hero_id FROM mains
        WHERE discord_server_id = ? AND discord_id = ?
        ORDER BY slot`,
    )
    .all(serverId, discordId)
    .map((row) => row.hero_id);
}

/** @returns {string | null} the slot-1 hero id */
export function getPrimaryMain(serverId, discordId) {
  const row = getDb()
    .prepare(
      `SELECT hero_id FROM mains
        WHERE discord_server_id = ? AND discord_id = ? AND slot = 1`,
    )
    .get(serverId, discordId);
  return row?.hero_id ?? null;
}

/**
 * Every member's primary main in one query — /sgroster renders a page of rows
 * and must not issue one query per member.
 *
 * @returns {Map<string, string>} discord_id -> hero_id
 */
export function getPrimaryMains(serverId) {
  const rows = getDb()
    .prepare('SELECT discord_id, hero_id FROM mains WHERE discord_server_id = ? AND slot = 1')
    .all(serverId);
  return new Map(rows.map((r) => [r.discord_id, r.hero_id]));
}

/**
 * Replaces a member's whole set of mains. Passing fewer heroes than before
 * removes the extra slots, so going from three mains to one is just re-running
 * the command with one hero.
 *
 * @param {string[]} heroIds 0-3 ids, in priority order
 */
export function setMains(serverId, discordId, heroIds) {
  const db = getDb();
  const ts = now();

  const replace = db.transaction((ids) => {
    db.prepare('DELETE FROM mains WHERE discord_server_id = ? AND discord_id = ?').run(
      serverId,
      discordId,
    );

    const insert = db.prepare(
      `INSERT INTO mains (discord_server_id, discord_id, slot, hero_id, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    ids.forEach((heroId, index) => {
      insert.run(serverId, discordId, index + 1, heroId, ts);
    });
  });

  replace(heroIds.slice(0, 3));
  return getMains(serverId, discordId);
}

export function clearMains(serverId, discordId) {
  const result = getDb()
    .prepare('DELETE FROM mains WHERE discord_server_id = ? AND discord_id = ?')
    .run(serverId, discordId);
  return result.changes > 0;
}

/** Who mains this hero — backs /whohas hero:<name> in slice (c). */
export function whoMains(serverId, heroId) {
  return getDb()
    .prepare(
      `SELECT discord_id, slot FROM mains
        WHERE discord_server_id = ? AND hero_id = ?
        ORDER BY slot`,
    )
    .all(serverId, heroId);
}
