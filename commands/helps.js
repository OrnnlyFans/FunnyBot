const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../gameMessage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('helps')
    .setDescription('Show available commands and how to use FunnyBot (public in channel).'),

  async execute(interaction) {
    const helpEmbed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🎮 FunnyBot — Help & Commands')
      .setDescription(
        'FunnyBot is an interactive game-night coordinator for your server. Post a prompt, let members vote, and check status anytime!',
      )
      .addFields(
        {
          name: '🕹️ `/tonight`',
          value: 'Post or refresh the interactive **"Are we playing tonight?"** prompt with Yes/No buttons and time presets.',
        },
        {
          name: '📊 `/status`',
          value: 'Check tonight\'s current game-night status (whether you\'re playing, time, and who responded).',
        },
        {
          name: '🔔 `/ping user:@member [message]`',
          value: 'Send a direct message (DM) to a teammate asking if they\'re playing tonight with interactive buttons.',
        },
        {
          name: '📝 `/respond status:[Yes/Join/No/Leave] [time]`',
          value: 'Directly submit your response or join tonight\'s game roster via slash command.',
        },
        {
          name: '❌ `/cancel`',
          value: 'Clear tonight\'s game-night response and reset the prompt.',
        },
        {
          name: '❓ `/help` / `/helps`',
          value: 'Display this help menu (private `/help` or public `/helps`).',
        },
      )
      .setFooter({ text: 'Tip: Answers are shared and persist for the whole server!' });

    await interaction.reply({
      embeds: [helpEmbed],
    });
  },
};
