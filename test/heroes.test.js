import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  AUTOCOMPLETE_MAX,
  allHeroes,
  getClientVersion,
  getHero,
  heroCount,
  heroName,
  loadHeroes,
  resolveHeroId,
  searchHeroes,
} from '../src/lib/heroes.js';

describe('heroes.json', () => {
  let result;
  before(() => {
    result = loadHeroes();
  });

  it('loads cleanly', () => {
    assert.deepEqual(result.problems, [], result.problems.join('\n'));
    assert.equal(result.applied, true);
  });

  it('has the 63 heroes of the final PC build', () => {
    assert.equal(heroCount(), 63);
    assert.equal(getClientVersion(), '1.52.0.1700');
  });

  it('uses the client spellings, not the wiki page titles', () => {
    // These six are where public lists disagree with the game. Confirmed from
    // the client's own "As <Hero>," achievement strings on 2026-09-27.
    assert.equal(heroName('mister_fantastic'), 'Mister Fantastic');
    assert.equal(heroName('captain_marvel'), 'Captain Marvel');
    assert.equal(heroName('doctor_strange'), 'Doctor Strange');
    assert.equal(heroName('doctor_doom'), 'Doctor Doom');
    assert.equal(heroName('thing'), 'Thing');
    assert.equal(heroName('punisher'), 'Punisher');
  });

  it('keeps hyphenation exact', () => {
    assert.equal(heroName('spider_man'), 'Spider-Man');
    assert.equal(heroName('star_lord'), 'Star-Lord');
    assert.equal(heroName('ant_man'), 'Ant-Man');
    assert.equal(heroName('she_hulk'), 'She-Hulk');
    assert.equal(heroName('x_23'), 'X-23');
    assert.equal(heroName('rocket_raccoon'), 'Rocket Raccoon');
  });

  it('includes the five heroes delisted from the store in June 2017', () => {
    // Pulled from sale over Fox/Marvel licensing, but still playable.
    for (const id of ['mister_fantastic', 'invisible_woman', 'human_torch', 'thing', 'silver_surfer']) {
      assert.ok(getHero(id), `${id} missing — the list would be 58, not 63`);
    }
  });

  it('excludes Team-Ups and never-released heroes', () => {
    // Domino and Wasp were Team-Ups; the rest never shipped. Including
    // Team-Ups would push the list past 100 and wreck autocomplete.
    for (const id of ['domino', 'wasp', 'gwenpool', 'thanos', 'spider_woman', 'odinson', 'agent_venom']) {
      assert.equal(getHero(id), null, `${id} should not be in the roster`);
    }
  });

  it('has no duplicate ids or display names', () => {
    const ids = new Set();
    const names = new Set();
    for (const hero of allHeroes()) {
      assert.ok(!ids.has(hero.id), `duplicate id ${hero.id}`);
      assert.ok(!names.has(hero.name), `duplicate name ${hero.name}`);
      ids.add(hero.id);
      names.add(hero.name);
    }
  });

  it('is sorted by display name', () => {
    const names = allHeroes().map((h) => h.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('searchHeroes', () => {
  before(() => loadHeroes());

  it('ranks an exact match first', () => {
    assert.equal(searchHeroes('thor')[0].id, 'thor');
    assert.equal(searchHeroes('hulk')[0].id, 'hulk');
  });

  it('ranks name prefixes above substrings', () => {
    assert.equal(searchHeroes('spider')[0].id, 'spider_man');
    assert.equal(searchHeroes('black')[0].name, 'Black Bolt');
  });

  it('finds heroes by the names members actually type', () => {
    // The whole point of aliases: the client renamed these, but members will
    // still reach for the old or the informal name.
    assert.equal(searchHeroes('ms marvel')[0].id, 'captain_marvel');
    assert.equal(searchHeroes('ms. marvel')[0].id, 'captain_marvel');
    assert.equal(searchHeroes('mr fantastic')[0].id, 'mister_fantastic');
    assert.equal(searchHeroes('dr strange')[0].id, 'doctor_strange');
    assert.equal(searchHeroes('spidey')[0].id, 'spider_man');
    assert.equal(searchHeroes('wolvie')[0].id, 'wolverine');
    assert.equal(searchHeroes('cap')[0].id, 'captain_america');
    assert.equal(searchHeroes('shadowcat')[0].id, 'kitty_pryde');
  });

  it('is case insensitive', () => {
    assert.equal(searchHeroes('WOLVERINE')[0].id, 'wolverine');
    assert.equal(searchHeroes('SpIdEy')[0].id, 'spider_man');
  });

  it('never exceeds the 25-choice autocomplete limit', () => {
    assert.ok(searchHeroes('').length <= AUTOCOMPLETE_MAX);
    assert.ok(searchHeroes('a').length <= AUTOCOMPLETE_MAX);
    assert.ok(searchHeroes('man').length <= AUTOCOMPLETE_MAX);
  });

  it('returns nothing for gibberish', () => {
    assert.deepEqual(searchHeroes('zzzzqqq'), []);
  });
});

describe('resolveHeroId', () => {
  before(() => loadHeroes());

  it('accepts an id straight from autocomplete', () => {
    assert.equal(resolveHeroId('spider_man'), 'spider_man');
  });

  it('accepts an exactly typed display name or alias', () => {
    assert.equal(resolveHeroId('Spider-Man'), 'spider_man');
    assert.equal(resolveHeroId('spidey'), 'spider_man');
    assert.equal(resolveHeroId('Ms. Marvel'), 'captain_marvel');
  });

  // Free text must be rejected, never promoted to a hero the member did not
  // actually choose — "spid" could plausibly be several things.
  it('rejects a partial name rather than guessing', () => {
    assert.equal(resolveHeroId('spid'), null);
    assert.equal(resolveHeroId('cap america'), null);
  });

  it('rejects unknown input', () => {
    assert.equal(resolveHeroId('Batman'), null);
    assert.equal(resolveHeroId('Domino'), null, 'Domino was a Team-Up, not a hero');
    assert.equal(resolveHeroId(''), null);
    assert.equal(resolveHeroId(null), null);
  });
});
