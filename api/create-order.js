const crypto = require('crypto');
const fetch = require('node-fetch');
const { getRedis } = require('./_redis');
const { validateInitData } = require('./_auth');

const ORDER_TTL = 86400;
const ORDER_LIFETIME = 1800;

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return 'ALP-' + ts + '-' + rand;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

async function getCurrentRate() {
  const markupPercent = parseFloat(process.env.MARKUP_PERCENT) || 8;
  const r = getRedis();

  if (r) {
    try {
      const cached = await r.get('rate:usdt_rub');
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return { baseRate: data.baseRate, finalRate: data.finalRate, markupPercent };
      }
    } catch (_) {}
  }

  const url = process.env.RAPIRA_API_URL;
  if (!url) throw new Error('Rate source not configured');

  const resp = await fetch(url, { timeout: 10000 });
  if (!resp.ok) throw new Error('Rate API error');

  const data = await resp.json();
  let baseRate = null;

  if (typeof data === 'number') baseRate = data;
  else if (data.price) baseRate = parseFloat(data.price);
  else if (data.rate) baseRate = parseFloat(data.rate);
  else if (data.last) baseRate = parseFloat(data.last);
  else if (data.result && data.result.price) baseRate = parseFloat(data.result.price);
  else if (data.data && typeof data.data === 'object' && data.data.price) baseRate = parseFloat(data.data.price);

  if (!baseRate || isNaN(baseRate) || baseRate <= 0) throw new Error('Cannot parse rate');

  const finalRate = Math.round(baseRate * (1 + markupPercent / 100) * 100) / 100;
  return { baseRate, finalRate, markupPercent };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  try {
    const { amountRub, payoutDetails } = req.body || {};

    if (!amountRub || isNaN(amountRub) || parseFloat(amountRub) <= 0) {
      return res.status(400).json({ ok: false, error: '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0443\u044E \u0441\u0443\u043C\u043C\u0443' });
    }

    const rubAmount = parseFloat(amountRub);

    if (rubAmount < 100) {
      return res.status(400).json({ ok: false, error: '\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430: 100 RUB' });
    }

    if (rubAmount > 10000000) {
      return res.status(400).json({ ok: false, error: '\u0421\u0443\u043C\u043C\u0430 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0430\u044F' });
    }

    if (!payoutDetails || typeof payoutDetails !== 'string' || payoutDetails.trim().length < 5) {
      return res.status(400).json({ ok: false, error: '\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u0434\u043B\u044F \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F' });
    }

    const initData = req.headers['x-telegram-init-data'];
    if (!initData) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация через Telegram' });
    }

    const tgUser = validateInitData(initData);
    if (!tgUser) {
      return res.status(401).json({ ok: false, error: 'Недействительные данные авторизации' });
    }

    const telegramId = String(tgUser.id);
    const telegramUsername = tgUser.username || null;
    const telegramFirstName = tgUser.first_name || null;

    const ip = getClientIp(req);
    const r = getRedis();

    if (r) {
      const cd = await r.get(`order_cd:${ip}`);
      if (cd) {
        return res.status(429).json({ ok: false, reason: 'cooldown_active', error: '\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435\u043C \u043D\u043E\u0432\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u0438' });
      }
      await r.set(`order_cd:${ip}`, '1', { ex: 30 });
    }

    const { baseRate, finalRate, markupPercent } = await getCurrentRate();

    if (!finalRate || finalRate <= 0) {
      return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u043A\u0443\u0440\u0441\u0430' });
    }

    const amountUsdt = Math.round((rubAmount / finalRate) * 100) / 100;

    const orderId = generateOrderId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ORDER_LIFETIME * 1000);

    let seqId = null;
    if (r) {
      seqId = await r.incr('order:seq');
    }

    const orderData = {
      orderId,
      seqId,
      telegramId,
      telegramUsername,
      telegramFirstName,
      receiveAmount: amountUsdt,
      receiveCurrency: 'USDT',
      payAmount: rubAmount,
      payCurrency: 'RUB',
      baseRate,
      finalRate,
      markupPercent,
      payoutDetails: payoutDetails.trim().substring(0, 500),
      status: 'created',
      clientIp: ip,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    if (r) {
      await r.set(`order:${orderId}`, JSON.stringify(orderData), { ex: ORDER_TTL });
      if (telegramId) {
        await r.lpush('user:orders:' + telegramId, orderId);
      }
    }

    return res.status(200).json({
      ok: true,
      orderId,
      seqId,
      receiveAmount: amountUsdt,
      receiveCurrency: 'USDT',
      payAmount: rubAmount,
      payCurrency: 'RUB',
      finalRate,
      paymentRequisites: process.env.PAYMENT_REQUISITES || '',
      expiresAt: expiresAt.toISOString()
    });
  } catch (err) {
    console.error('Create order error:', err.message);
    return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430' });
  }
};
