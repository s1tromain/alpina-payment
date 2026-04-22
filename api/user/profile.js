const { validateInitData } = require('../_auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const initData = req.headers['x-telegram-init-data'];
    const user = validateInitData(initData);
    if (!user) {
      return res.status(403).json({ ok: false, error: 'Неверная авторизация' });
    }

    return res.status(200).json({
      ok: true,
      profile: {
        telegramId: String(user.id),
        username: user.username || null,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        photoUrl: user.photo_url || null,
        languageCode: user.language_code || null,
        isPremium: !!user.is_premium
      }
    });
  } catch (err) {
    console.error('Profile error:', err.message);
    return res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
};
