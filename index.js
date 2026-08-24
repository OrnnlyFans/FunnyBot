const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { handleButton, handleModal } = require('./handlers');

// A minimal client: we only need the Guilds intent to receive commands and
// to fetch channels/messages via REST.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

// Load every command file from ./commands
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    `📦 Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ')}`,
  );
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: '⚠️ Something went wrong while handling your interaction.',
          ephemeral: true,
        });
      } else {
        await interaction.followUp({
          content: '⚠️ Something went wrong while handling your interaction.',
          ephemeral: true,
        });
      }
    } catch (e) {
      // best effort — interaction may have already been acknowledged
    }
  }
});

client.login(config.token).catch((err) => {
  console.error('❌ Failed to login:', err);
  process.exit(1);
});
