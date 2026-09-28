/**
 * /updatehero — record level and prestige for one hero.
 *
 * The detail command. Bulk ownership goes through /myheroes; this is for the
 * heroes a member actually cares about.
 *
 * Level and prestige bounds come from data/game.json, never hard-coded — they
 * describe a private server we do not control.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { AUTOCOMPLETE_MAX, getHero, resolveHeroId, searchHeroes } from '../lib/heroes.js';
import {
  describeProgress,
  isValidLevel,
  isValidPrestige,
  levelCap,
  levelFloor,
  maxPrestige,
  prestigeTier,
  prestigeTiers,
} from '../lib/game.js';
import { getHeroEntry, upsertHero } from '../lib/data/roster.js';
import { replyEphemeral } from '../lib/respond.js';

export const data = new SlashCommandBuilder()
  .setName('updatehero')
  .setDescription('Record your level and prestige for one hero')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt.setName('hero').setDescription('Which hero').setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((opt) =>
    opt.setName('level').setDescription('Current level (1-60)').setMinValue(1).setMaxValue(60),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('prestige')
      .setDescription('Prestige tier — white is 0, cosmic is 6')
      .addChoices(
        // Built from config at load time so the labels always match game.json.
        ...prestigeTiers().map((tier) => ({
          name: `${tier.emoji} ${tier.value} · ${tier.name}`,
          value: tier.value,
        })),
      ),
  )
  .addBooleanOption((opt) =>
    opt.setName('owned').setDescription('Uncheck if you no longer have this hero'),
  );

export async function autocomplete(interaction) {
  try {
    const matches = searchHeroes(interaction.options.getFocused(), AUTOCOMPLETE_MAX);
    await interaction.respond(matches.map((hero) => ({ name: hero.name, value: hero.id })));
  } catch (error) {
    console.error('[updatehero] autocomplete failed', error);
  }
}

export async function execute(interaction) {
  const heroInput = interaction.options.getString('hero');
  const heroId = resolveHeroId(heroInput);

  if (!heroId) {
    return replyEphemeral(interaction, {
      content:
        `I don't recognise **${heroInput}** as a hero in Marvel Heroes.\n\n` +
        'Pick from the autocomplete list as you type rather than typing the name out.',
    });
  }

  const level = interaction.options.getInteger('level');
  const prestige = interaction.options.getInteger('prestige');
  const owned = interaction.options.getBoolean('owned');

  // Belt and braces: the option min/max above is a client-side hint, and the
  // real bounds live in config, which may not match a stale command registration.
  if (level != null && !isValidLevel(level)) {
    return replyEphemeral(interaction, {
      content: `Level has to be between **${levelFloor()}** and **${levelCap()}**.`,
    });
  }
  if (prestige != null && !isValidPrestige(prestige)) {
    return replyEphemeral(interaction, {
      content: `Prestige has to be between **0** and **${maxPrestige()}**.`,
    });
  }

  if (level == null && prestige == null && owned == null) {
    const current = getHeroEntry(interaction.guildId, interaction.user.id, heroId);
    return replyEphemeral(interaction, {
      content: current
        ? `**${getHero(heroId).name}** — ${describeProgress(current, { verbose: true }) ?? 'owned, no level recorded'}\n\n` +
          'Give me a `level` or `prestige` to update it.'
        : `You haven't recorded **${getHero(heroId).name}** yet. ` +
          'Add a `level` or `prestige`, or use `/myheroes` to tick off what you own.',
    });
  }

  // Recording progress implies ownership — nobody levels a hero they don't have.
  const entry = upsertHero(interaction.guildId, interaction.user.id, heroId, {
    owned: owned ?? (level != null || prestige != null ? true : undefined),
    level: level ?? undefined,
    prestige: prestige ?? undefined,
  });

  const hero = getHero(heroId);
  const tier = prestigeTier(entry.prestige ?? 0);

  if (!entry.owned) {
    return replyEphemeral(interaction, {
      content: `**${hero.name}** marked as not owned. Your level and prestige are kept in case you get them back.`,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(tier?.colour ?? 0x2f8f4e)
    .setTitle(`${tier?.emoji ?? ''} ${hero.name}`.trim())
    .setDescription(describeProgress(entry, { verbose: true }) ?? 'Owned — no level recorded yet')
    .setFooter({ text: 'Run this again any time · /myheroes ticks off what you own in bulk' });

  return replyEphemeral(interaction, { embeds: [embed] });
}
