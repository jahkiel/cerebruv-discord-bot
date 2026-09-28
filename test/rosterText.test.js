import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { rosterLines, toBlocks } from '../src/interactions/rosterText.js';
import { parseRosterPaste } from '../src/lib/bulkparse.js';
import { allHeroes, loadHeroes } from '../src/lib/heroes.js';
import { loadGame } from '../src/lib/game.js';

const entry = (heroId, level = null, prestige = null, owned = true) => ({
  heroId,
  owned,
  level,
  prestige,
});

describe('rosterLines', () => {
  before(() => {
    loadHeroes();
    loadGame();
  });

  it('writes name, level and prestige', () => {
    assert.deepEqual(rosterLines([entry('wolverine', 60, 6)]), ['Wolverine 60 6']);
  });

  it('omits prestige when only a level is recorded', () => {
    assert.deepEqual(rosterLines([entry('thor', 60)]), ['Thor 60']);
  });

  // "Storm 3" would read back as level 3, so a prestige without a level has to
  // be tagged.
  it('tags a prestige that has no level', () => {
    assert.deepEqual(rosterLines([entry('storm', null, 3)]), ['Storm P3']);
  });

  it('writes a bare name when nothing is recorded', () => {
    assert.deepEqual(rosterLines([entry('blade')]), ['Blade']);
  });

  it('skips heroes that are not owned', () => {
    assert.deepEqual(rosterLines([entry('thor', 60), entry('hulk', 40, 1, false)]), ['Thor 60']);
  });

  it('puts recorded heroes first, best progress leading', () => {
    const lines = rosterLines([
      entry('angela'),
      entry('thor', 60, 0),
      entry('hulk', 5, 6),
      entry('blade'),
    ]);

    assert.deepEqual(lines, ['Hulk 5 6', 'Thor 60 0', 'Angela', 'Blade']);
  });

  it('returns nothing for an empty roster', () => {
    assert.deepEqual(rosterLines([]), []);
  });
});

// The point of the feature: /roster -> copy -> edit -> /bulkupdate -> paste.
describe('round-trip through /bulkupdate', () => {
  before(() => {
    loadHeroes();
    loadGame();
  });

  it('re-imports its own output with no errors', () => {
    const original = [
      entry('wolverine', 60, 6),
      entry('doctor_strange', 60, 5),
      entry('spider_man', 44, 2),
      entry('x_23', 47),
      entry('storm', null, 3),
      entry('mister_fantastic', 12, 0),
      entry('blade'),
      entry('angela'),
    ];

    const text = rosterLines(original).join('\n');
    const parsed = parseRosterPaste(text);

    assert.deepEqual(parsed.errors, [], parsed.errors.map((e) => e.reason).join('; '));
    assert.equal(parsed.applied.length, original.length);

    // Every hero comes back with exactly the values it went out with.
    for (const source of original) {
      const back = parsed.applied.find((a) => a.heroId === source.heroId);
      assert.ok(back, `${source.heroId} did not survive the round trip`);
      assert.equal(back.level, source.level, `${source.heroId} level`);
      assert.equal(back.prestige, source.prestige, `${source.heroId} prestige`);
    }
  });

  it('survives a full 63-hero roster', () => {
    const everything = allHeroes().map((hero, index) =>
      entry(hero.id, (index % 60) + 1, index % 7),
    );

    const parsed = parseRosterPaste(rosterLines(everything).join('\n'));

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.applied.length, 63);
  });

  it('round-trips the awkward names', () => {
    const awkward = [
      entry('x_23', 47, 2),
      entry('spider_man', 60, 4),
      entry('she_hulk', 33),
      entry('star_lord', 60, 1),
      entry('mister_fantastic', 41),
      entry('captain_marvel', 55, 3),
      entry('doctor_strange', 60, 5),
    ];

    const parsed = parseRosterPaste(rosterLines(awkward).join('\n'));
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.applied.length, awkward.length);
  });
});

describe('toBlocks', () => {
  it('wraps a short list in one code block', () => {
    const blocks = toBlocks(['Thor 60', 'Storm 44']);

    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].startsWith('```'));
    assert.ok(blocks[0].includes('Thor 60'));
  });

  it('splits a long list so each block fits a Discord message', () => {
    const blocks = toBlocks(Array.from({ length: 300 }, (_, i) => `Hero Number ${i} 60 6`));

    assert.ok(blocks.length > 1, 'should have split');
    for (const block of blocks) {
      assert.ok(block.length < 2000, `block of ${block.length} exceeds the message limit`);
    }
  });

  it('loses no lines when splitting', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Hero Number ${i} 60 6`);
    const rejoined = toBlocks(lines)
      .join('\n')
      .replace(/```/g, '')
      .split('\n')
      .filter(Boolean);

    assert.deepEqual(rejoined, lines);
  });

  it('returns nothing for no lines', () => {
    assert.deepEqual(toBlocks([]), []);
  });
});
