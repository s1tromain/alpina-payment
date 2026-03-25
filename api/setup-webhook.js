const fetch = require('node-fetch');

function botApi(method, body) {
  return fetch(
    'https://api.telegram.org/bot' + process.env.BOT_TOKEN + '/' + method,
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

  if (!process.env.WEBHOOK_SECRET || !process.env.BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  const secret = req.headers['x-setup-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = 'https://' + host + '/api/webhook';

    const webhookResult = await botApi('setWebhook', {
      url: webhookUrl,
      secret_token: process.env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query']
    });

    await botApi('setMyCommands', {
      commands: [
        { command: 'start', description: '\u0413\u043B\u0430\u0432\u043D\u043E\u0435 \u043C\u0435\u043D\u044E' },
        { command: 'orders', description: '\u041C\u043E\u0438 \u0437\u0430\u044F\u0432\u043A\u0438' }
      ]
    });

    const miniAppUrl = process.env.MINI_APP_URL || process.env.SITE_URL;
    if (miniAppUrl) {
      await botApi('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '\u041E\u0442\u043A\u0440\u044B\u0442\u044C',
          web_app: { url: miniAppUrl }
        }
      });
    }

    return res.status(200).json({ ok: webhookResult.ok, description: webhookResult.description });
  } catch (err) {
    console.error('Setup webhook error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to set webhook' });
  }
};
