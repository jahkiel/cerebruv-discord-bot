/**
 * /help — what every command does, in plain language.
 *
 * The text is hand-written rather than generated from command descriptions,
 * because a one-line option description and a useful explanation are different
 * things. To stop it drifting, test/help.test.js asserts that every registered
 * command appears here and that nothing here is invented — so adding a command
 * without documenting it fails the suite.
 */

import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';

import { allHeroes } from '../lib/heroes.js';
import { isSgAdmin } from '../lib/permissions.js';
import { replyEphemeral } from '../lib/respond.js';

const BRAND = 0x2f8f4e;

/** `command` must match a registered slash command name. */
export const HELP_SECTIONS = [
  {
    title: '🌏 Set yourself up',
    items: [
      {
        command: 'setup',
        usage: '/setup timezone',
        text: 'Put a country flag or UTC offset next to your name, so the supergroup can see when you are likely online. `/setup clear` removes it.',
      },
      {
        command: 'myheroes',
        usage: '/myheroes',
        text: 'Tick which heroes you have unlocked. Three pages, about a minute. This is what drives everyone\'s hero count.',
      },
      {
        command: 'setmains',
        usage: '/setmains',
        text: 'Pick your 1–3 main heroes. The first one shows beside your name in the supergroup roster.',
      },
      {
        command: 'updatehero',
        usage: '/updatehero',
        text: 'Record your level and prestige for one hero. Worth doing for the heroes you actually play.',
      },
      {
        command: 'bulkupdate',
        usage: '/bulkupdate',
        text: 'Paste a whole list at once — one hero per line, like `Wolverine 60 6`. Far quicker than doing them one at a time.',
      },
    ],
  },
  {
    title: '🔍 Look things up',
    items: [
      {
        command: 'roster',
        usage: '/roster [user]',
        text: 'Every hero someone has unlocked, best progress first. Yours if you do not name anyone.',
      },
      {
        command: 'profile',
        usage: '/profile [user]',
        text: 'The summary: timezone, mains, hero count and their furthest-along heroes.',
      },
      {
        command: 'sgroster',
        usage: '/sgroster',
        text: 'The whole supergroup, officers first. Use ◀ ▶ to page through.',
      },
      {
        command: 'whohas',
        usage: '/whohas hero:',
        text: 'Who has a particular hero, and how far along they are. Handy when you need someone for a specific run.',
      },
      {
        command: 'boxodds',
        usage: '/boxodds [boxes]',
        text: 'Your chance of pulling a new hero from a Random Hero Box, worked out from what you have ticked in /myheroes.',
      },
    ],
  },
  {
    title: '⭐ Officers only',
    adminOnly: true,
    items: [
      {
        command: 'admin',
        usage: '/admin panel',
        text: 'Post the flag/timezone panel in the current channel, or refresh the one already posted.',
      },
      {
        command: 'admin',
        usage: '/admin config',
        text: 'Set the officer role, or view the current settings. That role grants these commands and sorts those members to the top of the roster.',
      },
      {
        command: 'admin',
        usage: '/admin officer',
        text: 'Mark one person as an officer, or exclude them. Beats the role — useful when someone has no role, or owns the server but is not an officer.',
      },
      {
        command: 'admin',
        usage: '/admin reload',
        text: 'Reload the hero and country data files after editing them, without restarting the bot.',
      },
    ],
  },
];

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('What Cerebruv can do')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const admin = isSgAdmin(interaction);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Cerebruv')
    .setDescription(
      'I keep track of who plays what in the supergroup — heroes, levels and timezones.\n\n' +
        '**Everything you tell me is self-reported.** There is no connection to the game server, ' +
        'so the roster is only as accurate as what people enter.',
    );

  for (const section of HELP_SECTIONS) {
    if (section.adminOnly && !admin) continue;

    embed.addFields({
      name: section.title,
      value: section.items
        .map((item) => `**${item.usage}**\n${item.text}`)
        .join('\n\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: `${allHeroes().length} heroes tracked · roster lookups post in the channel, everything else is private to you`,
  });

  return replyEphemeral(interaction, { embeds: [embed] });
}
