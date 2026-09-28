/**
 * SQLite connection and migration runner.
 *
 * This is the only module that imports better-sqlite3. Everything else goes
 * through src/lib/data/*, so swapping the driver is a change to two files.
 */

import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../../migrations');

/** @type {import('better-sqlite3').Database | null} */
let db = null;

export function initDb(path) {
  if (db) return db;

  mkdirSync(dirname(resolve(path)), { recursive: true });
  db = new Database(resolve(path));

  // WAL lets a future read-only web dashboard read the same file while the bot
  // is writing to it.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first.');
  return db;
}

/**
 * A separate read-only connection that does NOT run migrations.
 *
 * Used by the backup script, and by the future web dashboard, which must be
 * able to read the file without any chance of mutating it. Callers own the
 * returned connection and must close it.
 */
export function openReadOnly(path) {
  return new Database(resolve(path), { readonly: true, fileMustExist: true });
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Applies any numbered .sql file in migrations/ that hasn't run yet, in
 * filename order, each inside its own transaction.
 */
function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (!Number.isInteger(version)) {
      throw new Error(`Migration filename must start with a number: ${file}`);
    }
    if (applied.has(version)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const apply = database.transaction(() => {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
    });

    apply();
    console.log(`[db] applied migration ${file}`);
  }
}

/** ISO-8601 UTC timestamp — the format every *_at column uses. */
export function now() {
  return new Date().toISOString();
}
