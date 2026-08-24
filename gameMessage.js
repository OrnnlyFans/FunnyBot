/**
 * Builders for the embeds, button rows and modals that make up the game-night
 * UI — shared by the slash commands and the button/modal handlers.
 *
 * The message is always a live view over the DB: the confirmed cast + an
 * editable "who's playing" roster (game_attendees).
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

/**
 * Host time presets offered on the "yes" flow. Each maps to a button; a
 * "custom" button is appended by `timeRow()`. 9:30 PM included per request.
 */
const TIME_OPTIONS = [
  { label: '8:00 PM', customId: 'time_8', hour: 20 },
  { label: '9:00 PM', customId: 'time_9', hour: 21 },
  { label: '9:30 PM', customId: 'time_9_30', hour: 21 },
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

/** Human list of tonight's players: "@User — when they'll appear". */
function participantsText(attendees = [], max = 15) {
  if (!attendees.length) return '_nobody has joined yet._';
  const lines = attendees
    .slice(0, max)
    .map((a) => `• <@${a.user_id}> ${a.join_time ? `— ${a.join_time}` : '— _anytime_'}`);
  const extra = attendees.length - max;
  if (extra > 0) lines.push(`_… and ${extra} more_`);
  return lines.join('\n');
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

/** Shown after the host clicks YES — ask for the time. */
function timeSelectionEmbed(setter) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 Are we playing tonight?')
    .setDescription('✅ **Yes** — what time?\nChoose a preset, or enter a custom time.');
  if (setter) embed.addFields({ name: '👤 Set by', value: setterLine(setter), inline: true });
  embed.setFooter({ text: 'Click a button below to pick the start time.' });
  return embed;
}

/** The final "game on" confirmation with the growing player roster. */
function confirmedEmbed(time, setter, attendees = []) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 WE\'RE PLAYING TONIGHT')
    .setDescription('✅ Game on!')
    .addFields({ name: '🕘 Start at', value: time || '_not chosen yet_', inline: true });
  if (setter) {
    embed.addFields({ name: '🕹 Host', value: setterLine(setter), inline: true });
  }
  embed.addFields({ name: `👥 Playing`, value: participantsText(attendees) });
  embed.setFooter({ text: 'Tap Join below to add yourself · /status for the full list' });
  return embed;
}

/** Final "no" state. */
function notPlayingEmbed(setter) {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('🎮 NOT PLAYING TONIGHT')
    .setDescription('❌ **Not playing tonight.**')
    .addFields({ name: '👤 Set by', value: setterLine(setter) })
    .setFooter({ text: 'Run /status for details.' });
}

/** Shown on the message after /cancel, with option to take over as host. */
function cancelledEmbed(cancelledBy, attendees = [], reason = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle('🎮 TONIGHT — CANCELLED')
    .setDescription(
      cancelledBy
        ? `⚠️ Tonight's game was cancelled by ${setterLine(cancelledBy)}.`
        : '…_game night cleared for tonight._',
    );
  if (reason) {
    embed.addFields({ name: '💬 Reason', value: reason });
  }
  if (attendees.length > 0) {
    embed.addFields({
      name: '👥 Previous Squad',
      value: participantsText(attendees),
    });
  }
  embed.setFooter({
    text: 'Want to keep the game going? Click "Take Over as Host" or "Set up again" below.',
  });
  return embed;
}

