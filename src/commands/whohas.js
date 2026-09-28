/**
 * /whohas hero:<name> — who in the supergroup has this hero, and how far along.
 *
 * The artifact variant is deferred (2026-09-27) along with the rest of the
 * artifact system. Adding it later is a second subcommand, not a reshape.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { AUTOCOMPLETE_MAX, getHero, resolveHeroId, searchHeroes } from '../lib/heroes.js';
import { describeProgress, prestigeTier } from '../lib/game.js';
import { whoOwns } from '../lib/data/roster.js';
import { whoMains } from '../lib/data/mains.js';
import { getUser } from '../lib/data/users.js';
import { memberName } from '../lib/embeds.js';
import { replyEphemeral, replyPublic } from '../lib/respond.js';

const MAX_LISTED = 20;

export const data = new SlashCommandBuilder()
  .setName('whohas')
  .setDescription('Find out who has a hero')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt.setName('hero').setDescription('Which hero').setRequired(true).setAutocomplete(true),
  );

export async function autocomplete(interaction) {
  try {
    const matches = searchHeroes(interaction.options.getFocused(), AUTOCOMPLETE_MAX);
    await interaction.respond(matches.map((hero) => ({ name: hero.name, value: hero.id })));
  } catch (error) {
    console.error('[whohas] autocomplete failed', error);
  }
}

export async function execute(interaction) {
  const input = interaction.options.getString('hero');
  const heroId = resolveHeroId(input);

  if (!heroId) {
    return replyEphemeral(interaction, {
      content:
        `I don't recognise **${input}** as a hero in Marvel Heroes.\n\n` +
        'Pick from the autocomplete list as you type.',
    });
  }

  const serverId = interaction.guildId;
  const hero = getHero(heroId);
  const owners = whoOwns(serverId, heroId);
  const mainers = new Set(whoMains(serverId, heroId).map((m) => m.discord_id));

  if (owners.length === 0) {
    return replyEphemeral(interaction, {
      content:
        `Nobody has recorded owning **${hero.name}** yet.\n\n` +
        '*Only heroes members have ticked in `/myheroes` show up here.*',
    });
  }

  const lines = owners.slice(0, MAX_LISTED).map((row) => {
    const user = getUser(serverId, row.discord_id);
    const name = memberName(user) || `<@${row.discord_id}>`;
    const progress = describeProgress(row) ?? 'owned';
    const star = mainers.has(row.discord_id) ? ' ⭐' : '';
    return `**${name}**${star} · ${progress}`;
  });

  const best = prestigeTier(owners[0].prestige ?? 0);

  const embed = new EmbedBuilder()
    .setColor(best?.colour ?? 0x2f8f4e)
    .setTitle(`Who has ${hero.name}?`)
    .setDescription(lines.join('\n'))
    .setFooter({
      text:
        `${owners.length} member${owners.length === 1 ? '' : 's'}` +
        (mainers.size > 0 ? ` · ⭐ mains this hero` : '') +
        (owners.length > MAX_LISTED ? ` · showing the top ${MAX_LISTED}` : ''),
    });

  return replyPublic(interaction, { embeds: [embed] });
}
