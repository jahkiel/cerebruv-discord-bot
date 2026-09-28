/**
 * Central config. Everything read from the environment lands here and nowhere
 * else, so `.env.example` only ever has to stay in sync with this one file.
 *
 * Loaded via `node --env-file=.env` (built into Node 20.6+), which is why there
 * is no dotenv dependency.
 */

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

export const config = {
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.DISCORD_CLIENT_ID ?? '',
  devServerId: process.env.DEV_SERVER_ID ?? '',

  /** Discord user IDs, not a role — superadmin must work in every server. */
  superadminIds: list(process.env.SUPERADMIN_IDS),

  databasePath: process.env.DATABASE_PATH ?? './data/bot.db',
  registerGlobal: bool(process.env.REGISTER_GLOBAL, false),

  /**
   * Discord's hard nickname limit, in CODE POINTS — confirmed empirically
   * against the live API on 2026-09-27, not assumed. See lib/nickname.js
   * `measure()`. A flag emoji costs 2 here, despite being 4 UTF-16 units.
   */
  nicknameMaxLength: 32,
};

/**
 * Fail loudly at startup rather than at the first interaction.
 * @param {string[]} names keys of `config` that must be non-empty
 */
export function assertConfig(names) {
  const missing = names.filter((name) => {
    const value = config[name];
    return Array.isArray(value) ? value.length === 0 : !value;
  });

  if (missing.length > 0) {
    const envNames = missing.map((n) => ENV_NAME_BY_KEY[n] ?? n).join(', ');
    console.error(
      `\n  Missing required environment variable(s): ${envNames}\n` +
        `  Copy .env.example to .env and fill them in. See SETUP.md.\n`,
    );
    process.exit(1);
  }
}

const ENV_NAME_BY_KEY = {
  token: 'DISCORD_TOKEN',
  clientId: 'DISCORD_CLIENT_ID',
  devServerId: 'DEV_SERVER_ID',
  superadminIds: 'SUPERADMIN_IDS',
  databasePath: 'DATABASE_PATH',
};
