/**
 * /sgroster — the whole supergroup, paginated.
 *
 * Posts publicly (2026-09-27, reversing the earlier ephemeral decision): the
 * roster is a shared view, and a private one meant only the person who ran it
 * ever saw it.
 *
 * The pagination buttons are scoped to whoever ran the command — see
 * interactions/sgroster.js — so a passer-by cannot flip the page under them.
 */

import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { buildPage } from '../interactions/sgroster.js';
import { replyPublic } from '../lib/respond.js';

export const data = new SlashCommandBuilder()
  .setName('sgroster')
  .setDescription('Show the whole supergroup roster')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  return replyPublic(
    interaction,
    buildPage(interaction.guildId, 0, interaction.user.id, interaction.guild?.name),
  );
}
