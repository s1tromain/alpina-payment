const fetch = require('node-fetch');

function botApi(token, method, body) {
  return fetch(
    'https://api.telegram.org/bot' + token + '/' + method,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  ).then(r => r.json());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  if (!process.env.MOD_BOT_TOKEN || !process.env.USER_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Bot tokens not configured' });
  }

  if (!process.env.MOD_WEBHOOK_SECRET || !process.env.USER_WEBHOOK_SECRET) {
    return res.status(500).json({ ok: false, error: 'Webhook secrets not configured' });
  }

  const secret = req.headers['x-setup-secret'];
  if (secret !== process.env.MOD_WEBHOOK_SECRET && secret !== process.env.USER_WEBHOOK_SECRET) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = 'https://' + host;

    const modResult = await botApi(process.env.MOD_BOT_TOKEN, 'setWebhook', {
      url: baseUrl + '/api/webhook-mod',
      secret_token: process.env.MOD_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query']
    });

    const userResult = await botApi(process.env.USER_BOT_TOKEN, 'setWebhook', {
      url: baseUrl + '/api/webhook-user',
      secret_token: process.env.USER_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query']
    });

    await botApi(process.env.USER_BOT_TOKEN, 'setMyCommands', {
      commands: [
        { command: 'start', description: '\u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u043C\u0435\u043D\u044E' },
        { command: 'orders', description: '\u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' }
      ]
    });

    await botApi(process.env.MOD_BOT_TOKEN, 'setMyCommands', {
      commands: [
        { command: 'start', description: '\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F' },
        { command: 'logout', description: '\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u0438' }
      ]
    });

    const miniAppUrl = process.env.MINI_APP_URL || process.env.SITE_URL;
    if (miniAppUrl) {
      await botApi(process.env.USER_BOT_TOKEN, 'setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '\u041E\u0442\u043A\u0440\u044B\u0442\u044C',
          web_app: { url: miniAppUrl }
        }
      });
    }

    return res.status(200).json({
      ok: true,
      mod_webhook: modResult.ok ? 'set' : modResult.description,
      user_webhook: userResult.ok ? 'set' : userResult.description
    });
  } catch (err) {
    console.error('Setup webhook error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to set webhooks' });
  }
};
