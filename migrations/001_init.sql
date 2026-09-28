-- 001_init.sql — slice (a): members and per-server config.
--
-- Snowflake IDs are stored as TEXT, never INTEGER. Discord IDs are 64-bit and
-- exceed JavaScript's safe integer range (2^53); round-tripping them as numbers
-- silently corrupts them.
--
-- Every user-data table carries discord_server_id so supergroup isolation is
-- structural rather than something a query has to remember to do.

CREATE TABLE users (
  discord_server_id   TEXT    NOT NULL,
  discord_id          TEXT    NOT NULL,

  -- Display only. Refreshed on every interaction so /sgroster can render names
  -- without the privileged GuildMembers intent. Never a key, never looked up by.
  display_name_cache  TEXT,

  -- Fallback only. The source of truth for a member's base name is their
  -- CURRENT nickname with our tag stripped off (see src/lib/nickname.js).
  -- Do not "restore" from this column — it goes stale the moment they rename.
  base_nickname       TEXT,

  tag_type            TEXT,             -- 'flag' | 'offset' | NULL
  country_code        TEXT,             -- ISO 3166-1 alpha-2, e.g. 'AU'
  iana_tz             TEXT,             -- e.g. 'Australia/Sydney'

  -- Only set when the member skipped the country picker and chose a raw offset.
  -- When iana_tz is present it wins, because it survives daylight saving.
  utc_offset_minutes  INTEGER,

  status              TEXT    NOT NULL DEFAULT 'active',   -- 'active' | 'departed'
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,

  PRIMARY KEY (discord_server_id, discord_id),
  CHECK (tag_type IS NULL OR tag_type IN ('flag', 'offset')),
  CHECK (status IN ('active', 'departed')),
  CHECK (country_code IS NULL OR length(country_code) = 2)
);

CREATE INDEX idx_users_server_status ON users (discord_server_id, status);

-- Per-server settings. Required for multi-supergroup: a single .env cannot hold
-- an officer role for every server the bot joins. /admin config lands in slice
-- (d); until then the server-owner and Administrator fallbacks in
-- src/lib/permissions.js mean everything works unconfigured.
CREATE TABLE server_config (
  discord_server_id   TEXT PRIMARY KEY,
  officer_role_id     TEXT,
  panel_channel_id    TEXT,
  panel_message_id    TEXT,
  mains_in_nickname   INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  CHECK (mains_in_nickname IN (0, 1))
);
