const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { todayKey, parseTimeString, manilaHour } = require('./utils');
const { COLORS } = require('./gameMessage');

/**
 * Checks all active game nights for upcoming start times and individual player
 * arrival times, sending automated pings/DMs.
 */
async function checkReminders(client) {
  if (!client || !client.isReady()) return;

  // 🌅 Game night ALWAYS ends at 6:00 AM Manila time — no pings after that.
  if (manilaHour() >= 6) return;

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
              if (a.role === 'declined') continue;
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

    // 2. Guild-wide "10 minutes in" check-in (fires ~10 min after the declared start time)
    if (game.time) {
      const startTime = parseTimeString(game.time, date);
      if (startTime) {
        const minsAfterStart = Math.round((now - startTime.getTime()) / 60000);
        if (minsAfterStart >= 5 && minsAfterStart <= 25) {
          if (!db.hasReminderBeenSent(guildId, date, 'guild_main', 'start_after')) {
            db.recordReminder(guildId, date, 'guild_main', 'start_after');

            const userIds = new Set();
            if (game.set_by) userIds.add(game.set_by);
            for (const a of attendees) {
              if (a.user_id) userIds.add(a.user_id);
            }
            const mentions = Array.from(userIds).map((id) => `<@${id}>`).join(' ');

            const checkinEmbed = new EmbedBuilder()
              .setColor(COLORS.info)
              .setTitle('🎮 Game Night — 10-Minute Check-in!')
              .setDescription(
                `The squad kicked off at **${game.time}** (~10 minutes ago)${game.game ? ` — **${game.game}** time` : ''}. Hop on, you're missing out!`,
              )
              .addFields({ name: '👥 Squad', value: mentions || '_no one yet_' })
              .setFooter({ text: 'Game night always wraps up by 6:00 AM sharp.' });

            // Post in server channel if available
            if (game.channel_id) {
              try {
                const channel = await client.channels.fetch(game.channel_id).catch(() => null);
                if (channel) {
                  await channel.send({
                    content: mentions ? `🔔 ${mentions}` : undefined,
                    embeds: [checkinEmbed],
                  }).catch(() => {});
                }
              } catch (e) {}
            }

            // Also DM participants
            for (const uid of userIds) {
              try {
                const user = await client.users.fetch(uid).catch(() => null);
                if (user && !user.bot) {
                  await user.send({ embeds: [checkinEmbed] }).catch(() => {});
                }
              } catch (e) {}
            }
          }
        }
      }
    }

    // 3. Individual player arrival reminder (e.g. for players running late with their own time)
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

    // 4. Individual nudge ~10 minutes AFTER a player's declared time — "still not here?"
    for (const attendee of attendees) {
      if (!attendee.join_time) continue;
      const lateTarget = parseTimeString(attendee.join_time, date);
      if (!lateTarget) continue;

      // If their declared time basically IS the start time, the guild-wide
      // check-in above already covers them — skip the duplicate DM.
      const startTarget = game.time ? parseTimeString(game.time, date) : null;
      if (startTarget && Math.abs(lateTarget.getTime() - startTarget.getTime()) < 15 * 60000) {
        continue;
      }

      const minsAfterJoin = Math.round((now - lateTarget.getTime()) / 60000);
      if (minsAfterJoin >= 5 && minsAfterJoin <= 25) {
        if (!db.hasReminderBeenSent(guildId, date, attendee.user_id, 'individual_after')) {
          db.recordReminder(guildId, date, attendee.user_id, 'individual_after');

          const nudgeEmbed = new EmbedBuilder()
            .setColor(COLORS.danger)
            .setTitle('🎭 Still not here…?')
            .setDescription(
              `Hey <@${attendee.user_id}>! You said you'd appear at **${attendee.join_time}** — that was ~10 minutes ago.`,
            )
            .setFooter({ text: "Don't rack up Lies and Deceit — your squad is waiting!" });

          try {
            const user = await client.users.fetch(attendee.user_id).catch(() => null);
            if (user && !user.bot) {
              await user.send({ embeds: [nudgeEmbed] }).catch(() => {});
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
