import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { rmSync } from 'node:fs';

import { closeDb, getDb, initDb } from '../src/lib/db.js';
import {
  clearMains,
  getMains,
  getPrimaryMain,
  getPrimaryMains,
  setMains,
  whoMains,
} from '../src/lib/data/mains.js';

const DB = './data/_test_mains.db';
const S1 = '111111111111111111';
const S2 = '222222222222222222';
const ADAM = '999999999999999999';
const PRIYA = '888888888888888888';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${DB}${suffix}`, { force: true });
  }
}

describe('mains data access', () => {
  before(() => {
    cleanup();
    initDb(DB);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM mains');
  });

  after(() => {
    closeDb();
    cleanup();
  });

  it('stores mains in priority order', () => {
    setMains(S1, ADAM, ['captain_america', 'thor', 'hulk']);
    assert.deepEqual(getMains(S1, ADAM), ['captain_america', 'thor', 'hulk']);
    assert.equal(getPrimaryMain(S1, ADAM), 'captain_america');
  });

  it('accepts a single main', () => {
    setMains(S1, ADAM, ['wolverine']);
    assert.deepEqual(getMains(S1, ADAM), ['wolverine']);
  });

  it('replaces the whole set, so three mains can drop to one', () => {
    setMains(S1, ADAM, ['captain_america', 'thor', 'hulk']);
    setMains(S1, ADAM, ['storm']);

    assert.deepEqual(getMains(S1, ADAM), ['storm'], 'stale slots must not linger');
    assert.equal(getPrimaryMain(S1, ADAM), 'storm');
  });

  it('reorders without duplicating', () => {
    setMains(S1, ADAM, ['thor', 'hulk']);
    setMains(S1, ADAM, ['hulk', 'thor']);
    assert.deepEqual(getMains(S1, ADAM), ['hulk', 'thor']);
  });

  it('never stores more than three', () => {
    setMains(S1, ADAM, ['thor', 'hulk', 'storm', 'venom', 'blade']);
    assert.equal(getMains(S1, ADAM).length, 3);
  });

  it('keeps supergroups isolated', () => {
    setMains(S1, ADAM, ['thor']);
    setMains(S2, ADAM, ['magneto']);

    assert.deepEqual(getMains(S1, ADAM), ['thor']);
    assert.deepEqual(getMains(S2, ADAM), ['magneto']);
  });

  it('returns an empty list for someone with no mains', () => {
    assert.deepEqual(getMains(S1, 'nobody'), []);
    assert.equal(getPrimaryMain(S1, 'nobody'), null);
  });

  it('clears mains', () => {
    setMains(S1, ADAM, ['thor', 'hulk']);
    assert.equal(clearMains(S1, ADAM), true);
    assert.deepEqual(getMains(S1, ADAM), []);
    assert.equal(clearMains(S1, ADAM), false, 'nothing left to clear');
  });

  // /sgroster renders a page of rows and must not issue one query per member.
  it('fetches every primary main in one query', () => {
    setMains(S1, ADAM, ['captain_america', 'thor']);
    setMains(S1, PRIYA, ['storm']);
    setMains(S2, ADAM, ['magneto']);

    const primaries = getPrimaryMains(S1);
    assert.equal(primaries.size, 2);
    assert.equal(primaries.get(ADAM), 'captain_america');
    assert.equal(primaries.get(PRIYA), 'storm');
    assert.ok(!primaries.has('nobody'));
  });

  it('finds who mains a hero, primaries first', () => {
    setMains(S1, ADAM, ['thor', 'hulk']);
    setMains(S1, PRIYA, ['hulk']);

    const thorMains = whoMains(S1, 'thor');
    assert.equal(thorMains.length, 1);
    assert.equal(thorMains[0].discord_id, ADAM);

    const hulkMains = whoMains(S1, 'hulk');
    assert.equal(hulkMains.length, 2);
    assert.equal(hulkMains[0].slot, 1, 'primary mains should sort first');
    assert.equal(hulkMains[0].discord_id, PRIYA);
  });

  it('rejects an out-of-range slot at the schema level', () => {
    assert.throws(
      () =>
        getDb()
          .prepare(
            `INSERT INTO mains (discord_server_id, discord_id, slot, hero_id, updated_at)
             VALUES (?, ?, 4, 'thor', '2026-01-01')`,
          )
          .run(S1, ADAM),
      /CHECK constraint failed/,
    );
  });

  it('dropped the dead mains_in_nickname column', () => {
    const columns = getDb()
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('server_config')
      .map((c) => c.name);

    assert.ok(!columns.includes('mains_in_nickname'), 'column should be gone after migration 002');
    assert.ok(columns.includes('panel_message_id'), 'other columns must survive the drop');
  });
});
