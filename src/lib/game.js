/**
 * Game progression rules: level cap and prestige tiers.
 *
 * Loaded from data/game.json so the values can be corrected without a code
 * change — they describe a private server we do not control, and the numbers
 * were confirmed by a player rather than derived from a document.
 *
 * KEY MODELLING POINT: prestiging restarts a hero at level 1. Level therefore
 * does NOT measure progress on its own — (prestige, level) together do. Any
 * comparison must use compareProgress().
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../../data/game.json');

let rules = {
  levelCap: 60,
  levelFloor: 1,
  prestigeTiers: [{ value: 0, name: 'White', emoji: '⚪', colour: 15790320 }],
  randomBoxExcludes: [],
};

export function loadGame(path = DATA_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const problems = [];

  if (!Number.isInteger(raw.levelCap) || raw.levelCap < 1) {
    problems.push('levelCap must be a positive integer');
  }
  if (!Array.isArray(raw.prestigeTiers) || raw.prestigeTiers.length === 0) {
    problems.push('prestigeTiers must be a non-empty array');
  } else {
    raw.prestigeTiers.forEach((tier, index) => {
      if (tier.value !== index) {
        problems.push(`prestigeTiers[${index}].value must equal its index (got ${tier.value})`);
      }
      if (!tier.name) problems.push(`prestigeTiers[${index}] missing name`);
      if (!tier.emoji) problems.push(`prestigeTiers[${index}] missing emoji`);
    });
  }

  if (problems.length > 0) {
    console.warn(`[game] ${problems.length} problem(s) in game.json — keeping previous rules:`);
    for (const p of problems) console.warn(`  - ${p}`);
    return { problems, applied: false };
  }

  rules = {
    levelCap: raw.levelCap,
    levelFloor: raw.levelFloor ?? 1,
    prestigeTiers: raw.prestigeTiers,
    randomBoxExcludes: raw.randomBoxExcludes ?? [],
  };

  console.log(
    `[game] level cap ${rules.levelCap}, ${rules.prestigeTiers.length} prestige tiers ` +
      `(${rules.prestigeTiers.map((t) => t.name).join(' → ')})`,
  );
  return { problems: [], applied: true };
}

// Self-initialise on import.
//
// /updatehero builds its prestige choices from these tiers at MODULE LOAD time,
// when the SlashCommandBuilder is constructed — so the rules must be in place
// before any command module is imported. Relying on an entry point to call
// loadGame() first would work until someone adds a third entry point and
// silently registers a command with one prestige option.
try {
  loadGame();
} catch (error) {
  console.warn('[game] could not read data/game.json — using built-in defaults:', error.message);
}

/**
 * Heroes that cannot drop from a Random Hero Box — the Fantastic Four and
 * Silver Surfer. They are still playable; they are just not in the pool.
 */
export const randomBoxExcludes = () => rules.randomBoxExcludes;

export const levelCap = () => rules.levelCap;
export const levelFloor = () => rules.levelFloor;
export const prestigeTiers = () => rules.prestigeTiers;
export const maxPrestige = () => rules.prestigeTiers.length - 1;

/** @returns {{value: number, name: string, emoji: string, colour: number} | null} */
export function prestigeTier(value) {
  if (!Number.isInteger(value)) return null;
  return rules.prestigeTiers[value] ?? null;
}

export function prestigeEmoji(value) {
  return prestigeTier(value)?.emoji ?? rules.prestigeTiers[0].emoji;
}

export function prestigeName(value) {
  return prestigeTier(value)?.name ?? rules.prestigeTiers[0].name;
}

export function isValidLevel(level) {
  return Number.isInteger(level) && level >= rules.levelFloor && level <= rules.levelCap;
}

export function isValidPrestige(value) {
  return Number.isInteger(value) && value >= 0 && value <= maxPrestige();
}

/**
 * Orders two heroes by actual progress. Prestige dominates, because reaching
 * a higher prestige means having completed every level below it — a Cosmic
 * hero at level 3 is further along than a White hero at level 60.
 *
 * @returns {number} negative if a is behind b, positive if ahead
 */
export function compareProgress(a, b) {
  const prestigeDiff = (a?.prestige ?? 0) - (b?.prestige ?? 0);
  if (prestigeDiff !== 0) return prestigeDiff;
  return (a?.level ?? 0) - (b?.level ?? 0);
}

/**
 * Human-readable progress: '🟡 Lv 60', or '🟡 Cosmic · Lv 60' when verbose.
 * Returns null when nothing has been recorded beyond ownership.
 */
export function describeProgress({ level, prestige } = {}, { verbose = false } = {}) {
  if (level == null && prestige == null) return null;

  const emoji = prestigeEmoji(prestige ?? 0);
  const levelPart = level == null ? null : `Lv ${level}`;

  if (!verbose) return [emoji, levelPart].filter(Boolean).join(' ');

  // The emoji belongs WITH the tier name ("🟡 Cosmic"), not as its own field —
  // joining all three with the separator gives "🟡 · Cosmic · Lv 60".
  const name = prestigeName(prestige ?? 0);
  return [`${emoji} ${name}`, levelPart].filter(Boolean).join(' · ');
}
