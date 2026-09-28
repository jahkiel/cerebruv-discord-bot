/**
 * Parses a pasted roster list into hero updates.
 *
 * Accepts one hero per line, in whatever shape someone naturally types:
 *
 *   Wolverine 60 6
 *   Doctor Strange, 60, 5
 *   Storm - Lv44 P3
 *   Thor 60
 *   X-23 p2
 *
 * VALUES ARE READ FROM THE END OF THE LINE, not the start. Hero names contain
 * spaces ("Doctor Strange"), hyphens ("Spider-Man") and digits ("X-23"), so
 * splitting on whitespace and taking the first token would mangle most of the
 * roster. Everything before the trailing numbers is the name.
 *
 * Applies the lines it understands and reports the ones it does not, per
 * Joewin's choice (2026-09-27) — one typo must not throw away the whole paste.
 */

import { resolveHeroId, getHero } from './heroes.js';
import { isValidLevel, isValidPrestige, levelCap, levelFloor, maxPrestige } from './game.js';

/** A token that is a bare number, or one tagged as a level/prestige. */
const VALUE_TOKEN = /^(?:lv|lvl|level|p|prestige)?[-:]?(\d{1,3})$/i;
const LEVEL_PREFIX = /^(?:lv|lvl|level)/i;
const PRESTIGE_PREFIX = /^(?:p|prestige)/i;

/** Lines people paste as headings or notes, which should be skipped silently. */
const IGNORABLE = /^(?:#|\/\/|-{2,}|=+|name\b|hero\b)/i;

function normalise(line) {
  return line
    .replace(/[,;|\t]+/g, ' ') // commas, tabs and pipes all mean "next field"
    .replace(/\s+-\s+/g, ' ') // "Storm - 44" but never "Spider-Man"
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text the pasted block
 * @returns {{applied: Array, errors: Array, skipped: number}}
 */
export function parseRosterPaste(text) {
  const applied = [];
  const errors = [];
  const seen = new Map();
  let skipped = 0;

  const lines = String(text ?? '').split(/\r?\n/);

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = normalise(raw);

    if (!line) return;
    if (IGNORABLE.test(line)) {
      skipped += 1;
      return;
    }

    const fail = (reason) => errors.push({ line: lineNumber, text: raw.trim(), reason });

    // Peel value tokens off the end until we hit something that is not one.
    const tokens = line.split(' ');
    const values = [];
    while (tokens.length > 1 && VALUE_TOKEN.test(tokens.at(-1))) {
      values.unshift(tokens.pop());
    }

    const name = tokens.join(' ').trim();
    if (!name) return fail('no hero name');

    const heroId = resolveHeroId(name);
    if (!heroId) {
      return fail(`"${name}" is not a hero I recognise`);
    }

    if (seen.has(heroId)) {
      return fail(`${getHero(heroId).name} was already given on line ${seen.get(heroId)}`);
    }

    // A bare hero name means "I own this, no level recorded". That keeps the
    // /roster text export round-tripping cleanly: heroes with nothing recorded
    // export as just a name, and pasting them back must not be an error.
    if (values.length === 0) {
      seen.set(heroId, lineNumber);
      applied.push({
        line: lineNumber,
        heroId,
        name: getHero(heroId).name,
        level: null,
        prestige: null,
      });
      return;
    }
    if (values.length > 2) {
      return fail('too many numbers — expected a level and optionally a prestige');
    }

    let level = null;
    let prestige = null;
    const untagged = [];

    for (const token of values) {
      const amount = Number(VALUE_TOKEN.exec(token)[1]);
      if (PRESTIGE_PREFIX.test(token) && !LEVEL_PREFIX.test(token)) prestige = amount;
      else if (LEVEL_PREFIX.test(token)) level = amount;
      else untagged.push(amount);
    }

    // Untagged numbers fill whatever is still empty, level first — "Thor 60"
    // means level 60 far more often than prestige 60, which isn't even valid.
    for (const amount of untagged) {
      if (level == null) level = amount;
      else if (prestige == null) prestige = amount;
      else return fail('too many numbers');
    }

    if (level != null && !isValidLevel(level)) {
      return fail(`level ${level} is outside ${levelFloor()}–${levelCap()}`);
    }
    if (prestige != null && !isValidPrestige(prestige)) {
      return fail(`prestige ${prestige} is outside 0–${maxPrestige()}`);
    }

    seen.set(heroId, lineNumber);
    applied.push({
      line: lineNumber,
      heroId,
      name: getHero(heroId).name,
      level,
      prestige,
    });
  });

  return { applied, errors, skipped };
}
