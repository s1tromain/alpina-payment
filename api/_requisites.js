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

  let ids;
  try {
    ids = await r.smembers('requisites:all');
  } catch (err) {
    console.error('getAllRequisites: failed to read requisites:all:', err.message);
    return [];
  }
  if (!ids || ids.length === 0) {
    console.log('getAllRequisites: requisites:all is empty');
    return [];
  }

  const results = [];
  const orphanedIds = [];
  for (const id of ids) {
    try {
      const raw = await r.get('requisite:' + id);
      if (!raw) {
        orphanedIds.push(id);
        continue;
      }
      const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!req || !req.id) {
        console.error('getAllRequisites: invalid requisite data for id=' + id);
        continue;
      }
      results.push(req);
    } catch (err) {
      console.error('getAllRequisites: failed to parse requisite id=' + id + ':', err.message);
      continue;
    }
  }

  // Clean up orphaned IDs from the set (ID in set but no data in Redis)
  for (const id of orphanedIds) {
    try {
      await r.srem('requisites:all', id);
      console.log('getAllRequisites: removed orphaned id=' + id + ' from requisites:all');
    } catch (_) {}
  }

  results.sort(function (a, b) {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  console.log('getAllRequisites: returning ' + results.length + ' requisites (cleaned ' + orphanedIds.length + ' orphaned)');
  return results;
}

/**
 * Get a single requisite by ID.
 */
async function getRequisite(id) {
  const r = getRedis();
  if (!r) return null;

  try {
    const raw = await r.get('requisite:' + id);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error('getRequisite: failed to read/parse id=' + id + ':', err.message);
    return null;
  }
}

/**
 * Normalize card number for comparison (strip spaces, dashes).
 */
function normalizeCardNumber(cn) {
  return (cn || '').replace(/[\s\-]/g, '');
}

/**
 * Check if a card number already exists among requisites.
 * Returns the existing requisite or null.
 */
async function findByCardNumber(cardNumber, excludeId) {
  const all = await getAllRequisites();
  const normalized = normalizeCardNumber(cardNumber);
  for (const req of all) {
    if (excludeId && req.id === excludeId) continue;
    if (normalizeCardNumber(req.cardNumber) === normalized) return req;
  }
  return null;
}

/**
 * Deduplicate requisites: find cards with same cardNumber, keep best copy, remove rest.
 * Priority: 1) busy with valid order, 2) active+free, 3) newest.
 * Returns { found, removed, details }.
 */
async function deduplicateRequisites() {
  const r = getRedis();
  if (!r) return { found: 0, removed: 0, details: [] };

  const all = await getAllRequisites();
  const byCard = {};

  for (const req of all) {
    const key = normalizeCardNumber(req.cardNumber);
    if (!key) continue;
    if (!byCard[key]) byCard[key] = [];
    byCard[key].push(req);
  }

  let totalFound = 0;
  let totalRemoved = 0;
  const details = [];

  for (const key of Object.keys(byCard)) {
    const group = byCard[key];
    if (group.length <= 1) continue;

    totalFound += group.length - 1;
    console.log('deduplicateRequisites: found ' + group.length + ' copies of card ' + key);

    // Score each copy to pick the best one
    const scored = [];
    for (const req of group) {
      let score = 0;
      // busy with valid currentOrderId gets highest priority
      if (req.status === 'busy' && req.currentOrderId) {
        try {
          const orderRaw = await r.get('order:' + req.currentOrderId);
          if (orderRaw) {
            const order = typeof orderRaw === 'string' ? JSON.parse(orderRaw) : orderRaw;
            if (['created', 'pending', 'approved'].includes(order.status)) {
              score = 100; // busy with active order — top priority
            }
          }
        } catch (_) {}
      }
      if (score === 0 && req.isActive && req.status === 'free') score = 50;
      if (score === 0 && req.isActive) score = 30;
      if (score === 0) score = 10;
      scored.push({ req, score });
    }

    // Sort: highest score first, then newest
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.req.updatedAt || b.req.createdAt || '').localeCompare(a.req.updatedAt || a.req.createdAt || '');
    });

    const keeper = scored[0].req;
    const toRemove = scored.slice(1).map(function (s) { return s.req; });

    for (const dup of toRemove) {
      // If this duplicate is busy, release its lock
      try {
        await r.del('requisite:' + dup.id);
        await r.srem('requisites:all', dup.id);
        await r.del('requisite:lock:' + dup.id);
        totalRemoved++;
        console.log('deduplicateRequisites: removed duplicate id=' + dup.id + ' (card=' + dup.cardNumber + ', status=' + dup.status + '), kept id=' + keeper.id);
        details.push({ removedId: dup.id, keptId: keeper.id, cardNumber: dup.cardNumber, removedStatus: dup.status });
      } catch (err) {
        console.error('deduplicateRequisites: failed to remove id=' + dup.id + ':', err.message);
      }
    }
  }

  console.log('deduplicateRequisites: total duplicates found=' + totalFound + ', removed=' + totalRemoved);
  return { found: totalFound, removed: totalRemoved, details };
}

