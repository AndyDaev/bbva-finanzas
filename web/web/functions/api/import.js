import { json } from "../_lib/auth.js"
import { ensureSchema, loadAll, setUpdatedAt } from "../_lib/db.js"

function fingerprint(row) {
  const amount = Number(row.amount)
  const normalizedAmount = Number.isFinite(amount) ? amount.toFixed(2) : "0.00"
  return `${row.date}|${normalizedAmount}|${String(row.text || "").trim().toLowerCase()}|${String(row.account || "").trim().toLowerCase()}`
}

function hash32(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableId(row, occurrence) {
  return `tx_${hash32(`${fingerprint(row)}#${occurrence}`)}`
}

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

  const existingRows = await db
    .prepare(
      `SELECT * FROM transactions
       WHERE lower(account) IN (${accounts.map(() => "lower(?)").join(",")})`,
    )
    .bind(...accounts)
    .all()

  const buckets = new Map()
  for (const row of existingRows.results || []) {
    const fp = fingerprint(row)
    const list = buckets.get(fp) || []
    list.push(row)
    buckets.set(fp, list)
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  const statements = []
  const now = new Date().toISOString()
  const seenFp = new Map()
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const account = String(row.account || "").trim()
    const text = String(row.text || "").trim()
    const date = String(row.date || "")
    const amount = Number(row.amount)
    if (!account || !date || !Number.isFinite(amount)) continue

    const candidate = { date, amount, text, account }
    const fp = fingerprint(candidate)
    const occurrence = seenFp.get(fp) || 0
    seenFp.set(fp, occurrence + 1)

    const bucket = buckets.get(fp) || []
    const match = bucket[occurrence]
    const balance = typeof row.balanceAfter === "number" ? row.balanceAfter : match?.balance_after ?? null

    if (match) {
      const categoryLocked = match.category_locked ? 1 : row.categoryLocked ? 1 : 0
      const category = match.category_locked ? match.category : String(row.category || "Otros gastos")
      statements.push(
        db
          .prepare(
            `UPDATE transactions
             SET date = ?, amount = ?, text = ?, category = ?, category_locked = ?,
                 account = ?, balance_after = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(date, amount, text, category, categoryLocked, account, balance, now, match.id),
      )
      updated += 1
    } else {
      const id = String(row.id || stableId(candidate, occurrence))
      const categoryLocked = row.categoryLocked ? 1 : 0
      const category = String(row.category || "Otros gastos")
      statements.push(
        db
          .prepare(
            `INSERT INTO transactions
              (id, date, amount, text, category, category_locked, account, balance_after, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               date = excluded.date,
               amount = excluded.amount,
               text = excluded.text,
               category = CASE WHEN transactions.category_locked = 1 THEN transactions.category ELSE excluded.category END,
               category_locked = CASE WHEN transactions.category_locked = 1 THEN 1 ELSE excluded.category_locked END,
               account = excluded.account,
               balance_after = excluded.balance_after,
               updated_at = excluded.updated_at`,
          )
          .bind(id, date, amount, text, category, categoryLocked, account, balance, now),
      )
      inserted += 1
    }
  }

  if (statements.length) await db.batch(statements)
  await setUpdatedAt(db, now)
  const data = await loadAll(db)
  return json({ ...data, importStats: { inserted, updated, total: rows.length } })
}
