const { validateInitData } = require('../_auth');
const { getRedis } = require('../_redis');
const { getDb } = require('../_db');

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

    // --- Redis first: source of truth ---
    const r = getRedis();
    if (r) {
      try {
        const orderIds = await r.lrange('user:orders:' + telegramId, 0, 99);
        if (orderIds && orderIds.length > 0) {
          const orders = [];
          for (const oid of orderIds) {
            const raw = await r.get('order:' + oid);
            if (!raw) continue;
            const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
            orders.push({
              order_id: o.orderId,
              status: o.status,
              pay_amount: o.payAmount,
              pay_currency: o.payCurrency || 'RUB',
              receive_amount: o.receiveAmount,
              receive_currency: o.receiveCurrency || 'USDT',
              final_rate: o.finalRate,
              created_at: o.createdAt,
              processed_at: o.processedAt || null,
            });
          }
          orders.sort(function (a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
          });
          return res.status(200).json({ ok: true, orders });
        }
      } catch (redisErr) {
        console.error('Redis orders fetch error:', redisErr.message);
      }
    }

    // --- Supabase fallback ---
    let db;
    try {
      db = getDb();
    } catch (dbInitErr) {
      console.error('Supabase init error in user/orders:', dbInitErr.message);
      return res.status(200).json({ ok: true, orders: [] });
    }

    const { data: orders, error } = await db
      .from('orders')
      .select('order_id, created_at, receive_amount, receive_currency, pay_amount, pay_currency, final_rate, status, processed_at')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('DB fetch error in user/orders:', error.message, error.details);
      return res.status(200).json({ ok: true, orders: [] });
    }

    return res.status(200).json({ ok: true, orders: orders || [] });
  } catch (err) {
    console.error('User orders unexpected error:', err.message);
    return res.status(200).json({ ok: true, orders: [] });
  }
};
