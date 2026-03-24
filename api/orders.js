const { validateInitData } = require('./_auth');
const { getDb } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const initData = req.headers['x-telegram-init-data'];
    const user = validateInitData(initData);
    if (!user) {
      return res.status(403).json({ ok: false, error: '\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044F' });
    }

    const db = getDb();

    await db.from('orders')
      .update({ status: 'expired' })
      .eq('telegram_id', user.id)
      .eq('status', 'created')
      .lt('expires_at', new Date().toISOString());

    const { data: orders, error } = await db
      .from('orders')
      .select('order_id, created_at, receive_amount, receive_currency, pay_amount, pay_currency, final_rate, status')
      .eq('telegram_id', user.id)
      .neq('status', 'created')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('DB fetch error:', error);
      return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0437\u0430\u044F\u0432\u043E\u043A' });
    }

    return res.status(200).json({ ok: true, orders: orders || [] });
  } catch (err) {
    console.error('Orders error:', err.message);
    return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430' });
  }
};
