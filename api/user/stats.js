const { validateInitData } = require('../_auth');
const { getRedis } = require('../_redis');
const { getDb } = require('../_db');

const ZERO_STATS = { totalRub: 0, totalUsdt: 0, totalOrders: 0, pendingCount: 0, rejectedCount: 0 };

function calcStats(orders) {
  var totalRub = 0, totalUsdt = 0, totalOrders = 0, pendingCount = 0, rejectedCount = 0;
  (orders || []).forEach(function (o) {
    var s = o.status;
    if (s === 'approved' || s === 'completed') {
      totalRub  += Number(o.pay_amount   || o.payAmount   || 0);
      totalUsdt += Number(o.receive_amount || o.receiveAmount || 0);
      totalOrders += 1;
    } else if (s === 'pending') {
      pendingCount += 1;
    } else if (s === 'rejected') {
      rejectedCount += 1;
    }
  });
  return {
    totalRub:      Math.round(totalRub  * 100) / 100,
    totalUsdt:     Math.round(totalUsdt * 100) / 100,
    totalOrders,
    pendingCount,
    rejectedCount
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const initData = req.headers['x-telegram-init-data'];
    const user = validateInitData(initData);
    if (!user) {
      return res.status(403).json({ ok: false, error: 'Неверная авторизация' });
    }

    const telegramId = String(user.id);

    // --- Redis first ---
    const r = getRedis();
    if (r) {
      try {
        const orderIds = await r.lrange('user:orders:' + telegramId, 0, 199);
        if (orderIds && orderIds.length > 0) {
          const orders = [];
          for (const oid of orderIds) {
            const raw = await r.get('order:' + oid);
            if (!raw) continue;
            orders.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
          }
          console.log('Stats from Redis, orders count:', orders.length);
          return res.status(200).json({ ok: true, stats: calcStats(orders) });
        }
      } catch (redisErr) {
        console.error('Redis stats error:', redisErr.message);
      }
    }

    // --- Supabase fallback ---
    let db;
    try {
      db = getDb();
    } catch (dbInitErr) {
      console.error('Supabase init error in user/stats:', dbInitErr.message);
      return res.status(200).json({ ok: true, stats: ZERO_STATS });
    }

    const { data: rows, error } = await db
      .from('orders')
      .select('pay_amount, receive_amount, status')
      .eq('telegram_id', telegramId);

    if (error) {
      console.error('DB fetch error in user/stats:', error.message, error.details);
      return res.status(200).json({ ok: true, stats: ZERO_STATS });
    }

    console.log('Stats from Supabase, rows count:', (rows || []).length);
    return res.status(200).json({ ok: true, stats: calcStats(rows) });

  } catch (err) {
    console.error('User stats unexpected error:', err.message);
    return res.status(200).json({ ok: true, stats: ZERO_STATS });
  }
};

