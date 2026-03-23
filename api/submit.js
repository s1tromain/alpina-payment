const crypto = require('crypto');
const Busboy = require('busboy');
const { esc, sendMessage, sendPhotoBuffer } = require('./_telegram');
const { checkAntiSpam, recordSubmission } = require('./_ratelimit');

const CHANNEL_ID = process.env.CHANNEL_ID;

const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 4.5 * 1024 * 1024;
const MAX_AMOUNT_LENGTH = 15;
const MAX_COMMENT_LENGTH = 500;
const VALID_CURRENCIES = [
  'RUB','USD','UZS','KGS','KZT','TJS','BYN','AMD','AZN','GEL','MDL','TMT'
];

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return 'ALP-' + ts + '-' + rand;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let pwd = '';
  for (let i = 0; i < 8; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
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

function buildCaption(orderId, password, amount, currency, comment, spamFlags) {
  const lines = [];
  if (spamFlags) {
    if (spamFlags.reason === 'redis_unavailable') {
      lines.push('\u{1F6A8} *Antispam unavailable \\(Redis not configured\\)*', '');
    } else if (spamFlags.reason === 'redis_error') {
      lines.push('\u{1F6A8} *Antispam unavailable \\(Redis error\\)*', '');
    } else if (spamFlags.suspicious) {
      lines.push('\u26A0\uFE0F *\u041F\u043E\u0434\u043E\u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430* \\[' + esc(spamFlags.reason || 'unknown') + '\\]', '');
    }
  }
  lines.push(
    '\u{1F4CB} *\u041D\u043E\u0432\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 ALPINA PAY\\-OUT*',
    '',
    `\u{1F194} *\u041D\u043E\u043C\u0435\u0440 \u0437\u0430\u044F\u0432\u043A\u0438:* \`${esc(orderId)}\``,
    `\u{1F511} *\u0423\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u0434:* \`${esc(password)}\``,
    `\u{1F4B0} *\u0421\u0443\u043C\u043C\u0430:* ${esc(amount)} ${esc(currency)}`
  );
  if (comment) {
    lines.push(`\u{1F4AC} *\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439:* ${esc(comment)}`);
  }
  lines.push('', '\u23F3 _\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438_');
  return lines.join('\n');
}

function buildButtons(orderId) {
  return {
    inline_keyboard: [[
      { text: '\u2705 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C', callback_data: `approve:${orderId}` },
      { text: '\u274C \u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C', callback_data: `reject:${orderId}` }
    ]]
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!process.env.BOT_TOKEN || !CHANNEL_ID) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  try {
    const { fields, fileBuffer, fileInfo, fileTruncated } = await parseMultipart(req);

    if (fields._hp) {
      return res.status(200).json({ ok: true, orderId: generateOrderId(), password: generatePassword() });
    }

    const elapsed = parseInt(fields._t, 10);
    if (!elapsed || elapsed < 5000) {
      return res.status(429).json({ ok: false, error: '\u0412\u044B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0447\u0430\u0441\u0442\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442\u0435 \u0437\u0430\u044F\u0432\u043A\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.' });
    }

    const { currency, amount, comment } = fields;

    if (!currency || !amount) {
      return res.status(400).json({ ok: false, error: '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u0432\u0441\u0435 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043F\u043E\u043B\u044F' });
    }

    if (!/^\d+$/.test(amount) || amount.length > MAX_AMOUNT_LENGTH) {
      return res.status(400).json({ ok: false, error: '\u0421\u0443\u043C\u043C\u0430 \u0434\u043E\u043B\u0436\u043D\u0430 \u0431\u044B\u0442\u044C \u0447\u0438\u0441\u043B\u043E\u043C' });
    }

    if (!VALID_CURRENCIES.includes(currency)) {
      return res.status(400).json({ ok: false, error: '\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0432\u0430\u043B\u044E\u0442\u0430' });
    }

    if (fileTruncated) {
      return res.status(400).json({ ok: false, error: '\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439 (\u043C\u0430\u043A\u0441 4.5 \u041C\u0411)' });
    }

    if (!fileBuffer) {
      return res.status(400).json({ ok: false, error: '\u041F\u0440\u0438\u043A\u0440\u0435\u043F\u0438\u0442\u0435 \u0447\u0435\u043A' });
    }

    if (!isValidImage(fileBuffer)) {
      return res.status(400).json({ ok: false, error: '\u041D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0444\u0430\u0439\u043B\u0430' });
    }

    const safeComment = comment ? comment.substring(0, MAX_COMMENT_LENGTH).trim() : '';

    const spam = await checkAntiSpam(req, { amount, currency, comment: safeComment });
    if (!spam.allowed) {
      return res.status(429).json({ ok: false, error: spam.error });
    }

    const orderId = generateOrderId();
    const password = generatePassword();
    const spamFlags = (spam.suspicious || spam.reason) ? spam : null;
    const caption = buildCaption(orderId, password, amount, currency, safeComment, spamFlags);
    const buttons = buildButtons(orderId);

    const safeFilename = sanitizeFilename(fileInfo.filename);

    const channelResult = await sendPhotoBuffer(
      CHANNEL_ID, fileBuffer, safeFilename, fileInfo.mimeType, caption, buttons
    );

    if (!channelResult.ok) {
      console.error('Telegram send failed:', channelResult.error_code);
      await sendMessage(CHANNEL_ID, caption, buttons);
    }

    const adminIds = process.env.ADMIN_ID
      ? process.env.ADMIN_ID.split(',').map(id => id.trim()).filter(Boolean)
      : [];
    for (const adminId of adminIds) {
      if (adminId !== String(CHANNEL_ID)) {
        await sendPhotoBuffer(adminId, fileBuffer, safeFilename, fileInfo.mimeType, caption);
      }
    }

    await recordSubmission(req, { amount, currency, comment: safeComment });

    return res.status(200).json({ ok: true, orderId, password });
  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ ok: false, error: '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430' });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
