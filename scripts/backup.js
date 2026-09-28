/**
 * Timestamped database backup. Run with `npm run backup`.
 *
 * Uses SQLite's online backup API rather than copying the file. In WAL mode a
 * plain file copy can capture a torn database — recent commits live in the
 * -wal sidecar, so copying only the .db can silently lose them. The backup API
 * produces one consistent file and is safe to run while the bot is live.
 *
 * On the Oracle VM, run it from cron:
 *   0 4 * * *  cd /home/ubuntu/heroes-international-bot && /usr/bin/npm run backup
 */

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config } from '../src/config.js';
import { openReadOnly } from '../src/lib/db.js';

const KEEP = 14; // roughly a fortnight of nightly backups
const BACKUP_DIR = resolve('backups');

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
const target = join(BACKUP_DIR, `bot-${stamp}.db`);

let db;
try {
  db = openReadOnly(config.databasePath);
} catch (error) {
  if (error?.code === 'SQLITE_CANTOPEN') {
    console.error(`No database at ${config.databasePath} — nothing to back up yet.`);
    process.exit(1);
  }
  throw error;
}

try {
  await db.backup(target);
  const size = (statSync(target).size / 1024).toFixed(1);
  console.log(`Backed up to ${target} (${size} KB)`);
} finally {
  db.close();
}

// Prune the oldest, so an unattended cron job cannot fill the disk.
const backups = readdirSync(BACKUP_DIR)
  .filter((f) => f.startsWith('bot-') && f.endsWith('.db'))
  .sort();

const stale = backups.slice(0, Math.max(0, backups.length - KEEP));
for (const file of stale) {
  unlinkSync(join(BACKUP_DIR, file));
  console.log(`Pruned old backup ${file}`);
}

console.log(`${Math.min(backups.length, KEEP)} backup(s) retained (keeping the newest ${KEEP}).`);
