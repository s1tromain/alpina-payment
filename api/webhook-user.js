const { userBot, modBot } = require('./_telegram');
const { getRedis } = require('./_redis');
const { releaseCardByOrder } = require('./_requisites');

const MAX_BODY_SIZE = 64 * 1024;

const STATUS_NAMES = {
  created: '\u0441\u043E\u0437\u0434\u0430\u043D\u0430',
  pending: '\u043E\u0436\u0438\u0434\u0430\u0435\u0442',
  approved: '\u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0430',
  completed: '\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430',
  rejected: '\u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430',
  expired: '\u0438\u0441\u0442\u0435\u043A\u043B\u0430',
  cancelled: '\u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430'
};

const STATUS_EMOJI = {
  created: '\uD83D\uDCDD',
  pending: '\u23F3',
  approved: '\u2705',
  completed: '\uD83D\uDCB8',
  rejected: '\u274C',
  expired: '\uD83D\uDD5B',
  cancelled: '\uD83D\uDEAB'
};

const FILTER_LABELS = {
  all: '\u0412\u0441\u0435',
  active: '\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435',
  pending: '\u041E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0435',
  approved: '\u041E\u0434\u043E\u0431\u0440\u0435\u043D\u043D\u044B\u0435',
  completed: '\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435',
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
      await userBot.editMessageText(chatId, editMessageId, text);
    } else {
      await userBot.sendPlainMessage(chatId, text);
    }
    return;
  }

  const orderIds = await r.lrange('user:orders:' + telegramId, 0, 49);

  if (!orderIds || orderIds.length === 0) {
    const text = '\u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0437\u0430\u044F\u0432\u043E\u043A.';
    const buttons = buildOrderButtons(filter, []);
    if (editMessageId) {
      await userBot.editMessageText(chatId, editMessageId, text, buttons);
    } else {
      await userBot.sendPlainMessage(chatId, text, buttons);
    }
    return;
  }

  const orders = [];
  const cancelable = [];
  for (const oid of orderIds) {
    const raw = await r.get('order:' + oid);
    if (!raw) continue;
    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < new Date()) {
      order.status = 'expired';
      r.set('order:' + oid, JSON.stringify(order), { ex: 86400 }).catch(function() {});
      releaseCardByOrder(order).catch(function() {});
    }
    if (filter === 'active') {
      if (order.status !== 'created' && order.status !== 'pending' && order.status !== 'approved') continue;
    } else if (filter !== 'all' && order.status !== filter) {
      continue;
    }
    orders.push(order);
    if (order.status === 'created' || order.status === 'pending') {
      cancelable.push(order);
    }
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

  var buttons = buildOrderButtons(filter, cancelable);

  if (editMessageId) {
    await userBot.editMessageText(chatId, editMessageId, text, buttons);
  } else {
    await userBot.sendPlainMessage(chatId, text, buttons);
  }
}

function buildOrderButtons(activeFilter, cancelableOrders) {
  var keyboard = [];

  for (var i = 0; i < cancelableOrders.length; i++) {
    var o = cancelableOrders[i];
    var num = o.seqId ? '#' + o.seqId : o.orderId;
    keyboard.push([{ text: '\uD83D\uDEAB \u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C ' + num, callback_data: 'cancel:' + o.orderId }]);
  }

  var filters1 = ['all', 'active', 'pending'];
  var filters2 = ['approved', 'completed', 'rejected', 'expired'];

  var row1 = filters1.map(function (f) {
    var label = (f === activeFilter ? '\u2022 ' : '') + FILTER_LABELS[f];
    return { text: label, callback_data: 'filter:' + f };
  });

  var row2 = filters2.map(function (f) {
    var label = (f === activeFilter ? '\u2022 ' : '') + FILTER_LABELS[f];
    return { text: label, callback_data: 'filter:' + f };
  });

  keyboard.push(row1);
  keyboard.push(row2);

  return { inline_keyboard: keyboard };
}

