/**
 * Loads data/heroes.json once at startup and indexes it for autocomplete,
 * which must answer inside Discord's 3-second window — so everything here is
 * in-memory and synchronous.
 *
 * Stored user data keys on the hero `id`, never the display name, so a name
 * can be corrected in the JSON without orphaning anyone's roster.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../../data/heroes.json');

/** Discord's cap on autocomplete choices, same as the select-menu cap. */
export const AUTOCOMPLETE_MAX = 25;

let heroes = [];
let byId = new Map();
let clientVersion = null;

export function loadHeroes(path = DATA_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));

  const loaded = raw.heroes ?? [];
  const problems = [];
  const seen = new Map();

  for (const hero of loaded) {
    if (!/^[a-z0-9_]+$/.test(hero.id ?? '')) {
      problems.push(`${hero.name ?? hero.id}: id must be lowercase letters, digits and underscores`);
    }
    if (seen.has(hero.id)) problems.push(`duplicate id ${hero.id}`);
    seen.set(hero.id, hero);

    if (!hero.name) problems.push(`${hero.id}: missing name`);
    if ((hero.name ?? '').length > 100) problems.push(`${hero.id}: name over 100 chars`);
  }

  // Only swap in the new data once it has been checked, so a bad edit via
  // /admin reload cannot leave the bot with a half-loaded hero list.
  if (problems.length > 0) {
    console.warn(`[heroes] ${problems.length} problem(s) in heroes.json — keeping previous data:`);
    for (const p of problems.slice(0, 20)) console.warn(`  - ${p}`);
    return { count: heroes.length, problems, applied: false };
  }

  heroes = [...loaded].sort((a, b) => a.name.localeCompare(b.name));
  byId = seen;
  clientVersion = raw.clientVersion ?? null;

  console.log(`[heroes] loaded ${heroes.length} heroes (client ${clientVersion ?? 'unknown'})`);
  return { count: heroes.length, problems: [], applied: true };
}

export function allHeroes() {
  return heroes;
}

export function heroCount() {
  return heroes.length;
}

export function getClientVersion() {
  return clientVersion;
}

/** @returns {{id: string, name: string, aliases?: string[]} | null} */
export function getHero(id) {
  return byId.get(String(id ?? '').toLowerCase()) ?? null;
}

export function heroName(id) {
  return getHero(id)?.name ?? null;
}

/**
 * Autocomplete search over display names and aliases.
 *
 * Ranked: exact match, then name prefix, then alias prefix, then substring.
 * Aliases matter more than they look — members will type "Ms Marvel" and
 * "Mr Fantastic" for heroes the client renamed, and "Spidey" for Spider-Man.
 *
 * @param {string} query
 * @param {number} limit
 */
export function searchHeroes(query, limit = AUTOCOMPLETE_MAX) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return heroes.slice(0, limit);

  const exact = [];
  const namePrefix = [];
  const aliasPrefix = [];
  const contains = [];

  for (const hero of heroes) {
    const name = hero.name.toLowerCase();
    const aliases = (hero.aliases ?? []).map((a) => a.toLowerCase());

    if (name === q || aliases.includes(q)) exact.push(hero);
    else if (name.startsWith(q)) namePrefix.push(hero);
    else if (aliases.some((a) => a.startsWith(q))) aliasPrefix.push(hero);
    else if (name.includes(q) || aliases.some((a) => a.includes(q))) contains.push(hero);
  }

  return [...exact, ...namePrefix, ...aliasPrefix, ...contains].slice(0, limit);
}

/**
 * Resolves user input to a hero id. Used to validate a submitted option value,
 * which is normally already an id from autocomplete — but a member can type
 * free text and submit without picking a suggestion.
 *
 * @returns {string | null} the hero id, or null if it matches nothing
 */
export function resolveHeroId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  if (byId.has(raw.toLowerCase())) return raw.toLowerCase();

  const match = searchHeroes(raw, 1)[0];
  if (!match) return null;

  // Only accept a typed name if it is an unambiguous exact match — never
  // silently promote a partial string to a hero the member did not choose.
  const lower = raw.toLowerCase();
  const names = [match.name.toLowerCase(), ...(match.aliases ?? []).map((a) => a.toLowerCase())];
  return names.includes(lower) ? match.id : null;
}
