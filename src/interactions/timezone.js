/**
 * The flag / timezone picker.
 *
 * Every screen is driven by a `custom_id`, never by a message collector.
 * Collectors live in process memory and die on restart, which would silently
 * break the pinned panel after any redeploy. Parsing state out of the
 * custom_id means a button posted months ago still works.
 *
 * custom_id grammar (prefix `tz`, colon-separated, all well under the 100-char
 * limit):
 *
 *   tz:start                  panel button — the main entry point
 *   tz:fmt:<f|o>:<cc|->       format chosen; cc is a pre-selected country or '-'
 *   tz:direct                 "just pick an offset" escape hatch
 *   tz:sub:<f|o>              subregion chosen        (value = subregion index)
 *   tz:cty:<f|o>:<si>:<p>     country chosen          (value = ISO code)
 *   tz:pg:<f|o>:<si>:<p>      page button             (p = target page)
 *   tz:back:<f|o>             back to the subregion list
 *   tz:zone:<f|o>:<cc>        zone chosen             (value = IANA id)
 *   tz:off:<p>                raw offset chosen       (value = minutes)
 *   tz:offpg:<p>              offset page button
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import {
  getCountry,
  getCountryPage,
  getSubregionByIndex,
  getSubregions,
  countryCount,
} from '../lib/countries.js';

import {
  OFFSET_CHOICES,
  buildTag,
  describeTimezone,
  flagEmoji,
  formatOffset,
  localTime,
  offsetMinutesFor,
} from '../lib/timezones.js';

import {
  applyNicknameTag,
  baseNameOf,
  currentDisplayName,
  explainOutcome,
} from '../lib/memberTag.js';

import { saveTimezone } from '../lib/data/users.js';
import { replyEphemeral, updateInPlace } from '../lib/respond.js';

export const PREFIX = 'tz';

const OFFSETS_PER_PAGE = 19; // 38 real-world offsets across 2 pages
const BRAND = 0x2f8f4e;

const tagTypeOf = (code) => (code === 'f' ? 'flag' : 'offset');

// ---------------------------------------------------------------------------
// The pinned panel
// ---------------------------------------------------------------------------

export function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('🌏 Set your flag / timezone')
    .setDescription(
      'Tag your name so the supergroup can tell at a glance when you\'re likely online.\n\n' +
        'Pick a **country flag** or a **UTC offset**. Takes about ten seconds, and ' +
        'only you can see the setup.',
    )
    .setFooter({ text: 'Run this again any time to change it · /setup clear removes the tag' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:start`)
      .setLabel('Set my flag / timezone')
      .setEmoji('🌏')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/** Step 1 — flag or offset. `countryCode` pre-selects from /setup timezone. */
export function formatScreen(countryCode = null) {
  const cc = countryCode ?? '-';
  const country = countryCode ? getCountry(countryCode) : null;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:fmt:f:${cc}`)
      .setLabel('Country flag')
      .setEmoji('🏳️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:fmt:o:${cc}`)
      .setLabel('UTC offset')
      .setEmoji('🕐')
      .setStyle(ButtonStyle.Secondary),
  );

  const rows = [buttons];

  // Only offered when no country is pre-selected — it is the "I'd rather not
  // say where I am" path, so it skips the country picker entirely.
  if (!country) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:direct`)
          .setLabel('Skip the country list, just pick an offset')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('How would you like to be tagged?')
    .setDescription(
      country
        ? `Country: **${flagEmoji(country.code) ?? ''} ${country.name}**\n\n` +
            'Choose how it shows next to your name.'
        : 'Choose how your tag appears next to your name.',
    )
    .addFields(
      { name: '🏳️ Country flag', value: 'e.g. `Joewin 🇦🇺`\nNever goes stale.', inline: true },
      {
        name: '🕐 UTC offset',
        value: 'e.g. `Joewin [UTC+11]`\nDrifts with daylight saving.',
        inline: true,
      },
    );

  return { embeds: [embed], components: rows };
}

/** Step 2 — subregion. 22 of them, which fits the 25-option menu limit. */
function subregionScreen(f) {
  const options = getSubregions().map((name, index) => ({
    label: name,
    value: String(index),
    description: `${countryCount(name)} countries`,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:sub:${f}`)
    .setPlaceholder('Choose your region…')
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Where are you?')
    .setDescription('Pick your region, then your country.');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** Step 3 — country, paged because Discord allows only 25 options per menu. */
