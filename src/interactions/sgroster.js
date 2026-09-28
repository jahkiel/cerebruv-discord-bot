/**
 * The paginated supergroup roster, rendered as a fixed-width table in the
 * style of SWGoHBot's guild list.
 *
 * Columns: Name | Rank | Country | Main Hero | Heroes unlocked | Top prestige
 *
 * NO EMOJI INSIDE THE BLOCK. Discord renders emoji at a variable width even in
 * monospace, which destroys the column alignment that is the entire point of
 * this format. Country is therefore the ISO code (AU) rather than the flag, and
 * prestige is the tier name rather than its colour. Flags and colours appear in
 * /roster and /profile, where there is no alignment to protect.
 *
 * Page state lives in the custom_id (`sgr:<page>:<invokerId>`), never in a
 * collector, so the buttons survive a restart. The invoker id is there because
 * this message is public — without it a passer-by could flip the page under
 * whoever is reading it.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { allHeroes, getHero } from '../lib/heroes.js';
import { prestigeName } from '../lib/game.js';
import { memberName } from '../lib/embeds.js';
import {
  countOwnedForAll,
  getPrimaryMainProgress,
  maxPrestigeForAll,
} from '../lib/data/roster.js';
import { listActiveUsers } from '../lib/data/users.js';
import { replyEphemeral, updateInPlace } from '../lib/respond.js';

export const PREFIX = 'sgr';

const PER_PAGE = 20;
const BRAND = 0x2f8f4e;

const W_NAME = 14;
const W_HERO = 16;
const W_COUNT = 3;

const pad = (value, width) => {
  const text = String(value ?? '');
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
};

/**
 * Officers first, then most heroes unlocked, then name.
 *
 * `isOfficer` is a cached flag refreshed when a member interacts with the bot —
 * reading it live would need the privileged GuildMembers intent. See CLAUDE.md.
 */
function buildRows(serverId) {
  const users = listActiveUsers(serverId);
  const counts = countOwnedForAll(serverId);
  const mains = getPrimaryMainProgress(serverId);
  const prestiges = maxPrestigeForAll(serverId);

  return users
    .map((user) => ({
      user,
      owned: counts.get(user.discordId) ?? 0,
      main: mains.get(user.discordId) ?? null,
      topPrestige: prestiges.get(user.discordId) ?? null,
    }))
    // Members who have done nothing at all would pad the roster with empty
    // rows — but officers always appear, recorded data or not. Leadership
    // missing from the roster looks broken, and it nudges them to fill it in.
    .filter((row) => row.user.isOfficer || row.owned > 0 || row.main || row.user.tagType)
    .sort((a, b) => {
      if (a.user.isOfficer !== b.user.isOfficer) return a.user.isOfficer ? -1 : 1;
      if (a.owned !== b.owned) return b.owned - a.owned;
      return memberName(a.user).localeCompare(memberName(b.user));
    });
}

function renderTable(rows) {
  const header =
    `${pad('NAME', W_NAME)} R CC ${pad('MAIN HERO', W_HERO)} ${'#'.padStart(W_COUNT)} PRESTIGE`;

  const lines = rows.map((row) => {
    const name = pad(memberName(row.user), W_NAME);
    const rank = row.user.isOfficer ? 'O' : 'M';
    const country = pad(row.user.countryCode ?? '--', 2);
    const hero = pad(row.main ? (getHero(row.main.heroId)?.name ?? row.main.heroId) : '-', W_HERO);
    const count = String(row.owned).padStart(W_COUNT);
    const prestige = row.topPrestige == null ? '-' : prestigeName(row.topPrestige);

    return `${name} ${rank} ${country} ${hero} ${count} ${prestige}`;
  });

  return ['```', header, ...lines, '```'].join('\n');
}

export function buildPage(serverId, page = 0, invokerId = '', supergroupName = 'the supergroup') {
  const rows = buildRows(serverId);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = ((page % pages) + pages) % pages;
  const slice = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${rows.length} member${rows.length === 1 ? '' : 's'} in ${supergroupName}`);

  if (slice.length === 0) {
    embed.setDescription(
      'No one has recorded anything yet.\n\n' +
        'Get members started with **/myheroes** to tick off what they own, ' +
        'then **/setmains** for their favourites.',
    );
    return { embeds: [embed], components: [] };
  }

  // Explain the columns rather than showing a supergroup-wide sum: the sum
  // duplicated the # column whenever there was only one member, which read as
  // a bug rather than a statistic.
  embed.setDescription(renderTable(slice)).setFooter({
    text:
      `Page ${current + 1} of ${pages} · R = rank (O officer, M member) · ` +
      `# = heroes unlocked, out of ${allHeroes().length}`,
  });

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:${current - 1}:${invokerId}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:${current + 1}:${invokerId}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
  );

  return { embeds: [embed], components: [nav] };
}

/** @returns {Promise<boolean>} false if the custom_id was not ours */
export async function handle(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== PREFIX) return false;

  const [, pageRaw, invokerId] = parts;

  // The roster posts publicly, so anyone can see these buttons. Only the person
  // who ran the command may page.
  if (invokerId && invokerId !== interaction.user.id) {
    await replyEphemeral(interaction, {
      content: `Those buttons belong to <@${invokerId}>'s roster. Run \`/sgroster\` to page through your own.`,
    });
    return true;
  }

  await updateInPlace(
    interaction,
    buildPage(interaction.guildId, Number(pageRaw), invokerId, interaction.guild?.name),
  );
  return true;
}
