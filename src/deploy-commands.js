/**
 * Registers slash commands with Discord. Run with `npm run deploy`.
 *
 * Server-scoped by default: those update instantly, which matters while
 * iterating. Global registration (REGISTER_GLOBAL=true) can take up to an hour
 * to propagate and is only worth it once the bot serves several servers.
 *
 * Re-run this whenever a command's name, description or options change.
 * Changing only the handler body does not require a re-deploy.
 */

import { REST, Routes } from 'discord.js';

import { assertConfig, config } from './config.js';
import { loadCommands } from './lib/commandLoader.js';

assertConfig(config.registerGlobal ? ['token', 'clientId'] : ['token', 'clientId', 'devServerId']);

const commands = await loadCommands();
const body = [...commands.values()].map((command) => command.data.toJSON());

const rest = new REST().setToken(config.token);

try {
  const route = config.registerGlobal
    ? Routes.applicationCommands(config.clientId)
    : Routes.applicationGuildCommands(config.clientId, config.devServerId);

  const result = await rest.put(route, { body });

  const scope = config.registerGlobal
    ? 'globally (allow up to an hour to appear)'
    : `to server ${config.devServerId} (available immediately)`;

  console.log(`Registered ${result.length} command(s) ${scope}:`);
  for (const command of result) console.log(`  /${command.name}`);
} catch (error) {
  console.error('\nCommand registration failed.');
  if (error?.status === 401) {
    console.error('  401 Unauthorized — DISCORD_TOKEN is wrong or has been reset.');
  } else if (error?.status === 403) {
    console.error(
      '  403 Forbidden — the bot is not in that server, or was invited without\n' +
        '  the applications.commands scope. Re-invite it using the URL in SETUP.md.',
    );
  } else if (error?.status === 404) {
    console.error('  404 Not Found — check DISCORD_CLIENT_ID and DEV_SERVER_ID.');
  } else {
    console.error(error);
  }
  process.exit(1);
}
