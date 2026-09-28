/**
 * /setmains hero1 [hero2] [hero3]
 *
 * Mains are a lookup feature — they surface in /roster and /sgroster, never in
 * the nickname (decided 2026-09-27).
 *
 * Re-running replaces the whole set, so dropping from three mains to one is
 * just running it again with one hero.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { AUTOCOMPLETE_MAX, getHero, resolveHeroId, searchHeroes } from '../lib/heroes.js';
import { getMains, setMains } from '../lib/data/mains.js';
import { replyEphemeral } from '../lib/respond.js';

const SLOTS = ['hero1', 'hero2', 'hero3'];
const BRAND = 0x2f8f4e;

export const data = new SlashCommandBuilder()
  .setName('setmains')
  .setDescription('Set your 1-3 main heroes')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((opt) =>
    opt
      .setName('hero1')
      .setDescription('Your primary main — this is the one shown in the supergroup roster')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt.setName('hero2').setDescription('Second main (optional)').setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt.setName('hero3').setDescription('Third main (optional)').setAutocomplete(true),
  );

export async function autocomplete(interaction) {
  try {
    const query = interaction.options.getFocused();
    const matches = searchHeroes(query, AUTOCOMPLETE_MAX);
    await interaction.respond(
      matches.map((hero) => ({ name: hero.name, value: hero.id })),
    );
  } catch (error) {
    console.error('[setmains] autocomplete failed', error);
  }
}

export async function execute(interaction) {
  const raw = SLOTS.map((slot) => interaction.options.getString(slot)).filter(
    (value) => value != null && value !== '',
  );

  // Validate before writing anything — a half-applied set would be worse than
  // a rejection. Free text that matches no hero is refused, never guessed at.
  const resolved = [];
  for (const input of raw) {
    const id = resolveHeroId(input);
    if (!id) {
      return replyEphemeral(interaction, {
        content:
          `I don't recognise **${input}** as a hero in Marvel Heroes.\n\n` +
          'Pick from the autocomplete list as you type rather than typing the name out — ' +
          "that way you can't miss.",
      });
    }
    resolved.push(id);
  }

  const unique = [...new Set(resolved)];
  if (unique.length !== resolved.length) {
    return replyEphemeral(interaction, {
      content: 'You listed the same hero more than once — each main has to be different.',
    });
  }

  const previous = getMains(interaction.guildId, interaction.user.id);
  const saved = setMains(interaction.guildId, interaction.user.id, unique);

  const lines = saved.map((id, index) => {
    const label = index === 0 ? '**Primary**' : `Main ${index + 1}`;
    return `${label} · ${getHero(id)?.name ?? id}`;
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(previous.length ? '✅ Mains updated' : '✅ Mains set')
    .setDescription(lines.join('\n'))
    .setFooter({
      text:
        saved.length < 3
          ? 'Run this again any time — you can set up to 3'
          : 'Run this again any time to change them',
    });

  return replyEphemeral(interaction, { embeds: [embed] });
}
