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
      console.error('Supabase init error in user/stats:', dbInitErr.message);
      return res.status(200).json({ ok: true, stats: { totalRub: 0, totalUsdt: 0, totalOrders: 0, pendingCount: 0, rejectedCount: 0 } });
    }

    const { data: rows, error } = await db
      .from('orders')
      .select('pay_amount, receive_amount, status')
      .eq('telegram_id', String(user.id));

    if (error) {
      console.error('DB fetch error in user/stats:', error.message, error.details);
      return res.status(200).json({ ok: true, stats: { totalRub: 0, totalUsdt: 0, totalOrders: 0, pendingCount: 0, rejectedCount: 0 } });
    }

    let totalRub = 0;
    let totalUsdt = 0;
    let totalOrders = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    (rows || []).forEach(function (r) {
      if (r.status === 'approved') {
        totalRub += Number(r.pay_amount || 0);
        totalUsdt += Number(r.receive_amount || 0);
        totalOrders += 1;
      } else if (r.status === 'pending') {
        pendingCount += 1;
      } else if (r.status === 'rejected') {
        rejectedCount += 1;
      }
    });

    return res.status(200).json({
      ok: true,
      stats: {
        totalRub: Math.round(totalRub * 100) / 100,
        totalUsdt: Math.round(totalUsdt * 100) / 100,
        totalOrders,
        pendingCount,
        rejectedCount
      }
    });
  } catch (err) {
    console.error('User stats unexpected error:', err.message);
    return res.status(200).json({ ok: true, stats: { totalRub: 0, totalUsdt: 0, totalOrders: 0, pendingCount: 0, rejectedCount: 0 } });
  }
};
