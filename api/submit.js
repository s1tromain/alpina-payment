const Busboy = require('busboy');
const { getRedis } = require('./_redis');
const { esc, sendPhotoBuffer, sendMessage } = require('./_telegram');
const { checkAntiSpam, recordSubmission } = require('./_ratelimit');

const CHANNEL_ID = process.env.CHANNEL_ID;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 4.5 * 1024 * 1024;
const PENDING_TTL = 86400;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

function sanitizeFilename(name) {
  if (!name) return 'receipt.jpg';
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
}

function isValidImage(buffer) {
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  return false;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 10 }
    });
    const fields = {};
    let fileBuffer = null;
    let fileInfo = null;
    let fileTruncated = false;

    busboy.on('field', (name, val) => {
      fields[name] = String(val).substring(0, 1000);
    });

    busboy.on('file', (_name, stream, info) => {
      if (!ALLOWED_TYPES.includes(info.mimeType)) {
        stream.resume();
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => { fileTruncated = true; });
      stream.on('end', () => {
        if (!fileTruncated) {
          fileBuffer = Buffer.concat(chunks);
          fileInfo = info;
        }
      });
    });

    busboy.on('finish', () => resolve({ fields, fileBuffer, fileInfo, fileTruncated }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function buildCaption(order, spamFlag) {
  const lines = [];

  if (spamFlag) {
    lines.push('\u26A0\uFE0F *\u041F\u043E\u0434\u043E\u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430* \\[' + esc(spamFlag) + '\\]', '');
  }

  lines.push(
    '\uD83D\uDCCB *\u041D\u043E\u0432\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 ALPINA PAY\\-OUT*',
    '',
    '\uD83C\uDD94 *\u041D\u043E\u043C\u0435\u0440:* `' + esc(order.orderId) + '`',
    '\uD83D\uDCB0 *\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435:* ' + esc(String(order.receiveAmount)) + ' ' + esc(order.receiveCurrency),
    '\uD83D\uDCB3 *\u041E\u043F\u043B\u0430\u0442\u0430:* ' + esc(String(order.payAmount)) + ' ' + esc(order.payCurrency),
    '\uD83D\uDCCA *\u041A\u0443\u0440\u0441:* ' + esc(String(order.finalRate)),
    '\uD83D\uDCDD *\u0420\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B:* ' + esc(order.payoutDetails),
    '',
    '\u23F3 _\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438_'
  );

  return lines.join('\n');
}

function buildButtons(orderId) {
  return {
    inline_keyboard: [[
      { text: '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C', callback_data: 'approve:' + orderId },
      { text: '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C', callback_data: 'reject:' + orderId }
    ]]
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  if (!process.env.BOT_TOKEN || !CHANNEL_ID) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  try {
    const { fields, fileBuffer, fileInfo, fileTruncated } = await parseMultipart(req);

    const { orderId } = fields;
    if (!orderId) {
      return res.status(400).json({ ok: false, error: '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D \u043D\u043E\u043C\u0435\u0440 \u0437\u0430\u044F\u0432\u043A\u0438' });
    }

    if (fileTruncated) {
      return res.status(400).json({ ok: false, error: '\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439 (\u043C\u0430\u043A\u0441 4.5 \u041C\u0411)' });
    }

    if (!fileBuffer || !isValidImage(fileBuffer)) {
      return res.status(400).json({ ok: false, error: '\u041F\u0440\u0438\u043A\u0440\u0435\u043F\u0438\u0442\u0435 \u0447\u0435\u043A (JPG \u0438\u043B\u0438 PNG)' });
    }

    const r = getRedis();
    if (!r) {
      return res.status(500).json({ ok: false, error: '\u0421\u0435\u0440\u0432\u0438\u0441 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D' });
    }

    const raw = await r.get(`order:${orderId}`);
    if (!raw) {
      return res.status(404).json({ ok: false, error: '\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0438\u043B\u0438 \u0438\u0441\u0442\u0435\u043A\u043B\u0430' });
    }

    const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (order.status !== 'created') {
      return res.status(400).json({ ok: false, error: '\u0417\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u0430 \u0438\u043B\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430' });
    }

    if (new Date(order.expiresAt) < new Date()) {
      await r.del(`order:${orderId}`);
      return res.status(400).json({ ok: false, error: '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.' });
    }

    const ip = getClientIp(req);
    let spamFlag = null;
    const spam = await checkAntiSpam(req, {
      telegramId: ip,
      amount: String(order.receiveAmount),
      currency: order.receiveCurrency
    });

    if (!spam.allowed) {
      return res.status(429).json({ ok: false, error: spam.error });
    }
    if (spam.suspicious && spam.reason) {
      spamFlag = spam.reason;
    }

    const caption = buildCaption(order, spamFlag);
    const buttons = buildButtons(orderId);
    const safeFilename = sanitizeFilename(fileInfo.filename);

    const channelResult = await sendPhotoBuffer(
      CHANNEL_ID, fileBuffer, safeFilename, fileInfo.mimeType, caption, buttons
    );

    let channelMessageId = null;
    if (channelResult.ok && channelResult.result) {
      channelMessageId = channelResult.result.message_id;
    } else {
      const textResult = await sendMessage(CHANNEL_ID, caption, buttons);
      if (textResult.ok && textResult.result) {
        channelMessageId = textResult.result.message_id;
      }
    }

    order.status = 'pending';
    order.channelMessageId = channelMessageId;
    await r.set(`order:${orderId}`, JSON.stringify(order), { ex: PENDING_TTL });

    await recordSubmission({
      telegramId: ip,
      amount: String(order.receiveAmount),
      currency: order.receiveCurrency
    });

    return res.status(200).json({ ok: true, orderId });
  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430' });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
