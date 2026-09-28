import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TagOutcome, applyNicknameTag, explainOutcome } from '../src/lib/memberTag.js';

const AU = '🇦🇺';

/**
 * Minimal stand-in for a discord.js GuildMember — just the surface
 * applyNicknameTag actually touches.
 */
function fakeMember({
  id = 'member-1',
  ownerId = 'someone-else',
  nickname = null,
  username = 'Jahkiel',
  botHasManageNicknames = true,
  botRoleIsAbove = true,
  setNicknameThrows = null,
} = {}) {
  const calls = [];

  const member = {
    id,
    nickname,
    user: { username, globalName: null },
    roles: { highest: { position: 5 } },
    guild: {
      ownerId,
      members: {
        me: {
          permissions: { has: () => botHasManageNicknames },
          roles: {
            highest: { comparePositionTo: () => (botRoleIsAbove ? 1 : -1) },
          },
        },
      },
    },
    async setNickname(value) {
      calls.push(value);
      if (setNicknameThrows) throw setNicknameThrows;
    },
  };

  return { member, calls };
}

describe('applyNicknameTag', () => {
  it('applies a tag when everything is in order', async () => {
    const { member, calls } = fakeMember();
    const result = await applyNicknameTag(member, AU);

    assert.equal(result.outcome, TagOutcome.APPLIED);
    assert.equal(result.desired, `Jahkiel ${AU}`);
    assert.deepEqual(calls, [`Jahkiel ${AU}`]);
  });

  it('never attempts to rename the server owner', async () => {
    const { member, calls } = fakeMember({ id: 'owner-1', ownerId: 'owner-1' });
    const result = await applyNicknameTag(member, AU);

    assert.equal(result.outcome, TagOutcome.IS_SERVER_OWNER);
    assert.deepEqual(calls, [], 'must not waste an API call Discord always refuses');
  });

  it('reports the hierarchy problem without calling the API', async () => {
    const { member, calls } = fakeMember({ botRoleIsAbove: false });
    const result = await applyNicknameTag(member, AU);

    assert.equal(result.outcome, TagOutcome.ROLE_TOO_LOW);
    assert.deepEqual(calls, []);
  });

  it('reports a missing Manage Nicknames permission', async () => {
    const { member } = fakeMember({ botHasManageNicknames: false });
    const result = await applyNicknameTag(member, AU);
    assert.equal(result.outcome, TagOutcome.MISSING_PERMISSION);
  });

  it('skips the API call when the name is already correct', async () => {
    const { member, calls } = fakeMember({ nickname: `Jahkiel ${AU}` });
    const result = await applyNicknameTag(member, AU);

    assert.equal(result.outcome, TagOutcome.UNCHANGED);
    assert.equal(result.alreadyCorrect, true);
    assert.deepEqual(calls, []);
  });

  // REGRESSION (2026-09-27): the "nothing to change" shortcut used to run
  // BEFORE the permission pre-flight. A member who had set the tag by hand was
  // told it worked, hiding the fact that the bot could never rename them and
  // would fail on their next change.
  it('does NOT report success when the name already matches but the bot is blocked', async () => {
    const { member, calls } = fakeMember({
      nickname: `Jahkiel ${AU}`,
      botRoleIsAbove: false,
    });
    const result = await applyNicknameTag(member, AU);

    assert.equal(
      result.outcome,
      TagOutcome.ROLE_TOO_LOW,
      'a matching nickname must not mask a permission failure',
    );
    assert.equal(result.alreadyCorrect, true);
    assert.deepEqual(calls, []);
    assert.ok(explainOutcome(result), 'the member must still be warned');
  });

  it('same false-success trap, for a missing permission', async () => {
    const { member } = fakeMember({
      nickname: `Jahkiel ${AU}`,
      botHasManageNicknames: false,
    });
    const result = await applyNicknameTag(member, AU);
    assert.equal(result.outcome, TagOutcome.MISSING_PERMISSION);
  });

  it('maps a 50013 rejection to the hierarchy message', async () => {
    const error = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    const { member } = fakeMember({ setNicknameThrows: error });
    const result = await applyNicknameTag(member, AU);
    assert.equal(result.outcome, TagOutcome.ROLE_TOO_LOW);
  });

  it('strips the tag when given a null tag', async () => {
    const { member, calls } = fakeMember({ nickname: `Jahkiel ${AU}` });
    const result = await applyNicknameTag(member, null);

    assert.equal(result.outcome, TagOutcome.APPLIED);
    assert.deepEqual(calls, ['Jahkiel']);
  });
});

describe('explainOutcome', () => {
  it('says nothing when the tag applied cleanly', () => {
    assert.equal(explainOutcome({ outcome: TagOutcome.APPLIED, desired: 'x' }), null);
    assert.equal(explainOutcome({ outcome: TagOutcome.UNCHANGED, desired: 'x' }), null);
  });

  it('hands a blocked member the exact string to paste', () => {
    for (const outcome of [
      TagOutcome.IS_SERVER_OWNER,
      TagOutcome.ROLE_TOO_LOW,
      TagOutcome.MISSING_PERMISSION,
      TagOutcome.FAILED,
    ]) {
      const text = explainOutcome({ outcome, desired: `Jahkiel ${AU}`, alreadyCorrect: false });
      assert.ok(text.includes(`Jahkiel ${AU}`), `${outcome} should include the nickname`);
      assert.ok(text.includes('```'), `${outcome} should offer a copy-paste block`);
    }
  });

  it('warns about future changes instead when the name already matches', () => {
    const text = explainOutcome({
      outcome: TagOutcome.ROLE_TOO_LOW,
      desired: `Jahkiel ${AU}`,
      alreadyCorrect: true,
    });
    assert.ok(!text.includes('```'), 'nothing to paste when it already matches');
    assert.ok(/later/i.test(text), 'must warn that future changes will not apply');
  });

  it('names the server owner as the only one who can fix the hierarchy', () => {
    const text = explainOutcome({ outcome: TagOutcome.ROLE_TOO_LOW, desired: 'x' });
    assert.ok(/server owner/i.test(text));
  });
});
