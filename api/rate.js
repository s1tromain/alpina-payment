const fetch = require('node-fetch');
const { getRedis } = require('./_redis');

const CACHE_KEY = 'rate:usdt_rub';
const CACHE_TTL = 25;

async function fetchRapiraRate() {
  const url = process.env.RAPIRA_API_URL;
  if (!url) throw new Error('RAPIRA_API_URL not configured');

  const resp = await fetch(url, { timeout: 10000 });
  if (!resp.ok) throw new Error('Rapira API error: ' + resp.status);

  const data = await resp.json();

  let baseRate = null;
  if (typeof data === 'number') {
    baseRate = data;
  } else if (data.price) {
    baseRate = parseFloat(data.price);
  } else if (data.rate) {
    baseRate = parseFloat(data.rate);
  } else if (data.last) {
    baseRate = parseFloat(data.last);
  } else if (data.result && data.result.price) {
    baseRate = parseFloat(data.result.price);
  } else if (Array.isArray(data.data)) {
    const pair = data.data.find(
      item => item && item.symbol === 'USDT/RUB'
    );
    if (pair) {
      baseRate = parseFloat(pair.askPrice || pair.close || pair.bidPrice);
    }
  } else if (data.data && typeof data.data === 'object' && data.data.price) {
    baseRate = parseFloat(data.data.price);
  } else if (Array.isArray(data) && data[0] && data[0].price) {
    baseRate = parseFloat(data[0].price);
  }

  if (!baseRate || isNaN(baseRate) || baseRate <= 0) {
    throw new Error('Could not parse rate from API response');
  }

  return baseRate;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const markupPercent = parseFloat(process.env.MARKUP_PERCENT) || 8;
    const r = getRedis();

    if (r) {
      try {
        const cached = await r.get(CACHE_KEY);
        if (cached) {
          const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
          return res.status(200).json({
            ok: true,
            baseRate: parsed.baseRate,
            markupPercent,
            finalRate: parsed.finalRate,
            updatedAt: parsed.updatedAt
          });
        }
      } catch (_) {}
    }

    const baseRate = await fetchRapiraRate();
    const finalRate = Math.round(baseRate * (1 + markupPercent / 100) * 100) / 100;
    const updatedAt = new Date().toISOString();

    if (r) {
      try {
        await r.set(CACHE_KEY, JSON.stringify({ baseRate, finalRate, updatedAt }), { ex: CACHE_TTL });
      } catch (_) {}
    }

    return res.status(200).json({
      ok: true,
      baseRate,
      markupPercent,
      finalRate,
      updatedAt
    });
  } catch (err) {
    console.error('Rate fetch error:', err.message);
    return res.status(500).json({ ok: false, error: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043A\u0443\u0440\u0441' });
  }
};
