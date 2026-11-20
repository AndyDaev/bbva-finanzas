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
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account, date);

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

-- User categorization rules: applied before the built-in ones.
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains',
  category TEXT NOT NULL,
  direction TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Read-only bank consents (Enable Banking). Data stays when a consent is removed.
CREATE TABLE IF NOT EXISTS bank_sessions (
  id TEXT PRIMARY KEY,
  valid_until TEXT NOT NULL,
  accounts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
