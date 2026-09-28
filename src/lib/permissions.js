/**
 * The three permission tiers. See the table in CLAUDE.md.
 *
 *   Superadmin  — Discord user ID in SUPERADMIN_IDS. Deliberately not a role,
 *                 because it must work in every server the bot joins.
 *   SG Admin    — server owner, OR Discord Administrator, OR the configured
 *                 officer role. The first two are automatic fallbacks so a new
 *                 supergroup is never locked out before configuring anything.
 *   Member      — everyone else.
 *
 * IMPORTANT: `default_member_permissions` set at command registration is a UI
 * hint only — server admins can override it in Server Settings → Integrations.
 * It hides admin commands from the picker; it is NOT the security boundary.
 * Every admin handler must also call requireSgAdmin() at runtime.
 */

import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { getServerConfig } from './data/serverConfig.js';
import { getOverride } from './data/officers.js';

export function isSuperadmin(userId) {
  return config.superadminIds.includes(String(userId));
}

/**
 * Role membership, tolerant of both shapes `interaction.member.roles` can take.
 * With the Guilds-only intent the member object is built from the interaction
 * payload, so roles may arrive as a manager with a populated cache or as a
 * plain array of role IDs.
 */
export function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  const roles = member.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(roleId);
  if (roles.cache?.has) return roles.cache.has(roleId);
  if (typeof roles.has === 'function') return roles.has(roleId);
  return false;
}

/**
 * The DEFAULT officer rule, before any explicit override is considered.
 *
 * The owner/Administrator fallback exists because Discord puts the server owner
 * above all role hierarchy — nobody, not even an Administrator, can assign them
 * the officer role. Requiring the role would permanently exclude the one person
 * most obviously in charge.
 *
 * Deliberately does NOT include superadmin: that is a bot-operator capability
 * from .env, not a rank within any particular supergroup.
 *
 * Prefer resolveOfficerStatus() — this is only the fallback half of the rule.
 *
 * @param {object} guild        discord.js Guild (for ownerId)
 * @param {object} member       GuildMember, or the member on an interaction
 * @param {string|null} officerRoleId
 * @param {object} [permissions] explicit permissions, for interaction members
 *                               whose `permissions` arrives as a raw bitfield
 */
export function isOfficerMember(guild, member, officerRoleId, permissions = null) {
  if (!member) return false;

  const memberId = member.id ?? member.user?.id;
  if (guild?.ownerId && memberId && guild.ownerId === memberId) return true;

  const perms = permissions ?? member.permissions;
  if (perms?.has?.(PermissionFlagsBits.Administrator)) return true;

  return hasRole(member, officerRoleId);
}

/**
 * Officer status as actually shown in /sgroster.
 *
 *   1. an explicit override (grant or deny) always wins
 *   2. otherwise the role / owner / Administrator default applies
 *
 * Both override directions matter: a supergroup may name officers individually
 * without using a role at all, and a server owner who is not a supergroup
 * officer must be excludable.
 */
export function resolveOfficerStatus(serverId, guild, member, permissions = null) {
  if (!member) return false;

  const memberId = member.id ?? member.user?.id;
  if (memberId) {
    const override = getOverride(serverId, memberId);
    if (override !== null) return override;
  }

  const { officerRoleId } = getServerConfig(serverId);
  return isOfficerMember(guild, member, officerRoleId, permissions);
}

export function isSgAdmin(interaction) {
  if (isSuperadmin(interaction.user.id)) return true;
  if (interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user.id) return true;

  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;

  const { officerRoleId } = getServerConfig(interaction.guildId);
  return hasRole(interaction.member, officerRoleId);
}

/**
 * @returns {{ok: true} | {ok: false, message: string}} a ready-to-send refusal
 */
export function requireSgAdmin(interaction) {
  if (isSgAdmin(interaction)) return { ok: true };

  const { officerRoleId } = getServerConfig(interaction.guildId);
  const who = officerRoleId
    ? `the server owner, an Administrator, or someone with <@&${officerRoleId}>`
    : 'the server owner or an Administrator';

  return {
    ok: false,
    message:
      `You need to be ${who} to use that.\n` +
      (officerRoleId
        ? ''
        : '\n*No officer role is configured for this server yet, so only the owner and Administrators qualify.*'),
  };
}

export function requireSuperadmin(interaction) {
  if (isSuperadmin(interaction.user.id)) return { ok: true };
  return {
    ok: false,
    message: 'That command is restricted to the bot operator.',
  };
}
