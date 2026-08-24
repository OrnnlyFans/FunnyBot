/**
 * Registers (or refreshes) the bot's slash commands on Discord.
 *
 * Uses Node's built-in fetch (Node 18+), so no extra HTTP dependencies are needed.
 *
 *   - If GUILD_ID is set in .env  -> registers as GUILD commands (appear instantly)
 *   - If GUILD_ID is empty        -> registers as GLOBAL commands (take up to 1h to appear)
 *
 * Run with:  npm run deploy
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

// Collect the SlashCommandBuilder JSON for every command file.
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

async function main() {
  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${CLIENT_ID}/commands`;

  console.log(
    `Registering ${commands.length} command(s)${
      GUILD_ID ? ` in guild ${GUILD_ID}` : ' globally'
    }...`,
  );

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Failed to register commands: HTTP ${res.status}\n${text}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ Registered ${data.length} command(s).`);
  if (!GUILD_ID) {
    console.log('💡 Global commands can take up to an hour to appear.');
  }
}

main().catch((err) => {
  console.error('❌ Deploy failed:', err);
  process.exit(1);
});
