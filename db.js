/**
 * SQLite storage for game-night answers.
 *
 * One row per (guild, date). `playing` is NULL while the interactive prompt
 * is up but nobody has answered yet:
 *   playing = null  → pending (prompt posted, awaiting an answer)
 *   playing = 1     → "Yes, we're playing"
 *   playing = 0     → "No, not playing"
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'game_nights.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_nights (
      guild_id    TEXT NOT NULL,
      date        TEXT NOT NULL,
      playing     INTEGER,            -- NULL = pending, 1 = yes, 0 = no
      time        TEXT,
      set_by      TEXT,
      set_by_name TEXT,
      message_id  TEXT,
      channel_id  TEXT,
      updated_at  TEXT,
      PRIMARY KEY (guild_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_game_nights_guild_date
      ON game_nights (guild_id, date);
`);

const now = () => new Date().toISOString();

module.exports = {
  db,

  /**
   * @param {string} guildId
   * @param {string} date  todayKey()
   * @returns {object|null}
   */
  get: (guildId, date) =>
    db.prepare(
      'SELECT * FROM game_nights WHERE guild_id = ? AND date = ?',
    ).get(guildId, date) || null,

  /**
   * Insert a pending row, or just (re)point an existing row at a message.
   * @param {string} guildId
   * @param {string} date
   * @param {{message_id:string, channel_id:string}} ref
   */
  createOrRefresh: (guildId, date, { message_id, channel_id }) => {
    const existing = db
      .prepare('SELECT 1 FROM game_nights WHERE guild_id = ? AND date = ?')
      .get(guildId, date);

    if (existing) {
      db.prepare(
        'UPDATE game_nights SET message_id = ?, channel_id = ?, updated_at = ? WHERE guild_id = ? AND date = ?',
      ).run(message_id, channel_id, now(), guildId, date);
    } else {
      db.prepare(
        `INSERT INTO game_nights
            (guild_id, date, playing, time, set_by, set_by_name, message_id, channel_id, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      ).run(guildId, date, message_id, channel_id, now());
    }
  },

  /**
   * Record an answer. Preserves the stored message reference.
   * @param {string} guildId
   * @param {string} date
   * @param {{playing:number|null, time:?string, set_by:string, set_by_name:string}} answer
   */
  setAnswer: (guildId, date, { playing, time, set_by, set_by_name }) => {
    db.prepare(
      `INSERT INTO game_nights
          (guild_id, date, playing, time, set_by, set_by_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, date) DO UPDATE SET
          playing     = excluded.playing,
          time        = excluded.time,
          set_by      = excluded.set_by,
          set_by_name = excluded.set_by_name,
          updated_at  = excluded.updated_at`,
    ).run(guildId, date, playing, time, set_by, set_by_name, now());
  },

  /** Re-point an existing row's message/channel (e.g. after re-creating a deleted prompt). */
  setMessageRef: (guildId, date, { message_id, channel_id }) => {
    db.prepare(
      'UPDATE game_nights SET message_id = ?, channel_id = ?, updated_at = ? WHERE guild_id = ? AND date = ?',
    ).run(message_id, channel_id, now(), guildId, date);
  },

    /** Reset tonight to a clean "pending prompt" state (clears any prior answer). */
  resetToPending: (guildId, date, { message_id, channel_id }) => {
    const existing = db
      .prepare('SELECT 1 FROM game_nights WHERE guild_id = ? AND date = ?')
      .get(guildId, date);

    if (existing) {
      db.prepare(
        `UPDATE game_nights
         SET playing = NULL, time = NULL, set_by = NULL, set_by_name = NULL,
             message_id = ?, channel_id = ?, updated_at = ?
         WHERE guild_id = ? AND date = ?`,
      ).run(message_id, channel_id, now(), guildId, date);
    } else {
      db.prepare(
        `INSERT INTO game_nights
            (guild_id, date, playing, time, set_by, set_by_name, message_id, channel_id, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      ).run(guildId, date, message_id, channel_id, now());
    }
  },

  /** Delete tonight's record (used by /cancel). */
  remove: (guildId, date) =>
    db.prepare('DELETE FROM game_nights WHERE guild_id = ? AND date = ?').run(guildId, date),
};
