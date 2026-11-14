import { json } from "../_lib/auth.js"
import { ensureSchema, loadAll, setUpdatedAt } from "../_lib/db.js"

export async function onRequestPost(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "JSON inválido" }, { status: 400 })
  }

  const rows = Array.isArray(body?.transactions) ? body.transactions : []
  if (!rows.length) return json({ error: "Sin movimientos" }, { status: 400 })

  await ensureSchema(db)

  const accounts = [...new Set(rows.map((row) => String(row.account || "").trim()).filter(Boolean))]
  if (!accounts.length) return json({ error: "Falta cuenta" }, { status: 400 })

  const lockedRows = await db
    .prepare(
      `SELECT id, date, amount, text, account, category, category_locked
       FROM transactions
       WHERE category_locked = 1 AND lower(account) IN (${accounts.map(() => "lower(?)").join(",")})`,
    )
    .bind(...accounts)
    .all()

  const lockedByKey = new Map()
  for (const row of lockedRows.results || []) {
    const key = `${row.date}|${row.amount}|${String(row.text).toLowerCase()}|${String(row.account).toLowerCase()}`
    lockedByKey.set(key, row)
  }

  const statements = []
  for (const account of accounts) {
    statements.push(db.prepare(`DELETE FROM transactions WHERE lower(account) = lower(?)`).bind(account))
  }

  const now = new Date().toISOString()
  for (const row of rows) {
    const account = String(row.account || "").trim()
    const text = String(row.text || "").trim()
    const date = String(row.date || "")
    const amount = Number(row.amount)
    if (!account || !date || !Number.isFinite(amount)) continue
    const key = `${date}|${amount}|${text.toLowerCase()}|${account.toLowerCase()}`
    const locked = lockedByKey.get(key)
    const categoryLocked = locked ? 1 : row.categoryLocked ? 1 : 0
    const category = locked ? locked.category : String(row.category || "Otros gastos")
    const id = String(row.id || `tx-${date}-${amount}-${Math.random().toString(36).slice(2, 9)}`)
    const balance = typeof row.balanceAfter === "number" ? row.balanceAfter : null
    statements.push(
      db
        .prepare(
          `INSERT INTO transactions
            (id, date, amount, text, category, category_locked, account, balance_after, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, date, amount, text, category, categoryLocked, account, balance, now),
    )
  }

  if (statements.length) await db.batch(statements)
  await setUpdatedAt(db, now)
  return json(await loadAll(db))
}
