export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
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
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        merchant TEXT NOT NULL,
        date TEXT,
        total REAL NOT NULL,
        items_json TEXT NOT NULL,
        transaction_id TEXT,
        account TEXT,
        created_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS budgets (
        category TEXT PRIMARY KEY,
        monthly_limit REAL NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `),
  ])
}

export function mapTransaction(row) {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    text: row.text,
    category: row.category,
    categoryLocked: Boolean(row.category_locked),
    account: row.account,
    balanceAfter: row.balance_after == null ? undefined : row.balance_after,
  }
}

export function mapTicket(row) {
  let items = []
  try {
    items = JSON.parse(row.items_json || "[]")
  } catch {
    items = []
  }
  return {
    id: row.id,
    merchant: row.merchant,
    date: row.date,
    total: row.total,
    items,
    transactionId: row.transaction_id,
    account: row.account,
    createdAt: row.created_at,
  }
}

export async function setUpdatedAt(db, iso = new Date().toISOString()) {
  await db
    .prepare(`INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(iso)
    .run()
  return iso
}

export async function getUpdatedAt(db) {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = 'updated_at'`).first()
  return row?.value || null
}

export async function loadAll(db) {
  await ensureSchema(db)
  const [txRows, ticketRows, budgetRows, updatedAt] = await Promise.all([
    db.prepare(`SELECT * FROM transactions ORDER BY date DESC, id DESC`).all(),
    db.prepare(`SELECT * FROM tickets ORDER BY created_at DESC`).all(),
    db.prepare(`SELECT * FROM budgets ORDER BY category`).all(),
    getUpdatedAt(db),
  ])
  return {
    transactions: (txRows.results || []).map(mapTransaction),
    tickets: (ticketRows.results || []).map(mapTicket),
    budgets: (budgetRows.results || []).map((row) => ({
      category: row.category,
      monthlyLimit: row.monthly_limit,
    })),
    updatedAt,
  }
}
