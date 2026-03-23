const fetch = require('node-fetch');

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
    const webhookUrl = `https://${host}/api/webhook`;

    const resp = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: process.env.WEBHOOK_SECRET,
          allowed_updates: ['callback_query']
        })
      }
    );

    const data = await resp.json();
    return res.status(200).json({ ok: data.ok, description: data.description });
  } catch (err) {
    console.error('Setup webhook error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to set webhook' });
  }
};
