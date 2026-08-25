# FunnyBot 🎮

A small Discord bot that runs an **interactive game-night check** for your
server. One command posts a single, persistent message that everyone answers
together — and the answer is stored so anyone can check it later.

---

## How it works

```
You: /tonight

Bot:  🎮 Are we playing tonight?
      Nobody has answered yet.
      [ ✅ YES ]  [ ❌ NO ]

→ click YES:
Bot:  🎮 Are we playing tonight?
      ✅ Yes — what time?
      [ 8 PM ] [ 9 PM ] [ 10 PM ] [ Custom time ]

→ click 9 PM (or enter a custom time):
Bot:  🎮 TONIGHT
      ✅ We're playing
      🕘 9:00 PM
      👤 YourName
      /status for details
```

Anyone on the server can answer by clicking the buttons. Once an answer is
recorded, `/status` shows it and `/tonight` will no longer re-post a prompt
(the answer sticks until you `/cancel` it).

## Commands

| Command    | What it does                                                    |
| ---------- | --------------------------------------------------------------- |
| `/tonight` | Posts (or refreshes) the interactive "are we playing?" prompt.  |
| `/status`  | Shows tonight's stored answer (Yes/No, time, who set it).        |
| `/ping`    | DMs a teammate asking if they're playing with the server status.|
| `/cancel`  | Clears tonight's game night and marks the message as cancelled.  |
| `/no-show` | 🎭 Lies & Deceit: declare a teammate who ghosted, or view the leaderboard. |
| `/help`    | Shows the command list and instructions on using the bot.        |

A **"Set up again"** button appears on a cancelled message so you can
re-open the night without retyping `/tonight`.

## Games, pings & the 6 AM rule

- 🎲 **Pick the game** — once a night is confirmed, **Valorant / League /
  Party / Any** buttons appear on the message (in the server *and* in DMs).
- ⏰ **Pings** — ~10 minutes before start, a personal ping at your declared
  arrival time, and a check-in ~10 minutes after start.
- 🌅 **Hard stop at 6 AM** — no pings are ever sent after 6:00 AM Manila time;
  game night always ends there regardless of when it started.
- 🎭 **Lies and Deceit** — the host or an admin runs `/no-show user:@member`
  to record someone who said they'd appear but didn't. The counter is
  permanent per user; `/no-show` with no arguments shows the Hall of Shame.

## Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) **18.0.0** or newer (tested on Node 26).
- A Discord account that can manage a server (to add the bot).

### 2. Create a Discord application + bot
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. **New Application** → give it a name → **Create**.
3. **OAuth2 → URL Generator**:
   - Scopes: `bot` and `applications.commands`
   - Bot Permissions: `Send Messages`, `Manage Messages`, `Read Message History`, `View Channel`
   - (Optionally `Embed Links` + `Use Components` for nice formatting.)
4. Copy the generated URL, open it, and add the bot to your server.
5. **Bot → Token**: click "Reset Token" (or copy), then paste it in `.env` as `TOKEN`.

### 3. Configure the bot
```bash
cp .env.example .env
# edit .env and fill in:
#   TOKEN        = your bot token (from step 5)
#   CLIENT_ID    = the Application ID
#   GUILD_ID     = your server's ID (right-click the server → "Copy ID" with Developer Mode on)
```

> `GUILD_ID` registers commands to one server for **instant** availability (best
> for testing). Leave it blank to register commands **globally** (available in
> every server the bot is in, but can take up to an hour to appear).

### 4. Install dependencies + register commands
```bash
npm install
npm run deploy   # registers /tonight, /status, /cancel on Discord
```

### 5. Run the bot
```bash
npm start
```

You should see `✅ Logged in as ...` and then `/tonight` will work in your
server.

---

## How it stores data

Answers are kept in a local **SQLite** database at `data/game_nights.db`, keyed
by `(guild_id, date)`. This is what makes the answer persist across restarts and
visible to everyone who runs `/status`.

| column        | meaning                                         |
| ------------- | ----------------------------------------------- |
| `guild_id`    | the server                                      |
| `date`        | `YYYY-MM-DD` of "tonight" (local time)          |
| `playing`     | `NULL` (pending), `1` (yes), `0` (no)           |
| `time`        | e.g. `9:00 PM` (only when playing = yes)        |
| `set_by`      | the user id of whoever answered                 |
| `set_by_name` | their username                                  |
| `game`        | chosen game (`Valorant`, `League`, `Party`, `Any`) |
| `message_id`  | the prompt message this row is attached to       |
| `channel_id`  | where that message lives                         |

> ⏰ **Timezone note:** the date rolls over at **midnight in the bot host's
> timezone**. Host the bot where you want "tonight" to be computed.

---

## Customising

- **Time presets** live in `gameMessage.js` (`TIME_OPTIONS`). Add/remove entries
  to change the buttons offered after someone answers "Yes".
- **Permission gate:** open `commands/<name>.js` and add `.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)` to `setDescription(...)` if you only want trusted members to run a command.
- **Command registration:** `deploy-commands.js` uses Node's built-in `fetch` — no extra packages required.

## Troubleshooting

- **`/tonight` replies "No TOKEN found"** — you forgot to create `.env` or it's
  missing `TOKEN`. Copy `.env.example` again and fill it in.
- **Commands don't appear** — re-run `npm run deploy` and wait for guild commands
  (instant) or up to an hour for global commands.
- **Buttons say "This interaction failed"** — the bot likely lost access to the
  channel or lacks `Send Messages`/`Manage Messages`. Re-add the bot with the
  permissions above.
