/**
 * Structural tests that catch Discord's hard limits at build time rather than
 * at runtime in front of a member.
 *
 * These need no token and no network — they just build the same payloads the
 * bot would send and assert they are legal.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { loadCommands } from '../src/lib/commandLoader.js';
import {
  SELECT_MENU_MAX,
  getCountry,
  getCountryPage,
  getSubregions,
  loadCountries,
  searchCountries,
} from '../src/lib/countries.js';
import { buildPanel, formatScreen } from '../src/interactions/timezone.js';

/** Every select menu in a payload, as raw JSON. */
function selectMenus(payload) {
  return payload.components
    .flatMap((row) => row.toJSON().components)
    .filter((c) => c.type === 3);
}

function customIds(payload) {
  return payload.components
    .flatMap((row) => row.toJSON().components)
    .map((c) => c.custom_id)
    .filter(Boolean);
}

describe('countries.json', () => {
  let result;
  before(() => {
    result = loadCountries();
  });

  it('loads without problems', () => {
    assert.deepEqual(result.problems, [], result.problems.join('\n'));
  });

  it('has enough countries to be useful', () => {
    assert.ok(result.count > 200, `only ${result.count} countries`);
  });

  it('fits the subregion menu inside the 25-option limit', () => {
    assert.ok(
      getSubregions().length <= SELECT_MENU_MAX,
      `${getSubregions().length} subregions will not fit in one menu`,
    );
  });

  it('pages every subregion to at most 25 options', () => {
    for (const subregion of getSubregions()) {
      let page = 0;
      const { pages } = getCountryPage(subregion, 0);
      while (page < pages) {
        const { items } = getCountryPage(subregion, page);
        assert.ok(
          items.length <= SELECT_MENU_MAX,
          `${subregion} page ${page} has ${items.length} options`,
        );
        assert.ok(items.length > 0, `${subregion} page ${page} is empty`);
        page += 1;
      }
    }
  });

  it('pages the Caribbean, which is the one subregion that overflows', () => {
    const { pages } = getCountryPage('Caribbean', 0);
    assert.ok(pages >= 2, 'expected the Caribbean to need more than one page');
  });

  it('wraps out-of-range page numbers instead of going blank', () => {
    const { pages } = getCountryPage('Caribbean', 0);
    assert.equal(getCountryPage('Caribbean', pages).page, 0);
    assert.equal(getCountryPage('Caribbean', -1).page, pages - 1);
  });

  it('finds Australia and its zones', () => {
    const au = getCountry('AU');
    assert.ok(au, 'AU missing');
    assert.ok(au.zones.length > 1, 'Australia should offer a zone picker');
    assert.ok(au.zones.some((z) => z.id === 'Australia/Sydney'));
  });

  it('keeps autocomplete within the 25-choice limit', () => {
    assert.ok(searchCountries('a').length <= SELECT_MENU_MAX);
    assert.ok(searchCountries('').length <= SELECT_MENU_MAX);
  });

  it('ranks prefix matches above substring matches', () => {
    const names = searchCountries('aus').map((c) => c.name);
    assert.equal(names[0], 'Australia');
  });
});

describe('slash commands', () => {
  it('all build to valid Discord JSON', async () => {
    const commands = await loadCommands();
    assert.ok(commands.size >= 2, 'expected at least /setup and /admin');

    for (const [name, command] of commands) {
      const json = command.data.toJSON();
      assert.equal(json.name, name);
      assert.ok(json.description.length <= 100, `${name}: description too long`);
    }
  });

  it('registers /setup and /admin', async () => {
    const commands = await loadCommands();
    assert.ok(commands.has('setup'));
    assert.ok(commands.has('admin'));
  });
});

describe('interaction payloads', () => {
  before(() => loadCountries());

  it('builds the panel with a working button', () => {
    const panel = buildPanel();
    assert.equal(panel.components.length, 1);
    assert.deepEqual(customIds(panel), ['tz:start']);
  });

  it('builds the format screen with and without a preselected country', () => {
    const plain = formatScreen(null);
    const preset = formatScreen('AU');

    // The "just pick an offset" escape hatch only appears when no country is set.
    assert.ok(customIds(plain).includes('tz:direct'));
    assert.ok(!customIds(preset).includes('tz:direct'));
    assert.ok(customIds(preset).includes('tz:fmt:f:AU'));
  });

  it('keeps every custom_id inside Discord\'s 100-character limit', () => {
    for (const payload of [buildPanel(), formatScreen(null), formatScreen('AU')]) {
      for (const id of customIds(payload)) {
        assert.ok(id.length <= 100, `custom_id too long: ${id}`);
      }
    }
  });

  it('never builds a select menu over the option limit', () => {
    for (const payload of [buildPanel(), formatScreen(null)]) {
      for (const menu of selectMenus(payload)) {
        assert.ok(menu.options.length <= SELECT_MENU_MAX);
      }
    }
  });
});
