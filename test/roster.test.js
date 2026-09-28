import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { rmSync } from 'node:fs';

import { closeDb, getDb, initDb } from '../src/lib/db.js';
import {
  applyOwnershipPage,
  countOwned,
  countOwnedForAll,
  getDetailedHeroes,
  getHeroEntry,
  getOwnedHeroIds,
  getPrimaryMainProgress,
  upsertHero,
  whoOwns,
} from '../src/lib/data/roster.js';
import { setMains } from '../src/lib/data/mains.js';

const DB = './data/_test_roster.db';
const S1 = '111111111111111111';
const S2 = '222222222222222222';
const ADAM = '999999999999999999';
const PRIYA = '888888888888888888';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB}${suffix}`, { force: true });
}

describe('roster data access', () => {
  before(() => {
    cleanup();
    initDb(DB);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM roster; DELETE FROM mains;');
  });

  after(() => {
    closeDb();
    cleanup();
  });

  describe('applyOwnershipPage', () => {
    it('marks ticked heroes owned and un-ticked ones not owned', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk', 'storm'], ['thor', 'storm']);

      assert.deepEqual([...getOwnedHeroIds(S1, ADAM)].sort(), ['storm', 'thor']);
      assert.equal(getHeroEntry(S1, ADAM, 'hulk').owned, false);
    });

    // THE critical behaviour: /myheroes pages through 63 heroes 25 at a time,
    // and Discord only reports what is ticked on the current page. If the write
    // were not page-scoped, saving page 2 would wipe page 1.
    it('only touches heroes on the page it was given', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], ['thor', 'hulk']);
      applyOwnershipPage(S1, ADAM, ['storm', 'venom'], ['storm']);

      const owned = getOwnedHeroIds(S1, ADAM);
      assert.ok(owned.has('thor'), 'page 1 selection was wiped by page 2');
      assert.ok(owned.has('hulk'), 'page 1 selection was wiped by page 2');
      assert.ok(owned.has('storm'));
      assert.ok(!owned.has('venom'));
    });

    it('returns the running total', () => {
      assert.equal(applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], ['thor', 'hulk']), 2);
      assert.equal(applyOwnershipPage(S1, ADAM, ['storm'], ['storm']), 3);
    });

    it('handles an empty page selection', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], ['thor', 'hulk']);
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], []);
      assert.equal(countOwned(S1, ADAM), 0);
    });

    // An accidental un-tick should not destroy recorded progress.
    it('keeps level and prestige when a hero is un-ticked', () => {
      upsertHero(S1, ADAM, 'thor', { level: 60, prestige: 4 });
      applyOwnershipPage(S1, ADAM, ['thor'], []);

      const entry = getHeroEntry(S1, ADAM, 'thor');
      assert.equal(entry.owned, false);
      assert.equal(entry.level, 60, 'progress was destroyed by an un-tick');
      assert.equal(entry.prestige, 4);
    });
  });

  describe('upsertHero', () => {
    it('records level and prestige', () => {
      const entry = upsertHero(S1, ADAM, 'thor', { level: 42, prestige: 3 });
      assert.equal(entry.level, 42);
      assert.equal(entry.prestige, 3);
      assert.equal(entry.owned, true, 'recording progress implies ownership');
    });

    it('leaves untouched fields alone', () => {
      upsertHero(S1, ADAM, 'thor', { level: 42, prestige: 3 });
      upsertHero(S1, ADAM, 'thor', { level: 7 });

      const entry = getHeroEntry(S1, ADAM, 'thor');
      assert.equal(entry.level, 7, 'level should update');
      assert.equal(entry.prestige, 3, 'prestige should survive a level-only update');
    });

    // A hero at prestige 4 level 3 is a fresh prestige, not a typo.
    it('accepts a high prestige with a low level', () => {
      const entry = upsertHero(S1, ADAM, 'thor', { level: 3, prestige: 6 });
      assert.equal(entry.level, 3);
      assert.equal(entry.prestige, 6);
    });

    it('returns null for a hero never recorded', () => {
      assert.equal(getHeroEntry(S1, ADAM, 'thor'), null);
    });
  });

  describe('counts and isolation', () => {
    it('counts only owned heroes', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk', 'storm'], ['thor', 'hulk']);
      assert.equal(countOwned(S1, ADAM), 2);
    });

    it('keeps supergroups separate', () => {
      applyOwnershipPage(S1, ADAM, ['thor'], ['thor']);
      applyOwnershipPage(S2, ADAM, ['hulk', 'storm'], ['hulk', 'storm']);

      assert.equal(countOwned(S1, ADAM), 1);
      assert.equal(countOwned(S2, ADAM), 2);
    });

    it('counts everyone in one query for /sgroster', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], ['thor', 'hulk']);
      applyOwnershipPage(S1, PRIYA, ['storm'], ['storm']);
      applyOwnershipPage(S2, ADAM, ['venom'], ['venom']);

      const counts = countOwnedForAll(S1);
      assert.equal(counts.get(ADAM), 2);
      assert.equal(counts.get(PRIYA), 1);
      assert.equal(counts.size, 2, 'must not leak the other supergroup');
    });
  });

  describe('ordering by progress', () => {
    it('sorts detailed heroes by prestige then level', () => {
      upsertHero(S1, ADAM, 'thor', { level: 60, prestige: 0 });
      upsertHero(S1, ADAM, 'hulk', { level: 5, prestige: 6 });
      upsertHero(S1, ADAM, 'storm', { level: 55, prestige: 3 });

      assert.deepEqual(
        getDetailedHeroes(S1, ADAM).map((e) => e.heroId),
        ['hulk', 'storm', 'thor'],
        'a fresh Cosmic hero outranks a maxed White one',
      );
    });

    it('excludes heroes with no progress recorded', () => {
      applyOwnershipPage(S1, ADAM, ['thor', 'hulk'], ['thor', 'hulk']);
      upsertHero(S1, ADAM, 'thor', { level: 30 });

      assert.deepEqual(
        getDetailedHeroes(S1, ADAM).map((e) => e.heroId),
        ['thor'],
      );
    });

    it('orders /whohas by progress', () => {
      upsertHero(S1, ADAM, 'hulk', { level: 60, prestige: 1 });
      upsertHero(S1, PRIYA, 'hulk', { level: 2, prestige: 5 });

      const owners = whoOwns(S1, 'hulk');
      assert.equal(owners.length, 2);
      assert.equal(owners[0].discord_id, PRIYA, 'higher prestige should come first');
    });

    it('omits un-owned heroes from /whohas', () => {
      upsertHero(S1, ADAM, 'hulk', { level: 60 });
      applyOwnershipPage(S1, ADAM, ['hulk'], []);
      assert.deepEqual(whoOwns(S1, 'hulk'), []);
    });
  });

  describe('getPrimaryMainProgress', () => {
    it('joins each primary main to its recorded progress', () => {
      setMains(S1, ADAM, ['thor', 'hulk']);
      upsertHero(S1, ADAM, 'thor', { level: 60, prestige: 6 });

      const map = getPrimaryMainProgress(S1);
      assert.equal(map.get(ADAM).heroId, 'thor');
      assert.equal(map.get(ADAM).level, 60);
      assert.equal(map.get(ADAM).prestige, 6);
    });

    // A main is usually set before any level is recorded; those members still
    // belong in the roster, just without a level beside their hero.
    it('still returns the main when no progress exists', () => {
      setMains(S1, PRIYA, ['storm']);

      const row = getPrimaryMainProgress(S1).get(PRIYA);
      assert.equal(row.heroId, 'storm');
      assert.equal(row.level, null);
      assert.equal(row.prestige, null);
    });

    it('ignores slots 2 and 3', () => {
      setMains(S1, ADAM, ['thor', 'hulk', 'storm']);
      assert.equal(getPrimaryMainProgress(S1).get(ADAM).heroId, 'thor');
    });
  });
});
