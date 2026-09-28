import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asOddsPercent, asPercent, boxOdds } from '../src/lib/boxodds.js';
import { allHeroes, loadHeroes } from '../src/lib/heroes.js';
import { loadGame, randomBoxExcludes } from '../src/lib/game.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );

describe('the box pool', () => {
  it('is 58 heroes, not 63', () => {
    loadHeroes();
    loadGame();

    const excluded = new Set(randomBoxExcludes());
    const pool = allHeroes().filter((h) => !excluded.has(h.id));

    assert.equal(allHeroes().length, 63, 'playable roster');
    assert.equal(pool.length, 58, 'box pool excludes the Fantastic Four and Silver Surfer');
  });

  it('excludes exactly the five delisted heroes', () => {
    loadGame();
    assert.deepEqual(
      [...randomBoxExcludes()].sort(),
      ['human_torch', 'invisible_woman', 'mister_fantastic', 'silver_surfer', 'thing'],
    );
  });
});

describe('boxOdds — a single box', () => {
  it('splits new versus duplicate correctly', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 29 });
    close(odds.pNew, 0.5);
    close(odds.pDuplicate, 0.5);
    assert.equal(odds.missing, 29);
  });

  it('is certain when you own nothing', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 0 });
    close(odds.pNew, 1);
    close(odds.pDuplicate, 0);
  });

  // The mechanic people get wrong: boxes are drawn with replacement, so owning
  // 57 of 58 still means a 98.3% chance of a duplicate.
  it('is nearly hopeless when you own almost everything', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 57 });
    close(odds.pNew, 1 / 58);
    close(odds.pDuplicate, 57 / 58);
    close(odds.boxesPerNew, 58);
  });

  it('flags a complete pool instead of dividing by zero', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 58 });
    assert.equal(odds.complete, true);
    assert.equal(odds.missing, 0);
    assert.equal(odds.pNew, 0);
    assert.equal(odds.boxesPerNew, null, 'no sensible "boxes per new" when none are left');
  });

  it('always sums new and duplicate to 1', () => {
    for (let owned = 0; owned <= 58; owned += 1) {
      const odds = boxOdds({ poolSize: 58, ownedInPool: owned });
      close(odds.pNew + odds.pDuplicate, 1);
    }
  });
});

describe('boxOdds — several boxes', () => {
  it('compounds "at least one new" across draws', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 29, boxes: 2 });
    close(odds.pAtLeastOneNew, 1 - 0.5 ** 2); // 0.75
  });

  it('matches the single-box case when boxes is 1', () => {
    const one = boxOdds({ poolSize: 58, ownedInPool: 40, boxes: 1 });
    close(one.pAtLeastOneNew, one.pNew);
    close(one.expectedNew, one.pNew);
  });

  // Expected DISTINCT new heroes, not boxes × pNew — the naive version
  // double-counts pulling the same new hero twice.
  it('counts distinct new heroes, never more than are missing', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 56, boxes: 500 });
    assert.ok(odds.expectedNew <= odds.missing, 'cannot expect more than exist');
    assert.ok(odds.expectedNew > 1.9, 'with 500 boxes both should be near certain');
  });

  it('stays below the naive boxes × pNew figure', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 50, boxes: 50 });
    const naive = 50 * odds.pNew;
    assert.ok(
      odds.expectedNew < naive,
      `expected ${odds.expectedNew} to be below the double-counting figure ${naive}`,
    );
  });

  it('approaches certainty with many boxes but never claims 100%', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 57, boxes: 1000 });
    assert.ok(odds.pAtLeastOneNew > 0.9999);
    assert.ok(odds.pAtLeastOneNew < 1, 'with replacement it is never a guarantee');
  });

  it('gives nothing when the pool is complete, however many boxes', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 58, boxes: 500 });
    assert.equal(odds.pAtLeastOneNew, 0);
    assert.equal(odds.expectedNew, 0);
  });
});

describe('boxOdds — bad input', () => {
  it('clamps ownership to the pool size', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 999 });
    assert.equal(odds.ownedInPool, 58);
    assert.equal(odds.missing, 0);
  });

  it('treats negatives and junk as zero', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: -5 });
    assert.equal(odds.ownedInPool, 0);
    assert.equal(boxOdds({ poolSize: 58, ownedInPool: NaN }).ownedInPool, 0);
  });

  it('never allows fewer than one box', () => {
    assert.equal(boxOdds({ poolSize: 58, ownedInPool: 1, boxes: 0 }).boxes, 1);
    assert.equal(boxOdds({ poolSize: 58, ownedInPool: 1, boxes: -3 }).boxes, 1);
  });

  it('survives an empty pool', () => {
    const odds = boxOdds({ poolSize: 0, ownedInPool: 0 });
    assert.equal(odds.complete, true);
    assert.equal(odds.pNew, 0);
  });
});

describe('percentage formatting', () => {
  it('formats ordinary odds to one decimal', () => {
    assert.equal(asPercent(0.5), '50.0%');
    assert.equal(asOddsPercent(0.4138), '41.4%');
  });

  // "100.0%" would read as a guarantee when it is not one.
  it('never rounds a real chance up to 100%', () => {
    const odds = boxOdds({ poolSize: 58, ownedInPool: 57, boxes: 1000 });
    assert.equal(asOddsPercent(odds.pAtLeastOneNew), '>99.99%');
  });

  it('never rounds a real chance down to 0%', () => {
    assert.equal(asOddsPercent(0.000005), '<0.01%');
  });

  it('shows exact certainty plainly', () => {
    assert.equal(asOddsPercent(1), '100.00%');
    assert.equal(asOddsPercent(0), '0.00%');
  });
});
