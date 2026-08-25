const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { todayKey, formatUserTimeInput } = require('./utils');
const {
  pendingEmbed,
  yesNoRow,
  timeSelectionEmbed,
  timeRow,
  confirmedEmbed,
  notPlayingEmbed,
  cancelledEmbed,
  setupAgainRow,
  rosterRow,
  customTimeModal,
  joinTimeModal,
  dmYesNoRow,
  dmTimeRow,
  dmRosterRow,
  dmCustomTimeModal,
  dmJoinTimeModal,
  TIME_OPTIONS,
  gameRow,
  dmGameRow,
} = require('./gameMessage');

function setterFrom(interaction) {
  return { id: String(interaction.user.id), name: interaction.user.username };
}

/** Live "confirmed game on" update payload: embed + roster buttons. */
function confirmedOptions(guildId, date) {
  const row = db.get(guildId, date);
  const setter = row && row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
  return {
    embeds: [confirmedEmbed(row ? row.time : null, setter, db.getAttendees(guildId, date), row ? row.game : null)],
    components: [gameRow(row ? row.game : null), rosterRow()],
    content: '',
  };
}

/** DM version of confirmed options with DM roster buttons. */
function dmConfirmedOptions(guildId, date) {
  const row = db.get(guildId, date);
  const setter = row && row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
  return {
    embeds: [confirmedEmbed(row ? row.time : null, setter, db.getAttendees(guildId, date), row ? row.game : null)],
    components: [dmGameRow(guildId, date, row ? row.game : null), dmRosterRow(guildId, date)],
    content: '',
  };
}

/** Refreshes the server's main prompt message across the guild channel. */
async function refreshGuildMessage(client, guildId, date) {
  if (!client || !guildId || !date) return;
  try {
    const row = db.get(guildId, date);
    if (!row || !row.channel_id || !row.message_id) return;
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (!message) return;

    if (row.playing === 1) {
      const setter = row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
      const attendees = db.getAttendees(guildId, date);
      await message
        .edit({
          embeds: [confirmedEmbed(row.time, setter, attendees, row.game)],
          components: [gameRow(row.game), rosterRow()],
          content: '',
        })
        .catch(() => {});
    } else if (row.playing === 0) {
      const setter = row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
      await message
        .edit({
          embeds: [notPlayingEmbed(setter)],
          components: [],
          content: '',
        })
        .catch(() => {});
    } else {
      await message
        .edit({
          embeds: [pendingEmbed()],
          components: [yesNoRow()],
          content: '',
        })
        .catch(() => {});
    }
  } catch (e) {
    // Best-effort refresh
  }
}

