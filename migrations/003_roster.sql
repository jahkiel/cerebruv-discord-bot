-- 003_roster.sql — slice (c): per-hero ownership and progress.
--
-- NOTE ON CHECK CONSTRAINTS (learned the hard way in migration 002):
-- the bounds here are deliberately loose. Level cap and prestige tier count
-- live in data/game.json and are enforced in application code, because a CHECK
-- naming a value cannot be altered later — SQLite refuses DROP COLUMN on a
-- checked column and changing a CHECK needs a full table rebuild. These
-- constraints only catch nonsense (negative levels), not policy.

CREATE TABLE roster (
  discord_server_id TEXT    NOT NULL,
  discord_id        TEXT    NOT NULL,
  hero_id           TEXT    NOT NULL,   -- data/heroes.json id, never a name

  owned             INTEGER NOT NULL DEFAULT 1,

  -- Both nullable: /myheroes records ownership in bulk without asking for
  -- detail, and most members will never fill in level/prestige for all 63.
  -- NULL means "not recorded", which is different from level 1.
  level             INTEGER,
  prestige          INTEGER,

  updated_at        TEXT    NOT NULL,

  PRIMARY KEY (discord_server_id, discord_id, hero_id),
  CHECK (owned IN (0, 1)),
  CHECK (level IS NULL OR level > 0),
  CHECK (prestige IS NULL OR prestige >= 0)
);

-- /whohas hero:<name>
CREATE INDEX idx_roster_hero ON roster (discord_server_id, hero_id, owned);

-- Unlock counts for /roster and /sgroster
CREATE INDEX idx_roster_member ON roster (discord_server_id, discord_id, owned);

-- Officers sort to the top of /sgroster.
--
-- Cached rather than read live: with the Guilds-only intent we cannot bulk-read
-- role membership (GET /guilds/{id}/members is privileged), and a REST fetch per
-- row would be slow and rate-limited. Refreshed whenever a member interacts with
-- the bot, plus an admin-triggered resync via /admin config.
--
-- ADD COLUMN is safe here — unlike DROP COLUMN, it does not rebuild the table.
ALTER TABLE users ADD COLUMN is_officer INTEGER NOT NULL DEFAULT 0;
