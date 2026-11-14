CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  category_locked INTEGER NOT NULL DEFAULT 0,
  account TEXT NOT NULL,
  balance_after REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  date TEXT,
  total REAL NOT NULL,
  items_json TEXT NOT NULL,
  transaction_id TEXT,
  account TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  category TEXT PRIMARY KEY,
  monthly_limit REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
