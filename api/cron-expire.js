module.exports = async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false });
  }

  const { getRedis } = require('./_redis');
  const { userBot } = require('./_telegram');
  const { releaseCardByOrder } = require('./_requisites');

  const r = getRedis();
  let redisExpired = 0;

  // Scan Redis orders for expired ones
  if (r) {
    try {
      const allKeys = await r.keys('order:*');
      for (const key of allKeys) {
        if (key === 'order:seq') continue;
        const raw = await r.get(key);
        if (!raw) continue;
        const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < new Date()) {
          order.status = 'expired';
          await r.set(key, JSON.stringify(order), { ex: 86400 });
          await releaseCardByOrder(order);
          redisExpired++;

          if (order.telegramId) {
            try {
              await userBot.sendPlainMessage(
                order.telegramId,
                '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.'
              );
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.error('Redis expire scan error:', err.message);
    }
  }

  // DB-based expiration only runs when Supabase is configured.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ ok: true, expired: redisExpired });
  }

  try {
    const { getDb } = require('./_db');
    const db = getDb();

    const { data: expiredOrders } = await db
      .from('orders')
      .select('order_id, telegram_id')
      .eq('status', 'created')
      .lt('expires_at', new Date().toISOString());

    if (!expiredOrders || expiredOrders.length === 0) {
      return res.status(200).json({ ok: true, expired: redisExpired });
    }

    let count = 0;
    for (const order of expiredOrders) {
      await db.from('orders')
        .update({ status: 'expired' })
        .eq('order_id', order.order_id);

      try {
        await userBot.sendPlainMessage(
          order.telegram_id,
          '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.'
        );
      } catch (_) {}

      count++;
    }

    return res.status(200).json({ ok: true, expired: redisExpired + count });
  } catch (err) {
    console.error('Cron expire error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
