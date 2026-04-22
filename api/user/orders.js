const { validateInitData } = require('../_auth');
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

    let db;
    try {
      db = getDb();
    } catch (dbInitErr) {
      console.error('Supabase init error in user/orders:', dbInitErr.message);
      return res.status(200).json({ ok: true, orders: [] });
    }

    // Non-fatal: expire stale created orders in DB history
    try {
      await db.from('orders')
        .update({ status: 'expired' })
        .eq('telegram_id', user.id)
        .eq('status', 'created')
        .lt('expires_at', new Date().toISOString());
    } catch (_) {}

    const { data: orders, error } = await db
      .from('orders')
      .select('order_id, created_at, receive_amount, receive_currency, pay_amount, pay_currency, final_rate, status, processed_at')
      .eq('telegram_id', String(user.id))
      .neq('status', 'created')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('DB fetch error in user/orders:', error.message || error);
      return res.status(200).json({ ok: true, orders: [] });
    }

    return res.status(200).json({ ok: true, orders: orders || [] });
  } catch (err) {
    console.error('User orders unexpected error:', err.message);
    return res.status(200).json({ ok: true, orders: [] });
  }
};
