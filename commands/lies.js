const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../db');
const { todayKey, formatTodayLong } = require('../utils');
const { COLORS } = require('../gameMessage');

/**
 * Hardcoded usernames who may ALWAYS use /lies, regardless of who is hosting.
 * These are GLOBAL Discord usernames (interaction.user.username) — NOT server
 * nicknames/display names, which change from server to server.
 * Comparison is case-insensitive. Add more names between the brackets.
 */
const TRUSTED_LIES_USERS = new Set(
  ['crankdatbutt'].map((n) => n.toLowerCase()),
);

/** Does this interaction come from one of the hardcoded trusted usernames? */
function isTrustedLiesUser(interaction) {
  const username = String(interaction.user?.username || '').toLowerCase();
  return TRUSTED_LIES_USERS.has(username);
}

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
        .setDescription('Optional note shown just in this reply (not stored)')
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('clear')
        .setDescription('🧽 Clear records instead of adding (this user, or whole board if no user)')
        .setRequired(false),
    ),

  /**
   * Modes:
   *  - `/lies user:@member [reason]`  → declare a strike (host/admin/trusted).
   *  - `/lies`                        → all-time Hall of Shame leaderboard.
   *  - `/lies user:@member clear:True`→ wipe ONE user's record (admin/trusted).
   *  - `/lies clear:True`             → wipe the ENTIRE board (admin/trusted).
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

    // ---- Leaderboard / wipe-all mode ---------------------------------------
    if (!targetUser) {
      if (interaction.options.getBoolean('clear')) {
        const mayWipe =
          !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
          isTrustedLiesUser(interaction);
        if (!mayWipe) {
          return interaction.reply({
            content: '🚫 Only server admins or trusted users can clear lie records.',
            ephemeral: true,
          });
        }
        const wiped = db.clearAllNoShows(guildId);
        return interaction.reply({
          content: `🧽 Wiped the entire Hall of Shame — ${wiped} record${wiped === 1 ? '' : 's'} gone.`,
          ephemeral: true,
        });
      }

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
    const isTrusted = isTrustedLiesUser(interaction);

    // ---- Clear-one-user mode ----------------------------------------------
    if (interaction.options.getBoolean('clear')) {
      if (!isAdmin && !isTrusted) {
        return interaction.reply({
          content: '🚫 Only server admins or trusted users can clear lie records.',
          ephemeral: true,
        });
      }
      const removed = db.clearNoShows(guildId, targetUser.id);
      return interaction.reply({
        content: `🧽 Cleared ${removed} lie record${removed === 1 ? '' : 's'} for <@${targetUser.id}>.`,
        ephemeral: true,
      });
    }

    if (!isAdmin && !isHost && !isCreator && !isTrusted) {
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
    });

    const count = db.getNoShowCount(guildId, targetUser.id);
    const attendees = row ? db.getAttendees(guildId, date) : [];
    const wasOnRoster = attendees.some((a) => a.user_id === targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle('🎭 Lies and Deceit')
      .setDescription(
        `<@${targetUser.id}> said they'd appear${wasOnRoster ? '' : " _(not on tonight's roster, but noted)_"} — and didn't show.`,
      )
      .addFields(
        { name: '📅 Date', value: formatTodayLong(), inline: true },
        { name: 'SMH', value: String(count), inline: true },
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