function countryScreen(f, subregionIndex, page) {
  const subregion = getSubregionByIndex(subregionIndex);
  if (!subregion) return subregionScreen(f);

  const { items, page: current, pages } = getCountryPage(subregion, page);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:cty:${f}:${subregionIndex}:${current}`)
    .setPlaceholder('Choose your country…')
    .addOptions(
      items.map((country) => ({
        label: `${flagEmoji(country.code) ?? ''} ${country.name}`.trim().slice(0, 100),
        value: country.code,
      })),
    );

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:pg:${f}:${subregionIndex}:${current - 1}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:pg:${f}:${subregionIndex}:${current + 1}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:back:${f}`)
      .setLabel('Back to regions')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(subregion)
    .setDescription(pages > 1 ? `Page ${current + 1} of ${pages}` : 'Pick your country.');

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), nav],
  };
}

/** Step 4 — only shown for countries that genuinely span several zones. */
function zoneScreen(f, country) {
  const now = new Date();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:zone:${f}:${country.code}`)
    .setPlaceholder('Which is closest to you?')
    .addOptions(
      country.zones.slice(0, 25).map((zone) => ({
        label: (zone.label ?? zone.id.split('/').pop().replace(/_/g, ' ')).slice(0, 100),
        value: zone.id,
        description: `${localTime(zone.id, now)} · ${formatOffset(offsetMinutesFor(zone.id, now))}`.slice(0, 100),
      })),
    );

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${flagEmoji(country.code) ?? ''} ${country.name}`.trim())
    .setDescription('This country has more than one timezone — pick the closest to you.\n*(Times shown are what it is there right now.)*');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** The escape hatch: a raw UTC offset, no country stored. */
function offsetScreen(page = 0) {
  const pages = Math.ceil(OFFSET_CHOICES.length / OFFSETS_PER_PAGE);
  const current = ((page % pages) + pages) % pages;
  const slice = OFFSET_CHOICES.slice(
    current * OFFSETS_PER_PAGE,
    current * OFFSETS_PER_PAGE + OFFSETS_PER_PAGE,
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:off:${current}`)
    .setPlaceholder('Choose your UTC offset…')
    .addOptions(slice.map((m) => ({ label: formatOffset(m), value: String(m) })));

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:offpg:${current - 1}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:offpg:${current + 1}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Pick your UTC offset')
    .setDescription(
      `Page ${current + 1} of ${pages}.\n\n` +
        '⚠️ A raw offset does **not** follow daylight saving — it will read an hour out ' +
        'for part of the year. Picking a country instead keeps it correct automatically.',
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), nav],
  };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/** The member object on an interaction may be uncached; make sure it can be edited. */
async function resolveMember(interaction) {
  const member = interaction.member;
  if (member && typeof member.setNickname === 'function') return member;
  return interaction.guild.members.fetch(interaction.user.id);
}

async function finish(interaction, tagType, selection) {
  const { countryCode = null, ianaTz = null, utcOffsetMinutes = null } = selection;

  let member;
  try {
    member = await resolveMember(interaction);
  } catch (error) {
    console.error('[timezone] could not resolve member', { user: interaction.user.id }, error);
    return updateInPlace(interaction, {
      content: '⚠️ I could not read your server profile. Please try again.',
      embeds: [],
      components: [],
    });
  }

  const stored = {
    tagType,
    countryCode,
    ianaTz,
    utcOffsetMinutes,
  };

  // Save BEFORE touching Discord, so the choice survives even when the rename
  // is refused (server owner, missing permission, role hierarchy).
  saveTimezone(interaction.guildId, interaction.user.id, {
    ...stored,
    displayName: currentDisplayName(member),
    baseNickname: baseNameOf(member),
  });

  const tag = buildTag(stored);
  const result = await applyNicknameTag(member, tag);
  const warning = explainOutcome(result);

  const embed = new EmbedBuilder()
    .setColor(warning ? 0xd4a017 : BRAND)
    .setTitle(warning ? '⚠️ Saved — but I could not rename you' : '✅ All set')
    .setDescription(
      warning
        ? warning
        : `You're now **${result.desired}**\n\n${describeTimezone(stored) ?? ''}`,
    )
    .setFooter({
      text: 'Run this again any time to change it · /setup clear removes the tag',
    });

  return updateInPlace(interaction, { embeds: [embed], components: [] });
}

