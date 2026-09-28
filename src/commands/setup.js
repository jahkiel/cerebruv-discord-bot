/**
 * /setup timezone [country]  — the slash-command entry to the flag/timezone flow
 * /setup clear               — removes the tag
 *
 * The panel button and this command share one backend, but deliberately differ
 * in UX: Discord only offers autocomplete on slash-command options, never
 * inside a select menu, so the `country:` shortcut can only exist here.
 */

import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { getCountry, searchCountries } from '../lib/countries.js';
import { flagEmoji } from '../lib/timezones.js';
import { formatScreen, startFlow } from '../interactions/timezone.js';
import { applyNicknameTag, baseNameOf, currentDisplayName, explainOutcome } from '../lib/memberTag.js';
import { clearTimezone } from '../lib/data/users.js';
import { replyEphemeral } from '../lib/respond.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set or clear your flag / timezone name tag')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('timezone')
      .setDescription('Add a country flag or UTC offset to your name')
      .addStringOption((opt) =>
        opt
          .setName('country')
          .setDescription('Optional — jump straight to your country')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('clear').setDescription('Remove your flag / timezone tag'),
  );

export async function autocomplete(interaction) {
  try {
    const query = interaction.options.getFocused();
    const matches = searchCountries(query, 25);
    await interaction.respond(
      matches.map((country) => ({
        name: `${flagEmoji(country.code) ?? ''} ${country.name}`.trim().slice(0, 100),
        value: country.code,
      })),
    );
  } catch (error) {
    // An autocomplete that throws just shows "no options" — never fatal.
    console.error('[setup] autocomplete failed', error);
  }
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'timezone') return runTimezone(interaction);
  if (sub === 'clear') return runClear(interaction);
  return replyEphemeral(interaction, { content: 'Unknown subcommand.' });
}

async function runTimezone(interaction) {
  const requested = interaction.options.getString('country');

  if (requested) {
    const country = getCountry(requested);
    if (!country) {
      // Free text that didn't match — reject rather than guess.
      return replyEphemeral(interaction, {
        content:
          `I don't recognise **${requested}** as a country.\n` +
          'Pick one from the autocomplete list, or run `/setup timezone` with no ' +
          'country to browse by region.',
      });
    }
    return replyEphemeral(interaction, formatScreen(country.code));
  }

  return startFlow(interaction, null);
}

async function runClear(interaction) {
  let member = interaction.member;
  if (!member || typeof member.setNickname !== 'function') {
    try {
      member = await interaction.guild.members.fetch(interaction.user.id);
    } catch (error) {
      console.error('[setup] clear could not resolve member', error);
      return replyEphemeral(interaction, {
        content: '⚠️ I could not read your server profile. Please try again.',
      });
    }
  }

  const base = baseNameOf(member);

  clearTimezone(interaction.guildId, interaction.user.id, {
    displayName: currentDisplayName(member),
    baseNickname: base,
  });

  const result = await applyNicknameTag(member, null);
  const warning = explainOutcome(result);

  if (warning) {
    return replyEphemeral(interaction, { content: warning });
  }

  return replyEphemeral(interaction, {
    content:
      result.outcome === 'unchanged'
        ? 'You had no tag to remove — nothing changed.'
        : `✅ Tag removed. You're now **${result.desired}**.`,
  });
}
