/**
 * /profile [user] — a member at a glance: timezone, mains, unlock count and
 * their furthest-along heroes.
 *
 * The *list* of heroes lives in /roster. This is the summary.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { allHeroes, getHero } from '../lib/heroes.js';
import { describeProgress, prestigeEmoji, prestigeTier } from '../lib/game.js';
import { describeTimezone } from '../lib/timezones.js';
import { memberLabel } from '../lib/embeds.js';
import { countOwned, getDetailedHeroes } from '../lib/data/roster.js';
import { getMains } from '../lib/data/mains.js';
import { getUser } from '../lib/data/users.js';
import { replyEphemeral, replyPublic } from '../lib/respond.js';

const BRAND = 0x2f8f4e;
const TOP_HEROES = 8;

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription("A member's timezone, mains and highlights — yours if you don't name anyone")
  .setContexts(InteractionContextType.Guild)
  .addUserOption((opt) => opt.setName('user').setDescription('Whose profile to show'));

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const serverId = interaction.guildId;

  const stored = getUser(serverId, target.id);
  const mains = getMains(serverId, target.id);
  const owned = countOwned(serverId, target.id);
  const detailed = getDetailedHeroes(serverId, target.id);

  const isSelf = target.id === interaction.user.id;

  if (!stored && mains.length === 0 && owned === 0) {
    return replyEphemeral(interaction, {
      content: isSelf
        ? "You haven't recorded anything yet.\n\n" +
          'Start with **/myheroes** to tick off what you own, then **/setmains** for your favourites.'
        : `**${target.displayName ?? target.username}** hasn't recorded anything yet.`,
    });
  }

  // Colour the embed by their best hero's prestige — a Cosmic member gets a
  // gold embed, which reads at a glance.
  const tier = prestigeTier(detailed[0]?.prestige ?? 0);

  const embed = new EmbedBuilder()
    .setColor(tier?.colour ?? BRAND)
    .setTitle(memberLabel(stored, target))
    .setThumbnail(target.displayAvatarURL());

  const timezone = stored ? describeTimezone(stored) : null;
  if (timezone) {
    embed.addFields({ name: 'Timezone', value: timezone, inline: false });
  }

  embed.addFields({
    name: 'Heroes unlocked',
    value: `**${owned}** of ${allHeroes().length}`,
    inline: true,
  });

  if (stored?.isOfficer) {
    embed.addFields({ name: 'Role', value: '⭐ Officer', inline: true });
  }

  if (mains.length > 0) {
    embed.addFields({
      name: mains.length === 1 ? 'Main' : 'Mains',
      value: mains
        .map((heroId, index) => {
          const name = getHero(heroId)?.name ?? heroId;
          const entry = detailed.find((e) => e.heroId === heroId);
          const progress = entry ? ` — ${describeProgress(entry)}` : '';
          return `${index === 0 ? '**' : ''}${name}${index === 0 ? '**' : ''}${progress}`;
        })
        .join('\n'),
      inline: false,
    });
  }

  if (detailed.length > 0) {
    const lines = detailed.slice(0, TOP_HEROES).map((entry) => {
      const name = getHero(entry.heroId)?.name ?? entry.heroId;
      return `${prestigeEmoji(entry.prestige ?? 0)} ${name} · Lv ${entry.level ?? '?'}`;
    });

    embed.addFields({
      name: `Furthest along${detailed.length > TOP_HEROES ? ` (top ${TOP_HEROES} of ${detailed.length})` : ''}`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: isSelf
      ? 'See every hero with /roster · /updatehero records level and prestige'
      : `See every hero with /roster user:${target.username}`,
  });

  return replyPublic(interaction, { embeds: [embed] });
}
