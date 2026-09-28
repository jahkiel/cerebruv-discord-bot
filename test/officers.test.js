import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { rmSync } from 'node:fs';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import { closeDb, getDb, initDb } from '../src/lib/db.js';
import { clearOverride, getOverride, getOverrides, setOverride } from '../src/lib/data/officers.js';
import { setOfficerRole } from '../src/lib/data/serverConfig.js';
import { resolveOfficerStatus } from '../src/lib/permissions.js';

const DB = './data/_test_officers.db';
const S1 = '111111111111111111';
const OWNER = '700000000000000000';
const MEMBER = '800000000000000000';
const OFFICER_ROLE = '900000000000000000';

const guild = { ownerId: OWNER };

function member({ id = MEMBER, roles = [], admin = false } = {}) {
  return {
    id,
    roles,
    permissions: new PermissionsBitField(admin ? PermissionFlagsBits.Administrator : 0n),
  };
}

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB}${suffix}`, { force: true });
}

describe('officer overrides', () => {
  before(() => {
    cleanup();
    initDb(DB);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM officer_overrides; DELETE FROM server_config;');
  });

  after(() => {
    closeDb();
    cleanup();
  });

  describe('storage', () => {
    it('returns null when there is no override', () => {
      assert.equal(getOverride(S1, MEMBER), null);
    });

    it('stores a grant and a denial distinctly from absent', () => {
      setOverride(S1, MEMBER, true, 'admin-1');
      assert.equal(getOverride(S1, MEMBER), true);

      setOverride(S1, MEMBER, false, 'admin-1');
      assert.equal(getOverride(S1, MEMBER), false, 'a denial must not read as "no override"');
    });

    it('clears back to no override', () => {
      setOverride(S1, MEMBER, true);
      assert.equal(clearOverride(S1, MEMBER), true);
      assert.equal(getOverride(S1, MEMBER), null);
      assert.equal(clearOverride(S1, MEMBER), false, 'nothing left to clear');
    });

    it('lists grants and denials together', () => {
      setOverride(S1, MEMBER, true);
      setOverride(S1, OWNER, false);

      const all = getOverrides(S1);
      assert.equal(all.get(MEMBER), true);
      assert.equal(all.get(OWNER), false);
    });

    it('keeps supergroups isolated', () => {
      setOverride(S1, MEMBER, true);
      assert.equal(getOverride('222222222222222222', MEMBER), null);
    });
  });

  describe('resolveOfficerStatus', () => {
    it('falls back to the officer role when no override exists', () => {
      setOfficerRole(S1, OFFICER_ROLE);

      assert.equal(resolveOfficerStatus(S1, guild, member({ roles: [OFFICER_ROLE] })), true);
      assert.equal(resolveOfficerStatus(S1, guild, member({ roles: [] })), false);
    });

    // The case that started this: nobody can assign the server owner a role.
    it('treats the server owner as an officer by default', () => {
      setOfficerRole(S1, OFFICER_ROLE);
      assert.equal(resolveOfficerStatus(S1, guild, member({ id: OWNER, roles: [] })), true);
    });

    // ...but that default must be overridable, which is the whole point.
    it('lets an explicit denial exclude the server owner', () => {
      setOfficerRole(S1, OFFICER_ROLE);
      setOverride(S1, OWNER, false);

      assert.equal(
        resolveOfficerStatus(S1, guild, member({ id: OWNER, roles: [] })),
        false,
        'a server owner who is not a supergroup officer must be excludable',
      );
    });

    it('lets a grant name an officer with no role at all', () => {
      // No officer role configured anywhere — some supergroups will work this way.
      assert.equal(resolveOfficerStatus(S1, guild, member({ roles: [] })), false);

      setOverride(S1, MEMBER, true);
      assert.equal(resolveOfficerStatus(S1, guild, member({ roles: [] })), true);
    });

    it('lets a denial override someone who holds the role', () => {
      setOfficerRole(S1, OFFICER_ROLE);
      setOverride(S1, MEMBER, false);

      assert.equal(resolveOfficerStatus(S1, guild, member({ roles: [OFFICER_ROLE] })), false);
    });

    it('treats a Discord Administrator as an officer by default', () => {
      assert.equal(resolveOfficerStatus(S1, guild, member({ admin: true })), true);
    });

    it('lets a denial override an Administrator too', () => {
      setOverride(S1, MEMBER, false);
      assert.equal(resolveOfficerStatus(S1, guild, member({ admin: true })), false);
    });

    it('accepts explicit permissions for raw interaction members', () => {
      const raw = { id: MEMBER, roles: [] };
      const admin = new PermissionsBitField(PermissionFlagsBits.Administrator);
      assert.equal(resolveOfficerStatus(S1, guild, raw, admin), true);
    });

    it('is safe with a missing member', () => {
      assert.equal(resolveOfficerStatus(S1, guild, null), false);
    });
  });
});
