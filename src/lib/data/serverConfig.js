/**
 * Data access for per-server settings.
 *
 * Multi-supergroup means a single .env cannot hold an officer role for every
 * server the bot joins, so these live in the database. `/admin config` to edit
 * them lands in slice (d); until then the server-owner and Administrator
 * fallbacks in src/lib/permissions.js keep everything usable unconfigured.
 */

import { getDb, now } from '../db.js';

function toConfig(row) {
  if (!row) return null;
  return {
    serverId: row.discord_server_id,
    officerRoleId: row.officer_role_id,
    panelChannelId: row.panel_channel_id,
    panelMessageId: row.panel_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Never returns null — an unconfigured server gets sensible defaults. */
export function getServerConfig(serverId) {
  const row = getDb()
    .prepare('SELECT * FROM server_config WHERE discord_server_id = ?')
    .get(serverId);

  return (
    toConfig(row) ?? {
      serverId,
      officerRoleId: null,
      panelChannelId: null,
      panelMessageId: null,
      createdAt: null,
      updatedAt: null,
    }
  );
}

function ensureRow(serverId) {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO server_config (discord_server_id, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (discord_server_id) DO NOTHING`,
    )
    .run(serverId, ts, ts);
}

/**
 * Records where the panel message lives so /admin panel can edit it in place
 * instead of posting a duplicate every time it is run.
 */
export function setPanelMessage(serverId, channelId, messageId) {
  ensureRow(serverId);
  getDb()
    .prepare(
      `UPDATE server_config
          SET panel_channel_id = ?, panel_message_id = ?, updated_at = ?
        WHERE discord_server_id = ?`,
    )
    .run(channelId, messageId, now(), serverId);
  return getServerConfig(serverId);
}

export function setOfficerRole(serverId, roleId) {
  ensureRow(serverId);
  getDb()
    .prepare(
      `UPDATE server_config SET officer_role_id = ?, updated_at = ?
        WHERE discord_server_id = ?`,
    )
    .run(roleId, now(), serverId);
  return getServerConfig(serverId);
}

