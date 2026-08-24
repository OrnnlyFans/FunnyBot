/**
 * SQLite storage for game nights.
 *
 * Every record is scoped by `(guild_id, Manila date)` — the composite primary
 * key. That is what keeps servers fully isolated: one server's prompts,
 * answers, message references and attendee lists can never be seen by another,
 * and `/status` only reads the row for the requesting guild.
 *
 * `game_nights` — one row per (guild, date). `playing`:
 *   NULL → prompt live, nobody has answered yet
 *   1    → yes, we're playing (host set a time)
 *   0    → no, not playing tonight
 * `creator` = the user who started the entry (first /tonight, or "Set up
 * again"); they (or a server admin) are the only ones who can `/cancel`.
 *
 * `game_attendees` — the "who's playing / when they'll appear" roster.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { manilaNow } = require('./utils');

const dbPath = path.join(__dirname, 'data', 'game_nights.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS game_nights (
      guild_id     TEXT NOT NULL,
      date         TEXT NOT NULL,     -- YYYY-MM-DD in Asia/Manila
      playing      INTEGER,           -- NULL pending, 1 yes, 0 no
      time         TEXT,              -- host-set start time label
      set_by       TEXT,              -- host user id
      set_by_name  TEXT,
      creator      TEXT,              -- user who created the entry (for /cancel)
      creator_name TEXT,
      message_id   TEXT,              -- the live prompt message id
      channel_id   TEXT,
      updated_at   TEXT,
      PRIMARY KEY (guild_id, date)
  );

  CREATE TABLE IF NOT EXISTS game_attendees (
      guild_id  TEXT NOT NULL,
      date      TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      user_name TEXT,
      join_time TEXT,
      joined_at TEXT,
      PRIMARY KEY (guild_id, date, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_game_nights_guild_date
      ON game_nights (guild_id, date);
  CREATE INDEX IF NOT EXISTS idx_attendees_guild_date
      ON game_attendees (guild_id, date);
`);

// Migration: add `creator`/`creator_name` to a db file made by the v1 schema.
(() => {
  const cols = db.prepare('PRAGMA table_info(game_nights)').all().map((c) => c.name);
  const adds = [];
  if (!cols.includes('creator')) adds.push('ALTER TABLE game_nights ADD COLUMN creator TEXT');
  if (!cols.includes('creator_name')) adds.push('ALTER TABLE game_nights ADD COLUMN creator_name TEXT');
  if (adds.length) db.exec(adds.join(';'));
})();

/* ---------------------------------------------------------------------- */
/* game_nights rows                                                       */
/* ---------------------------------------------------------------------- */

function get(guildId, date) {
  return db.prepare('SELECT * FROM game_nights WHERE guild_id = ? AND date = ?').get(guildId, date) || null;
}

function createOrRefresh(guildId, date, { message_id, channel_id }) {
  const existing = db
    .prepare('SELECT 1 FROM game_nights WHERE guild_id = ? AND date = ?')
    .get(guildId, date);

  if (existing) {
    db.prepare(
      'UPDATE game_nights SET message_id = ?, channel_id = ?, updated_at = ? WHERE guild_id = ? AND date = ?',
    ).run(message_id, channel_id, manilaNow(), guildId, date);
  } else {
    db.prepare(
      `INSERT INTO game_nights
          (guild_id, date, playing, time, set_by, set_by_name, creator, creator_name,
           message_id, channel_id, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(guildId, date, message_id, channel_id, manilaNow());
  }
}

function setMessageRef(guildId, date, { message_id, channel_id }) {
  db.prepare(
    'UPDATE game_nights SET message_id = ?, channel_id = ?, updated_at = ? WHERE guild_id = ? AND date = ?',
  ).run(message_id, channel_id, manilaNow(), guildId, date);
}

/** First actor on a row becomes `creator`; later actors never overwrite it. */
function ensureCreator(guildId, date, { id, name }) {
  db.prepare(
    `UPDATE game_nights
     SET creator = COALESCE(creator, ?),
         creator_name = COALESCE(creator_name, ?),
         updated_at = ?
     WHERE guild_id = ? AND date = ?`,
  ).run(id, name, manilaNow(), guildId, date);
}

/** Record the yes/no + optional host time. Preserves the stored message ref. */
function setAnswer(guildId, date, { playing, time, set_by, set_by_name }) {
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
  ).run(guildId, date, playing, time, set_by, set_by_name, manilaNow());
}

/** Wipe an answer back to a clean pending prompt; keep creator & message ref. */
function resetToPending(guildId, date, { message_id, channel_id }) {
  const existing = db
    .prepare('SELECT 1 FROM game_nights WHERE guild_id = ? AND date = ?')
    .get(guildId, date);

  if (existing) {
    db.prepare(
      `UPDATE game_nights
       SET playing = NULL, time = NULL, set_by = NULL, set_by_name = NULL,
           message_id = ?, channel_id = ?, updated_at = ?
       WHERE guild_id = ? AND date = ?`,
    ).run(message_id, channel_id, manilaNow(), guildId, date);
  } else {
    db.prepare(
      `INSERT INTO game_nights
          (guild_id, date, playing, time, set_by, set_by_name, creator, creator_name,
           message_id, channel_id, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(guildId, date, message_id, channel_id, manilaNow());
  }

  clearAttendees(guildId, date);
}

/** Delete tonight's row AND its attendee list (used by /cancel). */
function remove(guildId, date) {
  db.prepare('DELETE FROM game_attendees WHERE guild_id = ? AND date = ?').run(guildId, date);
  db.prepare('DELETE FROM game_nights WHERE guild_id = ? AND date = ?').run(guildId, date);
}

/* ---------------------------------------------------------------------- */
/* game_attendees                                                         */
/* ---------------------------------------------------------------------- */

/** Upsert a player into tonight's roster with the time they'll appear. */
function setAttendee(guildId, date, { user_id, user_name, time_ }) {
  db.prepare(
    `INSERT INTO game_attendees
        (guild_id, date, user_id, user_name, join_time, joined_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, date, user_id) DO UPDATE SET
        user_name = excluded.user_name,
        join_time = excluded.join_time,
        joined_at = excluded.joined_at`,
  ).run(guildId, date, user_id, user_name, time_ || null, manilaNow());
}

function getAttendees(guildId, date) {
  return db
    .prepare(
      'SELECT * FROM game_attendees WHERE guild_id = ? AND date = ? ORDER BY joined_at, rowid',
    )
    .all(guildId, date);
}

function removeAttendee(guildId, date, user_id) {
  db.prepare(
    'DELETE FROM game_attendees WHERE guild_id = ? AND date = ? AND user_id = ?',
  ).run(guildId, date, user_id);
}

function clearAttendees(guildId, date) {
  db.prepare('DELETE FROM game_attendees WHERE guild_id = ? AND date = ?').run(guildId, date);
}

module.exports = {
  db,
  get,
  createOrRefresh,
  setMessageRef,
  ensureCreator,
  setAnswer,
  resetToPending,
  remove,
  setAttendee,
  getAttendees,
  removeAttendee,
  clearAttendees,
};