-- =============================================
-- ALPINA PAY-OUT — Database Schema (Supabase / Postgres)
-- =============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  receive_currency TEXT NOT NULL DEFAULT 'USDT',
  receive_amount NUMERIC NOT NULL,
  pay_currency TEXT NOT NULL DEFAULT 'RUB',
  pay_amount NUMERIC NOT NULL,
  base_rate NUMERIC NOT NULL,
  markup_percent NUMERIC NOT NULL DEFAULT 8,
  final_rate NUMERIC NOT NULL,
  payout_details TEXT NOT NULL,
  receipt_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  telegram_channel_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  processed_by TEXT,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at);

-- Enable Row Level Security (optional, service key bypasses RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
