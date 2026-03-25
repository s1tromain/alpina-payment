module.exports = async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false });
  }

  // Orders are stored in Redis with TTL — they expire automatically.
  // DB-based expiration only runs when Supabase is configured.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ ok: true, expired: 0 });
  }

  try {
    const { getDb } = require('./_db');
    const { userBot } = require('./_telegram');
    const db = getDb();

    const { data: expiredOrders } = await db
      .from('orders')
      .select('order_id, telegram_id')
      .eq('status', 'created')
      .lt('expires_at', new Date().toISOString());

    if (!expiredOrders || expiredOrders.length === 0) {
      return res.status(200).json({ ok: true, expired: 0 });
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

    return res.status(200).json({ ok: true, expired: count });
  } catch (err) {
    console.error('Cron expire error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