/** /status output. Shows the yes/no, host time, and the player roster. */
function statusEmbed(row, todayLong, attendees = []) {
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
    embed.addFields({ name: '🕘 Start at', value: row.time || '_not chosen yet_', inline: true });
  }

  if (row.set_by) {
    embed.addFields({
      name: '🕹 Host',
      value: setterLine({ id: row.set_by, name: row.set_by_name }),
    });
  }

  if (row.playing === 1) {
    embed.addFields({ name: '👥 Playing', value: participantsText(attendees) });
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

/** Host start-time presets (currently 4) + a custom-time button. */
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

/** Join / Leave buttons shown on the confirmed "we're playing" message. */
function rosterRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('join_night')
      .setLabel('🎮 Join')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('leave_night')
      .setLabel('🚪 Leave')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Buttons shown on a cancelled message: Take Over or Set Up Again. */
function setupAgainRow(hasPreviousAttendees = false) {
  const row = new ActionRowBuilder();
  if (hasPreviousAttendees) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('takeover_host')
        .setLabel('👑 Take Over as Host')
        .setStyle(ButtonStyle.Success),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('setup_again')
      .setLabel('🔄 Set up again')
      .setStyle(ButtonStyle.Primary),
  );
  return row;
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                       */
/* -------------------------------------------------------------------------- */

/** Host enters a custom start time. */
function customTimeModal() {
  return new ModalBuilder()
    .setCustomId('time_custom_modal')
    .setTitle('Enter a start time')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('custom_time')
          .setLabel('What time are we starting?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 9:30 PM, 930, 21:30, +15m')
          .setRequired(true),
      ),
    );
}

/** A player's own "I'll appear at this time" modal. */
function joinTimeModal() {
  return new ModalBuilder()
    .setCustomId('join_time_modal')
    .setTitle('When will you appear?')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('join_time')
          .setLabel('Your estimated join time')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 9:30 PM, 930, 10:15, +30m')
          .setRequired(true),
      ),
    );
}

/** DM version of Yes/No row with embedded guildId and date. */
function dmYesNoRow(guildId, date) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dm_play_yes:${guildId}:${date}`)
      .setLabel('✅ YES')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dm_play_no:${guildId}:${date}`)
      .setLabel('❌ NO')
      .setStyle(ButtonStyle.Danger),
  );
}

/** DM version of time selection buttons with embedded guildId and date. */
function dmTimeRow(guildId, date) {
  const row = new ActionRowBuilder();
  for (const t of TIME_OPTIONS) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dm_${t.customId}:${guildId}:${date}`)
        .setLabel(t.label)
        .setStyle(ButtonStyle.Primary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`dm_time_custom:${guildId}:${date}`)
      .setLabel('Custom time')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

/** DM version of Join/Leave buttons with embedded guildId and date. */
function dmRosterRow(guildId, date) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dm_join:${guildId}:${date}`)
      .setLabel('🎮 Join')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dm_leave:${guildId}:${date}`)
      .setLabel('🚪 Leave')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Host enters a custom start time via DM. */
function dmCustomTimeModal(guildId, date) {
  return new ModalBuilder()
    .setCustomId(`dm_custom_time_modal:${guildId}:${date}`)
    .setTitle('Enter a start time')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('custom_time')
          .setLabel('What time are we starting?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 9:30 PM')
          .setRequired(true),
      ),
    );
}

/** Player enters their appearance time via DM. */
function dmJoinTimeModal(guildId, date) {
  return new ModalBuilder()
    .setCustomId(`dm_join_time_modal:${guildId}:${date}`)
    .setTitle('When will you appear?')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('join_time')
          .setLabel('Your join time')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 9:30 PM, or around 10 PM')
          .setRequired(true),
      ),
    );
}

/** Ephemeral join choices: On Time vs Estimate/Late. */
function joinChoiceRow(startTime = '9:00 PM') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('join_ontime')
      .setLabel(`⏰ On Time (${startTime})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('join_late_modal')
      .setLabel('⏱️ Running Late / Estimate')
      .setStyle(ButtonStyle.Primary),
  );
}

/** DM version of join choices: On Time vs Estimate/Late. */
function dmJoinChoiceRow(guildId, date, startTime = '9:00 PM') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dm_join_ontime:${guildId}:${date}`)
      .setLabel(`⏰ On Time (${startTime})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dm_join_late_modal:${guildId}:${date}`)
      .setLabel('⏱️ Running Late / Estimate')
      .setStyle(ButtonStyle.Primary),
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
  participantsText,
  yesNoRow,
  timeRow,
  rosterRow,
  setupAgainRow,
  customTimeModal,
  joinTimeModal,
  dmYesNoRow,
  dmTimeRow,
  dmRosterRow,
  dmCustomTimeModal,
  dmJoinTimeModal,
  joinChoiceRow,
  dmJoinChoiceRow,
};