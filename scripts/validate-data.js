/**
 * Validates data/countries.json. Run with `npm run validate:data`.
 *
 * WHY THIS DOES NOT USE Intl.supportedValuesOf('timeZone'):
 * that list is ICU-build-specific. A Windows dev box and a Linux deploy host
 * canonicalise differently — Windows ICU reports the legacy `Asia/Calcutta`
 * while Linux reports the modern `Asia/Kolkata`. Validating against the list
 * would pass on one machine and fail on the other for the same correct file.
 *
 * Constructing an Intl.DateTimeFormat is the portable check: every ICU build
 * accepts both spellings for formatting. The data file uses modern names so
 * city labels derived from the zone id read correctly (Kolkata, not Calcutta).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELECT_MENU_MAX = 25;

function canFormat(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/countries.json'), 'utf8'));
const subregions = new Set(data.subregionOrder);
const seenCodes = new Set();
const errors = [];
const warnings = [];

for (const country of data.countries) {
  const where = country.code ?? country.name ?? '(unnamed)';

  if (!/^[A-Z]{2}$/.test(country.code ?? '')) errors.push(`${where}: code must be two uppercase letters`);
  if (seenCodes.has(country.code)) errors.push(`${where}: duplicate country code`);
  seenCodes.add(country.code);

  if (!subregions.has(country.subregion)) errors.push(`${where}: unknown subregion "${country.subregion}"`);
  if (!country.name || country.name.length > 40) errors.push(`${where}: name missing or over 40 chars`);
  if (!Array.isArray(country.zones) || country.zones.length === 0) {
    errors.push(`${where}: must have at least one zone`);
    continue;
  }

  const seenZones = new Set();
  for (const zone of country.zones) {
    if (!canFormat(zone.id)) errors.push(`${where}: "${zone.id}" is not a usable IANA zone`);
    if (seenZones.has(zone.id)) errors.push(`${where}: duplicate zone "${zone.id}"`);
    seenZones.add(zone.id);

    if (country.zones.length === 1 && zone.label !== null) {
      warnings.push(`${where}: single-zone country should have label null`);
    }
    if (country.zones.length > 1 && (!zone.label || zone.label.length > 40)) {
      errors.push(`${where}: multi-zone entries need a label under 40 chars`);
    }
  }
}

if (data.subregionOrder.length > SELECT_MENU_MAX) {
  errors.push(`${data.subregionOrder.length} subregions exceeds the ${SELECT_MENU_MAX}-option menu limit`);
}

// Not an error — the picker pages. Reported so the paging stays justified.
const counts = new Map();
for (const c of data.countries) counts.set(c.subregion, (counts.get(c.subregion) ?? 0) + 1);
const paged = [...counts].filter(([, n]) => n > SELECT_MENU_MAX);

// --- heroes.json ------------------------------------------------------------
// Display names come from the 1.52 client's own strings, not wiki page titles.
// Stored roster data keys on `id`, so an id must never change once shipped.

const heroData = JSON.parse(readFileSync(resolve(ROOT, 'data/heroes.json'), 'utf8'));
const seenHeroIds = new Set();
const seenHeroNames = new Set();

for (const hero of heroData.heroes) {
  const where = hero.id ?? hero.name ?? '(unnamed)';

  if (!/^[a-z0-9_]+$/.test(hero.id ?? '')) {
    errors.push(`hero ${where}: id must be lowercase letters, digits and underscores`);
  }
  if (seenHeroIds.has(hero.id)) errors.push(`hero ${where}: duplicate id`);
  seenHeroIds.add(hero.id);

  if (!hero.name) errors.push(`hero ${where}: missing name`);
  if ((hero.name ?? '').length > 100) errors.push(`hero ${where}: name over 100 chars`);

  const lowerName = (hero.name ?? '').toLowerCase();
  if (seenHeroNames.has(lowerName)) errors.push(`hero ${where}: duplicate display name`);
  seenHeroNames.add(lowerName);

  for (const alias of hero.aliases ?? []) {
    if (alias.toLowerCase() === lowerName) {
      warnings.push(`hero ${where}: alias "${alias}" duplicates the display name`);
    }
  }
}

for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  ERROR ${e}`);

console.log(`\nheroes: ${heroData.heroes.length}   client: ${heroData.clientVersion ?? '?'}`);
console.log(`countries: ${data.countries.length}   subregions: ${data.subregionOrder.length}`);
for (const [name, n] of paged) {
  console.log(`paging required: ${name} has ${n} entries (${Math.ceil(n / SELECT_MENU_MAX)} pages)`);
}
console.log(`errors: ${errors.length}   warnings: ${warnings.length}`);

process.exit(errors.length > 0 ? 1 : 0);
