const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatUserTimeInput } = require('../utils');
const { confirmedEmbed, gameRow, rosterRow } = require('../gameMessage');
const { refreshGuildMessage } = require('../handlers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watch')
    .setDescription("🍿 Say you'll be there to WATCH tonight's game night (not play).")
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('When you will show up (e.g. 9:30 PM, 930, +15m)')
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
    const row = db.get(guildId, date);

    // Watching only makes sense if a game night actually exists.
    if (!row || row.playing !== 1) {
      return interaction.reply({
        content: '🙅 Nobody has confirmed a game tonight yet — run **/tonight** first!',
        ephemeral: true,
      });
    }

    const rawTime = interaction.options.getString('time');
    const formattedTime = rawTime ? formatUserTimeInput(rawTime, date) : null;
    const user = { id: String(interaction.user.id), name: interaction.user.username };

    // Keep any arrival time they'd already declared (as player or watcher).
    const prev = db.getAttendees(guildId, date).find((a) => a.user_id === user.id);
    const watchTime =
      formattedTime ||
      (prev && prev.join_time && prev.join_time !== 'On Time' ? prev.join_time : null);

    db.setAttendee(guildId, date, {
      user_id: user.id,
      user_name: user.name,
      time_: watchTime,
      role: 'watcher',
    });

    const updated = db.get(guildId, date);
    const setter = updated && updated.set_by
      ? { id: updated.set_by, name: updated.set_by_name }
      : user;
    const attendees = db.getAttendees(guildId, date);

    await interaction.reply({
      content: `🍿 <@${user.id}> will be there to watch tonight's game!`,
      embeds: [confirmedEmbed(updated.time, setter, attendees, updated.game)],
      components: [gameRow(updated.game), rosterRow()],
    });

    await refreshGuildMessage(interaction.client, guildId, date);
  },
};