/**
 * Create a new requisite card.
 * Rejects if a card with the same number already exists.
 */
async function createRequisite({ cardNumber, bankName }) {
  const r = getRedis();
  if (!r) throw new Error('Redis not available');

  // Check for duplicate card number
  const existing = await findByCardNumber(cardNumber);
  if (existing) {
    return { error: 'duplicate_card', message: 'Карта с таким номером уже существует (id=' + existing.id + ')' };
  }

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

  // Check for duplicate card number on rename
  if (updates.cardNumber !== undefined && normalizeCardNumber(updates.cardNumber) !== normalizeCardNumber(existing.cardNumber)) {
    const dup = await findByCardNumber(updates.cardNumber, id);
    if (dup) {
      return { error: 'duplicate_card', message: 'Карта с таким номером уже существует (id=' + dup.id + ')' };
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

  let ids;
  try {
    ids = await r.smembers('requisites:all');
  } catch (err) {
    console.error('assignCard: failed to read requisites:all:', err.message);
    return { ok: false, error: 'Redis read error' };
  }

  if (!ids || ids.length === 0) {
    console.error('assignCard: requisites:all is EMPTY — no cards configured');
    return { ok: false, error: 'no_free_cards' };
  }

  if (ids.length < 2) {
    console.warn('assignCard: only ' + ids.length + ' card(s) in requisites:all — risk of exhaustion');
  }

  // Shuffle for fairness
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }

  // Track seen cardNumbers to skip duplicates within this run
  const seenCards = new Set();

  for (const id of ids) {
    try {
      const raw = await r.get('requisite:' + id);
      if (!raw) continue;
      const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!req || !req.id) continue;

      // Skip duplicate cardNumbers — only consider first occurrence
      const normCard = normalizeCardNumber(req.cardNumber);
      if (seenCards.has(normCard)) {
        console.warn('assignCard: skipping duplicate card ' + id + ' (' + req.cardNumber + ')');
        continue;
      }
      seenCards.add(normCard);

      if (!req.isActive) continue;

      // If card is busy, check if its order is still valid — recover orphaned cards
      if (req.status === 'busy' && req.currentOrderId) {
        try {
          const orderRaw = await r.get('order:' + req.currentOrderId);
          let shouldRelease = false;
          if (!orderRaw) {
            shouldRelease = true;
          } else {
            const order = typeof orderRaw === 'string' ? JSON.parse(orderRaw) : orderRaw;
            if (['completed', 'rejected', 'expired', 'cancelled'].includes(order.status)) {
              shouldRelease = true;
            }
          }
          if (shouldRelease) {
            req.status = 'free';
            req.currentOrderId = null;
            req.updatedAt = new Date().toISOString();
            await r.set('requisite:' + id, JSON.stringify(req));
            await r.del('requisite:lock:' + id);
            console.log('assignCard: released orphaned card ' + id + ' for order ' + orderId);
          } else {
            continue; // genuinely busy
          }
        } catch (innerErr) {
          console.error('assignCard: error checking order for card ' + id + ':', innerErr.message);
          continue;
        }
      }

      if (req.status !== 'free') continue;

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

      if (!reqCheck || !reqCheck.isActive || reqCheck.status !== 'free') {
        await r.del(lockKey);
        continue;
      }

      // Mark as busy
      reqCheck.status = 'busy';
      reqCheck.currentOrderId = orderId;
      reqCheck.updatedAt = new Date().toISOString();
      await r.set('requisite:' + id, JSON.stringify(reqCheck));

      console.log('assignCard: assigned card ' + id + ' to order ' + orderId);
      return {
        ok: true,
        requisite: reqCheck
      };
    } catch (err) {
      console.error('assignCard: error processing card ' + id + ':', err.message);
      continue;
    }
  }

  console.error('assignCard: no free cards available out of ' + ids.length + ' total for order ' + orderId);
  return { ok: false, error: 'no_free_cards' };
}

