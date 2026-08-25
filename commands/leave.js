const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey } = require('../utils');
const { confirmedEmbed, gameRow, rosterRow } = require('../gameMessage');
const { refreshGuildMessage } = require('../handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription("Leave tonight's game night roster."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: '❌ This command only works inside a server.',
        ephemeral: true,
      });
    }

    const date = todayKey();
    const userId = String(interaction.user.id);
    const row = db.get(guildId, date);

    db.removeAttendee(guildId, date, userId);

    // If host leaves, promote next player in line
    if (row && row.set_by === userId) {
      const remaining = db.getAttendees(guildId, date);
      if (remaining.length > 0) {
        const nextHost = remaining[0];
        db.transferHost(guildId, date, { id: nextHost.user_id, name: nextHost.user_name });
      }
    }

    const updatedRow = db.get(guildId, date);
    if (updatedRow && updatedRow.playing === 1) {
      const setter = updatedRow.set_by
        ? { id: updatedRow.set_by, name: updatedRow.set_by_name }
        : null;
      const attendees = db.getAttendees(guildId, date);
      await interaction.reply({
        content: `🚪 <@${userId}> left tonight's roster.`,
        embeds: [confirmedEmbed(updatedRow.time, setter, attendees, updatedRow.game)],
        components: [gameRow(updatedRow.game), rosterRow()],
      });
    } else {
      await interaction.reply({
        content: `🚪 <@${userId}> left tonight's roster.`,
        ephemeral: true,
      });
    }

    await refreshGuildMessage(interaction.client, guildId, date);
  },
};
