const crypto = require('crypto');
const { getRedis } = require('./_redis');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

function hashDuplicate(telegramId, amount, currency) {
  const raw = [telegramId, amount, currency].join(':');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

async function checkAntiSpam(req, fields) {
  const result = { allowed: true, error: null, suspicious: false, reason: null };
  const r = getRedis();
  if (!r) {
    result.suspicious = true;
    result.reason = 'redis_unavailable';
    return result;
  }

  try {
    const ip = getClientIp(req);
    const tgId = fields.telegramId || ip;

    const [cooldown, rate10m, rate24h] = await Promise.all([
      r.get(`cd:${tgId}`),
      r.get(`r10:${tgId}`),
      r.get(`r24:${tgId}`),
    ]);

    if (cooldown) {
      result.allowed = false;
      result.reason = 'cooldown_active';
      result.error = '\u0412\u044B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0435 \u0437\u0430\u044F\u0432\u043A\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.';
      return result;
    }

    if (rate10m) {
      result.allowed = false;
      result.reason = 'rate_10m';
      result.error = '\u0412\u044B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0435 \u0437\u0430\u044F\u0432\u043A\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.';
      return result;
    }

    const count24h = rate24h !== null ? parseInt(String(rate24h), 10) : 0;
    if (count24h >= 5) {
      result.allowed = false;
      result.reason = 'rate_24h';
      result.error = '\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D \u043B\u0438\u043C\u0438\u0442 \u0437\u0430\u044F\u0432\u043E\u043A \u0437\u0430 \u0434\u0435\u043D\u044C.';
      result.suspicious = true;
      return result;
    }

    const dupKey = `dup:${hashDuplicate(tgId, fields.amount, fields.currency)}`;
    const dup = await r.get(dupKey);
    if (dup) {
      result.allowed = false;
      result.reason = 'duplicate';
      result.error = '\u0422\u0430\u043A\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442. \u0414\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438.';
      return result;
    }

    if (count24h >= 3) {
      result.suspicious = true;
      result.reason = 'rate_elevated';
    }

    return result;
  } catch (err) {
    console.error('Redis check error:', err.message);
    result.suspicious = true;
    result.reason = 'redis_error';
    return result;
  }
}

async function recordSubmission(fields) {
  const r = getRedis();
  if (!r) return;

  try {
    const tgId = fields.telegramId;
    const rate24hKey = `r24:${tgId}`;
    const dupHash = hashDuplicate(tgId, fields.amount, fields.currency);

    const p = r.pipeline();
    p.set(`cd:${tgId}`, '1', { ex: 60 });
    p.set(`r10:${tgId}`, '1', { ex: 600 });
    p.set(`dup:${dupHash}`, '1', { ex: 1800 });
    p.incr(rate24hKey);
    await p.exec();

    const ttl = await r.ttl(rate24hKey);
    if (ttl < 0) {
      await r.expire(rate24hKey, 86400);
    }
  } catch (err) {
    console.error('Redis record error:', err.message);
  }
}

module.exports = { checkAntiSpam, recordSubmission };
