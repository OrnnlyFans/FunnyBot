/**
 * Handlers for non-command interactions (buttons & modal submits).
 * These drive the state machine of the single persistent prompt message:
 *
 *   pending  --[YES]-->  time-select  --[time]-->  confirmed
 *              --[NO]-->  not-playing
 *              --[custom]-->  (modal)  -->  confirmed
 *
 * The database is always the source of truth; the message is just a live view.
 */

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
  customTimeModal,
  TIME_OPTIONS,
} = require('./gameMessage');

function setterFrom(interaction) {
  return { id: interaction.user.id, name: interaction.user.username };
}

async function handleButton(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ Not available in DMs.', ephemeral: true }).catch(() => {});
    return;
  }

  const date = todayKey();
  const setter = setterFrom(interaction);

  switch (interaction.customId) {
    case 'play_yes': {
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
      db.setAnswer(guildId, date, {
        playing: 0, time: null, set_by: setter.id, set_by_name: setter.name,
      });
      await interaction.update({
        embeds: [notPlayingEmbed(setter)],
        components: [],
      });
      break;
    }

    case 'time_8':
    case 'time_9':
    case 'time_10': {
      const opt = TIME_OPTIONS.find((t) => t.customId === interaction.customId);
      db.setAnswer(guildId, date, {
        playing: 1, time: opt.label, set_by: setter.id, set_by_name: setter.name,
      });
      await interaction.update({
        embeds: [confirmedEmbed(opt.label, setter)],
        components: [],
      });
      break;
    }

    case 'time_custom': {
      // Ask for a free-form time via a modal.
      await interaction.showModal(customTimeModal());
      break;
    }

    case 'setup_again': {
      // Re-open tonight: turn the cancelled message back into the prompt and
      // wipe any lingering answer so we start from a clean pending state.
      await interaction.update({
        embeds: [pendingEmbed()],
        components: [yesNoRow()],
        content: '',
      });
      db.resetToPending(guildId, date, {
        message_id: interaction.message.id,
        channel_id: interaction.channelId,
      });
      break;
    }

    default:
      await interaction.update({ content: 'Unknown button.', components: [] }).catch(() => {});
      break;
  }
}

async function handleModal(interaction) {
  if (interaction.customId !== 'time_custom_modal') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: 'Unknown modal.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  const customTime = interaction.fields.getTextInputValue('custom_time').trim();

  if (!customTime) {
    await interaction.update({
      embeds: [timeSelectionEmbed()],
      components: [timeRow()],
      content: '❌ You must enter a time, e.g. `9:30 PM`.',
    });
    return;
  }

  if (customTime.length > 64) {
    await interaction.update({
      embeds: [timeSelectionEmbed()],
      components: [timeRow()],
      content: "❌ That's too long. Try something like `9:30 PM`.",
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.update({ content: '❌ Not available in DMs.', components: [] }).catch(() => {});
    return;
  }

  const date = todayKey();
  const setter = setterFrom(interaction);
  db.setAnswer(guildId, date, {
    playing: 1, time: customTime, set_by: setter.id, set_by_name: setter.name,
  });

  await interaction.update({
    embeds: [confirmedEmbed(customTime, setter)],
    components: [],
    content: '',
  });
}

module.exports = { handleButton, handleModal };
