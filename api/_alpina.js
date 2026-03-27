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

  const body = {
    amount: String(Math.floor(amountRub)),
    currency: 'RUB',
    merchant_transaction_id: String(merchantTransactionId)
  };
  if (clientId) {
    body.client_id = String(clientId);
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    timeout: 15000
  });

  if (!resp.ok) {
    const status = resp.status;
    let bodyText = '';
    try {
      bodyText = await resp.text();
      if (bodyText.length > 1000) bodyText = bodyText.slice(0, 1000) + '…';
    } catch (_) {}
    console.error('Alpina API error:', status, bodyText);
    throw new Error(`Alpina API error ${status}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error('Alpina API returned invalid JSON');
  }

  const cardNumber = data.card_number || null;

  if (!cardNumber) {
    throw new Error('Alpina API response missing card number');
  }

  return {
    alpinaTransactionId: data.id || null,
    merchantTransactionId: data.merchant_transaction_id || null,
    expiresAt: data.expires_at || null,
    amountRub: data.amount || null,
    currency: data.currency || null,
    currencyRate: data.currency_rate || null,
    amountInUsd: data.amount_in_usd || null,
    rate: data.rate || null,
    commission: data.commission || null,
    cardNumber,
    ownerName: data.owner_name || null,
    bankName: data.bank_name || null,
    countryName: data.country_name || null,
    paymentCurrency: data.payment_currency || null,
    paymentLink: data.payment_link || null,
    raw: data
  };
}

module.exports = { createCardPayin };
