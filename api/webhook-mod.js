const { modBot, userBot } = require('./_telegram');
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
    await modBot.sendPlainMessage(chatId, '\u{1F6E1} \u041C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u0441\u043A\u0438\u0439 \u0431\u043E\u0442 ALPINA PAY\u2011OUT.\n\u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u0430 \u0434\u043B\u044F \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u0430.');
    return res.status(200).json({ ok: true });
  }

  if (text === '/logout') {
    const r = getRedis();
    if (r) await r.del('mod:auth:' + userId);
    await modBot.sendPlainMessage(chatId, '\u0412\u044B \u0432\u044B\u0448\u043B\u0438 \u0438\u0437 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u0438');
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith('/')) {
    return res.status(200).json({ ok: true });
  }

  if (process.env.MODERATOR_PASSWORD && text === process.env.MODERATOR_PASSWORD) {
    const r = getRedis();
    if (r) {
      await r.set('mod:auth:' + userId, 'true', { ex: 86400 });
      await modBot.sendPlainMessage(chatId, '\u041C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430. \u0412\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0438 \u0447\u0435\u0440\u0435\u0437 \u043A\u043D\u043E\u043F\u043A\u0438 \u0432 \u043A\u0430\u043D\u0430\u043B\u0435.');
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}

async function handleCallback(cb, res) {
  if (!cb.from || !cb.message) {
    return res.status(200).json({ ok: true });
  }

  const data = cb.data || '';
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
    await modBot.answerCallbackQuery(cb.id, '\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E');
    return res.status(200).json({ ok: true });
  }

  const sepIdx = data.indexOf(':');
  if (sepIdx === -1) {
    await modBot.answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
    return res.status(200).json({ ok: true });
  }

  const action = data.substring(0, sepIdx);
  const orderId = data.substring(sepIdx + 1);

  if (!['approve', 'reject', 'complete'].includes(action) || !orderId) {
    await modBot.answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
    return res.status(200).json({ ok: true });
  }

  const r = getRedis();
  if (!r) {
    await modBot.answerCallbackQuery(cb.id, '\u0421\u0435\u0440\u0432\u0438\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D');
    return res.status(200).json({ ok: true });
  }

  const raw = await r.get('order:' + orderId);
  if (!raw) {
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (order.status === 'cancelled') {
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u043C');
    return res.status(200).json({ ok: true });
  }

  if (order.status === 'expired' || (order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < new Date())) {
    if (order.status !== 'expired') {
      order.status = 'expired';
      await r.set('order:' + orderId, JSON.stringify(order), { ex: 86400 });
    }
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  // Status validation per action
  if (action === 'approve' && order.status !== 'pending') {
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
    return res.status(200).json({ ok: true });
  }
  if (action === 'reject' && order.status !== 'pending' && order.status !== 'approved') {
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
    return res.status(200).json({ ok: true });
  }
  if (action === 'complete' && order.status !== 'approved') {
    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u0432 \u0441\u0442\u0430\u0442\u0443\u0441\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F');
    return res.status(200).json({ ok: true });
  }

  const adminName = cb.from.first_name || 'Admin';
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const isPhoto = !!(cb.message.photo);
  const existingCaption = cb.message.caption || cb.message.text || '';
  const displayNum = order.seqId ? '#' + order.seqId : orderId;

  if (action === 'approve') {
    order.status = 'approved';
    order.processedBy = adminName + ' (' + fromId + ')';
    order.processedAt = new Date().toISOString();
    await r.set('order:' + orderId, JSON.stringify(order), { ex: PROCESSED_TTL });

    const statusLine = '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E, \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u043C\u043E\u043D\u0435\u0442\u044B\n\uD83D\uDC64 ' + adminName;
    const newCaption = existingCaption.replace(/\u23F3[\s\S]*$/, statusLine);
    const nextButtons = {
      inline_keyboard: [[
        { text: '\uD83D\uDCB8 \u041C\u043E\u043D\u0435\u0442\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430', callback_data: 'complete:' + orderId },
        { text: '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C', callback_data: 'reject:' + orderId }
      ]]
    };

    try {
      if (isPhoto) {
        await modBot.editMessageCaption(chatId, messageId, newCaption, nextButtons);
      } else {
        await modBot.editMessageText(chatId, messageId, newCaption, nextButtons);
      }
    } catch (editErr) {
      console.error('Edit message failed:', editErr.message);
    }

    if (order.telegramId) {
      try {
        await userBot.sendPlainMessage(order.telegramId, '\u2705 \u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430.\n\u041E\u0436\u0438\u0434\u0430\u0439\u0442\u0435 \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u0441\u0440\u0435\u0434\u0441\u0442\u0432.');
      } catch (_) {}
    }

    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430');

  } else if (action === 'complete') {
    order.status = 'completed';
    order.completedBy = adminName + ' (' + fromId + ')';
    order.completedAt = new Date().toISOString();
    await r.set('order:' + orderId, JSON.stringify(order), { ex: PROCESSED_TTL });

    const statusLine = '\uD83D\uDCB8 \u0421\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u044B \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E\n\uD83D\uDC64 ' + adminName;
    const newCaption = existingCaption.replace(/\u2705[\s\S]*$/, statusLine);
    const emptyMarkup = { inline_keyboard: [] };

    try {
      if (isPhoto) {
        await modBot.editMessageCaption(chatId, messageId, newCaption, emptyMarkup);
      } else {
        await modBot.editMessageText(chatId, messageId, newCaption, emptyMarkup);
      }
    } catch (editErr) {
      console.error('Edit message failed:', editErr.message);
    }

    if (order.telegramId) {
      try {
        await userBot.sendPlainMessage(order.telegramId, '\uD83D\uDCB8 \u0412\u0430\u0448\u0438 \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u044B. \u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430.');
      } catch (_) {}
    }

    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430');

  } else {
    // reject (from pending or approved)
    order.status = 'rejected';
    order.processedBy = adminName + ' (' + fromId + ')';
    order.processedAt = new Date().toISOString();
    await r.set('order:' + orderId, JSON.stringify(order), { ex: PROCESSED_TTL });

    const statusLine = '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430\n\uD83D\uDC64 ' + adminName;
    const newCaption = existingCaption.replace(/(\u23F3|\u2705)[\s\S]*$/, statusLine);
    const emptyMarkup = { inline_keyboard: [] };

    try {
      if (isPhoto) {
        await modBot.editMessageCaption(chatId, messageId, newCaption, emptyMarkup);
      } else {
        await modBot.editMessageText(chatId, messageId, newCaption, emptyMarkup);
      }
    } catch (editErr) {
      console.error('Edit message failed:', editErr.message);
    }

    if (order.telegramId) {
      try {
        await userBot.sendPlainMessage(order.telegramId, '\u274C \u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430.');
      } catch (_) {}
    }

    await modBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430');
  }

  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.MOD_WEBHOOK_SECRET) return res.status(500).end();

  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.MOD_WEBHOOK_SECRET) {
    return res.status(403).end();
  }

  try {
    const update = await readBody(req);
    if (update.message) return handleMessage(update.message, res);
    if (update.callback_query) return handleCallback(update.callback_query, res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Mod webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
