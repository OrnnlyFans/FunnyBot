const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatTodayLong } = require('../utils');
const { statusEmbed } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription("Show tonight's game-night status."),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: '❌ This command only works inside a server.',
        ephemeral: true,
      });
      return;
    }

    const row = db.get(guildId, todayKey());
    const attendees = db.getAttendees(guildId, todayKey());
    await interaction.reply({
      embeds: [statusEmbed(row, formatTodayLong(), attendees)],
    });
  },
};