/**
 * Release a card back to free status.
 * Called when order reaches a final state.
 */
async function releaseCard(requisiteId, expectedOrderId) {
  const r = getRedis();
  if (!r) return;
  if (!requisiteId) return;

  try {
    const raw = await r.get('requisite:' + requisiteId);
    if (!raw) return;

    const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!req || !req.id) return;

    // Safety: skip release if card was already reassigned to a different order
    if (expectedOrderId && req.currentOrderId && req.currentOrderId !== expectedOrderId) {
      console.log('releaseCard: skipping ' + requisiteId + ' — reassigned to ' + req.currentOrderId + ' (expected ' + expectedOrderId + ')');
      return;
    }

    req.status = 'free';
    req.currentOrderId = null;
    req.updatedAt = new Date().toISOString();

    await r.set('requisite:' + req.id, JSON.stringify(req));
    await r.del('requisite:lock:' + req.id);
    console.log('releaseCard: freed card ' + requisiteId + ' (was order ' + (expectedOrderId || 'unknown') + ')');
  } catch (err) {
    console.error('releaseCard: error releasing ' + requisiteId + ':', err.message);
  }
}

/**
 * Release card by looking up the order's assigned requisite.
 */
async function releaseCardByOrder(order) {
  if (order && order.assignedRequisiteId) {
    await releaseCard(order.assignedRequisiteId, order.orderId);
  }
}

/**
 * Repair all requisites state: release busy cards whose orders are missing or inactive.
 * Returns count of released cards.
 */
async function repairRequisitesState() {
  const r = getRedis();
  if (!r) return 0;

  // Distributed lock to prevent concurrent repair operations
  const repairLockKey = 'requisites:repair:lock';
  const repairLocked = await r.set(repairLockKey, '1', { nx: true, ex: 30 });
  if (!repairLocked) {
    console.log('repairRequisitesState: skipped — another repair in progress');
    return 0;
  }

  try {
    // First deduplicate
    try {
      await deduplicateRequisites();
    } catch (dedupErr) {
      console.error('repairRequisitesState: dedup error:', dedupErr.message);
    }

    const allRequisites = await getAllRequisites();
    let released = 0;

    for (const req of allRequisites) {
      if (req.status !== 'busy') continue;

      let shouldRelease = false;
      const prevOrderId = req.currentOrderId;

      if (!req.currentOrderId) {
        shouldRelease = true;
      } else {
        try {
          const orderRaw = await r.get('order:' + req.currentOrderId);
          if (!orderRaw) {
            shouldRelease = true;
          } else {
            const order = typeof orderRaw === 'string' ? JSON.parse(orderRaw) : orderRaw;
            if (!['created', 'pending', 'approved'].includes(order.status)) {
              shouldRelease = true;
            }
          }
        } catch (err) {
          console.error('repairRequisitesState: error checking order for card ' + req.id + ':', err.message);
          shouldRelease = true;
        }
      }

      if (shouldRelease) {
        console.log('repairRequisitesState: releasing card ' + req.id + ' (order: ' + (prevOrderId || 'none') + ')');
        req.status = 'free';
        req.currentOrderId = null;
        req.updatedAt = new Date().toISOString();
        await r.set('requisite:' + req.id, JSON.stringify(req));
        await r.del('requisite:lock:' + req.id);
        released++;
      }
    }

    console.log('repairRequisitesState: checked ' + allRequisites.length + ' cards, released ' + released);
    return released;
  } finally {
    try { await r.del(repairLockKey); } catch (_) {}
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
  repairRequisitesState,
  deduplicateRequisites,
  seedTestCards
};