/** Country chosen: skip the zone step entirely for single-zone countries. */
function afterCountry(interaction, f, country) {
  if (country.zones.length === 1) {
    return finish(interaction, tagTypeOf(f), {
      countryCode: country.code,
      ianaTz: country.zones[0].id,
    });
  }
  return updateInPlace(interaction, zoneScreen(f, country));
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Used by the panel button and by /setup timezone. */
export function startFlow(interaction, countryCode = null) {
  return replyEphemeral(interaction, formatScreen(countryCode));
}

/**
 * Routes any component interaction whose custom_id starts with `tz:`.
 * @returns {Promise<boolean>} false if the id was not ours
 */
export async function handle(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== PREFIX) return false;

  const [, action, a, b, c] = parts;

  switch (action) {
    case 'start':
      await replyEphemeral(interaction, formatScreen(null));
      return true;

    case 'fmt': {
      const f = a === 'f' ? 'f' : 'o';
      const country = b && b !== '-' ? getCountry(b) : null;
      if (country) await afterCountry(interaction, f, country);
      else await updateInPlace(interaction, subregionScreen(f));
      return true;
    }

    case 'direct':
      await updateInPlace(interaction, offsetScreen(0));
      return true;

    case 'back':
      await updateInPlace(interaction, subregionScreen(a === 'f' ? 'f' : 'o'));
      return true;

    case 'sub': {
      const f = a === 'f' ? 'f' : 'o';
      const index = Number(interaction.values?.[0] ?? -1);
      await updateInPlace(interaction, countryScreen(f, index, 0));
      return true;
    }

    case 'pg': {
      const f = a === 'f' ? 'f' : 'o';
      await updateInPlace(interaction, countryScreen(f, Number(b), Number(c)));
      return true;
    }

    case 'cty': {
      const f = a === 'f' ? 'f' : 'o';
      const country = getCountry(interaction.values?.[0]);
      if (!country) {
        await updateInPlace(interaction, subregionScreen(f));
        return true;
      }
      await afterCountry(interaction, f, country);
      return true;
    }

    case 'zone': {
      const f = a === 'f' ? 'f' : 'o';
      const country = getCountry(b);
      const zoneId = interaction.values?.[0];
      const zone = country?.zones.find((z) => z.id === zoneId);
      if (!country || !zone) {
        await updateInPlace(interaction, subregionScreen(f));
        return true;
      }
      await finish(interaction, tagTypeOf(f), {
        countryCode: country.code,
        ianaTz: zone.id,
      });
      return true;
    }

    case 'offpg':
      await updateInPlace(interaction, offsetScreen(Number(a)));
      return true;

    case 'off': {
      const minutes = Number(interaction.values?.[0]);
      if (!Number.isFinite(minutes)) {
        await updateInPlace(interaction, offsetScreen(0));
        return true;
      }
      await finish(interaction, 'offset', { utcOffsetMinutes: minutes });
      return true;
    }

    default:
      console.warn('[timezone] unrecognised custom_id', interaction.customId);
      return false;
  }
}
