const { editMessageCaption, answerCallbackQuery, sendPlainMessage, esc } = require('./_telegram');
const { getRedis } = require('./_redis');
const { getDb } = require('./_db');

const MAX_BODY_SIZE = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const STATUS_MESSAGES = {
  pending: '\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u0438\u043D\u044F\u0442\u0430 \u0438 \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0435.',
  approved: '\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430. \u041E\u0436\u0438\u0434\u0430\u0439\u0442\u0435 \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0432\u0430\u0448\u0438\u0445 \u0441\u0440\u0435\u0434\u0441\u0442\u0432.',
  rejected: '\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430.',
  expired: '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.'
};

async function handleMessage(msg, res) {
  if (!msg.text || !msg.from || !msg.chat || msg.chat.type !== 'private') {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  if (text === '/start') {
    const miniAppUrl = process.env.MINI_APP_URL;
    if (!miniAppUrl) {
      await sendPlainMessage(chatId, '\u0411\u043E\u0442 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D.');
      return res.status(200).json({ ok: true });
    }

    const keyboard = {
      keyboard: [
        [{ text: '\uD83D\uDCF1 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435', web_app: { url: miniAppUrl } }],
        [{ text: '\uD83D\uDCCB \u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438', web_app: { url: miniAppUrl + '?screen=orders' } }]
      ],
      resize_keyboard: true
    };

    await sendPlainMessage(
      chatId,
      '\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 ALPINA PAY-OUT!\n\n\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435:',
      keyboard
    );
    return res.status(200).json({ ok: true });
  }

  if (text === '/logout') {
    const r = getRedis();
    if (r) await r.del('mod:auth:' + userId);
    await sendPlainMessage(chatId, '\u0412\u044B \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u0438');
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith('/')) {
    return res.status(200).json({ ok: true });
  }

  if (process.env.MODERATOR_PASSWORD && text === process.env.MODERATOR_PASSWORD) {
    const r = getRedis();
    if (r) {
      await r.set('mod:auth:' + userId, 'true', { ex: 86400 });
      await sendPlainMessage(chatId, '\u041C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430. \u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0438 \u0447\u0435\u0440\u0435\u0437 \u043A\u043D\u043E\u043F\u043A\u0438 \u0432 \u043A\u0430\u043D\u0430\u043B\u0435.');
    }
  }

  return res.status(200).json({ ok: true });
}

async function handleCallback(cb, res) {
  if (!cb.from || !cb.message) {
    return res.status(200).json({ ok: true });
  }

  const fromId = String(cb.from.id);

  const adminList = (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean);
  let isAuthorized = adminList.includes(fromId);

  if (!isAuthorized) {
    const r = getRedis();
    if (r) {
      try {
        isAuthorized = !!(await r.get('mod:auth:' + fromId));
      } catch (_) {}
    }
  }

  if (!isAuthorized) {
    await answerCallbackQuery(cb.id, '\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E');
    return res.status(200).json({ ok: true });
  }

  const data = cb.data || '';
  const sepIdx = data.indexOf(':');
  if (sepIdx === -1) {
    await answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
    return res.status(200).json({ ok: true });
  }

  const action = data.substring(0, sepIdx);
  const orderId = data.substring(sepIdx + 1);

  if (!['approve', 'reject'].includes(action) || !orderId) {
    await answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
    return res.status(200).json({ ok: true });
  }

  const db = getDb();
  const { data: order, error: fetchErr } = await db
    .from('orders')
    .select('*')
    .eq('order_id', orderId)
    .single();

  if (fetchErr || !order) {
    await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  if (order.status !== 'pending') {
    await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const adminName = cb.from.first_name || 'Admin';

  await db.from('orders').update({
    status: newStatus,
    processed_by: adminName + ' (' + fromId + ')',
    processed_at: new Date().toISOString()
  }).eq('order_id', orderId);

  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const existingCaption = cb.message.caption || cb.message.text || '';

  let statusLine;
  if (action === 'approve') {
    statusLine = '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430\n\uD83D\uDC64 ' + adminName;
  } else {
    statusLine = '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430\n\uD83D\uDC64 ' + adminName;
  }

  const newCaption = existingCaption.replace(/\u23F3[^\n]*/s, statusLine);

  await editMessageCaption(chatId, messageId, newCaption, { inline_keyboard: [] });

  const notifMsg = STATUS_MESSAGES[newStatus];
  if (notifMsg) {
    await sendPlainMessage(order.telegram_id, notifMsg);
  }

  const alertText = action === 'approve'
    ? '\u0417\u0430\u044F\u0432\u043A\u0430 ' + orderId + ' \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430'
    : '\u0417\u0430\u044F\u0432\u043A\u0430 ' + orderId + ' \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430';

  await answerCallbackQuery(cb.id, alertText);
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.WEBHOOK_SECRET) return res.status(500).end();

  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    return res.status(403).end();
  }

  try {
    const update = await readBody(req);
    if (update.message) return handleMessage(update.message, res);
    if (update.callback_query) return handleCallback(update.callback_query, res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
