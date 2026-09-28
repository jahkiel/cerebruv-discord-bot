/**
 * The /myheroes tick-list.
 *
 * Ownership has to be cheap to record or nobody does it — 63 heroes one
 * /updatehero at a time means every roster row reads "0 heroes" forever. So
 * this is a multi-select: Discord allows 25 options per menu, giving 3 pages
 * for 63 heroes, pre-ticked from what is already stored.
 *
 * Routed by custom_id rather than a collector, so it survives a restart.
 *
 *   mh:pg:<page>    page navigation button
 *   mh:sel:<page>   the multi-select on that page (values = owned hero ids)
 *   mh:done:<page>  finish
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { allHeroes, getHero } from '../lib/heroes.js';
import { prestigeEmoji } from '../lib/game.js';
import { applyOwnershipPage, getOwnedHeroIds, getMemberRoster } from '../lib/data/roster.js';
import { updateInPlace } from '../lib/respond.js';

export const PREFIX = 'mh';

/** Discord's hard cap on options in one select menu. */
const PER_PAGE = 25;
const BRAND = 0x2f8f4e;

export function pageCount() {
  return Math.max(1, Math.ceil(allHeroes().length / PER_PAGE));
}

function heroesOnPage(page) {
  const all = allHeroes();
  const pages = pageCount();
  const safe = ((page % pages) + pages) % pages;
  return { page: safe, pages, items: all.slice(safe * PER_PAGE, safe * PER_PAGE + PER_PAGE) };
}

/**
 * Builds one page of the tick-list.
 *
 * `default: true` pre-ticks what the member already owns, so the menu doubles
 * as an edit screen rather than starting blank every time.
 */
export function buildPage(serverId, discordId, page = 0) {
  const { page: current, pages, items } = heroesOnPage(page);
  const owned = getOwnedHeroIds(serverId, discordId);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:sel:${current}`)
    .setPlaceholder(`Tick every hero you own — page ${current + 1} of ${pages}`)
    .setMinValues(0)
    .setMaxValues(items.length)
    .addOptions(
      items.map((hero) => ({
        label: hero.name,
        value: hero.id,
        default: owned.has(hero.id),
      })),
    );

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:pg:${current - 1}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:pg:${current + 1}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:done:${current}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Success),
  );

  const first = items[0]?.name ?? '';
  const last = items.at(-1)?.name ?? '';

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Which heroes have you unlocked?')
    .setDescription(
      `**${first} – ${last}**  ·  page ${current + 1} of ${pages}\n\n` +
        `You currently have **${owned.size}** of ${allHeroes().length} ticked.\n\n` +
        'Tick everything you own on this page, then use ◀ ▶ to move between pages. ' +
        'Each page saves as you go.',
    )
    .setFooter({ text: 'Use /updatehero to record level and prestige for a specific hero' });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), nav],
  };
}

function summary(serverId, discordId) {
  const entries = getMemberRoster(serverId, discordId);
  const owned = entries.filter((e) => e.owned);
  const detailed = owned.filter((e) => e.level != null || e.prestige != null);

  const best = [...detailed]
    .sort((a, b) => (b.prestige ?? 0) - (a.prestige ?? 0) || (b.level ?? 0) - (a.level ?? 0))
    .slice(0, 3)
    .map((e) => `${prestigeEmoji(e.prestige ?? 0)} ${getHero(e.heroId)?.name ?? e.heroId}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('✅ Saved')
    .setDescription(
      `You have **${owned.length}** of ${allHeroes().length} heroes unlocked.` +
        (best ? `\n\n**Furthest along**\n${best}` : ''),
    )
    .setFooter({
      text:
        detailed.length === 0
          ? 'Use /updatehero to add level and prestige for your favourites'
          : 'Run /myheroes again any time to update',
    });

  return { embeds: [embed], components: [] };
}

/**
 * Routes any component whose custom_id starts with `mh:`.
 * @returns {Promise<boolean>} false if the id was not ours
 */
export async function handle(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== PREFIX) return false;

  const [, action, pageRaw] = parts;
  const page = Number(pageRaw);
  const serverId = interaction.guildId;
  const userId = interaction.user.id;

  switch (action) {
    case 'pg':
      await updateInPlace(interaction, buildPage(serverId, userId, page));
      return true;

    case 'sel': {
      // Discord reports only what is ticked, so everything else ON THIS PAGE is
      // explicitly un-owned. Scoping to the page is what stops editing page 1
      // from wiping page 2.
      const { items } = heroesOnPage(page);
      applyOwnershipPage(
        serverId,
        userId,
        items.map((h) => h.id),
        interaction.values ?? [],
      );
      await updateInPlace(interaction, buildPage(serverId, userId, page));
      return true;
    }

    case 'done':
      await updateInPlace(interaction, summary(serverId, userId));
      return true;

    default:
      console.warn('[myheroes] unrecognised custom_id', interaction.customId);
      return false;
  }
}
