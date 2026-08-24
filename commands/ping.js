const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatTodayLong } = require('../utils');
const { COLORS } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription("Send a direct message to a server member asking if they're playing tonight.")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user you want to ping')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Optional custom message to include in the DM')
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

    const targetUser = interaction.options.getUser('user');
    const customMessage = interaction.options.getString('message');

    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ You cannot ping bots.',
        ephemeral: true,
      });
    }

    // Check game night status for context
    const row = db.get(guildId, todayKey());
    let statusText = 'Pending (nobody answered yet)';
    if (row && row.playing === 1) {
      statusText = `✅ Yes, playing at ${row.time || 'TBD'}`;
    } else if (row && row.playing === 0) {
      statusText = '❌ No, not playing tonight';
    }

    const guildName = interaction.guild ? interaction.guild.name : 'the server';

    const dmEmbed = new EmbedBuilder()
      .setColor(COLORS.prompt)
      .setTitle('🎮 Game Night Ping!')
      .setDescription(
        `Hey <@${targetUser.id}>!\n\n**${interaction.user.username}** from **${guildName}** wants to know if you're playing tonight!`,
      )
      .addFields(
        { name: '📅 Date', value: formatTodayLong(), inline: true },
        { name: '📊 Server Status', value: statusText, inline: true },
      );

    if (customMessage) {
      dmEmbed.addFields({ name: '💬 Note', value: customMessage });
    }

    dmEmbed.setFooter({ text: 'Check the server channel or run /status!' });

    try {
      await targetUser.send({ embeds: [dmEmbed] });
      await interaction.reply({
        content: `✅ Successfully sent a game-night DM to <@${targetUser.id}>!`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content: `❌ Could not send a DM to <@${targetUser.id}>. They may have direct messages disabled for this server.`,
        ephemeral: true,
      });
    }
  },
};
