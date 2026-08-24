/**
 * Builders for the embeds, button rows and modal that make up the
 * game-night UI. Keeping these here lets both the slash commands and the
 * button/modal handlers stay tiny and consistent.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/** Preset time buttons shown after someone answers "Yes". */
const TIME_OPTIONS = [
  { label: '8:00 PM', customId: 'time_8', hour: 20 },
  { label: '9:00 PM', customId: 'time_9', hour: 21 },
  { label: '10:00 PM', customId: 'time_10', hour: 22 },
];

const COLORS = {
  prompt: 0x8a2be2,   // purple
  success: 0x23a552,  // green
  danger: 0xe74c3c,   // red
  info: 0x3498db,     // blue
  neutral: 0x95a5a6,  // grey
};

/** Render a "set by" value as a mention (falling back to the name). */
function setterLine(setter) {
  if (!setter) return '_unknown_';
  if (setter.id) return `<@${setter.id}>`;
  return setter.name || '_unknown_';
}

/* -------------------------------------------------------------------------- */
/* Embeds                                                                        */
/* -------------------------------------------------------------------------- */

/** The initial "are we playing tonight?" prompt. */
function pendingEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.prompt)
    .setTitle('🎮 Are we playing tonight?')
    .setDescription('_Nobody has answered yet._')
    .setFooter({ text: 'Click a button below to answer.' });
}

/** Shown after someone clicks YES — ask for the time. */
function timeSelectionEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 Are we playing tonight?')
    .setDescription('✅ **Yes** — what time?\nChoose a preset, or enter a custom time.')
    .setFooter({ text: 'Click a button below to pick a time.' });
}

/** The final confirmation: we're playing at `time`. */
function confirmedEmbed(time, setter) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 TONIGHT')
    .setDescription('✅ **We\'re playing!**')
    .addFields({ name: '🕘 Time', value: time || '_not chosen yet_', inline: true });
  if (setter) {
    embed.addFields({ name: '👤 Set by', value: setterLine(setter), inline: true });
  }
  embed.setFooter({ text: 'Run /status for details.' });
  return embed;
}

/** Final "no" state. */
function notPlayingEmbed(setter) {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('🎮 TONIGHT')
    .setDescription('❌ **Not playing tonight.**')
    .addFields({ name: '👤 Set by', value: setterLine(setter) })
    .setFooter({ text: 'Run /status for details.' });
}

/** Shown on the (now stale) message after /cancel. */
function cancelledEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle('🎮 TONIGHT')
    .setDescription('…_game night cleared for tonight._')
    .setFooter({ text: 'Run /tonight to start fresh, or click "Set up again" below.' });
}

/** /status output. Handles pending + answered states. */
function statusEmbed(row, todayLong) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🎮 Tonight\'s Game')
    .setTimestamp();

  if (!row || row.playing === null) {
    embed.setDescription(
      `${todayLong}\n\n_Nobody has answered yet. Run \`/tonight\` to set up the prompt._`,
    );
    embed.addFields({ name: '🎮 Playing', value: '_pending_', inline: true });
    return embed;
  }

  embed.setDescription(todayLong)
    .addFields({ name: '🎮 Playing', value: row.playing === 1 ? '✅ Yes' : '❌ No', inline: true });

  if (row.playing === 1) {
    embed.addFields({ name: '🕘 Time', value: row.time || '_not chosen yet_', inline: true });
  }

  if (row.set_by) {
    embed.addFields({
      name: '👤 Set by',
      value: setterLine({ id: row.set_by, name: row.set_by_name }),
    });
  }

  return embed;
}

/* -------------------------------------------------------------------------- */
/* Action rows                                                                 */
/* -------------------------------------------------------------------------- */

function yesNoRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('play_yes')
      .setLabel('✅ YES')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('play_no')
      .setLabel('❌ NO')
      .setStyle(ButtonStyle.Danger),
  );
}

function timeRow() {
  const row = new ActionRowBuilder();
  for (const t of TIME_OPTIONS) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(t.customId)
        .setLabel(t.label)
        .setStyle(ButtonStyle.Primary),
    );
    }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('time_custom')
      .setLabel('Custom time')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

/** A "re-open tonight" button for the cancelled message. */
function setupAgainRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_again')
      .setLabel('🔄 Set up again')
      .setStyle(ButtonStyle.Primary),
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

/** A modal prompting for a custom time string. */
function customTimeModal() {
  return new ModalBuilder()
    .setCustomId('time_custom_modal')
    .setTitle('Enter a time')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('custom_time')
          .setLabel('What time are we playing?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 9:30 PM')
          .setRequired(true),
      ),
    );
}

module.exports = {
  COLORS,
  TIME_OPTIONS,
  pendingEmbed,
  timeSelectionEmbed,
  confirmedEmbed,
  notPlayingEmbed,
  cancelledEmbed,
  statusEmbed,
  yesNoRow,
  timeRow,
  setupAgainRow,
  customTimeModal,
};
