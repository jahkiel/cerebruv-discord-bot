/**
 * Data access for member rows.
 *
 * All SQL for `users` lives here. Command handlers must not contain queries —
 * the future read-only web dashboard will import this module rather than
 * reimplementing the same logic against the same file.
 *
 * Every function takes serverId first. There is no way to query across servers
 * by accident.
 */

import { getDb, now } from '../db.js';

/** DB row -> plain object with camelCase keys. */
function toUser(row) {
  if (!row) return null;
  return {
    serverId: row.discord_server_id,
    discordId: row.discord_id,
    displayName: row.display_name_cache,
    baseNickname: row.base_nickname,
    tagType: row.tag_type,
    countryCode: row.country_code,
    ianaTz: row.iana_tz,
    utcOffsetMinutes: row.utc_offset_minutes,
    isOfficer: row.is_officer === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUser(serverId, discordId) {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE discord_server_id = ? AND discord_id = ?')
    .get(serverId, discordId);
  return toUser(row);
}

export function listActiveUsers(serverId) {
  return getDb()
    .prepare(
      `SELECT * FROM users
        WHERE discord_server_id = ? AND status = 'active'
        ORDER BY display_name_cache COLLATE NOCASE`,
    )
    .all(serverId)
    .map(toUser);
}

/**
 * Creates or updates a member's timezone choice.
 *
 * Note `base_nickname` is written here as a fallback/dashboard hint only. The
 * live source of truth is the member's current nickname with the tag stripped
 * (see src/lib/nickname.js) — never read this column to "restore" a name.
 */
export function saveTimezone(serverId, discordId, fields) {
  const {
    displayName = null,
    baseNickname = null,
    tagType = null,
    countryCode = null,
    ianaTz = null,
    utcOffsetMinutes = null,
  } = fields;

  const ts = now();

  getDb()
    .prepare(
      `INSERT INTO users (
         discord_server_id, discord_id, display_name_cache, base_nickname,
         tag_type, country_code, iana_tz, utc_offset_minutes,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (discord_server_id, discord_id) DO UPDATE SET
         display_name_cache = excluded.display_name_cache,
         base_nickname      = excluded.base_nickname,
         tag_type           = excluded.tag_type,
         country_code       = excluded.country_code,
         iana_tz            = excluded.iana_tz,
         utc_offset_minutes = excluded.utc_offset_minutes,
         status             = 'active',
         updated_at         = excluded.updated_at`,
    )
    .run(
      serverId,
      discordId,
      displayName,
      baseNickname,
      tagType,
      countryCode,
      ianaTz,
      utcOffsetMinutes,
      ts,
      ts,
    );

  return getUser(serverId, discordId);
}

/** Removes the tag choice but keeps the row (and, later, their roster). */
export function clearTimezone(serverId, discordId, { displayName = null, baseNickname = null } = {}) {
  const ts = now();

  getDb()
    .prepare(
      `INSERT INTO users (
         discord_server_id, discord_id, display_name_cache, base_nickname,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (discord_server_id, discord_id) DO UPDATE SET
         display_name_cache = excluded.display_name_cache,
         base_nickname      = excluded.base_nickname,
         tag_type           = NULL,
         country_code       = NULL,
         iana_tz            = NULL,
         utc_offset_minutes = NULL,
         updated_at         = excluded.updated_at`,
    )
    .run(serverId, discordId, displayName, baseNickname, ts, ts);

  return getUser(serverId, discordId);
}

/**
 * Keeps display_name_cache warm so /sgroster can render without the privileged
 * GuildMembers intent. Only ever updates an existing row — we do not create a
 * row for someone who has never used the bot.
 */
export function touchDisplayName(serverId, discordId, displayName) {
  getDb()
    .prepare(
      `UPDATE users SET display_name_cache = ?, updated_at = ?
        WHERE discord_server_id = ? AND discord_id = ?`,
    )
    .run(displayName, now(), serverId, discordId);
}

/**
 * Creates a bare row for someone who has never used the bot.
 *
 * Needed so a named officer appears in /sgroster immediately rather than only
 * after they first interact — an officer with no heroes recorded is still part
 * of the supergroup and should be visible.
 *
 * Never overwrites existing data; only fills in a missing display name.
 */
export function ensureUser(serverId, discordId, displayName = null) {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO users (
         discord_server_id, discord_id, display_name_cache, status, created_at, updated_at
       ) VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT (discord_server_id, discord_id) DO UPDATE SET
         display_name_cache = COALESCE(excluded.display_name_cache, users.display_name_cache)`,
    )
    .run(serverId, discordId, displayName, ts, ts);

  return getUser(serverId, discordId);
}

/**
 * Caches whether a member holds the configured officer role, so /sgroster can
 * sort officers first without the privileged GuildMembers intent.
 *
 * Refreshed whenever the member interacts with the bot, so a newly-promoted
 * officer sorts to the top only after they next use Cerebruv or an admin runs
 * /admin config resync. That staleness is a deliberate trade — see CLAUDE.md.
 */
export function setOfficer(serverId, discordId, isOfficer) {
  getDb()
    .prepare(
      `UPDATE users SET is_officer = ?, updated_at = ?
        WHERE discord_server_id = ? AND discord_id = ?`,
    )
    .run(isOfficer ? 1 : 0, now(), serverId, discordId);
}

/** Soft delete — /admin removeuser. Reversible; they often come back. */
export function markDeparted(serverId, discordId) {
  const result = getDb()
    .prepare(
      `UPDATE users SET status = 'departed', updated_at = ?
        WHERE discord_server_id = ? AND discord_id = ?`,
    )
    .run(now(), serverId, discordId);
  return result.changes > 0;
}

export function markActive(serverId, discordId) {
  const result = getDb()
    .prepare(
      `UPDATE users SET status = 'active', updated_at = ?
        WHERE discord_server_id = ? AND discord_id = ?`,
    )
    .run(now(), serverId, discordId);
  return result.changes > 0;
}

/**
 * Hard delete — /forgetme (self-service) and /superadmin purge.
 * Slices (b) and (c) add their own tables; this will delete from those too.
 */
export function deleteUser(serverId, discordId) {
  const result = getDb()
    .prepare('DELETE FROM users WHERE discord_server_id = ? AND discord_id = ?')
    .run(serverId, discordId);
  return result.changes > 0;
}
