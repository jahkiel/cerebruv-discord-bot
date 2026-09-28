import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OFFSET_CHOICES,
  buildTag,
  describeTimezone,
  flagEmoji,
  formatOffset,
  isValidTimeZone,
  localTime,
  offsetMinutesFor,
} from '../src/lib/timezones.js';

// Fixed instants so these tests do not drift with the clock or the seasons.
const JANUARY = new Date('2026-01-15T00:00:00Z'); // southern summer
const JULY = new Date('2026-07-15T00:00:00Z'); // northern summer

describe('flagEmoji', () => {
  it('derives a flag from an ISO code', () => {
    assert.equal(flagEmoji('AU'), '🇦🇺');
    assert.equal(flagEmoji('IN'), '🇮🇳');
    assert.equal(flagEmoji('US'), '🇺🇸');
  });

  it('accepts lowercase', () => {
    assert.equal(flagEmoji('au'), '🇦🇺');
  });

  it('rejects anything that is not two letters', () => {
    assert.equal(flagEmoji('AUS'), null);
    assert.equal(flagEmoji('A'), null);
    assert.equal(flagEmoji('12'), null);
    assert.equal(flagEmoji(''), null);
    assert.equal(flagEmoji(null), null);
  });
});

describe('formatOffset', () => {
  it('omits :00 for whole hours', () => {
    assert.equal(formatOffset(600), 'UTC+10');
    assert.equal(formatOffset(0), 'UTC+0');
    assert.equal(formatOffset(-480), 'UTC-8');
  });

  it('formats half and quarter hours', () => {
    assert.equal(formatOffset(330), 'UTC+5:30');
    assert.equal(formatOffset(345), 'UTC+5:45');
    assert.equal(formatOffset(570), 'UTC+9:30');
    assert.equal(formatOffset(-210), 'UTC-3:30');
  });

  it('handles the extremes', () => {
    assert.equal(formatOffset(-720), 'UTC-12');
    assert.equal(formatOffset(840), 'UTC+14');
  });
});

describe('offsetMinutesFor', () => {
  it('tracks daylight saving in the southern hemisphere', () => {
    assert.equal(offsetMinutesFor('Australia/Sydney', JANUARY), 660); // +11 summer
    assert.equal(offsetMinutesFor('Australia/Sydney', JULY), 600); //  +10 winter
  });

  it('tracks daylight saving in the northern hemisphere', () => {
    assert.equal(offsetMinutesFor('America/New_York', JANUARY), -300); // -5
    assert.equal(offsetMinutesFor('America/New_York', JULY), -240); //  -4
  });

  it('is stable for zones without daylight saving', () => {
    assert.equal(offsetMinutesFor('Asia/Kolkata', JANUARY), 330);
    assert.equal(offsetMinutesFor('Asia/Kolkata', JULY), 330);
    assert.equal(offsetMinutesFor('Australia/Brisbane', JANUARY), 600);
    assert.equal(offsetMinutesFor('Australia/Brisbane', JULY), 600);
  });

  it('handles UTC itself', () => {
    assert.equal(offsetMinutesFor('UTC', JANUARY), 0);
  });

  it('handles a quarter-hour zone', () => {
    assert.equal(offsetMinutesFor('Asia/Kathmandu', JANUARY), 345);
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones', () => {
    assert.equal(isValidTimeZone('Australia/Sydney'), true);
    assert.equal(isValidTimeZone('Europe/Kyiv'), true);
    assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  });

  it('rejects nonsense', () => {
    assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone(null), false);
  });
});

describe('buildTag', () => {
  it('builds a flag tag from the country code', () => {
    assert.equal(buildTag({ tagType: 'flag', countryCode: 'AU' }), '🇦🇺');
  });

  it('builds an offset tag that follows daylight saving', () => {
    const user = { tagType: 'offset', ianaTz: 'Australia/Sydney' };
    assert.equal(buildTag(user, JANUARY), '[UTC+11]');
    assert.equal(buildTag(user, JULY), '[UTC+10]');
  });

  it('prefers the IANA zone over a stored raw offset', () => {
    const user = { tagType: 'offset', ianaTz: 'Australia/Sydney', utcOffsetMinutes: 0 };
    assert.equal(buildTag(user, JANUARY), '[UTC+11]');
  });

  it('falls back to the raw offset when no zone was stored', () => {
    assert.equal(
      buildTag({ tagType: 'offset', ianaTz: null, utcOffsetMinutes: 345 }),
      '[UTC+5:45]',
    );
  });

  it('returns null when there is nothing to show', () => {
    assert.equal(buildTag({ tagType: null }), null);
    assert.equal(buildTag(null), null);
    assert.equal(buildTag({ tagType: 'flag', countryCode: null }), null);
  });

  it('produces a tag that stripTag can remove', async () => {
    const { stripTag } = await import('../src/lib/nickname.js');
    for (const user of [
      { tagType: 'flag', countryCode: 'AU' },
      { tagType: 'offset', ianaTz: 'Asia/Kathmandu' },
      { tagType: 'offset', utcOffsetMinutes: -210 },
      { tagType: 'offset', utcOffsetMinutes: 0 },
    ]) {
      const tag = buildTag(user, JANUARY);
      assert.equal(stripTag(`Joewin ${tag}`), 'Joewin', `round-trip failed for ${tag}`);
    }
  });
});

describe('localTime and describeTimezone', () => {
  it('formats a wall-clock time', () => {
    assert.match(localTime('Australia/Sydney', JANUARY), /^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it('returns null for an invalid zone', () => {
    assert.equal(localTime('Nowhere/Nothing'), null);
  });

  it('summarises a zone-backed user', () => {
    const text = describeTimezone(
      { tagType: 'flag', countryCode: 'AU', ianaTz: 'Australia/Sydney' },
      JANUARY,
    );
    assert.ok(text.includes('🇦🇺'));
    assert.ok(text.includes('Sydney'));
    assert.ok(text.includes('UTC+11'));
  });

  it('summarises an offset-only user', () => {
    const text = describeTimezone({ tagType: 'offset', utcOffsetMinutes: 600 });
    assert.equal(text, 'UTC+10');
  });
});

describe('OFFSET_CHOICES', () => {
  it('covers the real-world range without duplicates', () => {
    assert.equal(new Set(OFFSET_CHOICES).size, OFFSET_CHOICES.length);
    assert.equal(Math.min(...OFFSET_CHOICES), -720);
    assert.equal(Math.max(...OFFSET_CHOICES), 840);
  });

  it('includes the half and quarter hour offsets', () => {
    for (const minutes of [330, 345, 570, 765, -210]) {
      assert.ok(OFFSET_CHOICES.includes(minutes), `missing ${formatOffset(minutes)}`);
    }
  });

  it('is sorted, so the paged picker reads sensibly', () => {
    const sorted = [...OFFSET_CHOICES].sort((a, b) => a - b);
    assert.deepEqual(OFFSET_CHOICES, sorted);
  });
});
