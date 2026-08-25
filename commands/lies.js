const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatTodayLong } = require('../utils');
const { COLORS } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lies')
    .setDescription(
      "🎭 Lies and Deceit: declare who said they'd show but didn't — or view the leaderboard.",
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('The teammate who bailed').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason / note for the record')
        .setRequired(false),
    ),

  /**
   * Two modes:
   *  - `/lies user:@member [reason]` → host/admin declares a no-show for tonight.
   *  - `/lies` (no user)             → shows the all-time Lies and Deceit leaderboard.
   */
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: '❌ This command only works inside a server.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    // ---- Leaderboard mode -------------------------------------------------
    if (!targetUser) {
      const counts = db.getAllNoShowCounts(guildId);
      const embed = new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle('🎭 Lies and Deceit — Hall of Shame')
        .setDescription(
          counts.length
            ? '_Players who said they would appear… and did not._'
            : '_Nobody has bailed yet. A suspiciously honest squad._',
        );
      for (let i = 0; i < Math.min(counts.length, 15); i++) {
        const entry = counts[i];
        embed.addFields({
          name: `#${i + 1} — ${entry.count} lie${entry.count === 1 ? '' : 's'}`,
          value: `<@${entry.user_id}> · last recorded ${entry.last_declared}`,
        });
      }
      embed.setFooter({
        text: "Hosts & admins: /lies user:@member to record tonight's liars.",
      });
      return interaction.reply({ embeds: [embed] });
    }

    // ---- Declare mode -----------------------------------------------------
    const date = todayKey();
    const row = db.get(guildId, date);
    const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const isHost = !!row && row.set_by != null && String(row.set_by) === String(interaction.user.id);
    const isCreator =
      !!row && row.creator != null && String(row.creator) === String(interaction.user.id);

    if (!isAdmin && !isHost && !isCreator) {
      return interaction.reply({
        content: "🚫 Only tonight's host or a server admin can declare a no-show.",
        ephemeral: true,
      });
    }

    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ Bots never lie. They just follow instructions.',
        ephemeral: true,
      });
    }
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: '😅 You cannot declare yourself a no-show… nice try though.',
        ephemeral: true,
      });
    }

    const memberName =
      interaction.guild?.members.cache.get(targetUser.id)?.displayName || targetUser.username;

    db.addNoShow(guildId, date, {
      user_id: targetUser.id,
      user_name: memberName,
      declared_by: String(interaction.user.id),
      declared_by_name: interaction.user.username,
      reason,
    });

    const count = db.getNoShowCount(guildId, targetUser.id);
    const attendees = row ? db.getAttendees(guildId, date) : [];
    const wasOnRoster = attendees.some((a) => a.user_id === targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle('🎭 Lie Recorded!')
      .setDescription(
        `<@${targetUser.id}> said they'd appear${wasOnRoster ? '' : " _(not on tonight's roster, but noted)_"} — and didn't show.`,
      )
      .addFields(
        { name: '📅 Date', value: formatTodayLong(), inline: true },
        { name: '🎭 Total Lies', value: String(count), inline: true },
      );
    if (reason) embed.addFields({ name: '💬 Reason', value: reason });
    embed.setFooter({
      text: `Declared by ${interaction.user.username} · Lies and Deceit counter`,
    });

    await interaction.reply({
      content: `🔔 <@${targetUser.id}> — that's **${count}** strike${count === 1 ? '' : 's'} now.`,
      embeds: [embed],
    });
  },
};
