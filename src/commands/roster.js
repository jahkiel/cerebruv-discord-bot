/**
 * /roster [user] — the actual list of heroes a member has unlocked.
 *
 * Laid out in three inline fields, which Discord renders as columns on desktop
 * and stacks on mobile. All 63 heroes fit comfortably in one embed
 * (~25 characters a line against a 1024-character field limit), so there is no
 * pagination to get wrong.
 *
 * The summary view — timezone, mains, highlights — is /profile.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { allHeroes, getHero } from '../lib/heroes.js';
import { compareProgress, prestigeEmoji, prestigeTier } from '../lib/game.js';
import { memberLabel } from '../lib/embeds.js';
import { buildCopyButton } from '../interactions/rosterText.js';
import { getMemberRoster } from '../lib/data/roster.js';
import { getMains } from '../lib/data/mains.js';
import { getUser } from '../lib/data/users.js';
import { replyEphemeral, replyPublic } from '../lib/respond.js';

const BRAND = 0x2f8f4e;
const COLUMNS = 3;
const FIELD_LIMIT = 1024;

export const data = new SlashCommandBuilder()
  .setName('roster')
  .setDescription("List a member's unlocked heroes — yours if you don't name anyone")
  .setContexts(InteractionContextType.Guild)
  .addUserOption((opt) => opt.setName('user').setDescription('Whose heroes to list'));

const heroName = (entry) => getHero(entry.heroId)?.name ?? entry.heroId;

/**
 * Heroes with recorded progress first, best first; then the rest alphabetically.
 *
 * Ordering uses compareProgress, not level — prestiging resets a hero to level
 * 1, so a Cosmic hero at Lv 3 belongs above a White hero at Lv 60.
 */
function orderEntries(entries) {
  const owned = entries.filter((entry) => entry.owned);

  const recorded = owned
    .filter((entry) => entry.level != null || entry.prestige != null)
    .sort((a, b) => compareProgress(b, a) || heroName(a).localeCompare(heroName(b)));

  const plain = owned
    .filter((entry) => entry.level == null && entry.prestige == null)
    .sort((a, b) => heroName(a).localeCompare(heroName(b)));

  return { ordered: [...recorded, ...plain], recorded: recorded.length };
}

function toColumns(lines) {
  const perColumn = Math.ceil(lines.length / COLUMNS);
  const fields = [];

  for (let start = 0; start < lines.length; start += perColumn) {
    let value = lines.slice(start, start + perColumn).join('\n');
    if (value.length > FIELD_LIMIT) value = `${value.slice(0, FIELD_LIMIT - 1)}…`;

    fields.push({
      // Only the first column gets a visible heading; the others use a
      // zero-width space so the columns line up without repeating the label.
      name: fields.length === 0 ? 'Unlocked' : '​',
      value,
      inline: true,
    });
  }

  return fields;
}

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const serverId = interaction.guildId;
  const isSelf = target.id === interaction.user.id;

  const entries = getMemberRoster(serverId, target.id);
  const { ordered, recorded } = orderEntries(entries);

  if (ordered.length === 0) {
    return replyEphemeral(interaction, {
      content: isSelf
        ? "You haven't ticked off any heroes yet.\n\nRun **/myheroes** — it takes about a minute."
        : `**${target.displayName ?? target.username}** hasn't recorded any heroes yet.`,
    });
  }

  const stored = getUser(serverId, target.id);
  const mains = new Set(getMains(serverId, target.id));

  const lines = ordered.map((entry) => {
    const star = mains.has(entry.heroId) ? '⭐' : '';
    const level = entry.level != null ? ` ${entry.level}` : '';
    return `${prestigeEmoji(entry.prestige ?? 0)} ${heroName(entry)}${level}${star}`;
  });

  const tier = prestigeTier(ordered[0]?.prestige ?? 0);

  const embed = new EmbedBuilder()
    .setColor(tier?.colour ?? BRAND)
    .setTitle(`${memberLabel(stored, target)} — ${ordered.length} of ${allHeroes().length} heroes`)
    .addFields(toColumns(lines))
    .setFooter({
      text:
        recorded === 0
          ? isSelf
            ? 'No levels recorded yet — use /updatehero · ⭐ marks your mains'
            : 'No levels recorded yet · ⭐ marks their mains'
          : `${recorded} with a level recorded · ⭐ marks mains · /profile for the summary`,
    });

  return replyPublic(interaction, {
    embeds: [embed],
    components: [buildCopyButton(target.id)],
  });
}
