const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatUserTimeInput } = require('../utils');
const {
  confirmedEmbed,
  notPlayingEmbed,
  gameRow,
  rosterRow,
} = require('../gameMessage');
const { refreshGuildMessage } = require('../handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('respond')
    .setDescription("Respond to tonight's game night (Yes, No, Join, or Leave).")
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Your response for tonight')
        .setRequired(true)
        .addChoices(
          { name: '✅ Yes — We are playing (start game night)', value: 'yes' },
          { name: '🎮 Join — I am playing tonight', value: 'join' },
          { name: '🍿 Watch — I will be there but not play', value: 'watch' },
          { name: '❌ No — Not playing tonight', value: 'no' },
          { name: '🚪 Leave — I cannot make it', value: 'leave' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('Optional start or arrival time (e.g. 9:30 PM, 930, +15m)')
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
    const status = interaction.options.getString('status');
    const rawTime = interaction.options.getString('time');
    const formattedTime = rawTime ? formatUserTimeInput(rawTime, date) : null;
    const user = { id: String(interaction.user.id), name: interaction.user.username };

    let row = db.get(guildId, date);

    if (status === 'yes') {
      const startTime = formattedTime || (row && row.time) || '9:00 PM';
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
      const freshRow = db.get(guildId, date);
      const attendees = db.getAttendees(guildId, date);
      await interaction.reply({
        embeds: [confirmedEmbed(startTime, user, attendees, freshRow ? freshRow.game : null)],
        components: [gameRow(freshRow ? freshRow.game : null), rosterRow()],
      });
      await refreshGuildMessage(interaction.client, guildId, date);
      return;
    }

    if (status === 'join') {
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
      return;
    }

    if (status === 'no') {
      db.ensureCreator(guildId, date, user);
      db.setAnswer(guildId, date, {
        playing: 0,
        time: null,
        set_by: user.id,
        set_by_name: user.name,
      });
      db.clearAttendees(guildId, date);
      await interaction.reply({
        embeds: [notPlayingEmbed(user)],
        components: [],
      });
      await refreshGuildMessage(interaction.client, guildId, date);
      return;
    }

        if (status === 'watch') {
      if (!row || row.playing !== 1) {
        return interaction.reply({
          content: '🙅 Nobody has confirmed a game tonight yet — run **/tonight** first.',
          ephemeral: true,
        });
      }
      // Keep any arrival time they'd already declared (as player or watcher).
      const prevW = db.getAttendees(guildId, date).find((a) => a.user_id === user.id);
      const watchTime =
        formattedTime ||
        (prevW && prevW.join_time && prevW.join_time !== 'On Time' ? prevW.join_time : null);
      db.setAttendee(guildId, date, {
        user_id: user.id,
        user_name: user.name,
        time_: watchTime,
        role: 'watcher',
      });
      row = db.get(guildId, date);
      const setter = row && row.set_by ? { id: row.set_by, name: row.set_by_name } : user;
      const attendees = db.getAttendees(guildId, date);
      await interaction.reply({
        content: `🍿 <@${user.id}> will be there to watch tonight's game!`,
        embeds: [confirmedEmbed(row.time, setter, attendees, row.game)],
        components: [gameRow(row.game), rosterRow()],
      });
      await refreshGuildMessage(interaction.client, guildId, date);
      return;
    }

    if (status === 'leave') {
      db.removeAttendee(guildId, date, user.id);
      row = db.get(guildId, date);
      if (row && row.playing === 1) {
        const setter = row.set_by ? { id: row.set_by, name: row.set_by_name } : null;
        const attendees = db.getAttendees(guildId, date);
        await interaction.reply({
          content: `🚪 <@${user.id}> left tonight's roster.`,
          embeds: [confirmedEmbed(row.time, setter, attendees, row.game)],
          components: [gameRow(row.game), rosterRow()],
        });
      } else {
        await interaction.reply({
          content: `🚪 <@${user.id}> left the roster.`,
          ephemeral: true,
        });
      }
      await refreshGuildMessage(interaction.client, guildId, date);
      return;
    }
  },
};
