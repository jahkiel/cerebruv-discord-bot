/**
 * Applies a nickname tag to a guild member, with every documented failure mode
 * handled explicitly rather than thrown.
 *
 * Known Discord limits this has to respect (see CLAUDE.md):
 *  - A bot can NEVER change the server owner's nickname, whatever permissions
 *    it has. We store the member's choice anyway and tell them to apply it by
 *    hand.
 *  - The bot needs Manage Nicknames.
 *  - The bot's highest role must sit ABOVE the target member's highest role.
 */

import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { applyTag, stripTag } from './nickname.js';

/** @enum {string} */
export const TagOutcome = {
  APPLIED: 'applied',
  UNCHANGED: 'unchanged',
  IS_SERVER_OWNER: 'is_server_owner',
  MISSING_PERMISSION: 'missing_permission',
  ROLE_TOO_LOW: 'role_too_low',
  FAILED: 'failed',
};

/**
 * What Discord currently shows for this member: their server nickname, else
 * their global display name, else their username.
 */
export function currentDisplayName(member) {
  return member.nickname ?? member.user?.globalName ?? member.user?.username ?? '';
}

/** The member's name with any tag of ours stripped off. */
export function baseNameOf(member) {
  return stripTag(currentDisplayName(member));
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {string | null} tag e.g. '🇦🇺' or '[UTC+11]'. Null removes the tag.
 * @returns {Promise<{outcome: TagOutcome, desired: string, base: string}>}
 */
export async function applyNicknameTag(member, tag) {
  const display = currentDisplayName(member);
  const base = stripTag(display);
  const desired = applyTag(display, tag, config.nicknameMaxLength);

  const alreadyCorrect = display === desired;
  const result = (outcome) => ({ outcome, desired, base, alreadyCorrect });

  // Discord refuses this unconditionally — do not waste an API call on it.
  if (member.id === member.guild.ownerId) {
    return result(TagOutcome.IS_SERVER_OWNER);
  }

  // Permission pre-flight runs BEFORE the "nothing to change" shortcut.
  //
  // Doing it the other way round produces a false success: a member whose
  // nickname already happens to match gets told it worked, hiding the fact
  // that we could never have applied it and will fail on their next change.
  // That is exactly what slipped through in testing on 2026-09-27.
  let me = null;
  try {
    me = member.guild.members.me ?? (await member.guild.members.fetchMe());
  } catch {
    // Fall through — the edit attempt below will surface the real problem.
  }

  if (me) {
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return result(TagOutcome.MISSING_PERMISSION);
    }
    try {
      if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        return result(TagOutcome.ROLE_TOO_LOW);
      }
    } catch {
      // Role cache incomplete; let the edit attempt decide.
    }
  }

  if (alreadyCorrect) {
    return result(TagOutcome.UNCHANGED);
  }

  try {
    // This string lands in the server's audit log, so it names the bot.
    await member.setNickname(desired || null, 'Cerebruv: flag / timezone tag');
    return result(TagOutcome.APPLIED);
  } catch (error) {
    // 50013 Missing Permissions covers both "no Manage Nicknames" and
    // "role hierarchy too low"; the pre-flight above usually distinguishes
    // them, so anything landing here is the hierarchy case in practice.
    if (error?.code === 50013) return result(TagOutcome.ROLE_TOO_LOW);
    console.error('[memberTag] setNickname failed', {
      member: member.id,
      server: member.guild.id,
      desired,
      code: error?.code,
    }, error);
    return result(TagOutcome.FAILED);
  }
}

/**
 * Member-facing explanation for an outcome. Returns null when it worked and
 * there is nothing to warn about.
 */
export function explainOutcome({ outcome, desired, alreadyCorrect }) {
  // Anyone blocked can still apply the tag by hand, so always hand them the
  // exact string rather than only telling them what went wrong.
  const paste =
    `\n\`\`\`\n${desired}\n\`\`\`\n` +
    '*(Right-click your name → **Edit Server Profile** → Nickname.)*';

  // When the name already matches there is nothing to paste — but the member
  // still needs to know future changes will not apply.
  const latent = '\n\nYour nickname already shows the right tag, so nothing to do right now — but I won\'t be able to update it if you change your tag later.';

  switch (outcome) {
    case TagOutcome.IS_SERVER_OWNER:
      return (
        '**Your choice is saved**, but Discord never lets a bot rename the server owner — ' +
        'not even with full permissions.' +
        (alreadyCorrect ? latent : `\n\nSet it yourself:${paste}`)
      );

    case TagOutcome.MISSING_PERMISSION:
      return (
        "**Your choice is saved**, but I don't have the **Manage Nicknames** permission " +
        'in this server.' +
        (alreadyCorrect
          ? latent
          : `\n\nSet it yourself:${paste}\n…or ask an admin to grant me that permission in ` +
            '**Server Settings → Roles**.')
      );

    case TagOutcome.ROLE_TOO_LOW:
      return (
        "**Your choice is saved**, but my role sits below yours, so Discord won't let me " +
        'rename you.' +
        (alreadyCorrect ? latent : `\n\nSet it yourself:${paste}`) +
        '\n\n*To fix this permanently, the **server owner** must drag my role above yours in ' +
        '**Server Settings → Roles**. Only the owner can do it — Discord stops anyone else ' +
        'from moving a role above their own.*'
      );

    case TagOutcome.FAILED:
      return (
        '**Your choice is saved**, but renaming you failed unexpectedly.' +
        (alreadyCorrect ? latent : `\n\nSet it yourself:${paste}`) +
        '\n\n*An admin can check the bot logs for details.*'
      );

    default:
      return null;
  }
}
