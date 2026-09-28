/**
 * Shared embed helpers.
 *
 * The important one is memberLabel: `display_name_cache` holds the member's
 * NICKNAME, which already ends in the flag/offset tag Cerebruv appended. Naive
 * rendering produces "🇦🇺 Jahkiel 🇦🇺". Every view that shows a member name must
 * strip the tag before adding the flag back deliberately.
 */

import { stripTag } from './nickname.js';
import { flagEmoji } from './timezones.js';

/**
 * The member's name with any flag/offset tag removed.
 *
 * @param {object|null} stored   row from lib/data/users.js
 * @param {object|null} fallback discord.js User, when there is no stored row
 */
export function memberName(stored, fallback = null) {
  const raw =
    stored?.displayName ?? fallback?.displayName ?? fallback?.username ?? fallback?.id ?? 'Unknown';
  return stripTag(raw) || raw;
}

/**
 * Name prefixed with their country flag, with no duplication.
 * e.g. "🇦🇺 Jahkiel"
 */
export function memberLabel(stored, fallback = null) {
  const flag = stored?.countryCode ? flagEmoji(stored.countryCode) : null;
  return [flag, memberName(stored, fallback)].filter(Boolean).join(' ');
}
