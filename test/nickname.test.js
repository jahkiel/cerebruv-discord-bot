import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyTag, hasTag, measure, stripTag, truncateToBudget } from '../src/lib/nickname.js';

const AU = '🇦🇺';
const IN = '🇮🇳';

describe('stripTag', () => {
  it('removes a trailing flag', () => {
    assert.equal(stripTag(`Joewin ${AU}`), 'Joewin');
  });

  it('removes a trailing UTC offset', () => {
    assert.equal(stripTag('Joewin [UTC+10]'), 'Joewin');
    assert.equal(stripTag('Joewin [UTC-3:30]'), 'Joewin');
    assert.equal(stripTag('Joewin [UTC+0]'), 'Joewin');
  });

  it('removes stacked tags left by an older version', () => {
    assert.equal(stripTag(`Joewin ${AU} [UTC+10]`), 'Joewin');
    assert.equal(stripTag(`Joewin [UTC+10] ${AU}`), 'Joewin');
    assert.equal(stripTag(`Joewin ${AU}${IN}`), 'Joewin');
  });

  it('leaves an untagged name alone', () => {
    assert.equal(stripTag('Joewin'), 'Joewin');
    assert.equal(stripTag('Adam A'), 'Adam A');
  });

  it('preserves the member\'s own edits to the base name', () => {
    assert.equal(stripTag(`Joewin (Cap main) ${AU}`), 'Joewin (Cap main)');
  });

  it('does not strip a flag that is not at the end', () => {
    assert.equal(stripTag(`${AU} Joewin`), `${AU} Joewin`);
  });

  it('handles empty and nullish input', () => {
    assert.equal(stripTag(''), '');
    assert.equal(stripTag(null), '');
    assert.equal(stripTag(undefined), '');
  });
});

describe('hasTag', () => {
  it('detects both tag styles', () => {
    assert.equal(hasTag(`Joewin ${AU}`), true);
    assert.equal(hasTag('Joewin [UTC+10]'), true);
    assert.equal(hasTag('Joewin'), false);
  });
});

describe('measure', () => {
  // Measured against the live Discord API on 2026-09-27: the nickname limit is
  // 32 CODE POINTS, not 32 UTF-16 units. A flag costs 2, not 4.
  it('counts code points, not UTF-16 units', () => {
    assert.equal(measure('Joewin'), 6);
    assert.equal(measure(AU), 2, 'a flag is 2 code points');
    assert.equal(AU.length, 4, 'but 4 UTF-16 units — this is the trap');
    assert.equal(measure(`${'A'.repeat(30)}${AU}`), 32, 'the exact string Discord accepted');
  });

  it('handles nullish input', () => {
    assert.equal(measure(null), 0);
    assert.equal(measure(''), 0);
  });
});

describe('truncateToBudget', () => {
  it('leaves short strings untouched', () => {
    assert.equal(truncateToBudget('Joewin', 32), 'Joewin');
  });

  it('never splits a surrogate pair', () => {
    // 'ab' is 2 code points, the flag is 2 more — 4 total will not fit in 3.
    const result = truncateToBudget(`ab${AU}`, 3);
    assert.equal(result, 'ab');
    assert.ok(!/[\uD800-\uDFFF]/.test(result), 'left a lone surrogate behind');
  });

  it('keeps a whole emoji when it fits exactly', () => {
    assert.equal(truncateToBudget(`ab${AU}`, 4), `ab${AU}`);
  });

  it('returns empty for a non-positive budget', () => {
    assert.equal(truncateToBudget('Joewin', 0), '');
    assert.equal(truncateToBudget('Joewin', -5), '');
  });
});

describe('applyTag', () => {
  it('appends a flag to a clean name', () => {
    assert.equal(applyTag('Joewin', AU), `Joewin ${AU}`);
  });

  it('REPLACES an existing tag rather than stacking', () => {
    assert.equal(applyTag(`Joewin ${AU}`, '[UTC+11]'), 'Joewin [UTC+11]');
    assert.equal(applyTag('Joewin [UTC+11]', AU), `Joewin ${AU}`);
  });

  it('is idempotent — re-running produces the same name', () => {
    const once = applyTag('Joewin', AU);
    assert.equal(applyTag(once, AU), once);
    assert.equal(applyTag(applyTag(once, AU), AU), once);
  });

  it('keeps a manual edit to the base name (the scenario from the build plan)', () => {
    assert.equal(
      applyTag('Joewin (Cap main) [UTC+11]', AU),
      `Joewin (Cap main) ${AU}`,
    );
  });

  it('truncates the BASE NAME, never the tag', () => {
    const long = 'Joewin The Extremely Verbose Hero Of Sydney';
    const result = applyTag(long, AU, 32);

    assert.ok(measure(result) <= 32, `got ${measure(result)} code points: ${result}`);
    assert.ok(result.endsWith(AU), 'the tag was truncated');
    assert.ok(result.startsWith('Joewin'), 'the base was not preserved from the left');
  });

  it('respects the 32-character limit with an offset tag', () => {
    const result = applyTag('A'.repeat(40), '[UTC+5:45]', 32);
    assert.ok(measure(result) <= 32);
    assert.ok(result.endsWith('[UTC+5:45]'));
  });

  // The whole point of the code-point fix: a flag leaves 29 characters for the
  // name, not 27. Measuring in UTF-16 would silently cost members two letters.
  it('gives the base name the full 29 characters a flag leaves free', () => {
    const result = applyTag('A'.repeat(40), AU, 32);

    assert.equal(measure(result), 32, 'should use the whole budget');
    assert.equal(result, `${'A'.repeat(29)} ${AU}`);
    assert.ok(result.length > 32, 'and it exceeds 32 UTF-16 units, which is fine');
  });

  it('matches the exact string the live API accepted', () => {
    const result = applyTag('A'.repeat(29), AU, 32);
    assert.equal(measure(result), 32);
  });

  it('strips the tag when given a null tag', () => {
    assert.equal(applyTag(`Joewin ${AU}`, null), 'Joewin');
    assert.equal(applyTag('Joewin [UTC+10]', ''), 'Joewin');
  });

  it('falls back to the tag alone when the base cannot fit', () => {
    const result = applyTag('', AU, 32);
    assert.equal(result, AU);
  });
});
