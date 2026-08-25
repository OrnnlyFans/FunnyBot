const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('helps')
    .setDescription('Show available commands and how to use FunnyBot (public in channel).'),

  async execute(interaction) {
    const helpEmbed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🎮 FunnyBot — Help & Guide')
      .setDescription(
        'FunnyBot is an interactive game-night coordinator for your server. Plan game nights, RSVP, set custom arrival times, and get automated start reminders!',
      )
      .addFields(
        {
          name: '🕹️ `/tonight`',
          value: 'Post or refresh the interactive **"Are we playing tonight?"** prompt with Yes/No voting, time presets (8:00, 9:00, 9:30, 10:00 PM), and custom times.',
        },
        {
          name: '📊 `/status`',
          value: 'Check tonight\'s game status (Yes/No, scheduled start time, host, and player roster with arrival times).',
        },
        {
          name: '🔔 `/ping user:@member [message]`',
          value: 'Send a DM to a teammate with interactive **Yes/No/Join/Leave** buttons directly inside their DM.',
        },
        {
          name: '🎮 `/join [time]`',
          value: 'Quickly join tonight\'s game roster (optional arrival time, e.g. `9:30 PM`).',
        },
        {
          name: '🚪 `/leave`',
          value: 'Quickly leave tonight\'s game roster.',
        },
        {
          name: '📝 `/respond status:[Yes/Join/No/Leave] [time]`',
          value: 'Full RSVP control with custom start or arrival times.',
        },
        {
          name: '❌ `/cancel [reason]`',
          value: 'Cancel tonight\'s game with an optional reason note. Squad is alerted with an option to **Take Over as Host**.',
        },
        {
          name: '❓ `/help` / `/helps`',
          value: '`/help` shows this private help menu; `/helps` posts it publicly in the channel for everyone.',
        },
        {
          name: '🎲 Pick the Game',
          value: 'After the night is confirmed, **Valorant / League / Party / Any** buttons appear on the message — tap one to declare what you\'re playing (DM buttons included).',
        },
        {
          name: '⏰ Automated Reminders',
          value: 'Pings the squad ~10 minutes before game time, pings you personally around your declared arrival time, then checks in again ~10 minutes after start. Game night ALWAYS ends by 6:00 AM.',
        },
        {
          name: '🎭 Lies and Deceit (/lies)',
          value: "Said they'd show up but ghosted? The host or an admin records it with `/lies user:@member [reason]`. Run `/lies` alone for the all-time Hall of Shame leaderboard.",
        },
        {
          name: '👑 Host Takeover & Succession',
          value: 'If the host leaves or cancels, squad members can click **"👑 Take Over as Host"** to keep game night alive without losing the roster.',
        },
      )
      .setFooter({ text: 'All times are synced to Asia/Manila (UTC+8).' });

    await interaction.reply({
      embeds: [helpEmbed],
    });
  },
};
