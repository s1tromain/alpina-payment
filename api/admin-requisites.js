const { getRedis } = require('./_redis');
const {
  getAllRequisites,
  getRequisite,
  createRequisite,
  updateRequisite,
  deleteRequisite,
  seedTestCards
} = require('./_requisites');

/**
 * Simple admin auth: checks MODERATOR_PASSWORD header.
 */
function checkAdminAuth(req) {
  const password = req.headers['x-admin-password'];
  if (!password || !process.env.MODERATOR_PASSWORD) return false;
  return password === process.env.MODERATOR_PASSWORD;
}

module.exports = async (req, res) => {
  // CORS for admin panel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
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

      const id = query.get('id');
      if (id) {
        const requisite = await getRequisite(id);
        if (!requisite) {
          return res.status(404).json({ ok: false, error: 'Not found' });
        }
        return res.status(200).json({ ok: true, requisite });
      }

      const all = await getAllRequisites();
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
