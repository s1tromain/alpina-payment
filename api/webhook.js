const { editMessageCaption, editMessageText, answerCallbackQuery, sendPlainMessage, esc } = require('./_telegram');
const { getRedis } = require('./_redis');

const MAX_BODY_SIZE = 64 * 1024;
const PROCESSED_TTL = 86400;

const STATUS_NAMES = {
  created: '\u0441\u043E\u0437\u0434\u0430\u043D\u0430',
  pending: '\u043E\u0436\u0438\u0434\u0430\u0435\u0442',
  approved: '\u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430',
  rejected: '\u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430',
  expired: '\u0438\u0441\u0442\u0435\u043A\u043B\u0430'
};

const STATUS_EMOJI = {
  created: '\u{1F4DD}',
  pending: '\u23F3',
  approved: '\u2705',
  rejected: '\u274C',
  expired: '\u{1F55B}'
};

const FILTER_LABELS = {
  all: '\u0412\u0441\u0435',
  pending: '\u041E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0435',
  approved: '\u041E\u0434\u043E\u0431\u0440\u0435\u043D\u043D\u044B\u0435',
  rejected: '\u041E\u0442\u043A\u043B\u043E\u043D\u0451\u043D\u043D\u044B\u0435',
  expired: '\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043D\u044B\u0435'
};

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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return dd + '.' + mm + '.' + yy + ' ' + hh + ':' + mi;
}

async function showUserOrders(chatId, telegramId, filter, editMessageId) {
  const r = getRedis();
  if (!r) {
    const text = '\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.';
    if (editMessageId) {
      await editMessageText(chatId, editMessageId, text);
    } else {
      await sendPlainMessage(chatId, text);
    }
    return;
  }

  const orderIds = await r.lrange('user:orders:' + telegramId, 0, 49);

  if (!orderIds || orderIds.length === 0) {
    const text = '\u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0437\u0430\u044F\u0432\u043E\u043A.';
    const buttons = buildFilterButtons(filter);
    if (editMessageId) {
      await editMessageText(chatId, editMessageId, text, buttons);
    } else {
      await sendPlainMessage(chatId, text, buttons);
    }
    return;
  }

  const orders = [];
  for (const oid of orderIds) {
    const raw = await r.get('order:' + oid);
    if (!raw) continue;
    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < new Date()) {
      order.status = 'expired';
      r.set('order:' + oid, JSON.stringify(order), { ex: 86400 }).catch(function() {});
    }
    if (filter !== 'all' && order.status !== filter) continue;
    orders.push(order);
    if (orders.length >= 20) break;
  }

  var header = '\uD83D\uDCCB \u0412\u0430\u0448\u0438 \u0437\u0430\u044F\u0432\u043A\u0438';
  if (filter !== 'all') header += ' (' + FILTER_LABELS[filter] + ')';
  header += ':\n';

  var text;
  if (orders.length === 0) {
    text = header + '\n\u0417\u0430\u044F\u0432\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.';
  } else {
    var lines = [header];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var emoji = STATUS_EMOJI[o.status] || '\u23F3';
      var num = o.seqId ? '#' + o.seqId : o.orderId;
      var statusName = STATUS_NAMES[o.status] || o.status;
      lines.push(
        emoji + ' ' + num + '  \u2014  ' + statusName,
        '   ' + o.payAmount + ' RUB \u2192 ' + o.receiveAmount + ' USDT',
        '   ' + formatDate(o.createdAt),
        ''
      );
    }
    text = lines.join('\n');
  }

  var buttons = buildFilterButtons(filter);

  if (editMessageId) {
    await editMessageText(chatId, editMessageId, text, buttons);
  } else {
    await sendPlainMessage(chatId, text, buttons);
  }
}

function buildFilterButtons(activeFilter) {
  var filters = ['all', 'pending', 'approved', 'rejected', 'expired'];
  var row = filters.map(function (f) {
    var label = (f === activeFilter ? '\u2022 ' : '') + FILTER_LABELS[f];
    return { text: label, callback_data: 'filter:' + f };
  });
  return { inline_keyboard: [row] };
}

async function handleMessage(msg, res) {
  if (!msg.text || !msg.from || !msg.chat || msg.chat.type !== 'private') {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  if (text === '/start') {
    const miniAppUrl = process.env.MINI_APP_URL || process.env.SITE_URL || '';

    const welcome = '\uD83D\uDC4B \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 ALPINA PAY-OUT!\n\n\u0417\u0434\u0435\u0441\u044C \u0432\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043D\u0430 \u043F\u043E\u043A\u0443\u043F\u043A\u0443 USDT \u0437\u0430 RUB.\n\n\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435\u00BB \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C.';

    var keyboard = { resize_keyboard: true, keyboard: [] };
    if (miniAppUrl) {
      keyboard.keyboard.push([{ text: '\uD83C\uDF10 \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435', web_app: { url: miniAppUrl } }]);
    }
    keyboard.keyboard.push([{ text: '\uD83D\uDCCB \u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' }]);

    await sendPlainMessage(chatId, welcome, keyboard);
    return res.status(200).json({ ok: true });
  }

  if (text === '\uD83D\uDCCB \u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' || text === '/orders') {
    await showUserOrders(chatId, userId, 'all');
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

  const data = cb.data || '';

  if (data.startsWith('filter:')) {
    const filter = data.substring(7);
    if (!['all', 'pending', 'approved', 'rejected', 'expired'].includes(filter)) {
      await answerCallbackQuery(cb.id);
      return res.status(200).json({ ok: true });
    }
    await showUserOrders(cb.message.chat.id, String(cb.from.id), filter, cb.message.message_id);
    await answerCallbackQuery(cb.id);
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

  if (order.status === 'expired' || (order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < new Date())) {
    if (order.status !== 'expired') {
      order.status = 'expired';
      await r.set(`order:${orderId}`, JSON.stringify(order), { ex: 86400 });
    }
    await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

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

  const displayNum = order.seqId ? '#' + order.seqId : orderId;

  if (order.telegramId) {
    try {
      var userMsg;
      if (action === 'approve') {
        userMsg = '\u2705 \u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430.\n\u041E\u0436\u0438\u0434\u0430\u0439\u0442\u0435 \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0432\u0430\u0448\u0438\u0445 \u0441\u0440\u0435\u0434\u0441\u0442\u0432.';
      } else {
        userMsg = '\u274C \u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430.';
      }
      await sendPlainMessage(order.telegramId, userMsg);
    } catch (_) {}
  }

  const alertText = action === 'approve'
    ? '\u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430'
    : '\u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430';

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
