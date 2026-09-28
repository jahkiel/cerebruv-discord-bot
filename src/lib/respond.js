/**
 * Interaction reply helpers.
 *
 * Discord closes an interaction after 3 seconds if it has not been
 * acknowledged, which surfaces to the member as "This interaction failed".
 * Every path through the bot goes through one of these so that never happens,
 * and so a failure to reply is logged rather than thrown into the void.
 */

import { MessageFlags } from 'discord.js';

function context(interaction) {
  return {
    type: interaction.type,
    id: interaction.commandName ?? interaction.customId ?? '(unknown)',
    user: interaction.user?.tag ?? interaction.user?.id,
    server: interaction.guildId,
  };
}

/**
 * Acknowledges immediately for work that may exceed Discord's 3-second window
 * (anything doing REST calls in a loop). Follow with replyEphemeral, which
 * detects the deferred state and edits instead of replying.
 */
export async function deferEphemeral(interaction) {
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch (error) {
    console.error('[respond] deferEphemeral failed', context(interaction), error);
    return false;
  }
}

/** Sends (or edits, if already acknowledged) an ephemeral reply. */
export async function replyEphemeral(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      // editReply rejects `flags`; the original reply already set ephemeral.
      const { flags, ...rest } = payload;
      return await interaction.editReply(rest);
    }
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('[respond] replyEphemeral failed', context(interaction), error);
    return null;
  }
}

/**
 * Posts visibly in the channel.
 *
 * Used by the lookup commands — /roster, /profile, /sgroster and /whohas —
 * because they answer questions the whole supergroup has. "Who has Gambit?" is
 * useless as a private answer: the asker would just have to retype it.
 *
 * Data-entry commands stay ephemeral: their multi-step pickers would flood the
 * channel, and nobody else needs to watch someone tick 63 boxes.
 */
export async function replyPublic(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    console.error('[respond] replyPublic failed', context(interaction), error);
    return null;
  }
}

/**
 * For component interactions: replaces the existing ephemeral message in place
 * so the flow feels like one screen rather than a stack of messages.
 */
export async function updateInPlace(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }
    return await interaction.update(payload);
  } catch (error) {
    console.error('[respond] updateInPlace failed', context(interaction), error);
    return null;
  }
}

/**
 * Last-resort acknowledgement used by the router's error boundary, so a thrown
 * handler still closes the interaction cleanly.
 */
export async function replyError(interaction, message) {
  const payload = {
    content: `⚠️ ${message}`,
    embeds: [],
    components: [],
  };
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('[respond] replyError failed', context(interaction), error);
    return null;
  }
}
