-- 004_officer_overrides.sql — name individual officers, or exclude someone.
--
-- Officer status resolves in this order:
--   1. an explicit override here  (grant OR deny — this always wins)
--   2. holding the configured officer role
--   3. being the server owner or a Discord Administrator  (default fallback)
--
-- Two problems this solves:
--
-- * Discord puts the server owner above all role hierarchy, so NOBODY can
--   assign them the officer role — not even an Administrator. Without the
--   step-3 fallback the one person most obviously in charge could never be
--   marked as an officer.
-- * But that fallback must not be mandatory. A server owner who is not a
--   supergroup officer needs to be excludable, which is what a deny row does.
--
-- Also covers supergroups that do not use a Discord role for officers at all:
-- name them individually and never set officer_role_id.

CREATE TABLE officer_overrides (
  discord_server_id TEXT    NOT NULL,
  discord_id        TEXT    NOT NULL,
  is_officer        INTEGER NOT NULL,   -- 1 = force officer, 0 = force not
  set_by            TEXT,               -- who ran the command, for audit
  updated_at        TEXT    NOT NULL,

  PRIMARY KEY (discord_server_id, discord_id),
  CHECK (is_officer IN (0, 1))
);
