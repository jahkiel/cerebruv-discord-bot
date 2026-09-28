import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

import { hasRole, isOfficerMember } from '../src/lib/permissions.js';

const OWNER = 'owner-1';
const OFFICER_ROLE = 'role-officer';

const guild = { ownerId: OWNER };

/** Stand-in for a discord.js GuildMember. */
function member({ id = 'member-1', roles = [], admin = false } = {}) {
  return {
    id,
    roles: { cache: new Set(roles), has: (r) => roles.includes(r) },
    permissions: new PermissionsBitField(admin ? PermissionFlagsBits.Administrator : 0n),
  };
}

describe('hasRole', () => {
  it('reads a roles cache', () => {
    const m = { roles: { cache: new Map([[OFFICER_ROLE, {}]]) } };
    assert.equal(hasRole(m, OFFICER_ROLE), true);
    assert.equal(hasRole(m, 'other'), false);
  });

  // With the Guilds-only intent the member can arrive as a raw payload where
  // roles is a plain array of ids rather than a manager.
  it('reads a plain array of role ids', () => {
    assert.equal(hasRole({ roles: [OFFICER_ROLE] }, OFFICER_ROLE), true);
    assert.equal(hasRole({ roles: [] }, OFFICER_ROLE), false);
  });

  it('is safe with missing input', () => {
    assert.equal(hasRole(null, OFFICER_ROLE), false);
    assert.equal(hasRole({ roles: [OFFICER_ROLE] }, null), false);
  });
});

describe('isOfficerMember', () => {
  it('counts someone holding the officer role', () => {
    const m = member({ roles: [OFFICER_ROLE] });
    assert.equal(isOfficerMember(guild, m, OFFICER_ROLE), true);
  });

  it('does not count an ordinary member', () => {
    assert.equal(isOfficerMember(guild, member(), OFFICER_ROLE), false);
  });

  // The case that prompted this: Discord puts the server owner above all role
  // hierarchy, so nobody — not even an Administrator — can assign them the
  // officer role. Requiring the role would permanently exclude the one person
  // who most obviously belongs at the top of the roster.
  it('always counts the server owner, with no role at all', () => {
    const owner = member({ id: OWNER });
    assert.equal(hasRole(owner, OFFICER_ROLE), false, 'owner genuinely has no role here');
    assert.equal(isOfficerMember(guild, owner, OFFICER_ROLE), true);
  });

  it('counts the server owner even before any officer role is configured', () => {
    assert.equal(isOfficerMember(guild, member({ id: OWNER }), null), true);
  });

  it('counts a Discord Administrator', () => {
    assert.equal(isOfficerMember(guild, member({ admin: true }), OFFICER_ROLE), true);
    assert.equal(isOfficerMember(guild, member({ admin: true }), null), true);
  });

  it('accepts explicit permissions for interaction members', () => {
    // interaction.memberPermissions is passed separately because a raw
    // interaction member's `permissions` is a bitfield string, not an object.
    const raw = { id: 'x', roles: [] };
    const perms = new PermissionsBitField(PermissionFlagsBits.Administrator);
    assert.equal(isOfficerMember(guild, raw, OFFICER_ROLE, perms), true);
    assert.equal(isOfficerMember(guild, raw, OFFICER_ROLE, null), false);
  });

  it('is safe with missing input', () => {
    assert.equal(isOfficerMember(guild, null, OFFICER_ROLE), false);
    assert.equal(isOfficerMember(null, member(), OFFICER_ROLE), false);
  });
});
