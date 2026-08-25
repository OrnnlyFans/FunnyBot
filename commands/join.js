const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatUserTimeInput } = require('../utils');
const { confirmedEmbed, gameRow, rosterRow } = require('../gameMessage');
const { refreshGuildMessage } = require('../handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription("Join tonight's game night roster.")
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('Your arrival time (e.g. 9:30 PM, 930, 10, +15m)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: '❌ This command only works inside a server.',
        ephemeral: true,
      });
    }

    const date = todayKey();
    const rawTime = interaction.options.getString('time');
    const formattedTime = rawTime ? formatUserTimeInput(rawTime, date) : null;
    const user = { id: String(interaction.user.id), name: interaction.user.username };

    let row = db.get(guildId, date);

    if (!row || row.playing !== 1) {
      const startTime = formattedTime || '9:00 PM';
      db.ensureCreator(guildId, date, user);
      db.setAnswer(guildId, date, {
        playing: 1,
        time: startTime,
        set_by: user.id,
        set_by_name: user.name,
      });
      db.setAttendee(guildId, date, {
        user_id: user.id,
        user_name: user.name,
        time_: startTime,
      });
    } else {
      const joinTime = formattedTime || row.time || 'On Time';
      db.setAttendee(guildId, date, {
        user_id: user.id,
        user_name: user.name,
        time_: joinTime,
      });
    }

    row = db.get(guildId, date);
    const setter = row && row.set_by ? { id: row.set_by, name: row.set_by_name } : user;
    const attendees = db.getAttendees(guildId, date);

    await interaction.reply({
      content: `🎮 <@${user.id}> joined tonight's game!`,
      embeds: [confirmedEmbed(row.time, setter, attendees, row.game)],
      components: [gameRow(row.game), rosterRow()],
    });

    await refreshGuildMessage(interaction.client, guildId, date);
  },
};

