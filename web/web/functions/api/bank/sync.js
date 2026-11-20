import { json } from "../../_lib/auth.js"
import { ensureSchema, loadAll, loadBankSessions, setUpdatedAt } from "../../_lib/db.js"
import {
  BankError,
  backfillBalances,
  fetchAllTransactions,
  fetchBookedBalance,
  isConfigured,
  mapBankTransaction,
  planBankUpsert,
} from "../../_lib/enablebanking.js"

const FIRST_SYNC_DAYS = 730
const OVERLAP_DAYS = 10
const FALLBACK_DAYS = 89

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

async function fetchRows(env, account, dateFrom, request) {
  try {
    return await fetchAllTransactions(env, account.uid, dateFrom, request)
  } catch (error) {
    // Some banks only allow ~90 days of history: retry with a shorter window.
    if (error instanceof BankError && /PERIOD|INTERVAL|DATE/i.test(String(error.code || error.message))) {
      return fetchAllTransactions(env, account.uid, daysAgo(FALLBACK_DAYS), request)
    }
    throw error
  }
}

/** Pulls booked movements from every valid bank session and upserts them. */
export async function onRequestPost(context) {
  const { env, request } = context
  const db = env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  if (!isConfigured(env)) return json({ error: "Falta configurar EB_APP_ID y EB_PRIVATE_KEY en Cloudflare." }, { status: 400 })
  await ensureSchema(db)

  const now = new Date().toISOString()
  const sessions = (await loadBankSessions(db)).filter((session) => session.validUntil > now)
  if (!sessions.length) return json({ error: "No hay ninguna conexión con el banco vigente. Conecta BBVA de nuevo." }, { status: 409 })

  const stats = { inserted: 0, updated: 0, skipped: 0, accounts: 0 }
  const errors = []

  for (const session of sessions) {
    const dateFrom = session.lastSyncAt
      ? new Date(Date.parse(session.lastSyncAt) - OVERLAP_DAYS * 86400000).toISOString().slice(0, 10)
      : daysAgo(FIRST_SYNC_DAYS)
    let sessionOk = true
    for (const account of session.accounts) {
      try {
        const raw = await fetchRows(env, account, dateFrom, request)
        let rows = raw.map((item) => mapBankTransaction(item, account.accountName, account.uid)).filter(Boolean)
        // Balances can only be rebuilt from a full history fetch, not an incremental window.
        if (!session.lastSyncAt) {
          const booked = await fetchBookedBalance(env, account.uid, request).catch(() => null)
          rows = backfillBalances(rows, booked)
        }
        const existing = await db
          .prepare(`SELECT id, date, amount FROM transactions WHERE account = ? AND date >= ?`)
          .bind(account.accountName, dateFrom)
          .all()
        const plan = planBankUpsert(existing.results || [], rows)
        const statements = [
          ...plan.inserts.map((row) =>
            db
              .prepare(
                `INSERT INTO transactions (id, date, amount, text, category, category_locked, account, balance_after, updated_at)
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
              )
              .bind(row.id, row.date, row.amount, row.text, row.amount < 0 ? "Otros gastos" : "Otros ingresos", row.account, row.balanceAfter ?? null, now),
          ),
          ...plan.updates.map((row) =>
            db
              .prepare(
                `UPDATE transactions SET date = ?, amount = ?, text = ?, account = ?,
                   balance_after = COALESCE(?, balance_after), updated_at = ? WHERE id = ?`,
              )
              .bind(row.date, row.amount, row.text, row.account, row.balanceAfter ?? null, now, row.id),
          ),
        ]
        for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100))
        stats.inserted += plan.inserts.length
        stats.updated += plan.updates.length
        stats.skipped += plan.skipped
        stats.accounts += 1
      } catch (error) {
        sessionOk = false
        const expired = error instanceof BankError && /EXPIRED|REVOKED|SESSION/i.test(String(error.code))
        errors.push({ account: account.accountName, message: expired ? "La autorización del banco ha caducado: vuelve a conectar." : error.message })
        if (expired) {
          await db.prepare(`UPDATE bank_sessions SET valid_until = ? WHERE id = ?`).bind(now, session.id).run()
          break
        }
      }
    }
    if (sessionOk) await db.prepare(`UPDATE bank_sessions SET last_sync_at = ? WHERE id = ?`).bind(now, session.id).run()
  }

  if (stats.inserted || stats.updated) await setUpdatedAt(db, now)
  const data = await loadAll(db)
  return json({ ...data, syncStats: stats, syncErrors: errors, bankSessions: await loadBankSessions(db) })
}
