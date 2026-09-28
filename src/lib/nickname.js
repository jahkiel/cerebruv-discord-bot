/**
 * Nickname tag manipulation. Pure string logic — no Discord types, no I/O —
 * so it is fully unit-testable. See test/nickname.test.js.
 *
 * DESIGN NOTE (the important one):
 * We never store a copy of a member's base name and later "restore" it. The
 * nickname string lives on Discord's side and the member can edit it whenever
 * they like, so a cached copy goes stale and would clobber their edit. Instead
 * we read their CURRENT display name and strip our own tag off the end.
 *
 * That makes re-tagging idempotent (replace, never stack), survives manual
 * edits, and self-heals after the bot has been offline.
 */

/** Two regional-indicator code points at the end of the string = a flag. */
const TRAILING_FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}\s*$/u;

/** e.g. " [UTC+10]", " [UTC-3:30]", " [UTC+0]" */
const TRAILING_OFFSET = /\[UTC[+-]\d{1,2}(?::\d{2})?\]\s*$/u;

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Removes any tag this bot may have appended, including historically stacked
 * ones (e.g. "Joewin 🇦🇺 [UTC+10]" -> "Joewin").
 *
 * Known limitation: if a member deliberately ends their own name with a flag
 * emoji, we treat it as ours and replace it. Acceptable — that is the tag slot.
 *
 * @param {string} displayName
 * @returns {string}
 */
export function stripTag(displayName) {
  let out = String(displayName ?? '');
  let previous;

  do {
    previous = out;
    out = out.replace(TRAILING_OFFSET, '').trimEnd();
    out = out.replace(TRAILING_FLAG, '').trimEnd();
  } while (out !== previous);

  return out.trim();
}

/** True if the name currently ends with a tag we would recognise. */
export function hasTag(displayName) {
  const s = String(displayName ?? '');
  return TRAILING_FLAG.test(s) || TRAILING_OFFSET.test(s);
}

/**
 * Length as Discord counts it: CODE POINTS, not UTF-16 code units.
 *
 * Measured empirically against the live API on 2026-09-27 (see CLAUDE.md):
 *   30 ASCII + 🇦🇺  = 34 UTF-16 units, 32 code points -> ACCEPTED
 *   31 ASCII + 🇦🇺  = 35 UTF-16 units, 33 code points -> REJECTED (50035)
 *
 * So a regional-indicator flag costs 2, not 4. Using String#length here would
 * silently rob every member of two characters of their own name.
 *
 * @param {string} str
 * @returns {number}
 */
export function measure(str) {
  return [...String(str ?? '')].length;
}

/**
 * Truncates to a code-point budget without splitting a surrogate pair or an
 * emoji sequence — iteration is by grapheme, measurement is by code point.
 *
 * @param {string} str
 * @param {number} budget in code points
 * @returns {string}
 */
export function truncateToBudget(str, budget) {
  const s = String(str ?? '');
  if (budget <= 0) return '';
  if (measure(s) <= budget) return s;

  let out = '';
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(s)) {
    const cost = measure(segment);
    if (used + cost > budget) break;
    out += segment;
    used += cost;
  }
  return out.trimEnd();
}

/**
 * Produces the nickname to send to Discord: current name, tag stripped, new
 * tag appended, whole thing inside the length limit.
 *
 * The BASE NAME is truncated to make room — never the tag.
 *
 * @param {string} currentDisplayName the member's nickname right now (or their
 *   username if they have no nickname set)
 * @param {string | null} tag e.g. "🇦🇺" or "[UTC+10]". Null/empty just strips.
 * @param {number} [max] nickname limit
 * @returns {string} may be empty only if both base and tag are empty
 */
export function applyTag(currentDisplayName, tag, max = 32) {
  const base = stripTag(currentDisplayName);

  if (!tag) return truncateToBudget(base, max);

  // -1 for the space separating base and tag. Tag cost is in code points.
  const budget = max - measure(tag) - 1;

  // Pathological: the tag alone fills the limit. Ship the tag, drop the base.
  if (budget < 1) return truncateToBudget(tag, max);

  const kept = truncateToBudget(base, budget);
  if (!kept) return truncateToBudget(tag, max);

  return `${kept} ${tag}`;
}
