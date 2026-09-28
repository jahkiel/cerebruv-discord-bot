/**
 * /myheroes — tick everything you own, three pages of 25.
 *
 * The heavy lifting lives in src/interactions/myheroes.js so the component
 * handlers are routed by custom_id and survive a restart.
 */

import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { buildPage } from '../interactions/myheroes.js';
import { replyEphemeral } from '../lib/respond.js';

export const data = new SlashCommandBuilder()
  .setName('myheroes')
  .setDescription('Tick which heroes you have unlocked')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  return replyEphemeral(interaction, buildPage(interaction.guildId, interaction.user.id, 0));
}
