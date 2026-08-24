const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { todayKey, parseTimeString } = require('./utils');
const { COLORS } = require('./gameMessage');

/**
 * Checks all active game nights for upcoming start times and individual player
 * arrival times, sending automated pings/DMs.
 */
async function checkReminders(client) {
  if (!client || !client.isReady()) return;

  const date = todayKey();
  const games = db.getActiveGameNights(date);
  if (!games || !games.length) return;

  const now = Date.now();

  for (const game of games) {
    const guildId = game.guild_id;
    const attendees = db.getAttendees(guildId, date);

    // 1. Guild-wide start-soon reminder (10 minutes before game start time)
    if (game.time) {
      const startTime = parseTimeString(game.time, date);
      if (startTime) {
        const diffMinutes = Math.round((startTime.getTime() - now) / 60000);
        if (diffMinutes <= 10 && diffMinutes >= -15) {
          if (!db.hasReminderBeenSent(guildId, date, 'guild_main', 'start_soon')) {
            db.recordReminder(guildId, date, 'guild_main', 'start_soon');

            // Collect unique user IDs to ping
            const userIds = new Set();
            if (game.set_by) userIds.add(game.set_by);
            for (const a of attendees) {
              if (a.user_id) userIds.add(a.user_id);
            }

            const mentions = Array.from(userIds).map((id) => `<@${id}>`).join(' ');

            const reminderEmbed = new EmbedBuilder()
              .setColor(COLORS.prompt)
              .setTitle('⏰ Game Night Starting Soon!')
              .setDescription(
                diffMinutes > 0
                  ? `🎮 **Game starts in ~${diffMinutes} minutes** (at **${game.time}**)!`
                  : `🎮 **Game time is here!** (started at **${game.time}**)!`,
              )
              .addFields(
                { name: '👥 Squad', value: mentions || '_no one yet_' },
              )
              .setFooter({ text: 'Hop on voice / launch your game!' });

            // Post in server channel if available
            if (game.channel_id) {
              try {
                const channel = await client.channels.fetch(game.channel_id).catch(() => null);
                if (channel) {
                  await channel.send({
                    content: mentions ? `🔔 ${mentions}` : undefined,
                    embeds: [reminderEmbed],
                  }).catch(() => {});
                }
              } catch (e) {}
            }

            // Also DM participants
            for (const uid of userIds) {
              try {
                const user = await client.users.fetch(uid).catch(() => null);
                if (user && !user.bot) {
                  await user.send({ embeds: [reminderEmbed] }).catch(() => {});
                }
              } catch (e) {}
            }
          }
        }
      }
    }

    // 2. Individual player arrival reminder (e.g. for players running late with their own time)
    for (const attendee of attendees) {
      if (!attendee.join_time) continue;
      const joinTarget = parseTimeString(attendee.join_time, date);
      if (!joinTarget) continue;

      const diffMinutes = Math.round((joinTarget.getTime() - now) / 60000);
      if (diffMinutes <= 10 && diffMinutes >= -15) {
        if (!db.hasReminderBeenSent(guildId, date, attendee.user_id, 'individual_join')) {
          db.recordReminder(guildId, date, attendee.user_id, 'individual_join');

          const dmEmbed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('⏰ Estimated Join Time Reminder!')
            .setDescription(
              diffMinutes > 0
                ? `Hey <@${attendee.user_id}>! Your estimated arrival time (**${attendee.join_time}**) is in **~${diffMinutes} minutes**.`
                : `Hey <@${attendee.user_id}>! It is now your estimated arrival time (**${attendee.join_time}**)!`,
            )
            .setFooter({ text: 'Your teammates are playing / getting ready for you!' });

          try {
            const user = await client.users.fetch(attendee.user_id).catch(() => null);
            if (user && !user.bot) {
              await user.send({ embeds: [dmEmbed] }).catch(() => {});
            }
          } catch (e) {}
        }
      }
    }
  }
}

function startReminderScheduler(client) {
  // Check immediately, then every 30 seconds
  checkReminders(client).catch(() => {});
  setInterval(() => {
    checkReminders(client).catch(() => {});
  }, 30000);
}

module.exports = { startReminderScheduler, checkReminders };
