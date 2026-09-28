-- 002_mains.sql — slice (b): each member's 1-3 main heroes.
--
-- hero_id references data/heroes.json by its stable `id`, never by display
-- name, so correcting a name in the JSON cannot orphan stored data. There is
-- deliberately no FOREIGN KEY: the hero list is an editable file, not a table,
-- and a member's mains must survive a hero being temporarily renamed or
-- removed from the file.

CREATE TABLE mains (
  discord_server_id TEXT    NOT NULL,
  discord_id        TEXT    NOT NULL,
  slot              INTEGER NOT NULL,   -- 1 = primary, shown in /sgroster rows
  hero_id           TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,

  PRIMARY KEY (discord_server_id, discord_id, slot),
  CHECK (slot BETWEEN 1 AND 3)
);

-- Supports /whohas hero:<name> in slice (c).
CREATE INDEX idx_mains_hero ON mains (discord_server_id, hero_id);

-- Mains are a roster-view feature, not a nickname feature (decided 2026-09-27).
-- The toggle this column backed no longer exists, so remove it rather than
-- leave dead schema for a future reader to puzzle over.
--
-- This is a full table rebuild, NOT `ALTER TABLE ... DROP COLUMN`. SQLite
-- supports DROP COLUMN from 3.35, but refuses when the column is named in a
-- CHECK constraint — and 001 declared CHECK (mains_in_nickname IN (0, 1)).
-- Attempting the shortcut fails with:
--   "error in table server_config after drop column: no such column"
-- which would throw inside the migration and stop the bot from starting.
--
-- The migration runner wraps this file in a transaction, so the rebuild is
-- atomic. Nothing references server_config by foreign key.

CREATE TABLE server_config_new (
  discord_server_id   TEXT PRIMARY KEY,
  officer_role_id     TEXT,
  panel_channel_id    TEXT,
  panel_message_id    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

INSERT INTO server_config_new (
  discord_server_id, officer_role_id, panel_channel_id, panel_message_id,
  created_at, updated_at
)
SELECT
  discord_server_id, officer_role_id, panel_channel_id, panel_message_id,
  created_at, updated_at
FROM server_config;

DROP TABLE server_config;

ALTER TABLE server_config_new RENAME TO server_config;