async function handleMessage(msg, res) {
  if (!msg.text || !msg.from || !msg.chat || msg.chat.type !== 'private') {
    return res.status(200).json({ ok: true });
  }

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  if (text === '/start') {
    const welcome = '\uD83D\uDC4B \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 ALPINA PAY\u2011OUT!\n\n\u0417\u0434\u0435\u0441\u044C \u0432\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043D\u0430 \u043F\u043E\u043A\u0443\u043F\u043A\u0443 USDT \u0437\u0430 RUB.\n\n\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u043C\u0435\u043D\u044E \u0434\u043B\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F.';

    var keyboard = { resize_keyboard: true, keyboard: [] };
    keyboard.keyboard.push([{ text: '\uD83D\uDCCB \u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' }]);

    await userBot.sendPlainMessage(chatId, welcome, keyboard);
    return res.status(200).json({ ok: true });
  }

  if (text === '\uD83D\uDCCB \u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' || text === '/orders') {
    await showUserOrders(chatId, userId, 'all');
    return res.status(200).json({ ok: true });
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
    if (!['all', 'active', 'pending', 'approved', 'completed', 'rejected', 'expired'].includes(filter)) {
      await userBot.answerCallbackQuery(cb.id);
      return res.status(200).json({ ok: true });
    }
    await showUserOrders(cb.message.chat.id, String(cb.from.id), filter, cb.message.message_id);
    await userBot.answerCallbackQuery(cb.id);
    return res.status(200).json({ ok: true });
  }

  if (data.startsWith('cancel:')) {
    const orderId = data.substring(7);
    if (!orderId) {
      await userBot.answerCallbackQuery(cb.id);
      return res.status(200).json({ ok: true });
    }
    await handleCancelOrder(cb, orderId, res);
    return;
  }

  await userBot.answerCallbackQuery(cb.id);
  return res.status(200).json({ ok: true });
}

function buildCancelCaption(order) {
  var displayId = order.seqId ? '#' + order.seqId : order.orderId;
  var userLine = '';
  if (order.telegramUsername) {
    userLine = '@' + order.telegramUsername;
  } else if (order.telegramFirstName) {
    userLine = order.telegramFirstName;
  } else if (order.telegramId) {
    userLine = 'ID: ' + order.telegramId;
  }
  var lines = [
    '\u274C \u0417\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u043C',
    '',
    '\uD83C\uDD94 \u041D\u043E\u043C\u0435\u0440: ' + displayId
  ];
  if (userLine) {
    lines.push('\uD83D\uDC64 \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C: ' + userLine);
  }
  lines.push(
    '\uD83D\uDCB3 \u041E\u043F\u043B\u0430\u0442\u0430: ' + order.payAmount + ' ' + order.payCurrency,
    '\uD83D\uDCB0 \u041F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435: ' + order.receiveAmount + ' ' + order.receiveCurrency
  );
  return lines.join('\n');
}

async function handleCancelOrder(cb, orderId, res) {
  var chatId = cb.message.chat.id;
  var userId = String(cb.from.id);
  var r = getRedis();

  if (!r) {
    await userBot.answerCallbackQuery(cb.id, '\u0421\u0435\u0440\u0432\u0438\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D');
    return res.status(200).json({ ok: true });
  }

  var raw = await r.get('order:' + orderId);
  if (!raw) {
    await userBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  var order = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (order.telegramId !== userId) {
    await userBot.answerCallbackQuery(cb.id, '\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430');
    return res.status(200).json({ ok: true });
  }

  if (order.status !== 'created' && order.status !== 'pending') {
    await userBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
    return res.status(200).json({ ok: true });
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  await r.set('order:' + orderId, JSON.stringify(order), { ex: 86400 });
  await releaseCardByOrder(order);

  if (order.channelMessageId && process.env.CHANNEL_ID) {
    try {
      var cancelCaption = buildCancelCaption(order);
      var emptyMarkup = { inline_keyboard: [] };
      try {
        await modBot.editMessageCaption(process.env.CHANNEL_ID, order.channelMessageId, cancelCaption, emptyMarkup);
      } catch (_) {
        try {
          await modBot.editMessageText(process.env.CHANNEL_ID, order.channelMessageId, cancelCaption, emptyMarkup);
        } catch (_) {}
      }
    } catch (_) {}
  }

  var displayNum = order.seqId ? '#' + order.seqId : orderId;
  await userBot.sendPlainMessage(chatId, '\uD83D\uDEAB \u0417\u0430\u044F\u0432\u043A\u0430 ' + displayNum + ' \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.');
  await userBot.answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430');
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.USER_WEBHOOK_SECRET) return res.status(500).end();

  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.USER_WEBHOOK_SECRET) {
    return res.status(403).end();
  }

  try {
    const update = await readBody(req);
    if (update.message) return handleMessage(update.message, res);
    if (update.callback_query) return handleCallback(update.callback_query, res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('User webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
