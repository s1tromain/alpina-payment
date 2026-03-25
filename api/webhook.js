const { editMessageCaption, editMessageText, answerCallbackQuery, sendPlainMessage, esc } = require('./_telegram');
const { getRedis } = require('./_redis');

const MAX_BODY_SIZE = 64 * 1024;
const PROCESSED_TTL = 86400;

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

async function handleMessage(msg, res) {
  if (!msg.text || !msg.from || !msg.chat || msg.chat.type !== 'private') {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  if (text === '/start') {
    const siteUrl = process.env.SITE_URL || '';
    const message = siteUrl
      ? '\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 ALPINA PAY-OUT!\n\n\u041E\u0444\u043E\u0440\u043C\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043C\u043E\u0436\u043D\u043E \u043D\u0430 \u0441\u0430\u0439\u0442\u0435:\n' + siteUrl
      : '\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 ALPINA PAY-OUT!';

    await sendPlainMessage(chatId, message);
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

  const r = getRedis();
  if (!r) {
    await answerCallbackQuery(cb.id, '\u0421\u0435\u0440\u0432\u0438\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D');
    return res.status(200).json({ ok: true });
  }

  const raw = await r.get(`order:${orderId}`);
  if (!raw) {
    await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (order.status !== 'pending') {
    await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const adminName = cb.from.first_name || 'Admin';

  order.status = newStatus;
  order.processedBy = adminName + ' (' + fromId + ')';
  order.processedAt = new Date().toISOString();
  await r.set(`order:${orderId}`, JSON.stringify(order), { ex: PROCESSED_TTL });

  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const isPhoto = !!(cb.message.photo);
  const existingCaption = cb.message.caption || cb.message.text || '';

  let statusLine;
  if (action === 'approve') {
    statusLine = '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430\n\uD83D\uDC64 ' + adminName;
  } else {
    statusLine = '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430\n\uD83D\uDC64 ' + adminName;
  }

  const newCaption = existingCaption.replace(/\u23F3[^\n]*/s, statusLine);

  const emptyMarkup = { inline_keyboard: [] };

  try {
    if (isPhoto) {
      await editMessageCaption(chatId, messageId, newCaption, emptyMarkup);
    } else {
      await editMessageText(chatId, messageId, newCaption, emptyMarkup);
    }
  } catch (editErr) {
    console.error('Edit message failed:', editErr.message);
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
