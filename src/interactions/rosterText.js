/**
 * The "Copy as text" button on /roster.
 *
 * Produces exactly the format /bulkupdate accepts, so the loop is:
 *   /roster -> copy -> edit the levels -> /bulkupdate -> paste.
 *
 * That round-trip is the reason a bare hero name is valid input in
 * lib/bulkparse.js: heroes with nothing recorded export as just a name, and
 * pasting them back must not produce a wall of errors.
 *
 *   rost:txt:<targetUserId>
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import { getHero } from '../lib/heroes.js';
import { compareProgress } from '../lib/game.js';
import { getMemberRoster } from '../lib/data/roster.js';
import { replyEphemeral } from '../lib/respond.js';

export const PREFIX = 'rost';

/** Discord caps a message at 2000 characters; leave room for the fences. */
const CHUNK = 1800;

export function buildCopyButton(targetUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:txt:${targetUserId}`)
      .setLabel('Copy as text')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
  );
}

const heroName = (entry) => getHero(entry.heroId)?.name ?? entry.heroId;

/**
 * One hero per line: `Name Level Prestige`, omitting whatever is not recorded.
 * Same order as the /roster embed, so the text matches what was just on screen.
 *
 * @returns {string[]} lines
 */
export function rosterLines(entries) {
  const owned = entries.filter((entry) => entry.owned);

  const recorded = owned
    .filter((entry) => entry.level != null || entry.prestige != null)
    .sort((a, b) => compareProgress(b, a) || heroName(a).localeCompare(heroName(b)));

  const plain = owned
    .filter((entry) => entry.level == null && entry.prestige == null)
    .sort((a, b) => heroName(a).localeCompare(heroName(b)));

  return [...recorded, ...plain].map((entry) => {
    const parts = [heroName(entry)];
    if (entry.level != null) parts.push(String(entry.level));
    // A prestige with no level would be ambiguous on the way back in — "Storm 3"
    // reads as level 3 — so tag it explicitly.
    if (entry.prestige != null) parts.push(entry.level == null ? `P${entry.prestige}` : String(entry.prestige));
    return parts.join(' ');
  });
}

/** Splits into code blocks that each fit inside one Discord message. */
export function toBlocks(lines) {
  const blocks = [];
  let current = [];
  let size = 0;

  for (const line of lines) {
    if (size + line.length + 1 > CHUNK) {
      blocks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) blocks.push(current);

  return blocks.map((block) => `\`\`\`\n${block.join('\n')}\n\`\`\``);
}

/** @returns {Promise<boolean>} false if the custom_id was not ours */
export async function handle(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== PREFIX || parts[1] !== 'txt') return false;

  const targetId = parts[2];
  const lines = rosterLines(getMemberRoster(interaction.guildId, targetId));

  if (lines.length === 0) {
    await replyEphemeral(interaction, { content: 'Nothing recorded to copy.' });
    return true;
  }

  const blocks = toBlocks(lines);

  // Ephemeral: this is a working copy for pasting into /bulkupdate, not
  // something the channel needs to see twice.
  await replyEphemeral(interaction, {
    content:
      `**${lines.length} heroes** — copy this, edit the numbers, then paste it into ` +
      '`/bulkupdate`.\n' +
      (blocks.length > 1 ? `*Split across ${blocks.length} blocks — paste them one at a time.*\n` : '') +
      blocks[0],
  });

  // Follow-ups for anyone with a roster too big for one message.
  for (const block of blocks.slice(1)) {
    try {
      await interaction.followUp({ content: block, flags: 64 });
    } catch (error) {
      console.error('[rosterText] follow-up block failed', error);
    }
  }

  return true;
}
