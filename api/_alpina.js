const fetch = require('node-fetch');

/**
 * Create a card payin via Alpina API.
 * Returns normalized requisites object.
 */
async function createCardPayin({ amountRub, merchantTransactionId, clientId }) {
  const baseUrl = process.env.ALPINA_API_BASE_URL;
  const token = process.env.ALPINA_BEARER_TOKEN;

  if (!baseUrl || !token) {
    throw new Error('Alpina API not configured');
  }

  const url = `${baseUrl}/api/v1/transactions/card`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: amountRub,
      currency: 'RUB',
      merchant_transaction_id: merchantTransactionId,
      client_id: clientId
    }),
    timeout: 15000
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Alpina API error ${resp.status}: ${text}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error('Alpina API returned invalid JSON');
  }

  // Handle nested response formats (data may be wrapped)
  const payload = data.data || data.result || data;

  const alpinaTransactionId = payload.transaction_id || payload.id || null;
  const cardNumber = payload.card_number || payload.card || payload.number || null;
  const bankName = payload.bank_name || payload.bank || null;
  const ownerName = payload.owner_name || payload.owner || payload.cardholder || null;
  const expiresAt = payload.expires_at || payload.expired_at || payload.expiration || null;

  if (!cardNumber) {
    throw new Error('Alpina API response missing card number');
  }

  return {
    alpinaTransactionId,
    cardNumber,
    bankName,
    ownerName,
    expiresAt,
    raw: data
  };
}

module.exports = { createCardPayin };
