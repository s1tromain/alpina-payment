const fetch = require('node-fetch');

const ALLOWED_HOSTS = [
  't.me',
  'telegram.org',
  'cdn.telegram.org',
];

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (_) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).end();
  }

  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch (_) {
    return res.status(400).end();
  }

  if (!isAllowedUrl(decoded)) {
    return res.status(403).end();
  }

  try {
    const upstream = await fetch(decoded, {
      timeout: 5000,
      headers: { 'User-Agent': 'TelegramBot/1.0' },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(404).end();
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstream.buffer();

    res.setHeader('Content-Type', contentType.startsWith('image/') ? contentType : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('Avatar proxy error:', err.message);
    return res.status(502).end();
  }
};