/** Is the interaction's user a server administrator? */
function isAdmin(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

/* ---------------------------------------------------------------------- */
/* Button interactions                                                     */
/* ---------------------------------------------------------------------- */

async function handleButton(interaction) {
  const date = todayKey();
  const setter = setterFrom(interaction);

  // Handle DM button interactions
  if (interaction.customId.startsWith('dm_')) {
    const parts = interaction.customId.split(':');
    const action = parts[0];
    const guildId = parts[1];
    const targetDate = parts[2] || date;

    switch (action) {
      case 'dm_play_yes': {
        db.ensureCreator(guildId, targetDate, setter);
        db.setAnswer(guildId, targetDate, {
          playing: 1,
          time: null,
          set_by: setter.id,
          set_by_name: setter.name,
        });
        await interaction.update({
          embeds: [timeSelectionEmbed(setter)],
          components: [dmTimeRow(guildId, targetDate)],
        });
        await refreshGuildMessage(interaction.client, guildId, targetDate);
        break;
      }

      case 'dm_play_no': {
        db.ensureCreator(guildId, targetDate, setter);
        db.setAnswer(guildId, targetDate, {
          playing: 0,
          time: null,
          set_by: setter.id,
          set_by_name: setter.name,
        });
        db.clearAttendees(guildId, targetDate);
        await interaction.update({
          embeds: [notPlayingEmbed(setter)],
          components: [],
        });
        await refreshGuildMessage(interaction.client, guildId, targetDate);
        break;
      }

      case 'dm_time_8':
      case 'dm_time_9':
      case 'dm_time_9_30':
      case 'dm_time_10': {
        const customId = action.replace(/^dm_/, '');
        const opt = TIME_OPTIONS.find((t) => t.customId === customId);
        if (opt) {
          db.setAnswer(guildId, targetDate, {
            playing: 1,
            time: opt.label,
            set_by: setter.id,
            set_by_name: setter.name,
          });
          db.setAttendee(guildId, targetDate, {
            user_id: setter.id,
            user_name: setter.name,
            time_: opt.label,
          });
          await interaction.update(dmConfirmedOptions(guildId, targetDate));
          await refreshGuildMessage(interaction.client, guildId, targetDate);
        }
        break;
      }

      case 'dm_time_custom': {
        await interaction.showModal(dmCustomTimeModal(guildId, targetDate));
        break;
      }

      case 'dm_game_Valorant':
      case 'dm_game_League':
      case 'dm_game_Party':
      case 'dm_game_Any': {
        if (db.get(guildId, targetDate)?.playing !== 1) {
          await interaction
            .reply({ content: '❌ Nobody has confirmed a game tonight yet.', ephemeral: true })
            .catch(() => {});
          break;
        }
        db.setGame(guildId, targetDate, action.replace('dm_game_', ''));
        await interaction.update(dmConfirmedOptions(guildId, targetDate));
        await refreshGuildMessage(interaction.client, guildId, targetDate);
        break;
      }

      case 'dm_join':
      case 'dm_join_ontime': {
        const row = db.get(guildId, targetDate);
        if (row?.playing !== 1) {
          await interaction
            .reply({ content: '❌ Nobody has confirmed a game tonight yet.', ephemeral: true })
            .catch(() => {});
          break;
        }
        const startTime = row?.time || '9:00 PM';
        db.setAttendee(guildId, targetDate, {
          user_id: setter.id,
          user_name: setter.name,
          time_: startTime,
        });
        if (!row.set_by || row.set_by === '') {
          db.transferHost(guildId, targetDate, setter);
        }
        await interaction.update(dmConfirmedOptions(guildId, targetDate));
        await refreshGuildMessage(interaction.client, guildId, targetDate);
        break;
      }

      case 'dm_join_late_modal': {
        await interaction.showModal(dmJoinTimeModal(guildId, targetDate));
        break;
      }

      case 'dm_leave': {
        db.removeAttendee(guildId, targetDate, setter.id);
        const row = db.get(guildId, targetDate);
        if (row && row.set_by === setter.id) {
          const remaining = db.getAttendees(guildId, targetDate);
          if (remaining.length > 0) {
            const nextHost = remaining[0];
            db.transferHost(guildId, targetDate, { id: nextHost.user_id, name: nextHost.user_name });
          }
        }
        await interaction.update(dmConfirmedOptions(guildId, targetDate));
        await refreshGuildMessage(interaction.client, guildId, targetDate);
        break;
      }

      default:
        await interaction
          .update({ content: 'Unknown button.', components: [] })
          .catch(() => {});
        break;
    }
    return;
  }

  // Handle server (guild) button interactions
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction
      .reply({ content: '❌ Not available in DMs.', ephemeral: true })
      .catch(() => {});
    return;
  }

  switch (interaction.customId) {
    case 'play_yes': {
      db.ensureCreator(guildId, date, setter);
      db.setAnswer(guildId, date, {
        playing: 1,
        time: null,
        set_by: setter.id,
        set_by_name: setter.name,
      });
      await interaction.update({
        embeds: [timeSelectionEmbed(setter)],
        components: [timeRow()],
      });
      break;
    }

    case 'play_no': {
      db.ensureCreator(guildId, date, setter);
      db.setAnswer(guildId, date, {
        playing: 0,
        time: null,
        set_by: setter.id,
        set_by_name: setter.name,
      });
      db.clearAttendees(guildId, date);
      await interaction.update({
        embeds: [notPlayingEmbed(setter)],
        components: [],
      });
      break;
    }

    case 'time_8':
    case 'time_9':
    case 'time_9_30':
    case 'time_10': {
      const opt = TIME_OPTIONS.find((t) => t.customId === interaction.customId);
      db.setAnswer(guildId, date, {
        playing: 1,
        time: opt.label,
        set_by: setter.id,
        set_by_name: setter.name,
      });
      db.setAttendee(guildId, date, {
        user_id: setter.id,
        user_name: setter.name,
        time_: opt.label,
      });
      await interaction.update(confirmedOptions(guildId, date));
      break;
    }

    case 'time_custom': {
      await interaction.showModal(customTimeModal());
      break;
    }

    case 'game_Valorant':
    case 'game_League':
    case 'game_Party':
    case 'game_Any': {
      const grow = db.get(guildId, date);
      if (!grow || grow.playing !== 1) {
        await interaction
          .reply({ content: '🙅 No game is set up tonight anymore.', ephemeral: true })
          .catch(() => {});
        break;
      }
      db.setGame(guildId, date, interaction.customId.replace('game_', ''));
      await interaction.update(confirmedOptions(guildId, date));
      break;
    }

    case 'join_night':
    case 'join_ontime': {
      const row = db.get(guildId, date);
      if (row?.playing !== 1) {
        await interaction
          .reply({ content: '❌ Nobody has confirmed a game tonight yet.', ephemeral: true })
          .catch(() => {});
        break;
      }
      const startTime = row?.time || '9:00 PM';
      db.setAttendee(guildId, date, {
        user_id: setter.id,
        user_name: setter.name,
        time_: startTime,
      });
      if (!row.set_by || row.set_by === '') {
        db.transferHost(guildId, date, setter);
      }
      await interaction.update(confirmedOptions(guildId, date));
      break;
    }

    case 'join_late_modal': {
      await interaction.showModal(joinTimeModal());
      break;
    }

    case 'leave_night': {
      db.removeAttendee(guildId, date, setter.id);
      const row = db.get(guildId, date);
      if (row && row.set_by === setter.id) {
        const remaining = db.getAttendees(guildId, date);
        if (remaining.length > 0) {
          const nextHost = remaining[0];
          db.transferHost(guildId, date, { id: nextHost.user_id, name: nextHost.user_name });
        }
      }
      await interaction.update(confirmedOptions(guildId, date));
      break;
    }

    case 'takeover_host': {
      let row = db.get(guildId, date);
      const startTime = row?.time || '9:00 PM';
      db.setAnswer(guildId, date, {
        playing: 1,
        time: startTime,
        set_by: setter.id,
        set_by_name: setter.name,
      });
      db.transferHost(guildId, date, setter);
      db.setAttendee(guildId, date, {
        user_id: setter.id,
        user_name: setter.name,
        time_: startTime,
      });
      if (interaction.message) {
        db.setMessageRef(guildId, date, {
          message_id: interaction.message.id,
          channel_id: interaction.channelId,
        });
      }
      await interaction.update({
        ...confirmedOptions(guildId, date),
        content: `👑 <@${setter.id}> took over as **Host**! Game night is back **ON** for tonight!`,
      });
      break;
    }

    case 'setup_again': {
      await interaction.update({
        embeds: [pendingEmbed()],
        components: [yesNoRow()],
        content: '',
      });
      db.resetToPending(guildId, date, {
        message_id: interaction.message.id,
        channel_id: interaction.channelId,
      });
      db.ensureCreator(guildId, date, setter);
      break;
    }

    default:
      await interaction
        .update({ content: 'Unknown button.', components: [] })
        .catch(() => {});
      break;
  }
}

