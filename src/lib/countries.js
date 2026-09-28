/**
 * Loads data/countries.json once at startup and indexes it for the picker and
 * for autocomplete, both of which must answer inside Discord's 3-second window.
 *
 * Flag emoji are NOT stored in the JSON — they are derived from the ISO code at
 * render time (see lib/timezones.js), which removes a whole class of data-entry
 * error from a hand-assembled file.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidTimeZone } from './timezones.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../../data/countries.json');

/** Discord's hard cap on options in a single select menu. */
export const SELECT_MENU_MAX = 25;

let subregionOrder = [];
let countries = [];
let byCode = new Map();
let bySubregion = new Map();

export function loadCountries(path = DATA_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));

  subregionOrder = raw.subregionOrder ?? [];
  countries = raw.countries ?? [];
  byCode = new Map();
  bySubregion = new Map();

  const problems = [];

  for (const country of countries) {
    if (byCode.has(country.code)) problems.push(`duplicate code ${country.code}`);
    byCode.set(country.code, country);

    if (!subregionOrder.includes(country.subregion)) {
      problems.push(`${country.code}: unknown subregion "${country.subregion}"`);
    }
    if (!country.zones?.length) {
      problems.push(`${country.code}: no zones`);
    }
    for (const zone of country.zones ?? []) {
      if (!isValidTimeZone(zone.id)) problems.push(`${country.code}: invalid zone "${zone.id}"`);
    }

    const list = bySubregion.get(country.subregion) ?? [];
    list.push(country);
    bySubregion.set(country.subregion, list);
  }

  for (const list of bySubregion.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (subregionOrder.length > SELECT_MENU_MAX) {
    problems.push(
      `${subregionOrder.length} subregions exceeds the ${SELECT_MENU_MAX}-option select menu limit`,
    );
  }

  if (problems.length > 0) {
    console.warn(`[countries] ${problems.length} problem(s) in countries.json:`);
    for (const p of problems.slice(0, 20)) console.warn(`  - ${p}`);
    if (problems.length > 20) console.warn(`  ...and ${problems.length - 20} more`);
  }

  console.log(
    `[countries] loaded ${countries.length} countries across ${subregionOrder.length} subregions`,
  );

  return { count: countries.length, problems };
}

export function getSubregions() {
  return subregionOrder.filter((name) => bySubregion.has(name));
}

export function getSubregionByIndex(index) {
  return getSubregions()[index] ?? null;
}

export function getSubregionIndex(name) {
  return getSubregions().indexOf(name);
}

export function getCountriesIn(subregion) {
  return bySubregion.get(subregion) ?? [];
}

export function getCountry(code) {
  return byCode.get(String(code ?? '').toUpperCase()) ?? null;
}

export function countryCount(subregion) {
  return getCountriesIn(subregion).length;
}

/** Number of pages needed for a subregion, given the 25-option menu limit. */
export function pageCount(subregion, perPage = SELECT_MENU_MAX) {
  return Math.max(1, Math.ceil(getCountriesIn(subregion).length / perPage));
}

export function getCountryPage(subregion, page = 0, perPage = SELECT_MENU_MAX) {
  const all = getCountriesIn(subregion);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const safePage = ((page % pages) + pages) % pages; // wrap, never out of range
  return {
    page: safePage,
    pages,
    items: all.slice(safePage * perPage, safePage * perPage + perPage),
  };
}

/**
 * For the /setup timezone `country:` autocomplete option. Prefix matches rank
 * above substring matches so typing "aus" surfaces Australia before Belarus.
 */
export function searchCountries(query, limit = SELECT_MENU_MAX) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return countries.slice(0, limit);

  const prefix = [];
  const contains = [];

  for (const country of countries) {
    const name = country.name.toLowerCase();
    if (name.startsWith(q) || country.code.toLowerCase() === q) prefix.push(country);
    else if (name.includes(q)) contains.push(country);
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...contains].slice(0, limit);
}
