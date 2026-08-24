/**
 * Handlers for non-command interactions (buttons & modal submits).
 *
 * Drives the state machine of the single persistent prompt message:
 *
 *   pending  --[YES]-->  host picks a time  -> confirmed (game on)
 *              --[NO]-->  not playing
 *   confirmed --[Join]-->  (modal: your time) -> added to roster
 *             --[Leave]-->  removed from roster
 *
 * Everything is scoped by the interaction's guild id, so one server's buttons
 * can never touch another server's game night.
 */

const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { todayKey } = require('./utils');
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
  TIME_OPTIONS,
} = require('./gameMessage');

function setterFrom(interaction) {
  return { id: String(interaction.user.id), name: interaction.user.username };
}

/** Live "confirmed game on" update payload: embed + roster buttons. */
function confirmedOptions(guildId, date) {
  const row = db.get(guildId, date);
  const setter = row && row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
  return {
    embeds: [confirmedEmbed(row.time, setter, db.getAttendees(guildId, date))],
    components: [rosterRow()],
    content: '',
  };
}

/** Is the interaction's user a server administrator? */
function isAdmin(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

/* ---------------------------------------------------------------------- */
/* Button interactions                                                     */
/* ---------------------------------------------------------------------- */

async function handleButton(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction
      .reply({ content: '❌ Not available in DMs.', ephemeral: true })
      .catch(() => {});
    return;
  }

  const date = todayKey();
  const setter = setterFrom(interaction);

  switch (interaction.customId) {
    case 'play_yes': {
      db.ensureCreator(guildId, date, setter);
      db.setAnswer(guildId, date, {
        playing: 1, time: null, set_by: setter.id, set_by_name: setter.name,
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
        playing: 0, time: null, set_by: setter.id, set_by_name: setter.name,
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
        playing: 1, time: opt.label, set_by: setter.id, set_by_name: setter.name,
      });
      db.setAttendee(guildId, date, {
        user_id: setter.id, user_name: setter.name, time_: opt.label,
      });
      await interaction.update(confirmedOptions(guildId, date));
      break;
    }

    case 'time_custom': {
      await interaction.showModal(customTimeModal());
      break;
    }

    case 'join_night': {
      if (db.get(guildId, date)?.playing !== 1) {
        await interaction
          .reply({ content: '❌ Nobody has confirmed a game tonight yet.', ephemeral: true })
          .catch(() => {});
        break;
      }
      await interaction.showModal(joinTimeModal());
      break;
    }

    case 'leave_night': {
      db.removeAttendee(guildId, date, setter.id);
      await interaction.update(confirmedOptions(guildId, date));
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
  const guildId = interaction.guildId;
  const date = todayKey();

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
    const setter = setterFrom(interaction);
    db.ensureCreator(guildId, date, setter);
    db.setAnswer(guildId, date, {
      playing: 1, time: value, set_by: setter.id, set_by_name: setter.name,
    });
    db.setAttendee(guildId, date, { user_id: setter.id, user_name: setter.name, time_: value });
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
    const joiner = setterFrom(interaction);
    db.setAttendee(guildId, date, {
      user_id: joiner.id, user_name: joiner.name, time_: value,
    });
    await interaction.update(confirmedOptions(guildId, date));
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: 'Unknown modal.', ephemeral: true }).catch(() => {});
  }
}

module.exports = { handleButton, handleModal, isAdmin };