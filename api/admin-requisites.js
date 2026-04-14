const { getRedis } = require('./_redis');
const {
  getAllRequisites,
  getRequisite,
  createRequisite,
  updateRequisite,
  deleteRequisite,
  seedTestCards,
  repairRequisitesState,
  deduplicateRequisites
} = require('./_requisites');
const { getDailyStats, getStatsHistory, DAILY_LIMIT_RUB } = require('./_stats');

/**
 * Simple admin auth: checks MODERATOR_PASSWORD header.
 */
function checkAdminAuth(req) {
  const password = req.headers['x-admin-password'];
  if (!password || !process.env.MODERATOR_PASSWORD) return false;
  return password === process.env.MODERATOR_PASSWORD;
}

module.exports = async (req, res) => {
  // CORS for admin panel — restrict to same-origin or explicit ADMIN_ORIGIN
  const allowedOrigin = process.env.ADMIN_ORIGIN || null;
  const requestOrigin = req.headers['origin'] || '';

  if (requestOrigin) {
    // Cross-origin request — only allow if it matches configured origin
    if (allowedOrigin && requestOrigin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    } else if (!allowedOrigin) {
      // No ADMIN_ORIGIN set — allow same deployment origin (Vercel auto-URLs)
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    } else {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }
  }
  // If no Origin header — same-origin request, no CORS headers needed

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Admin login rate limit — block after 5 failed attempts per IP for 15 min
  const r = getRedis();
  const forwarded = req.headers['x-forwarded-for'];
  const adminIp = forwarded ? forwarded.split(',')[0].trim() : (req.headers['x-real-ip'] || 'unknown');
  const adminRlKey = `admin_rl:${adminIp}`;

  if (r) {
    try {
      const failures = await r.get(adminRlKey);
      const failCount = failures ? parseInt(String(failures), 10) : 0;
      if (failCount >= 5) {
        return res.status(429).json({ ok: false, error: '\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 15 \u043C\u0438\u043D\u0443\u0442.' });
      }
    } catch (_) {}
  }

  if (!checkAdminAuth(req)) {
    // Record failed attempt
    if (r) {
      try {
        const curr = await r.incr(adminRlKey);
        if (curr === 1) await r.expire(adminRlKey, 900);
      } catch (_) {}
    }
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Successful auth — clear rate limit
  if (r) {
    try { await r.del(adminRlKey); } catch (_) {}
  }

  const url = req.url || '';
  const queryIdx = url.indexOf('?');
  const query = queryIdx !== -1 ? new URLSearchParams(url.substring(queryIdx)) : new URLSearchParams();
  const action = query.get('action') || '';

  try {
    // GET — list all or get one
    if (req.method === 'GET') {
      if (action === 'seed') {
        const result = await seedTestCards();
        return res.status(200).json({ ok: true, ...result });
      }

      if (action === 'dedup') {
        const result = await deduplicateRequisites();
        return res.status(200).json({ ok: true, ...result });
      }

      if (action === 'stats') {
        const today = await getDailyStats();
        return res.status(200).json({
          ok: true,
          today: {
            date: today.date,
            totalApprovedRub: today.totalApprovedRub || 0,
            approvedOrdersCount: today.approvedOrdersCount || 0,
            dailyLimitRub: DAILY_LIMIT_RUB
          }
        });
      }

      if (action === 'history') {
        const limit = parseInt(query.get('limit')) || 30;
        const safedLimit = Math.min(Math.max(limit, 1), 90);
        const history = await getStatsHistory(safedLimit);
        return res.status(200).json({ ok: true, history: history });
      }

      const id = query.get('id');
      if (id) {
        const requisite = await getRequisite(id);
        if (!requisite) {
          return res.status(404).json({ ok: false, error: 'Not found' });
        }
        return res.status(200).json({ ok: true, requisite });
      }

      await repairRequisitesState();
      const all = await getAllRequisites();
      console.log('ADMIN FETCH: returning ' + all.length + ' requisites');

      // Enrich requisites with order seqId for display
      for (const req of all) {
        if (req.currentOrderId && r) {
          try {
            const orderRaw = await r.get('order:' + req.currentOrderId);
            if (orderRaw) {
              const order = typeof orderRaw === 'string' ? JSON.parse(orderRaw) : orderRaw;
              req.currentOrderSeqId = order.seqId || null;
            } else {
              // Order disappeared but card still busy — will be fixed by repair on next call
              console.warn('ADMIN FETCH: card ' + req.id + ' references missing order ' + req.currentOrderId);
            }
          } catch (enrichErr) {
            console.error('ADMIN FETCH: enrichment error for card ' + req.id + ':', enrichErr.message);
          }
        }
      }

      return res.status(200).json({ ok: true, requisites: all });
    }

    // POST — create
    if (req.method === 'POST') {
      const { cardNumber, bankName } = req.body || {};

      if (!cardNumber || !bankName) {
        return res.status(400).json({ ok: false, error: 'cardNumber and bankName required' });
      }

      if (typeof cardNumber !== 'string' || cardNumber.trim().length < 4) {
        return res.status(400).json({ ok: false, error: 'Invalid card number' });
      }

      if (typeof bankName !== 'string' || bankName.trim().length < 2) {
        return res.status(400).json({ ok: false, error: 'Invalid bank name' });
      }

      const requisite = await createRequisite({ cardNumber, bankName });

      if (requisite.error) {
        return res.status(409).json({ ok: false, error: requisite.message, reason: requisite.error });
      }

      return res.status(200).json({ ok: true, requisite });
    }

    // PUT — update
    if (req.method === 'PUT') {
      const { id, cardNumber, bankName, isActive } = req.body || {};

      if (!id) {
        return res.status(400).json({ ok: false, error: 'id required' });
      }

      const updates = {};
      if (cardNumber !== undefined) updates.cardNumber = cardNumber;
      if (bankName !== undefined) updates.bankName = bankName;
      if (isActive !== undefined) updates.isActive = !!isActive;

      const result = await updateRequisite(id, updates);
      if (!result) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }

      if (result.error) {
        const statusCode = result.error === 'duplicate_card' ? 409 : 409;
        return res.status(statusCode).json({ ok: false, error: result.message, reason: result.error });
      }

      return res.status(200).json({ ok: true, requisite: result });
    }

    // DELETE — delete
    if (req.method === 'DELETE') {
      const id = query.get('id') || (req.body && req.body.id);

      if (!id) {
        return res.status(400).json({ ok: false, error: 'id required' });
      }

      const result = await deleteRequisite(id);
      if (!result.deleted) {
        if (result.reason === 'busy') {
          return res.status(409).json({ ok: false, error: 'Card is currently busy, cannot delete' });
        }
        return res.status(404).json({ ok: false, error: 'Not found' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin requisites error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
