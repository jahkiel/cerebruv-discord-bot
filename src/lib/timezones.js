/**
 * Timezone and flag formatting. Pure — no I/O, no Discord types.
 * Everything is derived at call time from `Intl`, which is built into Node, so
 * there is no timezone package and no offset table to go stale.
 *
 * See test/timezones.test.js.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;
const ASCII_A = 65;

/**
 * Derives a flag emoji from an ISO 3166-1 alpha-2 code: 'AU' -> 🇦🇺.
 *
 * Deriving rather than storing removes an entire class of data-entry error
 * from data/countries.json.
 *
 * @param {string} countryCode
 * @returns {string | null} null if the code isn't two ASCII letters
 */
export function flagEmoji(countryCode) {
  if (typeof countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  const cc = countryCode.toUpperCase();
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + cc.charCodeAt(0) - ASCII_A,
    REGIONAL_INDICATOR_A + cc.charCodeAt(1) - ASCII_A,
  );
}

/** @param {string} timeZone IANA name, e.g. 'Australia/Sydney' */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone's offset from UTC *at a given moment*, so it is correct across
 * daylight saving transitions. This is the whole reason we store an IANA zone
 * rather than a fixed number.
 *
 * @param {string} timeZone
 * @param {Date} [at]
 * @returns {number} minutes east of UTC (Sydney in summer = 660)
 */
export function offsetMinutesFor(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);

  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';

  // 'GMT+11:00', 'GMT-03:30', or bare 'GMT' for UTC itself.
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/**
 * Formats minutes-east-of-UTC for display: 600 -> 'UTC+10', 345 -> 'UTC+5:45'.
 * Whole hours omit the ':00' to save nickname characters.
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatOffset(minutes) {
  const mins = Number(minutes) || 0;
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(rest).padStart(2, '0')}`;
}

/**
 * The member's current wall-clock time, e.g. '9:42 PM'.
 * @param {string} timeZone
 * @param {Date} [at]
 */
export function localTime(timeZone, at = new Date()) {
  if (!isValidTimeZone(timeZone)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
}

/**
 * Builds the nickname tag for a stored user row.
 *
 * `iana_tz` wins over `utc_offset_minutes` when both are present, because the
 * zone survives daylight saving and the raw offset does not.
 *
 * @param {{tagType: string|null, countryCode: string|null, ianaTz: string|null,
 *          utcOffsetMinutes: number|null}} user
 * @param {Date} [at]
 * @returns {string | null} e.g. '🇦🇺' or '[UTC+11]'
 */
export function buildTag(user, at = new Date()) {
  if (!user || !user.tagType) return null;

  if (user.tagType === 'flag') {
    return flagEmoji(user.countryCode);
  }

  if (user.tagType === 'offset') {
    const minutes = user.ianaTz && isValidTimeZone(user.ianaTz)
      ? offsetMinutesFor(user.ianaTz, at)
      : user.utcOffsetMinutes;
    if (minutes == null) return null;
    return `[${formatOffset(minutes)}]`;
  }

  return null;
}

/**
 * A one-line summary for embeds: '🇦🇺 Sydney · 9:42 PM (UTC+11)'.
 * Falls back gracefully when only a raw offset was stored.
 */
export function describeTimezone(user, at = new Date()) {
  if (!user) return null;
  const flag = user.countryCode ? flagEmoji(user.countryCode) : null;

  if (user.ianaTz && isValidTimeZone(user.ianaTz)) {
    const city = user.ianaTz.split('/').pop().replace(/_/g, ' ');
    const offset = formatOffset(offsetMinutesFor(user.ianaTz, at));
    return [flag, `${city} · ${localTime(user.ianaTz, at)} (${offset})`]
      .filter(Boolean)
      .join(' ');
  }

  if (user.utcOffsetMinutes != null) {
    return [flag, formatOffset(user.utcOffsetMinutes)].filter(Boolean).join(' ');
  }

  return flag;
}

/**
 * The real-world UTC offsets, including the half- and quarter-hour ones, for
 * the "pick an offset directly" path. Minutes east of UTC.
 */
export const OFFSET_CHOICES = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120,
  -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525,
  540, 570, 600, 630, 660, 720, 765, 780, 840,
];
