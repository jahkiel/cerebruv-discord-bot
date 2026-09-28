import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { rmSync } from 'node:fs';

import { closeDb, getDb, initDb } from '../src/lib/db.js';
import { loadHeroes } from '../src/lib/heroes.js';
import { buildPage } from '../src/interactions/sgroster.js';
import { applyOwnershipPage, upsertHero } from '../src/lib/data/roster.js';
import { setMains } from '../src/lib/data/mains.js';
import { ensureUser, saveTimezone, setOfficer } from '../src/lib/data/users.js';

const DB = './data/_test_sgroster.db';
const S1 = '111111111111111111';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB}${suffix}`, { force: true });
}

/** Extracts the fixed-width table out of the embed description. */
function table(page) {
  return page.embeds[0].data.description ?? '';
}

function rowFor(page, name) {
  return table(page)
    .split('\n')
    .find((line) => line.startsWith(name));
}

describe('/sgroster page', () => {
  before(() => {
    cleanup();
    loadHeroes();
    initDb(DB);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM users; DELETE FROM roster; DELETE FROM mains;');
  });

  after(() => {
    closeDb();
    cleanup();
  });

  // Joewin added an officer who had never used the bot, and they vanished from
  // the roster (2026-09-27). Leadership missing from the list looks broken.
  it('lists an officer who has recorded nothing at all', () => {
    ensureUser(S1, '2', 'Lanceor');
    setOfficer(S1, '2', true);

    const row = rowFor(buildPage(S1, 0, '1', 'Test SG'), 'Lanceor');
    assert.ok(row, 'a named officer must appear even with no data');
    assert.match(row, /\bO\b/, 'should be ranked O for officer');
    assert.match(row, /\s0\s/, 'should show zero heroes rather than being hidden');
  });

  it('still hides an ordinary member who has recorded nothing', () => {
    ensureUser(S1, '3', 'Nobody');

    assert.equal(rowFor(buildPage(S1, 0, '1', 'Test SG'), 'Nobody'), undefined);
    assert.match(buildPage(S1, 0, '1', 'Test SG').embeds[0].data.title, /^0 members/);
  });

  it('shows a member once they have recorded something', () => {
    ensureUser(S1, '3', 'Marcus');
    applyOwnershipPage(S1, '3', ['thor'], ['thor']);

    assert.ok(rowFor(buildPage(S1, 0, '1', 'Test SG'), 'Marcus'));
  });

  it('puts officers above members with more heroes', () => {
    ensureUser(S1, '2', 'Officer');
    setOfficer(S1, '2', true);

    ensureUser(S1, '3', 'Busy');
    const many = Array.from({ length: 40 }, (_, i) => `h${i}`);
    applyOwnershipPage(S1, '3', many, many);

    const lines = table(buildPage(S1, 0, '1', 'Test SG')).split('\n');
    const officerAt = lines.findIndex((l) => l.startsWith('Officer'));
    const busyAt = lines.findIndex((l) => l.startsWith('Busy'));

    assert.ok(officerAt < busyAt, 'officers sort first regardless of hero count');
  });

  it('renders the six columns with the name tag stripped', () => {
    saveTimezone(S1, '1', {
      displayName: 'Jahkiel 🇦🇺',
      tagType: 'flag',
      countryCode: 'AU',
      ianaTz: 'Australia/Sydney',
    });
    setOfficer(S1, '1', true);
    applyOwnershipPage(S1, '1', ['thor', 'hulk'], ['thor', 'hulk']);
    setMains(S1, '1', ['thor']);
    upsertHero(S1, '1', 'thor', { level: 60, prestige: 6 });

    const row = rowFor(buildPage(S1, 0, '1', 'Test SG'), 'Jahkiel');
    assert.ok(row, 'row should start with the tag-stripped name');
    assert.match(row, /\bAU\b/, 'country as ISO code');
    assert.match(row, /Thor/, 'main hero');
    assert.match(row, /Cosmic/, 'highest prestige by name');
  });

  // Emoji render at a variable width even in monospace, which would break the
  // column alignment that is the entire point of this format.
  it('never puts emoji inside the code block', () => {
    saveTimezone(S1, '1', {
      displayName: 'Jahkiel 🇦🇺',
      tagType: 'flag',
      countryCode: 'AU',
      ianaTz: 'Australia/Sydney',
    });
    applyOwnershipPage(S1, '1', ['thor'], ['thor']);

    const emoji = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}]/u;
    assert.ok(!emoji.test(table(buildPage(S1, 0, '1', 'Test SG'))), 'found emoji in the table');
  });

  it('scopes the pagination buttons to whoever ran the command', () => {
    ensureUser(S1, '2', 'Someone');
    setOfficer(S1, '2', true);

    const page = buildPage(S1, 0, 'invoker-9', 'Test SG');
    const ids = page.components[0].toJSON().components.map((c) => c.custom_id);

    assert.ok(
      ids.every((id) => id.endsWith(':invoker-9')),
      'public message — buttons must carry the invoker id so others cannot page it',
    );
  });

  it('says so plainly when nobody has recorded anything', () => {
    const page = buildPage(S1, 0, '1', 'Test SG');
    assert.equal(page.components.length, 0, 'no pagination on an empty roster');
    assert.match(page.embeds[0].data.description, /No one has recorded anything yet/);
  });
});
