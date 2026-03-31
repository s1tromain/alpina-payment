const crypto = require('crypto');
const { getRedis } = require('./_redis');

function generateRequisiteId() {
  return 'req_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Get all requisites.
 */
async function getAllRequisites() {
  const r = getRedis();
  if (!r) return [];

  const ids = await r.smembers('requisites:all');
  if (!ids || ids.length === 0) return [];

  const results = [];
  for (const id of ids) {
    const raw = await r.get('requisite:' + id);
    if (!raw) continue;
    const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
    results.push(req);
  }

  results.sort(function (a, b) {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  return results;
}

/**
 * Get a single requisite by ID.
 */
async function getRequisite(id) {
  const r = getRedis();
  if (!r) return null;

  const raw = await r.get('requisite:' + id);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * Create a new requisite card.
 */
async function createRequisite({ cardNumber, bankName }) {
  const r = getRedis();
  if (!r) throw new Error('Redis not available');

  const id = generateRequisiteId();
  const now = new Date().toISOString();

  const requisite = {
    id,
    cardNumber: cardNumber.trim(),
    bankName: bankName.trim(),
    isActive: true,
    status: 'free',
    currentOrderId: null,
    createdAt: now,
    updatedAt: now
  };

  await r.set('requisite:' + id, JSON.stringify(requisite));
  await r.sadd('requisites:all', id);

  return requisite;
}

/**
 * Update an existing requisite.
 */
async function updateRequisite(id, updates) {
  const r = getRedis();
  if (!r) throw new Error('Redis not available');

  const existing = await getRequisite(id);
  if (!existing) return null;

  // Block editing cardNumber/bankName on busy cards
  if (existing.status === 'busy') {
    if (updates.cardNumber !== undefined || updates.bankName !== undefined) {
      return { error: 'busy_edit', message: '\u041D\u0435\u043B\u044C\u0437\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u043D\u044F\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443' };
    }
    if (updates.isActive === false) {
      return { error: 'busy_disable', message: '\u041D\u0435\u043B\u044C\u0437\u044F \u0434\u0435\u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u043D\u044F\u0442\u0443\u044E \u043A\u0430\u0440\u0442\u0443' };
    }
  }

  if (updates.cardNumber !== undefined) existing.cardNumber = updates.cardNumber.trim();
  if (updates.bankName !== undefined) existing.bankName = updates.bankName.trim();
  if (updates.isActive !== undefined) existing.isActive = updates.isActive;
  existing.updatedAt = new Date().toISOString();

  await r.set('requisite:' + id, JSON.stringify(existing));
  return existing;
}

/**
 * Delete a requisite (only if free).
 */
async function deleteRequisite(id) {
  const r = getRedis();
  if (!r) throw new Error('Redis not available');

  const existing = await getRequisite(id);
  if (!existing) return { deleted: false, reason: 'not_found' };

  if (existing.status === 'busy') {
    return { deleted: false, reason: 'busy' };
  }

  await r.del('requisite:' + id);
  await r.srem('requisites:all', id);

  return { deleted: true };
}

/**
 * Assign a free active card to an order.
 * Uses setnx-based locking to prevent two orders getting the same card.
 */
async function assignCard(orderId) {
  const r = getRedis();
  if (!r) return { ok: false, error: 'Redis not available' };

  const ids = await r.smembers('requisites:all');
  if (!ids || ids.length === 0) {
    return { ok: false, error: 'no_free_cards' };
  }

  // Shuffle for fairness
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }

  for (const id of ids) {
    const raw = await r.get('requisite:' + id);
    if (!raw) continue;
    const req = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!req.isActive || req.status !== 'free') continue;

    // Attempt atomic lock using SET NX with TTL as safety net
    const lockKey = 'requisite:lock:' + id;
    const locked = await r.set(lockKey, orderId, { nx: true, ex: 3600 });

    if (!locked) continue; // Another process grabbed it

    // Re-read to ensure still free after lock
    const rawCheck = await r.get('requisite:' + id);
    if (!rawCheck) {
      await r.del(lockKey);
      continue;
    }
    const reqCheck = typeof rawCheck === 'string' ? JSON.parse(rawCheck) : rawCheck;

    if (!reqCheck.isActive || reqCheck.status !== 'free') {
      await r.del(lockKey);
      continue;
    }

    // Mark as busy
    reqCheck.status = 'busy';
    reqCheck.currentOrderId = orderId;
    reqCheck.updatedAt = new Date().toISOString();
    await r.set('requisite:' + id, JSON.stringify(reqCheck));

    return {
      ok: true,
      requisite: reqCheck
    };
  }

  return { ok: false, error: 'no_free_cards' };
}

/**
 * Release a card back to free status.
 * Called when order reaches a final state.
 */
async function releaseCard(requisiteId) {
  const r = getRedis();
  if (!r) return;
  if (!requisiteId) return;

  const raw = await r.get('requisite:' + requisiteId);
  if (!raw) return;

  const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
  req.status = 'free';
  req.currentOrderId = null;
  req.updatedAt = new Date().toISOString();

  await r.set('requisite:' + req.id, JSON.stringify(req));
  await r.del('requisite:lock:' + req.id);
}

/**
 * Release card by looking up the order's assigned requisite.
 */
async function releaseCardByOrder(order) {
  if (order && order.assignedRequisiteId) {
    await releaseCard(order.assignedRequisiteId);
  }
}

/**
 * Seed initial test cards (idempotent — skips if cards already exist).
 */
async function seedTestCards() {
  const r = getRedis();
  if (!r) throw new Error('Redis not available');

  const existing = await r.smembers('requisites:all');
  if (existing && existing.length > 0) {
    return { seeded: 0, message: 'Cards already exist, skipping seed' };
  }

  const cards = [
    { cardNumber: '9860 1901 1253 6791', bankName: 'Aloqa Bank' },
    { cardNumber: '9860 6004 0229 0180', bankName: 'Anor Bank' },
    { cardNumber: '9860 6004 0259 9754', bankName: 'Anor Bank' },
    { cardNumber: '5614 6822 1682 2959', bankName: 'Kapital Bank' },
    { cardNumber: '5614 6821 2384 6448', bankName: 'Ipak Yoli' }
  ];

  let count = 0;
  for (const card of cards) {
    await createRequisite(card);
    count++;
  }

  return { seeded: count };
}

module.exports = {
  getAllRequisites,
  getRequisite,
  createRequisite,
  updateRequisite,
  deleteRequisite,
  assignCard,
  releaseCard,
  releaseCardByOrder,
  seedTestCards
};
