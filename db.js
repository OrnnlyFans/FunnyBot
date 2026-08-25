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
      game         TEXT,              -- selected game (e.g. Valorant, League, Party, Any)
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
      role      TEXT,             -- 'player' (default) or 'watcher'
      joined_at TEXT,
      PRIMARY KEY (guild_id, date, user_id)
  );

  CREATE TABLE IF NOT EXISTS sent_reminders (
      guild_id    TEXT NOT NULL,
      date        TEXT NOT NULL,
      target_id   TEXT NOT NULL,   -- 'guild_main' or user_id
      remind_type TEXT NOT NULL,   -- 'start_soon', 'start_after', 'individual_join', 'individual_after'
      sent_at     TEXT NOT NULL,
      PRIMARY KEY (guild_id, date, target_id, remind_type)
  );

  CREATE TABLE IF NOT EXISTS lies_and_deceit (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id         TEXT NOT NULL,
      date             TEXT NOT NULL,    -- the game-night date this was recorded against
      user_id          TEXT NOT NULL,    -- the teammate who didn't show
      user_name        TEXT,
      declared_by      TEXT,             -- host who declared it
      declared_by_name TEXT,
      reason           TEXT,
      declared_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_nights_guild_date
      ON game_nights (guild_id, date);
  CREATE INDEX IF NOT EXISTS idx_attendees_guild_date
      ON game_attendees (guild_id, date);
  CREATE INDEX IF NOT EXISTS idx_sent_reminders
      ON sent_reminders (guild_id, date);
`);

// Migration: add columns to db files made by earlier schemas.
(() => {
  const cols = db.prepare('PRAGMA table_info(game_nights)').all().map((c) => c.name);
  const acols = db.prepare('PRAGMA table_info(game_attendees)').all().map((c) => c.name);
  const adds = [];
  if (!cols.includes('creator')) adds.push('ALTER TABLE game_nights ADD COLUMN creator TEXT');
  if (!cols.includes('creator_name')) adds.push('ALTER TABLE game_nights ADD COLUMN creator_name TEXT');
  if (!cols.includes('game')) adds.push('ALTER TABLE game_nights ADD COLUMN game TEXT');
  if (!acols.includes('role')) adds.push("ALTER TABLE game_attendees ADD COLUMN role TEXT DEFAULT 'player'");
  if (adds.length) db.exec(adds.join(';'));

  // Rebuild lies_and_deceit if it uses the old one-row-per-day primary key —
  // strikes must stack even when declared multiple times on the same night.
  const lcols = db.prepare('PRAGMA table_info(lies_and_deceit)').all().map((c) => c.name);
  if (lcols.length && !lcols.includes('id')) {
    db.exec(`
      ALTER TABLE lies_and_deceit RENAME TO lies_and_deceit_legacy;
      CREATE TABLE lies_and_deceit (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id         TEXT NOT NULL,
          date             TEXT NOT NULL,
          user_id          TEXT NOT NULL,
          user_name        TEXT,
          declared_by      TEXT,
          declared_by_name TEXT,
          reason           TEXT,
          declared_at      TEXT NOT NULL
      );
      INSERT INTO lies_and_deceit
          (guild_id, date, user_id, user_name, declared_by, declared_by_name, reason, declared_at)
      SELECT guild_id, date, user_id, user_name, declared_by, declared_by_name, reason, declared_at
        FROM lies_and_deceit_legacy;
      DROP TABLE lies_and_deceit_legacy;
    `);
  }
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

/** Transfer host & creator ownership to a new user. */
function transferHost(guildId, date, { id, name }) {
  db.prepare(
    `UPDATE game_nights
     SET set_by = ?,
         set_by_name = ?,
         creator = ?,
         creator_name = ?,
         updated_at = ?
     WHERE guild_id = ? AND date = ?`,
  ).run(id, name, id, name, manilaNow(), guildId, date);
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
            game = NULL,
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

/** Upsert a player (or watcher) into tonight's roster with the time they'll appear. */
function setAttendee(guildId, date, { user_id, user_name, time_, role }) {
  const safeRole = role === 'watcher' ? 'watcher' : 'player';
  db.prepare(
    `INSERT INTO game_attendees
        (guild_id, date, user_id, user_name, join_time, role, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, date, user_id) DO UPDATE SET
        user_name = excluded.user_name,
        join_time = excluded.join_time,
        role = excluded.role,
        joined_at = excluded.joined_at`,
  ).run(guildId, date, user_id, user_name, time_ || null, safeRole, manilaNow());
}

function getAttendees(guildId, date) {
  return db
    .prepare(
      'SELECT * FROM game_attendees WHERE guild_id = ? AND date = ? ORDER BY joined_at, rowid',
    )
    .all(guildId, date);
}

/** Split a roster into { players, watchers }. NULL/unknown role counts as player. */
function splitAttendees(attendees) {
  const players = [];
  const watchers = [];
  for (const a of attendees || []) {
    if (a.role === 'watcher') watchers.push(a);
    else players.push(a);
  }
  return { players, watchers };
}

function removeAttendee(guildId, date, user_id) {
  db.prepare(
    'DELETE FROM game_attendees WHERE guild_id = ? AND date = ? AND user_id = ?',
  ).run(guildId, date, user_id);
}

function clearAttendees(guildId, date) {
  db.prepare('DELETE FROM game_attendees WHERE guild_id = ? AND date = ?').run(guildId, date);
}

/* ---------------------------------------------------------------------- */
/* Reminders                                                              */
/* ---------------------------------------------------------------------- */

function getActiveGameNights(date) {
  return db
    .prepare('SELECT * FROM game_nights WHERE date = ? AND playing = 1')
    .all(date);
}

function hasReminderBeenSent(guildId, date, targetId, remindType) {
  const row = db
    .prepare(
      'SELECT 1 FROM sent_reminders WHERE guild_id = ? AND date = ? AND target_id = ? AND remind_type = ?',
    )
    .get(guildId, date, targetId, remindType);
  return !!row;
}

function recordReminder(guildId, date, targetId, remindType) {
  db.prepare(
    `INSERT OR IGNORE INTO sent_reminders (guild_id, date, target_id, remind_type, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(guildId, date, targetId, remindType, manilaNow());
}

/* ---------------------------------------------------------------------- */
/* Game selection                                                         */
/* ---------------------------------------------------------------------- */

/** Store the game chosen by the host (e.g. "Valorant", "League", "Party", "Any"). */
function setGame(guildId, date, game) {
  db.prepare(
    'UPDATE game_nights SET game = ?, updated_at = ? WHERE guild_id = ? AND date = ?',
  ).run(game, manilaNow(), guildId, date);
}

/* ---------------------------------------------------------------------- */
/* Lies and Deceit — no-show tracking                                       */
/* ---------------------------------------------------------------------- */

/** Record ONE no-show strike for a teammate (multiple strikes per day stack). */
function addNoShow(guildId, date, { user_id, user_name, declared_by, declared_by_name }) {
  db.prepare(
    `INSERT INTO lies_and_deceit
        (guild_id, date, user_id, user_name, declared_by, declared_by_name, declared_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(guildId, date, user_id, user_name, declared_by, declared_by_name, manilaNow());
}

/** All no-shows recorded for a specific game-night date. */
function getNoShows(guildId, date) {
  return db
    .prepare(
      'SELECT * FROM lies_and_deceit WHERE guild_id = ? AND date = ? ORDER BY declared_at',
    )
    .all(guildId, date);
}

/** Total no-show count for a user across every date (the "Lies and Deceit" counter). */
function getNoShowCount(guildId, userId) {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM lies_and_deceit WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  return row ? row.cnt : 0;
}

/** All-time no-show leaderboard for a guild: user_id, user_name, count, last_declared. */
function getAllNoShowCounts(guildId) {
  return db
    .prepare(
      `SELECT user_id, user_name, COUNT(*) as count, MAX(declared_at) as last_declared
       FROM lies_and_deceit WHERE guild_id = ?
       GROUP BY user_id, user_name
       ORDER BY count DESC, last_declared DESC`,
    )
        .all(guildId);
}

/** Delete every lie record for one user in a guild. Returns rows removed. */
function clearNoShows(guildId, userId) {
  const res = db
    .prepare('DELETE FROM lies_and_deceit WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId);
  return res.changes;
}

/** Wipe a guild's ENTIRE Hall of Shame. Returns rows removed. */
function clearAllNoShows(guildId) {
  const res = db.prepare('DELETE FROM lies_and_deceit WHERE guild_id = ?').run(guildId);
  return res.changes;
}

module.exports = {
  db,
  get,
  createOrRefresh,
  setMessageRef,
  ensureCreator,
  transferHost,
  setAnswer,
  resetToPending,
  remove,
  setGame,
  setAttendee,
  getAttendees,
  splitAttendees,
  removeAttendee,
  clearAttendees,
  getActiveGameNights,
  hasReminderBeenSent,
  recordReminder,
  addNoShow,
  getNoShows,
  getNoShowCount,
  getAllNoShowCounts,
  clearNoShows,
  clearAllNoShows,
};