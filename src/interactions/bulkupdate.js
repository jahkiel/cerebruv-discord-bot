/**
 * The /bulkupdate modal: paste a roster, get levels and prestige applied in one go.
 *
 * Routed by custom_id like every other component, so it survives a restart.
 *   bulk:open    the modal itself, submitted back to us
 */

import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { parseRosterPaste } from '../lib/bulkparse.js';
import { describeProgress, maxPrestige } from '../lib/game.js';
import { countOwned, upsertHero } from '../lib/data/roster.js';
import { allHeroes } from '../lib/heroes.js';
import { replyEphemeral } from '../lib/respond.js';

export const PREFIX = 'bulk';

const INPUT_ID = 'lines';
const BRAND = 0x2f8f4e;
const WARN = 0xd4a017;
const FIELD_LIMIT = 1024;

export function buildModal() {
  const input = new TextInputBuilder()
    .setCustomId(INPUT_ID)
    .setLabel('One hero per line')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Wolverine 60 6\nDoctor Strange 60 5\nStorm 44 3\nThor 60')
    .setRequired(true)
    .setMaxLength(4000);

  return new ModalBuilder()
    .setCustomId(`${PREFIX}:open`)
    .setTitle('Bulk update your roster')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Truncates a list of lines to fit an embed field. */
function fit(lines, limit = FIELD_LIMIT) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > limit - 30) {
      out.push(`…and ${lines.length - out.length} more`);
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

/** @returns {Promise<boolean>} false if the custom_id was not ours */
export async function handle(interaction) {
  if (!interaction.customId?.startsWith(`${PREFIX}:`)) return false;

  const text = interaction.fields.getTextInputValue(INPUT_ID);
  const { applied, errors, skipped } = parseRosterPaste(text);

  // Recording a level implies ownership — nobody levels a hero they do not have.
  for (const entry of applied) {
    upsertHero(interaction.guildId, interaction.user.id, entry.heroId, {
      owned: true,
      level: entry.level ?? undefined,
      prestige: entry.prestige ?? undefined,
    });
  }

  const owned = countOwned(interaction.guildId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(errors.length > 0 ? WARN : BRAND)
    .setTitle(
      applied.length === 0
        ? "❌ Nothing I could use"
        : `✅ Updated ${applied.length} hero${applied.length === 1 ? '' : 'es'}`,
    );

  if (applied.length > 0) {
    embed.setDescription(
      fit(
        applied.map(
          (entry) => `**${entry.name}** · ${describeProgress(entry) ?? 'owned'}`,
        ),
        4000,
      ),
    );
  }

  if (errors.length > 0) {
    embed.addFields({
      name: `⚠️ ${errors.length} line${errors.length === 1 ? '' : 's'} I couldn't use`,
      value: fit(errors.map((e) => `\`${e.line}\` ${e.text} — ${e.reason}`)),
      inline: false,
    });
  }

  if (applied.length === 0 && errors.length === 0) {
    embed.setDescription(
      'I could not find any hero lines in that.\n\n' +
        'Put one hero per line, with the level after the name:\n' +
        '```\nWolverine 60 6\nStorm 44 3\nThor 60\n```',
    );
  }

  embed.setFooter({
    text:
      `You now have ${owned} of ${allHeroes().length} heroes recorded` +
      (skipped > 0 ? ` · ${skipped} heading line${skipped === 1 ? '' : 's'} skipped` : '') +
      ` · prestige 0–${maxPrestige()}`,
  });

  await replyEphemeral(interaction, { embeds: [embed] });
  return true;
}
