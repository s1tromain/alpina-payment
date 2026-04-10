module.exports = async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false });
  }

  const { getRedis } = require('./_redis');
  const { userBot } = require('./_telegram');
  const { releaseCardByOrder, repairRequisitesState } = require('./_requisites');

  const r = getRedis();
  let redisExpired = 0;
  let orphanedCardsReleased = 0;

  const ORDER_LIFETIME = 900; // 15 min for created orders (payment window)
  const DRAFT_LIFETIME = 120; // 2 min for unconfirmed draft orders
  const TOTAL_ORDER_LIFETIME = 1800; // 30 min total from creation (pending + approved)

  // Scan Redis orders for expired / stuck ones
  if (r) {
    try {
      // Use SCAN instead of KEYS to avoid blocking Redis
      const allKeys = [];
      let cursor = 0;
      do {
        const [nextCursor, keys] = await r.scan(cursor, { match: 'order:*', count: 100 });
        cursor = typeof nextCursor === 'string' ? parseInt(nextCursor, 10) : nextCursor;
        if (keys && keys.length) allKeys.push(...keys);
      } while (cursor !== 0);

      const now = new Date();
      for (const key of allKeys) {
        if (key === 'order:seq') continue;
        const raw = await r.get(key);
        if (!raw) continue;
        const order = typeof raw === 'string' ? JSON.parse(raw) : raw;

        let shouldExpire = false;
        let notifyMessage = null;

        // Unconfirmed draft: expire after DRAFT_LIFETIME (2 min)
        if (order.status === 'created' && !order.confirmed && order.draftExpiresAt && new Date(order.draftExpiresAt) < now) {
          shouldExpire = true;
          notifyMessage = null; // Don't notify — user never saw the payment page
        }

        // created: expire if past expiresAt (15 min payment window)
        if (!shouldExpire && order.status === 'created' && order.expiresAt && new Date(order.expiresAt) < now) {
          shouldExpire = true;
          notifyMessage = '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.';
        }

        // pending: expire if total order age > 30 min from creation
        if (order.status === 'pending' && order.createdAt) {
          const age = now.getTime() - new Date(order.createdAt).getTime();
          if (age > TOTAL_ORDER_LIFETIME * 1000) {
            shouldExpire = true;
            notifyMessage = '\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u0430 \u0438 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.';
          }
        }

        // approved: expire if total order age > 30 min from creation
        if (order.status === 'approved' && order.createdAt) {
          const age = now.getTime() - new Date(order.createdAt).getTime();
          if (age > TOTAL_ORDER_LIFETIME * 1000) {
            shouldExpire = true;
            notifyMessage = '\u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u0430 \u0438 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.';
          }
        }

        if (shouldExpire) {
          order.status = 'expired';
          await r.set(key, JSON.stringify(order), { ex: 86400 });
          await releaseCardByOrder(order);
          redisExpired++;

          if (order.telegramId && notifyMessage) {
            try {
              await userBot.sendPlainMessage(order.telegramId, notifyMessage);
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.error('Redis expire scan error:', err.message);
    }

    // Repair orphaned busy cards via centralized function
    try {
      orphanedCardsReleased = await repairRequisitesState();
    } catch (err) {
      console.error('Orphaned card cleanup error:', err.message);
    }

    // Cleanup old stats entries (older than 90 days)
    try {
      const statsDates = await r.smembers('stats:dates');
      if (statsDates && statsDates.length > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        for (const d of statsDates) {
          if (d < cutoffStr) {
            await r.srem('stats:dates', d);
            await r.del('stats:daily:' + d);
          }
        }
      }
    } catch (err) {
      console.error('Stats cleanup error:', err.message);
    }
  }

  // DB-based expiration only runs when Supabase is configured.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(200).json({ ok: true, expired: redisExpired, orphanedCardsReleased });
  }

  try {
    const { getDb } = require('./_db');
    const db = getDb();

    const { data: expiredOrders } = await db
      .from('orders')
      .select('order_id, telegram_id')
      .eq('status', 'created')
      .lt('expires_at', new Date().toISOString());

    if (!expiredOrders || expiredOrders.length === 0) {
      return res.status(200).json({ ok: true, expired: redisExpired, orphanedCardsReleased });
    }

    let count = 0;
    for (const order of expiredOrders) {
      await db.from('orders')
        .update({ status: 'expired' })
        .eq('order_id', order.order_id);

      try {
        await userBot.sendPlainMessage(
          order.telegram_id,
          '\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u043F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.'
        );
      } catch (_) {}

      count++;
    }

    return res.status(200).json({ ok: true, expired: redisExpired + count, orphanedCardsReleased });
  } catch (err) {
    console.error('Cron expire error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
