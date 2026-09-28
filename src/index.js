/**
 * Bot entry point.
 *
 * Gateway intents: Guilds ONLY. That is genuinely sufficient for everything in
 * v1 — nickname edits and single-member fetches are REST calls, and the member
 * object arrives inside the interaction payload. The privileged GuildMembers
 * intent would only be needed to auto-tag people as they join, which is out of
 * scope. Do not add intents without justifying them first (see CLAUDE.md).
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';

import { assertConfig, config } from './config.js';
import { loadCommands } from './lib/commandLoader.js';
import { loadCountries } from './lib/countries.js';
import { loadHeroes } from './lib/heroes.js';
import { initDb } from './lib/db.js';
import { setOfficer, touchDisplayName } from './lib/data/users.js';
import { resolveOfficerStatus } from './lib/permissions.js';
import { replyError } from './lib/respond.js';
import * as timezone from './interactions/timezone.js';
import * as myheroes from './interactions/myheroes.js';
import * as sgroster from './interactions/sgroster.js';
import * as bulkupdate from './interactions/bulkupdate.js';
import * as rosterText from './interactions/rosterText.js';

/** Component routers, tried in order. Each returns true if it owned the id. */
const COMPONENT_ROUTERS = [timezone, myheroes, sgroster, rosterText];

/** Modal submissions are a separate interaction type from components. */
const MODAL_ROUTERS = [bulkupdate];

assertConfig(['token', 'clientId']);

initDb(config.databasePath);
loadCountries();
loadHeroes();

const commands = await loadCommands();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (ready) => {
  console.log(`[bot] logged in as ${ready.user.tag} — serving ${ready.guilds.cache.size} server(s)`);
  if (config.superadminIds.length === 0) {
    console.warn('[bot] SUPERADMIN_IDS is empty — no superadmin commands will be usable.');
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      await command?.autocomplete?.(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        console.warn(`[bot] no handler for /${interaction.commandName}`);
        await replyError(interaction, 'That command is no longer available. Try re-deploying commands.');
        return;
      }
      refreshMemberCache(interaction);
      await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      refreshMemberCache(interaction);

      for (const router of MODAL_ROUTERS) {
        if (await router.handle(interaction)) return;
      }

      console.warn('[bot] unrouted modal', interaction.customId);
      await replyError(interaction, 'That form is from an older version of the bot.');
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      refreshMemberCache(interaction);

      // Components are routed by custom_id prefix, never by a collector, so a
      // panel posted months ago still works after a restart.
      for (const router of COMPONENT_ROUTERS) {
        if (await router.handle(interaction)) return;
      }

      console.warn('[bot] unrouted component', interaction.customId);
      await replyError(
        interaction,
        'That control is from an older version of the bot. Run `/setup timezone` instead.',
      );
      return;
    }
  } catch (error) {
    console.error('[bot] interaction handler threw', {
      id: interaction.commandName ?? interaction.customId,
      user: interaction.user?.id,
      server: interaction.guildId,
    }, error);

    // One failed interaction must never take the process down, and must never
    // leave the member staring at "This interaction failed".
    await replyError(interaction, 'Something went wrong on my end. Please try again.');
  }
});

/**
 * Keeps display_name_cache and is_officer warm without the privileged
 * GuildMembers intent — every interaction carries the member object, so we
 * piggyback on it rather than polling Discord.
 *
 * Consequence: a newly-promoted officer only sorts to the top of /sgroster
 * after they next use the bot, or an admin runs `/admin config resync`.
 * Deliberate trade; see CLAUDE.md.
 */
function refreshMemberCache(interaction) {
  if (!interaction.guildId) return;
  try {
    const name =
      interaction.member?.nickname ??
      interaction.user.globalName ??
      interaction.user.username;
    touchDisplayName(interaction.guildId, interaction.user.id, name);

    // Not gated on an officer role being configured: explicit overrides, the
    // server owner and Administrators all count without one.
    setOfficer(
      interaction.guildId,
      interaction.user.id,
      resolveOfficerStatus(
        interaction.guildId,
        interaction.guild,
        interaction.member,
        interaction.memberPermissions,
      ),
    );
  } catch (error) {
    console.error('[bot] member cache refresh failed', error);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[bot] unhandled rejection', reason);
});

process.on('uncaughtException', (error) => {
  // The process may be in an undefined state; exit so pm2/systemd restarts it
  // cleanly rather than limping along.
  console.error('[bot] uncaught exception — exiting for restart', error);
  process.exit(1);
});

client.login(config.token);
