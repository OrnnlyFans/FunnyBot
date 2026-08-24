const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const { todayKey } = require('../utils');
const { cancelledEmbed, setupAgainRow } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription("Cancel tonight's game night (clears the answer and prompt).")
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason why tonight is cancelled')
        .setRequired(false),
    ),

  /**
   * Clears tonight's record, but ONLY for tonight's creator or a server admin.
   * If the live prompt message still exists, it is edited to a "cancelled"
   * state with a "Set up again" button so the night can be re-opened.
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
    const reason = interaction.options.getString('reason');

    if (!row) {
      await interaction.reply({
        content: '🎮 Nothing is set up for tonight. Run **/tonight** to begin.',
        ephemeral: true,
      });
      return;
    }

    // Gate: only the entry's creator or a server administrator may cancel.
    const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const isCreator =
      row.creator != null && String(row.creator) === String(interaction.user.id);
    if (!isAdmin && !isCreator) {
      await interaction.reply({
        content:
          '🚫 Only the person who set up tonight\'s game or an **admin** can cancel it.',
        ephemeral: true,
      });
      return;
    }

    // Check existing attendees before clearing
    const attendees = db.getAttendees(guildId, date);
    const mentions = attendees.map((a) => `<@${a.user_id}>`).filter((m) => m !== `<@${interaction.user.id}>`);

    // Mark the live message as cancelled (if we can still find it).
    let marked = false;
    if (row.message_id && row.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(row.channel_id);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(row.message_id);
          const alertText = mentions.length > 0
            ? `⚠️ **Game Night Cancelled** ${mentions.join(' ')}${reason ? `\n> 💬 *${reason}*` : ''}`
            : (reason ? `⚠️ **Game Night Cancelled**\n> 💬 *${reason}*` : '');

          await msg.edit({
            embeds: [cancelledEmbed(interaction.user, attendees, reason)],
            components: [setupAgainRow(attendees.length > 0)],
            content: alertText,
          });
          marked = true;
        }
      } catch (err) {
        console.error('[/cancel] could not edit prompt message:', err);
      }
    }

    db.remove(guildId, date);

    await interaction.reply({
      content: marked
        ? `🎮 Cancelled tonight's game night${reason ? ` (*"${reason}"*)` : ''}. The squad was notified — anyone can click **"Take Over as Host"** to restore it.`
        : `🎮 Cancelled tonight's game night${reason ? ` (*"${reason}"*)` : ''}. Run **/tonight** to start fresh.`,
      ephemeral: true,
    });
  },
};

