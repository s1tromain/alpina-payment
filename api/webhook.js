const { editMessageCaption, answerCallbackQuery } = require('./_telegram');

function getAdminIds() {
  if (!process.env.ADMIN_ID) return [];
  return process.env.ADMIN_ID.split(',').map(id => id.trim()).filter(Boolean);
}

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  if (!process.env.WEBHOOK_SECRET) {
    return res.status(500).end();
  }

  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
    return res.status(403).end();
  }

  try {
    const update = await readBody(req);

    if (!update.callback_query) {
      return res.status(200).json({ ok: true });
    }

    const cb = update.callback_query;

    if (!cb.from || !cb.message) {
      return res.status(200).json({ ok: true });
    }

    const fromId = String(cb.from.id);
    const adminIds = getAdminIds();

    if (!adminIds.includes(fromId)) {
      await answerCallbackQuery(cb.id, '\u0423 \u0432\u0430\u0441 \u043D\u0435\u0442 \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F');
      return res.status(200).json({ ok: true });
    }

    const data = cb.data || '';
    const separatorIndex = data.indexOf(':');
    if (separatorIndex === -1) {
      await answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
      return res.status(200).json({ ok: true });
    }

    const action = data.substring(0, separatorIndex);
    const orderId = data.substring(separatorIndex + 1);

    if (!['approve', 'reject'].includes(action) || !orderId) {
      await answerCallbackQuery(cb.id, '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435');
      return res.status(200).json({ ok: true });
    }

    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const existingCaption = cb.message.caption || cb.message.text || '';

    if (!existingCaption.includes('\u23F3')) {
      await answerCallbackQuery(cb.id, '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430');
      return res.status(200).json({ ok: true });
    }

    const adminName = cb.from.first_name || 'Admin';
    let statusLine;
    let alertText;

    if (action === 'approve') {
      statusLine = `\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430\n\u{1F464} ${adminName}`;
      alertText = `\u0417\u0430\u044F\u0432\u043A\u0430 ${orderId} \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430`;
    } else {
      statusLine = `\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430\n\u{1F464} ${adminName}`;
      alertText = `\u0417\u0430\u044F\u0432\u043A\u0430 ${orderId} \u043E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u0430`;
    }

    const newCaption = existingCaption.replace(/\u23F3[^\n]*/s, statusLine);

    await editMessageCaption(chatId, messageId, newCaption, { inline_keyboard: [] });
    await answerCallbackQuery(cb.id, alertText);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
