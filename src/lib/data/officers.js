/**
 * Data access for explicit officer grants and denials.
 *
 * An override always beats the role and the owner/Administrator fallback —
 * see migrations/004_officer_overrides.sql for why both directions matter.
 */

import { getDb, now } from '../db.js';

/**
 * @returns {boolean | null} true = forced officer, false = forced not,
 *                           null = no override, fall back to role/owner rules
 */
export function getOverride(serverId, discordId) {
  const row = getDb()
    .prepare(
      'SELECT is_officer FROM officer_overrides WHERE discord_server_id = ? AND discord_id = ?',
    )
    .get(serverId, discordId);
  return row ? row.is_officer === 1 : null;
}

/** @returns {Map<string, boolean>} discord_id -> forced value */
export function getOverrides(serverId) {
  const rows = getDb()
    .prepare('SELECT discord_id, is_officer FROM officer_overrides WHERE discord_server_id = ?')
    .all(serverId);
  return new Map(rows.map((r) => [r.discord_id, r.is_officer === 1]));
}

export function setOverride(serverId, discordId, isOfficer, setBy = null) {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO officer_overrides (discord_server_id, discord_id, is_officer, set_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (discord_server_id, discord_id) DO UPDATE SET
         is_officer = excluded.is_officer,
         set_by     = excluded.set_by,
         updated_at = excluded.updated_at`,
    )
    .run(serverId, discordId, isOfficer ? 1 : 0, setBy, ts);
}

/** Back to following the role and the owner/Administrator fallback. */
export function clearOverride(serverId, discordId) {
  return (
    getDb()
      .prepare('DELETE FROM officer_overrides WHERE discord_server_id = ? AND discord_id = ?')
      .run(serverId, discordId).changes > 0
  );
}
