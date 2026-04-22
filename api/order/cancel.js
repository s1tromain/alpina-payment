const { validateInitData } = require('../_auth');
const { getRedis } = require('../_redis');
const { releaseCard } = require('../_requisites');
const { getDb } = require('../_db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const initData = req.headers['x-telegram-init-data'];
  const user = validateInitData(initData);
  if (!user) {
    return res.status(403).json({ ok: false, error: 'Неверная авторизация' });
  }

  const { orderId } = req.body || {};
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Укажите orderId' });
  }

  const r = getRedis();
  if (!r) {
    return res.status(503).json({ ok: false, error: 'Сервис временно недоступен' });
  }

  const raw = await r.get('order:' + orderId);
  if (!raw) {
    return res.status(404).json({ ok: false, error: 'Заявка не найдена или истекла' });
  }

  const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (order.telegramId && String(order.telegramId) !== String(user.id)) {
    return res.status(403).json({ ok: false, error: 'Нет доступа к этой заявке' });
  }

  if (!['created', 'pending'].includes(order.status)) {
    return res.status(400).json({ ok: false, error: 'Заявку нельзя отменить в текущем статусе' });
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  await r.set('order:' + orderId, JSON.stringify(order), { ex: 86400 });

  try {
    await releaseCard(order.assignedRequisiteId, orderId);
  } catch (e) {
    console.error('releaseCard error on cancel:', e.message);
  }

  // Sync to Supabase (fire-and-forget)
  try {
    const db = getDb();
    const { error } = await db.from('orders').update({ status: 'cancelled' }).eq('order_id', orderId);
    if (error) console.error('Supabase cancel sync error:', error.message);
  } catch (dbErr) {
    console.error('Supabase cancel crash:', dbErr.message);
  }

  return res.status(200).json({ ok: true });
};
