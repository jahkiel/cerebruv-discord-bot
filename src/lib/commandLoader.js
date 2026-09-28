/**
 * Loads every command module in src/commands.
 *
 * One file per command; a module qualifies if it exports `data`
 * (a SlashCommandBuilder) and `execute`. Shared by the bot and by
 * deploy-commands.js so the two can never drift out of sync.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = resolve(HERE, '../commands');

/** @returns {Promise<Map<string, {data: object, execute: Function, autocomplete?: Function}>>} */
export async function loadCommands() {
  const commands = new Map();
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    // pathToFileURL matters on Windows — a bare path breaks dynamic import.
    const module = await import(pathToFileURL(join(COMMANDS_DIR, file)).href);

    if (!module.data || typeof module.execute !== 'function') {
      console.warn(`[commands] skipping ${file}: needs both "data" and "execute" exports`);
      continue;
    }

    if (commands.has(module.data.name)) {
      throw new Error(`Duplicate command name "${module.data.name}" in ${file}`);
    }

    commands.set(module.data.name, module);
  }

  console.log(`[commands] loaded ${commands.size}: ${[...commands.keys()].join(', ')}`);
  return commands;
}
