const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatTodayLong } = require('../utils');
const { pendingEmbed, yesNoRow, statusEmbed } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tonight')
    .setDescription('Post an interactive "are we playing tonight?" prompt.'),

  /**
   * Ensures a prompt message is visible for today:
   *  - if tonight is already answered -> tell them to use /status or /cancel
   *  - if a pending prompt message exists -> refresh it in place
   *  - otherwise -> create a new prompt as this command's reply
   */
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: '❌ This command only works inside a server.',
        ephemeral: true,
      });
      return;
    }

    const date = todayKey();
    const row = db.get(guildId, date);

    // Tonight already decided — don't overwrite, just point them to /status & /cancel.
    if (row && row.playing !== null) {
      await interaction.reply({
        embeds: [statusEmbed(row, formatTodayLong(), db.getAttendees(guildId, date))],
        content: '> Already answered for tonight. Use **/status** to view, or **/cancel** to reset.',
        ephemeral: true,
      });
      return;
    }

    // Try to refresh the existing prompt message (if any) so we keep a single message.
    let message = null;
    let replied = false;

    if (row && row.message_id && row.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(row.channel_id);
        if (channel?.isTextBased()) {
          const existing = await channel.messages.fetch(row.message_id);
          message = await existing.edit({
            embeds: [pendingEmbed()],
            components: [yesNoRow()],
            content: '',
          });
        }
      } catch (err) {
        console.error('[/tonight] could not refresh existing prompt:', err);
        message = null;
      }
    }

    // No usable existing message -> create one via this command's reply.
    if (!message) {
      const response = await interaction.reply({
        embeds: [pendingEmbed()],
        components: [yesNoRow()],
        withResponse: true,
      });
      message = response.resource?.message;
      if (!message) {
        message = await interaction.fetchReply(); // fallback
      }
      replied = true;
    }

    // Keep the DB pointer in sync with the message we're using.
    const messageId = message?.id;
    const channelId = message?.channelId ?? interaction.channelId;
    if (!messageId || !channelId) {
      throw new Error('Could not determine prompt message/channel.');
    }
    if (row) {
      db.setMessageRef(guildId, date, { message_id: messageId, channel_id: channelId });
    } else {
      db.createOrRefresh(guildId, date, { message_id: messageId, channel_id: channelId });
    }

    // Whoever opens the prompt counts as tonight's entry creator (for /cancel).
    db.ensureCreator(guildId, date, {
      id: String(interaction.user.id),
      name: interaction.user.username,
    });

    if (replied) {
      await interaction.followUp({
        content: '✅ Prompt is live — tell everyone to answer below!',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "✅ Refreshed tonight's prompt.",
        ephemeral: true,
      });
    }
  },
};