/* ---------------------------------------------------------------------- */
/* Modal submits                                                          */
/* ---------------------------------------------------------------------- */

/** Trim and validate a free-form time string; returns it or an error message. */
function cleanTime(raw) {
  const t = (raw || '').trim();
  if (!t) return { error: '❌ You must enter a time, e.g. `9:30 PM`.' };
  if (t.length > 64) return { error: `❌ That's too long. Try something like \`9:30 PM\`.` };
  return { value: t };
}

async function handleModal(interaction) {
  const date = todayKey();

  // DM Modal: Custom Start Time
  if (interaction.customId.startsWith('dm_custom_time_modal:')) {
    const [, guildId, targetDate] = interaction.customId.split(':');
    const { value, error } = cleanTime(interaction.fields.getTextInputValue('custom_time'));
    if (error) {
      await interaction.update({
        embeds: [timeSelectionEmbed()],
        components: [dmTimeRow(guildId, targetDate)],
        content: error,
      });
      return;
    }
    const formatted = formatUserTimeInput(value, targetDate) || value;
    const setter = setterFrom(interaction);
    db.ensureCreator(guildId, targetDate, setter);
    db.setAnswer(guildId, targetDate, {
      playing: 1,
      time: formatted,
      set_by: setter.id,
      set_by_name: setter.name,
    });
    db.setAttendee(guildId, targetDate, {
      user_id: setter.id,
      user_name: setter.name,
      time_: formatted,
    });
    await interaction.update(dmConfirmedOptions(guildId, targetDate));
    await refreshGuildMessage(interaction.client, guildId, targetDate);
    return;
  }

  // DM Modal: Join Time
  if (interaction.customId.startsWith('dm_join_time_modal:')) {
    const [, guildId, targetDate] = interaction.customId.split(':');
    if (db.get(guildId, targetDate)?.playing !== 1) {
      await interaction
        .reply({ content: '🙅 No game is set up tonight anymore.', ephemeral: true })
        .catch(() => {});
      return;
    }
    const { value, error } = cleanTime(interaction.fields.getTextInputValue('join_time'));
    if (error) {
      const opts = dmConfirmedOptions(guildId, targetDate);
      opts.content = error;
      await interaction.update(opts);
      return;
    }
    const formatted = formatUserTimeInput(value, targetDate) || value;
    const joiner = setterFrom(interaction);
    db.setAttendee(guildId, targetDate, {
      user_id: joiner.id,
      user_name: joiner.name,
      time_: formatted,
    });
    await interaction.update(dmConfirmedOptions(guildId, targetDate));
    await refreshGuildMessage(interaction.client, guildId, targetDate);
    return;
  }

  // Guild Modals
  const guildId = interaction.guildId;

  if (interaction.customId === 'time_custom_modal') {
    if (!guildId) {
      await interaction
        .update({ content: '❌ Not available in DMs.', components: [] })
        .catch(() => {});
      return;
    }
    const { value, error } = cleanTime(interaction.fields.getTextInputValue('custom_time'));
    if (error) {
      await interaction.update({
        embeds: [timeSelectionEmbed()],
        components: [timeRow()],
        content: error,
      });
      return;
    }
    const formatted = formatUserTimeInput(value, date) || value;
    const setter = setterFrom(interaction);
    db.ensureCreator(guildId, date, setter);
    db.setAnswer(guildId, date, {
      playing: 1,
      time: formatted,
      set_by: setter.id,
      set_by_name: setter.name,
    });
    db.setAttendee(guildId, date, { user_id: setter.id, user_name: setter.name, time_: formatted });
    await interaction.update(confirmedOptions(guildId, date));
    return;
  }

  if (interaction.customId === 'join_time_modal') {
    if (!guildId) {
      await interaction
        .update({ content: '❌ Not available in DMs.', components: [] })
        .catch(() => {});
      return;
    }
    if (db.get(guildId, date)?.playing !== 1) {
      await interaction
        .reply({ content: '🙅 No game is set up tonight anymore.', ephemeral: true })
        .catch(() => {});
      return;
    }
    const { value, error } = cleanTime(interaction.fields.getTextInputValue('join_time'));
    if (error) {
      const opts = confirmedOptions(guildId, date);
      opts.content = error;
      await interaction.update(opts);
      return;
    }
    const formatted = formatUserTimeInput(value, date) || value;
    const joiner = setterFrom(interaction);
    db.setAttendee(guildId, date, {
      user_id: joiner.id,
      user_name: joiner.name,
      time_: formatted,
    });
    await interaction.update(confirmedOptions(guildId, date));
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: 'Unknown modal.', ephemeral: true }).catch(() => {});
  }
}

module.exports = { handleButton, handleModal, isAdmin, refreshGuildMessage };