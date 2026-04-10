const { getRedis } = require('./_redis');

const DAILY_LIMIT_RUB = 200000;
const STATS_KEY_PREFIX = 'stats:daily:';
const DATES_INDEX_KEY = 'stats:dates';

function getTodayDateStr() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function statsKey(dateStr) {
  return STATS_KEY_PREFIX + dateStr;
}

/**
 * Record an approved order in daily stats.
 * Called once when an order is approved in the channel.
 * Returns the updated stats for today.
 */
async function recordApproval(amountRub) {
  var r = getRedis();
  if (!r) return null;

  var dateStr = getTodayDateStr();
  var key = statsKey(dateStr);

  var raw = await r.get(key);
  var stats = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {
    date: dateStr,
    totalApprovedRub: 0,
    approvedOrdersCount: 0
  };

  stats.totalApprovedRub = (stats.totalApprovedRub || 0) + amountRub;
  stats.approvedOrdersCount = (stats.approvedOrdersCount || 0) + 1;

  await r.set(key, JSON.stringify(stats), { ex: 7776000 });

  // Add date to index set for history queries
  await r.sadd(DATES_INDEX_KEY, dateStr);

  return stats;
}

/**
 * Get daily stats for a specific date (or today).
 */
async function getDailyStats(dateStr) {
  var r = getRedis();
  if (!r) return { date: dateStr, totalApprovedRub: 0, approvedOrdersCount: 0 };

  if (!dateStr) dateStr = getTodayDateStr();

  var key = statsKey(dateStr);
  var raw = await r.get(key);
  if (!raw) return { date: dateStr, totalApprovedRub: 0, approvedOrdersCount: 0 };

  var stats = typeof raw === 'string' ? JSON.parse(raw) : raw;
  stats.date = dateStr;
  return stats;
}

/**
 * Get stats history for the last N days (from the index).
 */
async function getStatsHistory(limit) {
  var r = getRedis();
  if (!r) return [];

  if (!limit) limit = 30;

  var dates = await r.smembers(DATES_INDEX_KEY);
  if (!dates || dates.length === 0) return [];

  // Sort descending
  dates.sort(function(a, b) { return b.localeCompare(a); });

  // Limit
  if (dates.length > limit) dates = dates.slice(0, limit);

  var results = [];
  for (var i = 0; i < dates.length; i++) {
    var key = statsKey(dates[i]);
    var raw = await r.get(key);
    if (!raw) {
      results.push({ date: dates[i], totalApprovedRub: 0, approvedOrdersCount: 0 });
      continue;
    }
    var stats = typeof raw === 'string' ? JSON.parse(raw) : raw;
    stats.date = dates[i];
    results.push(stats);
  }

  return results;
}

/**
 * Check if a new order with the given RUB amount would exceed the daily limit.
 * Returns { allowed: true/false, currentTotal, limit, remaining }
 */
async function checkDailyLimit(amountRub) {
  var today = await getDailyStats(getTodayDateStr());
  var currentTotal = today.totalApprovedRub || 0;
  var remaining = DAILY_LIMIT_RUB - currentTotal;

  return {
    allowed: (currentTotal + amountRub) <= DAILY_LIMIT_RUB,
    currentTotal: currentTotal,
    limit: DAILY_LIMIT_RUB,
    remaining: Math.max(0, remaining)
  };
}

module.exports = {
  DAILY_LIMIT_RUB,
  getTodayDateStr,
  recordApproval,
  getDailyStats,
  getStatsHistory,
  checkDailyLimit
};
