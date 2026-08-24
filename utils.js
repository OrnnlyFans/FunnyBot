/**
 * Date + time source of truth.
 *
 * Every game-night date/time is pinned to **Asia/Manila** (Philippines, UTC+8).
 * Asia/Manila observes no daylight-saving time, so compared to a host machine's
 * local clock the Philippine date can differ by up to a day. We intentionally
 * use the Philippine calendar for the SQLite `date` key AND the date shown to
 * users — never the host's local time.
 */

const TZ = 'Asia/Manila';

/**
 * The `YYYY-MM-DD` key for "today/tonight", computed in Manila time.
 * @param {Date} [date] default = now; pass a fixed Date in tests.
 * @returns {string}
 */
function todayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * A human-friendly Manila date, e.g. "Tuesday, August 25, 2026".
 * @param {Date} [date] overrunnable for tests.
 * @returns {string}
 */
function formatTodayLong(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * A Manila clock timestamp `YYYY-MM-DD HH:mm:ss`, used only for audit columns
 * (`updated_at` / `joined_at`).
 * @param {Date} [date] = now.
 * @returns {string}
 */
function manilaNow(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Parses a time string (e.g. "9:00 PM", "9:30", "+15m") against a Manila date.
 * Returns a JS Date object in UTC/local time corresponding to that Manila clock time.
 * @param {string} timeStr
 * @param {string} [dateKey] default = todayKey()
 * @returns {Date|null}
 */
function parseTimeString(timeStr, dateKey = todayKey()) {
  if (!timeStr || !dateKey) return null;
  const str = String(timeStr).trim().toLowerCase();

  // Relative offset e.g. "+15m", "+30 mins", "in 20m"
  const relMatch = str.match(/(?:\+|in\s*)(\d+)\s*(?:m|min|mins|minutes)?/i);
  if (relMatch && (str.startsWith('+') || str.startsWith('in '))) {
    const addMinutes = parseInt(relMatch[1], 10);
    return new Date(Date.now() + addMinutes * 60000);
  }

  // Standard clock time "9:30 PM", "21:30", "10pm"
  const match = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridian = match[3];

  if (meridian === 'pm' && hours < 12) hours += 12;
  if (meridian === 'am' && hours === 12) hours = 0;

  // Default to PM for evening game hours if not specified
  if (!meridian) {
    if (hours >= 1 && hours <= 11) hours += 12;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoStr = `${dateKey}T${pad(hours)}:${pad(minutes)}:00+08:00`;
  const dateObj = new Date(isoStr);
  return isNaN(dateObj.getTime()) ? null : dateObj;
}

module.exports = { TZ, todayKey, formatTodayLong, manilaNow, parseTimeString };