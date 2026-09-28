/**
 * Random Hero Box probability. Pure maths — no Discord, no database.
 *
 * MECHANICS (from https://mhtahiti.com/mh-random/, the community calculator):
 *  - Every hero in the pool has an EQUAL chance.
 *  - The box draws from the WHOLE pool, including heroes you already own — a
 *    repeat gives a duplicate token rather than being re-rolled into something
 *    new. This is the detail that makes the odds worse than people expect.
 *  - The Fantastic Four and Silver Surfer are NOT in the pool, so it is 58
 *    heroes, not 63. See data/game.json `randomBoxExcludes`.
 *
 * Draws are independent and with replacement, which makes the single-box case
 * trivial and the multi-box case a straightforward application of linearity of
 * expectation rather than a coupon-collector simulation.
 */

/**
 * @param {object} input
 * @param {number} input.poolSize     heroes that can drop (58)
 * @param {number} input.ownedInPool  how many of those you already have
 * @param {number} [input.boxes]      how many boxes you plan to open
 */
export function boxOdds({ poolSize, ownedInPool, boxes = 1 }) {
  const pool = Math.max(0, Math.trunc(poolSize) || 0);
  const owned = Math.min(Math.max(0, Math.trunc(ownedInPool) || 0), pool);
  const count = Math.max(1, Math.trunc(boxes) || 1);
  const missing = pool - owned;

  if (pool === 0) {
    return {
      poolSize: 0,
      ownedInPool: 0,
      missing: 0,
      boxes: count,
      pNew: 0,
      pDuplicate: 0,
      pAtLeastOneNew: 0,
      expectedNew: 0,
      boxesPerNew: null,
      complete: true,
    };
  }

  const pNew = missing / pool;
  const pDuplicate = owned / pool;

  // Every draw is independent, so "at least one new" is the complement of
  // drawing a duplicate every single time.
  const pAtLeastOneNew = 1 - (owned / pool) ** count;

  // Linearity of expectation: each missing hero is absent from all `count`
  // draws with probability ((pool-1)/pool)^count, so it is obtained with the
  // complement. Summing over the missing heroes gives DISTINCT new heroes —
  // this is not just count × pNew, which would double-count duplicates of the
  // same new hero.
  const expectedNew = missing * (1 - ((pool - 1) / pool) ** count);

  return {
    poolSize: pool,
    ownedInPool: owned,
    missing,
    boxes: count,
    pNew,
    pDuplicate,
    pAtLeastOneNew,
    expectedNew,
    // Geometric distribution mean: how many boxes it takes on average to see
    // one new hero. Null when there is nothing left to find.
    boxesPerNew: missing === 0 ? null : 1 / pNew,
    complete: missing === 0,
  };
}

/** e.g. 0.4138 -> '41.4%' */
export function asPercent(value, decimals = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Percentages near certainty are more honest with more precision: "100.0%"
 * when there is still a real chance of missing out reads as a guarantee.
 */
export function asOddsPercent(value) {
  if (!Number.isFinite(value)) return '—';
  if (value > 0.9999 && value < 1) return '>99.99%';
  if (value < 0.0001 && value > 0) return '<0.01%';
  return asPercent(value, value > 0.99 || value < 0.01 ? 2 : 1);
}
