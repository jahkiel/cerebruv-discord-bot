import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  compareProgress,
  describeProgress,
  isValidLevel,
  isValidPrestige,
  levelCap,
  loadGame,
  maxPrestige,
  prestigeEmoji,
  prestigeName,
  prestigeTier,
  prestigeTiers,
} from '../src/lib/game.js';

describe('game.json', () => {
  let result;
  before(() => {
    result = loadGame();
  });

  it('loads cleanly', () => {
    assert.deepEqual(result.problems, [], result.problems.join('\n'));
    assert.equal(result.applied, true);
  });

  // Confirmed first-hand by Joewin from the T.A.H.I.T.I. server, 2026-09-27.
  it('matches the rules confirmed in game', () => {
    assert.equal(levelCap(), 60);
    assert.equal(maxPrestige(), 6, 'seven tiers, 0-6');
    assert.deepEqual(
      prestigeTiers().map((t) => t.name),
      ['White', 'Green', 'Blue', 'Purple', 'Orange', 'Red', 'Cosmic'],
    );
  });

  it('keeps tier values aligned with their index', () => {
    prestigeTiers().forEach((tier, index) => assert.equal(tier.value, index));
  });

  it('gives every tier an emoji for the roster views', () => {
    for (const tier of prestigeTiers()) {
      assert.ok(tier.emoji, `${tier.name} has no emoji`);
    }
    assert.equal(prestigeEmoji(0), '⚪');
    assert.equal(prestigeEmoji(6), '🟡');
    assert.equal(prestigeName(6), 'Cosmic');
  });

  it('falls back to tier 0 for an unknown prestige', () => {
    assert.equal(prestigeEmoji(99), '⚪');
    assert.equal(prestigeEmoji(null), '⚪');
    assert.equal(prestigeTier(99), null);
  });
});

describe('validation', () => {
  before(() => loadGame());

  it('accepts levels within the cap', () => {
    assert.equal(isValidLevel(1), true);
    assert.equal(isValidLevel(60), true);
    assert.equal(isValidLevel(37), true);
  });

  it('rejects levels outside it', () => {
    assert.equal(isValidLevel(0), false);
    assert.equal(isValidLevel(61), false);
    assert.equal(isValidLevel(-5), false);
    assert.equal(isValidLevel(1.5), false);
    assert.equal(isValidLevel('60'), false);
    assert.equal(isValidLevel(null), false);
  });

  it('accepts every real prestige tier', () => {
    for (let i = 0; i <= 6; i += 1) assert.equal(isValidPrestige(i), true);
  });

  it('rejects prestige outside the tier list', () => {
    assert.equal(isValidPrestige(7), false);
    assert.equal(isValidPrestige(-1), false);
    assert.equal(isValidPrestige(null), false);
  });
});

describe('compareProgress', () => {
  before(() => loadGame());

  // The whole reason this function exists. Prestiging resets you to level 1,
  // so raw level comparison ranks a fresh Cosmic hero below a maxed White one.
  it('ranks prestige above level', () => {
    const freshCosmic = { prestige: 6, level: 1 };
    const maxedWhite = { prestige: 0, level: 60 };

    assert.ok(compareProgress(freshCosmic, maxedWhite) > 0, 'Cosmic Lv1 beats White Lv60');
    assert.ok(compareProgress(maxedWhite, freshCosmic) < 0);
  });

  it('falls back to level within the same prestige', () => {
    assert.ok(compareProgress({ prestige: 2, level: 40 }, { prestige: 2, level: 12 }) > 0);
    assert.equal(compareProgress({ prestige: 2, level: 40 }, { prestige: 2, level: 40 }), 0);
  });

  it('treats missing values as zero', () => {
    assert.ok(compareProgress({ prestige: 1 }, {}) > 0);
    assert.equal(compareProgress({}, {}), 0);
    assert.equal(compareProgress(null, null), 0);
  });

  it('sorts a mixed list the way the roster should show it', () => {
    const heroes = [
      { name: 'a', prestige: 0, level: 60 },
      { name: 'b', prestige: 3, level: 5 },
      { name: 'c', prestige: 6, level: 1 },
      { name: 'd', prestige: 3, level: 55 },
    ];
    const order = [...heroes].sort((x, y) => compareProgress(y, x)).map((h) => h.name);
    assert.deepEqual(order, ['c', 'd', 'b', 'a']);
  });
});

describe('describeProgress', () => {
  before(() => loadGame());

  it('shows the colour and level compactly', () => {
    assert.equal(describeProgress({ prestige: 6, level: 60 }), '🟡 Lv 60');
    assert.equal(describeProgress({ prestige: 0, level: 12 }), '⚪ Lv 12');
  });

  it('names the tier when verbose', () => {
    assert.equal(describeProgress({ prestige: 6, level: 60 }, { verbose: true }), '🟡 Cosmic · Lv 60');
  });

  it('copes with prestige but no level, and vice versa', () => {
    assert.equal(describeProgress({ prestige: 3 }), '🟣');
    assert.equal(describeProgress({ level: 22 }), '⚪ Lv 22');
  });

  it('returns null when nothing has been recorded', () => {
    assert.equal(describeProgress({}), null);
    assert.equal(describeProgress(), null);
  });
});
