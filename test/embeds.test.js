import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { memberLabel, memberName } from '../src/lib/embeds.js';

const AU = '🇦🇺';

describe('memberName', () => {
  // display_name_cache stores the member's NICKNAME, which already ends in the
  // tag Cerebruv appended. Rendering it raw and then prepending the flag gave
  // "🇦🇺 Jahkiel 🇦🇺" — spotted in a live screenshot on 2026-09-27.
  it('strips the tag already baked into the cached nickname', () => {
    assert.equal(memberName({ displayName: `Jahkiel ${AU}` }), 'Jahkiel');
    assert.equal(memberName({ displayName: 'Jahkiel [UTC+10]' }), 'Jahkiel');
  });

  it('leaves an untagged name alone', () => {
    assert.equal(memberName({ displayName: 'Jahkiel' }), 'Jahkiel');
  });

  it('keeps the member\'s own edits to their name', () => {
    assert.equal(memberName({ displayName: `Jahkiel (Cap main) ${AU}` }), 'Jahkiel (Cap main)');
  });

  it('falls back to the Discord user when nothing is stored', () => {
    assert.equal(memberName(null, { displayName: 'Priya' }), 'Priya');
    assert.equal(memberName(null, { username: 'priya_x' }), 'priya_x');
    assert.equal(memberName(null, null), 'Unknown');
  });

  it('never returns empty for a name that is only a tag', () => {
    assert.equal(memberName({ displayName: AU }), AU);
  });
});

describe('memberLabel', () => {
  it('adds the flag exactly once', () => {
    const label = memberLabel({ displayName: `Jahkiel ${AU}`, countryCode: 'AU' });

    assert.equal(label, `${AU} Jahkiel`);
    assert.equal(label.split(AU).length - 1, 1, 'the flag appeared more than once');
  });

  it('adds a flag to a name that never had one', () => {
    assert.equal(memberLabel({ displayName: 'Priya', countryCode: 'IN' }), '🇮🇳 Priya');
  });

  it('omits the flag when no country is stored', () => {
    assert.equal(memberLabel({ displayName: 'Jahkiel' }), 'Jahkiel');
  });

  // Someone on the offset format still has a country stored, so they get a flag
  // in embeds even though their nickname shows [UTC+10].
  it('handles an offset-tagged member with a country', () => {
    assert.equal(memberLabel({ displayName: 'Kenji [UTC+9]', countryCode: 'JP' }), '🇯🇵 Kenji');
  });
});
