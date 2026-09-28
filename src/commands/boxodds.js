/**
 * /boxodds — your chance of pulling a new hero from a Random Hero Box,
 * calculated from what you have actually ticked in /myheroes.
 *
 * The pool is 58, not 63: the Fantastic Four and Silver Surfer cannot drop.
 * See data/game.json `randomBoxExcludes`.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { allHeroes, getHero } from '../lib/heroes.js';
import { randomBoxExcludes } from '../lib/game.js';
import { asOddsPercent, boxOdds } from '../lib/boxodds.js';
import { getOwnedHeroIds } from '../lib/data/roster.js';
import { getUser } from '../lib/data/users.js';
import { memberLabel } from '../lib/embeds.js';
import { replyEphemeral, replyPublic } from '../lib/respond.js';

const BRAND = 0x2f8f4e;
const GOLD = 0xd4a017;
const MAX_BOXES = 1000;
const LIST_MISSING = 12;

export const data = new SlashCommandBuilder()
  .setName('boxodds')
  .setDescription('Your chance of getting a new hero from a Random Hero Box')
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption((opt) =>
    opt
      .setName('boxes')
      .setDescription('How many boxes you plan to open (default 1)')
      .setMinValue(1)
      .setMaxValue(MAX_BOXES),
  )
  .addUserOption((opt) => opt.setName('user').setDescription("Check someone else's odds"));

/** The heroes that can actually drop. */
function boxPool() {
  const excluded = new Set(randomBoxExcludes());
  return allHeroes().filter((hero) => !excluded.has(hero.id));
}

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const boxes = interaction.options.getInteger('boxes') ?? 1;
  const isSelf = target.id === interaction.user.id;

  const pool = boxPool();
  const owned = getOwnedHeroIds(interaction.guildId, target.id);

  // Ownership of an excluded hero is irrelevant to the box, so intersect
  // rather than using the raw unlock count.
  const ownedInPool = pool.filter((hero) => owned.has(hero.id));

  if (owned.size === 0) {
    return replyEphemeral(interaction, {
      content: isSelf
        ? "I don't know which heroes you have yet, so I can't work out your odds.\n\n" +
          'Run **/myheroes** first — it takes about a minute.'
        : `**${target.displayName ?? target.username}** hasn't recorded which heroes they own yet.`,
    });
  }

  const odds = boxOdds({
    poolSize: pool.length,
    ownedInPool: ownedInPool.length,
    boxes,
  });

  const stored = getUser(interaction.guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(odds.complete ? GOLD : BRAND)
    .setTitle(`🎲 Random Hero Box — ${memberLabel(stored, target)}`);

  if (odds.complete) {
    embed.setDescription(
      `**Every hero in the box pool is already unlocked** — all ${odds.poolSize} of them.\n\n` +
        'Every box from here is a duplicate token. Nothing left to chase.',
    );
    return replyPublic(interaction, { embeds: [embed] });
  }

  embed.setDescription(
    `**${odds.ownedInPool}** of **${odds.poolSize}** heroes in the box pool — ` +
      `**${odds.missing}** still missing.`,
  );

  embed.addFields(
    {
      name: 'One box',
      value:
        `🆕 New hero · **${asOddsPercent(odds.pNew)}**\n` +
        `🔁 Duplicate · ${asOddsPercent(odds.pDuplicate)}`,
      inline: true,
    },
    {
      name: 'On average',
      value: `**${odds.boxesPerNew.toFixed(1)}** boxes per new hero`,
      inline: true,
    },
  );

  if (boxes > 1) {
    embed.addFields({
      name: `${boxes} boxes`,
      value:
        `At least one new · **${asOddsPercent(odds.pAtLeastOneNew)}**\n` +
        `Expected new heroes · **${odds.expectedNew.toFixed(1)}**`,
      inline: false,
    });
  }

  // When someone is close to finishing, naming what is left is more useful
  // than the percentage.
  if (odds.missing <= LIST_MISSING) {
    const ownedIds = new Set(ownedInPool.map((h) => h.id));
    const missingNames = pool
      .filter((hero) => !ownedIds.has(hero.id))
      .map((hero) => getHero(hero.id)?.name ?? hero.id);

    embed.addFields({
      name: `Still missing (${odds.missing})`,
      value: missingNames.join(' · '),
      inline: false,
    });
  }

  embed.setFooter({
    text:
      `Pool is ${odds.poolSize} — the Fantastic Four and Silver Surfer cannot drop. ` +
      'Boxes can repeat heroes you already own.',
  });

  return replyPublic(interaction, { embeds: [embed] });
}
