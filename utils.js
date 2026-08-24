/**
 * Small date helpers shared by the bot and database layer.
 *
 * ⚠️  Date keys are computed in the **bot host's local time**. If your bot
 *     runs on a UTC server, "tonight" rolls over at midnight UTC. Put the
 *     bot in the timezone you want, or adjust `todayKey`/`formatTodayLong`.
 */

/**
 * Returns the DB key for "today" as `YYYY-MM-DD` (local time).
 * @returns {string}
 */
function todayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A human-friendly long date, e.g. "Sunday, August 24, 2026".
 * @returns {string}
 */
function formatTodayLong() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

module.exports = { todayKey, formatTodayLong };
