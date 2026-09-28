/**
 * /bulkupdate — paste a whole roster instead of running /updatehero 40 times.
 *
 * `showModal` IS the acknowledgement for this interaction, so there is no
 * reply or defer here; the response comes from the modal submit handler in
 * src/interactions/bulkupdate.js.
 */

import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { buildModal } from '../interactions/bulkupdate.js';

export const data = new SlashCommandBuilder()
  .setName('bulkupdate')
  .setDescription('Paste a list to set levels and prestige for many heroes at once')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  return interaction.showModal(buildModal());
}
