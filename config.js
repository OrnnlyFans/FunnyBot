/**
 * Loads and validates secrets/configuration from the environment (.env).
 */
require('dotenv').config();

const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
};

if (!config.token) {
  throw new Error(
    '❌ No TOKEN found. Copy ".env.example" to ".env" and set TOKEN=your-bot-token.',
  );
}
if (!config.clientId) {
  throw new Error(
    '❌ No CLIENT_ID found. Set CLIENT_ID=your-client-id in ".env".',
  );
}

module.exports = config;
