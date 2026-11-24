// Schema creation runs once per isolate instead of on every request.
let schemaReady = null

export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = createSchema(db).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function createSchema(db) {
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
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account, date)`),
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
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        match_type TEXT NOT NULL DEFAULT 'contains',
        category TEXT NOT NULL,
        direction TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bank_sessions (
        id TEXT PRIMARY KEY,
        valid_until TEXT NOT NULL,
        accounts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_sync_at TEXT
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

export function mapRule(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type === "regex" ? "regex" : "contains",
    category: row.category,
    direction: row.direction === "in" || row.direction === "out" ? row.direction : null,
    priority: Number(row.priority) || 0,
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

export async function loadTickets(db) {
  const rows = await db.prepare(`SELECT * FROM tickets ORDER BY created_at DESC`).all()
  return (rows.results || []).map(mapTicket)
}

export async function loadBudgets(db) {
  const rows = await db.prepare(`SELECT * FROM budgets ORDER BY category`).all()
  return (rows.results || []).map((row) => ({ category: row.category, monthlyLimit: row.monthly_limit }))
}

export async function loadRules(db) {
  const rows = await db.prepare(`SELECT * FROM rules ORDER BY priority DESC, created_at`).all()
  return (rows.results || []).map(mapRule)
}

export async function loadAll(db) {
  await ensureSchema(db)
  const [txRows, tickets, budgets, rules, updatedAt, balanceRows] = await Promise.all([
    db.prepare(`SELECT * FROM transactions ORDER BY date DESC, id DESC`).all(),
    loadTickets(db),
    loadBudgets(db),
    loadRules(db),
    getUpdatedAt(db),
    db.prepare(`SELECT key, value FROM meta WHERE key LIKE 'bank_balance:%'`).all(),
  ])
  // Bank's own balances per account (booked / available), saved on each sync.
  const bankBalances = {}
  for (const row of balanceRows.results || []) {
    try {
      bankBalances[row.key.slice("bank_balance:".length)] = JSON.parse(row.value)
    } catch {
      // ignore a malformed entry
    }
  }
  return {
    transactions: (txRows.results || []).map(mapTransaction),
    tickets,
    budgets,
    rules,
    updatedAt,
    bankBalances,
  }
}

export function mapBankSession(row) {
  let accounts = []
  try {
    accounts = JSON.parse(row.accounts_json || "[]")
  } catch {
    accounts = []
  }
  return {
    id: row.id,
    validUntil: row.valid_until,
    accounts,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at || null,
  }
}

export async function loadBankSessions(db) {
  const rows = await db.prepare(`SELECT * FROM bank_sessions ORDER BY created_at DESC`).all()
  return (rows.results || []).map(mapBankSession)
}

export async function getMeta(db, key) {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first()
  return row?.value ?? null
}

export async function setMeta(db, key, value) {
  await db
    .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run()
}

export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
