/**
 * /admin panel — post the timezone panel, or refresh the existing one in place.
 *
 * `setDefaultMemberPermissions` below hides this from ordinary members in the
 * command picker, but it is ONLY a UI hint — server admins can override it in
 * Server Settings → Integrations. requireSgAdmin() at runtime is the actual
 * boundary. Both, always.
 */

import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { buildPanel } from '../interactions/timezone.js';
import { loadCountries } from '../lib/countries.js';
import { loadHeroes } from '../lib/heroes.js';
import { getServerConfig, setOfficerRole, setPanelMessage } from '../lib/data/serverConfig.js';
import { ensureUser, listActiveUsers, setOfficer } from '../lib/data/users.js';
import { clearOverride, getOverrides, setOverride } from '../lib/data/officers.js';
import { requireSgAdmin, resolveOfficerStatus } from '../lib/permissions.js';
import { deferEphemeral, replyEphemeral } from '../lib/respond.js';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Supergroup admin tools')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('panel')
      .setDescription('Post the flag/timezone panel here, or refresh the existing one'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reload')
      .setDescription('Reload the hero and country data files without restarting the bot'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('View or change supergroup settings')
      .addRoleOption((opt) =>
        opt
          .setName('officer-role')
          .setDescription('Role that marks officers and grants admin commands'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('officer')
      .setDescription('Mark one person as an officer, or exclude them — overrides the role')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Who').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('status')
          .setDescription('What they should be')
          .setRequired(true)
          .addChoices(
            { name: '⭐ Officer', value: 'grant' },
            { name: 'Not an officer', value: 'deny' },
            { name: 'Follow the officer role (remove override)', value: 'default' },
          ),
      ),
  );

export async function execute(interaction) {
  const allowed = requireSgAdmin(interaction);
  if (!allowed.ok) return replyEphemeral(interaction, { content: allowed.message });

  const sub = interaction.options.getSubcommand();
  if (sub === 'panel') return runPanel(interaction);
  if (sub === 'reload') return runReload(interaction);
  if (sub === 'config') return runConfig(interaction);
  if (sub === 'officer') return runOfficer(interaction);
  return replyEphemeral(interaction, { content: 'Unknown subcommand.' });
}

/**
 * Explicit per-person officer status, for supergroups that do not use a role,
 * and for excluding a server owner who is not actually an officer.
 */
async function runOfficer(interaction) {
  const target = interaction.options.getUser('user');
  const status = interaction.options.getString('status');
  const serverId = interaction.guildId;

  if (status === 'default') {
    clearOverride(serverId, target.id);
  } else {
    setOverride(serverId, target.id, status === 'grant', interaction.user.id);
  }

  // Apply immediately if we already have a row for them. If we don't, they have
  // never used the bot, so they are not in the roster to sort anyway — the
  // override applies the moment they first interact.
  let applied = null;
  try {
    const member = await interaction.guild.members.fetch(target.id);
    applied = resolveOfficerStatus(serverId, interaction.guild, member);

    // Create a row if they have never used the bot, so a named officer shows up
    // in /sgroster straight away instead of only after they first interact.
    ensureUser(serverId, target.id, member.nickname ?? target.globalName ?? target.username);
    setOfficer(serverId, target.id, applied);
  } catch {
    // Not in the server any more, or unfetchable — the stored override stands.
  }

  const { officerRoleId } = getServerConfig(serverId);

  if (status === 'default') {
    return replyEphemeral(interaction, {
      content:
        `Override removed for **${target.displayName ?? target.username}**.\n\n` +
        `They now follow the normal rules: ${
          officerRoleId ? `the <@&${officerRoleId}> role` : 'no officer role is set'
        }, plus the server owner and Administrators.` +
        (applied === null ? '' : `\nCurrently: **${applied ? '⭐ officer' : 'not an officer'}**.`),
    });
  }

  const granted = status === 'grant';
  return replyEphemeral(interaction, {
    content:
      `${granted ? '⭐' : '✅'} **${target.displayName ?? target.username}** is now ` +
      `**${granted ? 'an officer' : 'not an officer'}**, regardless of roles.\n\n` +
      '*This override beats the officer role and the owner/Administrator default. ' +
      'Use `/admin officer` with **Follow the officer role** to undo it.*',
  });
}

/**
 * Re-reads officer status for every stored member.
 *
 * Fetches members ONE AT A TIME BY ID, which is unprivileged. The bulk
 * endpoint (GET /guilds/{id}/members) would need the GuildMembers intent,
 * which this bot deliberately does not request. That makes this O(members)
 * REST calls, so it is an explicit admin action rather than anything on a
 * hot path.
 */
async function resyncOfficers(interaction, officerRoleId) {
  const members = listActiveUsers(interaction.guildId);
  let changed = 0;
  let missing = 0;

  for (const stored of members) {
    try {
      const member = await interaction.guild.members.fetch(stored.discordId);
      const isOfficer = resolveOfficerStatus(interaction.guildId, interaction.guild, member);
      if (isOfficer !== stored.isOfficer) {
        setOfficer(interaction.guildId, stored.discordId, isOfficer);
        changed += 1;
      }
    } catch {
      // Almost always "member left the server" — not an error worth shouting
      // about, but worth counting so the admin knows the roster has stragglers.
      missing += 1;
    }
  }

  return { total: members.length, changed, missing };
}

async function runConfig(interaction) {
  const role = interaction.options.getRole('officer-role');
  const current = getServerConfig(interaction.guildId);

  if (!role) {
    const overrides = getOverrides(interaction.guildId);
    const granted = [...overrides].filter(([, v]) => v).map(([id]) => `<@${id}>`);
    const denied = [...overrides].filter(([, v]) => !v).map(([id]) => `<@${id}>`);

    return replyEphemeral(interaction, {
      content:
        '**Supergroup settings**\n' +
        `• Officer role: ${current.officerRoleId ? `<@&${current.officerRoleId}>` : '*not set*'}\n` +
        `• Panel: ${current.panelMessageId ? 'posted' : '*not posted — run `/admin panel`*'}\n` +
        `• Named officers: ${granted.length ? granted.join(', ') : '*none*'}\n` +
        `• Excluded: ${denied.length ? denied.join(', ') : '*none*'}\n\n` +
        'Set the officer role with `/admin config officer-role:@YourRole` — it grants ' +
        '`/admin` access and sorts those members to the top of `/sgroster`.\n' +
        'Use `/admin officer` to name someone individually, or to exclude someone the ' +
        'role would otherwise include.',
    });
  }

  setOfficerRole(interaction.guildId, role.id);

  // The resync makes REST calls in a loop, so acknowledge first.
  await deferEphemeral(interaction);
  const result = await resyncOfficers(interaction, role.id);

  return replyEphemeral(interaction, {
    content:
      `✅ Officer role set to <@&${role.id}>.\n\n` +
      `Checked **${result.total}** stored member${result.total === 1 ? '' : 's'}, ` +
      `updated **${result.changed}**.` +
      (result.missing > 0
        ? `\n⚠️ **${result.missing}** could not be found — they have probably left the server.`
        : '') +
      '\n\n*Officer status also refreshes whenever a member uses the bot, so this ' +
      'only needs re-running after you change several roles at once.*',
  });
}

/**
 * Hot-reloads the editable JSON data files. Correcting a hero name should cost
 * seconds, not a redeploy.
 */
async function runReload(interaction) {
  const heroes = loadHeroes();
  const countries = loadCountries();

  const problems = [
    ...heroes.problems.map((p) => `heroes.json — ${p}`),
    ...countries.problems.map((p) => `countries.json — ${p}`),
  ];

  if (problems.length > 0) {
    return replyEphemeral(interaction, {
      content:
        `⚠️ Reloaded with **${problems.length}** problem(s):\n` +
        problems.slice(0, 10).map((p) => `• ${p}`).join('\n') +
        (problems.length > 10 ? `\n…and ${problems.length - 10} more` : '') +
        (heroes.applied === false
          ? '\n\n**The hero list was not applied** — the previous data is still in use. ' +
            'Fix the file and run this again.'
          : '') +
        '\n\n*Run `npm run validate:data` on the host for the full report.*',
    });
  }

  return replyEphemeral(interaction, {
    content:
      `✅ Reloaded — **${heroes.count}** heroes, **${countries.count}** countries.\n` +
      '*Autocomplete uses the new data immediately.*',
  });
}

/**
 * Channel permissions Cerebruv needs where the panel lives.
 *
 * Checked up front rather than discovered via a raw 50001. Missing View
 * Channel is especially worth catching: Discord will not deliver component
 * interactions to an app that cannot see the channel, so the panel button
 * would render but silently do nothing when clicked.
 */
const PANEL_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
];

async function checkChannelPermissions(interaction) {
  try {
    const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
    const perms = interaction.channel?.permissionsFor(me);
    if (!perms) return [];
    return PANEL_PERMISSIONS.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
  } catch {
    return []; // Can't tell — let the send attempt surface it.
  }
}

async function runPanel(interaction) {
  const missing = await checkChannelPermissions(interaction);
  if (missing.length > 0) {
    return replyEphemeral(interaction, {
      content:
        `⚠️ I'm missing these permissions in ${interaction.channel}:\n` +
        missing.map((p) => `• **${p}**`).join('\n') +
        '\n\nFix in **Channel Settings → Permissions** (a channel override can deny ' +
        "what the server-wide role allows), then run this again.\n\n" +
        '*Without **View Channel** in particular, the panel button would appear but ' +
        'do nothing when clicked — Discord drops interactions for channels I cannot see.*',
    });
  }

  const config = getServerConfig(interaction.guildId);
  const panel = buildPanel();

  // Refresh in place if we already posted one — re-running should not spam the
  // channel with duplicate panels.
  if (config.panelChannelId && config.panelMessageId) {
    try {
      const channel = await interaction.guild.channels.fetch(config.panelChannelId);
      const message = await channel.messages.fetch(config.panelMessageId);
      await message.edit(panel);
      return replyEphemeral(interaction, {
        content: `✅ Refreshed the existing panel: ${message.url}`,
      });
    } catch {
      // Message deleted, channel gone, or no access — fall through and post a
      // fresh one rather than failing.
    }
  }

  let sent;
  try {
    sent = await interaction.channel.send(panel);
  } catch (error) {
    console.error('[admin] could not post panel', {
      server: interaction.guildId,
      channel: interaction.channelId,
      code: error?.code,
    });
    return replyEphemeral(interaction, {
      content:
        "⚠️ I couldn't post here. I need **View Channel**, **Send Messages** and " +
        '**Embed Links** in this channel.',
    });
  }

  setPanelMessage(interaction.guildId, interaction.channelId, sent.id);

  let note = '';
  try {
    await sent.pin();
  } catch {
    note =
      '\n\n*I could not pin it — that needs the **Manage Messages** permission. ' +
      'Pin it yourself so members can find it.*';
  }

  return replyEphemeral(interaction, {
    content: `✅ Panel posted: ${sent.url}${note}`,
  });
}
