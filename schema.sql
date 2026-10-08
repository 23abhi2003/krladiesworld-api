-- KR Ladies World D1 Database Schema
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  order_date TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  due_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'due',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total_price REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_payments (
  id TEXT PRIMARY KEY,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'Cash',
  customer_name TEXT,
  order_id TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  investment_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'Cash',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_daily_payments_date ON daily_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_investments_date ON investments(investment_date);
