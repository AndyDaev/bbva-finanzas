import { json } from "../../_lib/auth.js"
import { ensureSchema, loadAll, loadBankSessions, readJson, setMeta, setUpdatedAt } from "../../_lib/db.js"
import {
  BankError,
  fetchBalances,
  forwardEnd,
  fetchTransactionsPage,
  isConfigured,
  mapBankTransaction,
  planForwardBalances,
  matchExistingAccount,
  planBankUpsert,
  EXCEL_BOOKING_LAG_DAYS,
} from "../../_lib/enablebanking.js"

// Each request does a bounded amount of work (Workers CPU/subrequest limits); the client
// calls again with the returned cursor until `done`.
const PAGES_PER_STEP = 4
const FIRST_SYNC_DAYS = 730
const OVERLAP_DAYS = 10
const FALLBACK_DAYS = 89

function daysBefore(iso, days) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function startDate(session) {
  return session.lastSyncAt
    ? new Date(Date.parse(session.lastSyncAt) - OVERLAP_DAYS * 86400000).toISOString().slice(0, 10)
    : daysAgo(FIRST_SYNC_DAYS)
}

/** Stable per bank account across consent renewals (the uid changes, the IBAN does not). */
function accountKey(account) {
  return account.label || account.uid
}

async function saveAccounts(db, session) {
  await db.prepare(`UPDATE bank_sessions SET accounts_json = ? WHERE id = ?`).bind(JSON.stringify(session.accounts), session.id).run()
}

/** First sync only: adopt the name of the Excel-imported account this bank account matches. */
async function autoMatchAccount(env, db, session, account, request) {
  const range = await db
    .prepare(`SELECT MIN(date) AS first FROM transactions WHERE id NOT LIKE 'eb\\_%' ESCAPE '\\'`)
    .first()
  if (!range?.first) return
  const page = await fetchTransactionsPage(env, account.uid, range.first, null, request)
  const sample = (page.transactions || []).map((raw) => mapBankTransaction(raw, account.accountName, accountKey(account))).filter(Boolean)
  if (!sample.length) return
  const candidates = await db
    .prepare(`SELECT id, date, amount, account FROM transactions WHERE date >= ? AND id NOT LIKE 'eb\\_%' ESCAPE '\\'`)
    .bind(range.first)
    .all()
  const claimed = new Set(session.accounts.filter((item) => item.uid !== account.uid).map((item) => item.accountName))
  const match = matchExistingAccount((candidates.results || []).filter((row) => !claimed.has(row.account)), sample)
  if (match && match !== account.accountName) {
    account.accountName = match
    await saveAccounts(db, session)
  }
}

/** Writes a batch with two statements (JSON-expanded), whatever its size. */
async function writeRows(db, account, rows, now) {
  if (!rows.length) return { inserted: 0, updated: 0, skipped: 0 }
  const dates = rows.map((row) => row.date).sort()
  const existing = await db
    .prepare(`SELECT id, date, amount, text FROM transactions WHERE account = ? AND date BETWEEN ? AND ?`)
    // Look a few days earlier too: Excel rows carry the purchase date, the bank the booking date.
    .bind(account.accountName, daysBefore(dates[0], EXCEL_BOOKING_LAG_DAYS), dates[dates.length - 1])
    .all()
  const plan = planBankUpsert(existing.results || [], rows)
  const statements = []
  if (plan.inserts.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO transactions (id, date, amount, text, category, category_locked, account, balance_after, updated_at)
           SELECT json_extract(value, '$.id'), json_extract(value, '$.date'), json_extract(value, '$.amount'),
                  json_extract(value, '$.text'),
                  CASE WHEN json_extract(value, '$.amount') < 0 THEN 'Otros gastos' ELSE 'Otros ingresos' END,
                  0, ?, json_extract(value, '$.balanceAfter'), ?
           FROM json_each(?) WHERE true
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(account.accountName, now, JSON.stringify(plan.inserts)),
    )
  }
  if (plan.updates.length) {
    statements.push(
      db
        .prepare(
          `UPDATE transactions AS t
           SET date = j.date, amount = j.amount, text = j.text,
               balance_after = COALESCE(j.balance, t.balance_after), updated_at = ?
           FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.date') AS date,
                        json_extract(value, '$.amount') AS amount, json_extract(value, '$.text') AS text,
                        json_extract(value, '$.balanceAfter') AS balance
                 FROM json_each(?)) AS j
           WHERE t.id = j.id`,
        )
        .bind(now, JSON.stringify(plan.updates)),
    )
  }
  if (statements.length) await db.batch(statements)
  return { inserted: plan.inserts.length, updated: plan.updates.length, skipped: plan.skipped }
}

/** End-of-day balance among same-day rows: the one no other row of the day starts from. */
function endOfDay(rows) {
  const starts = rows.map((row) => Math.round((row.balance_after - row.amount) * 100))
  const last = rows.find((row) => !starts.includes(Math.round(row.balance_after * 100)))
  return (last || rows[rows.length - 1]).balance_after
}

/** Recent days are recomputed on every sync: movements of one day can arrive in several syncs. */
const RECOMPUTE_DAYS = 14

/**
 * Balance after each movement (the API sends none). Recomputes the last RECOMPUTE_DAYS (and any
 * older gap) walking forward from the last settled day, then stores the bank's own balances:
 * booked (posted movements) and available (minus card holds the API does not list).
 */
async function backfillBalances(env, db, account, request, now) {
  const bank = await fetchBalances(env, account.uid, request).catch(() => null)
  const gap = await db.prepare("SELECT MIN(date) AS first FROM transactions WHERE account = ? AND balance_after IS NULL").bind(account.accountName).first()
  const recent = daysAgo(RECOMPUTE_DAYS)
  const windowStart = gap?.first && gap.first < recent ? gap.first : recent
  const anchorDay = await db
    .prepare("SELECT MAX(date) AS day FROM transactions WHERE account = ? AND date < ? AND balance_after IS NOT NULL")
    .bind(account.accountName, windowStart)
    .first()
  let computed = null
  if (anchorDay?.day) {
    const sameDay = await db
      .prepare("SELECT amount, balance_after FROM transactions WHERE account = ? AND date = ? AND balance_after IS NOT NULL")
      .bind(account.accountName, anchorDay.day)
      .all()
    const following = (await db
      .prepare("SELECT id, date, amount, balance_after FROM transactions WHERE account = ? AND date > ? ORDER BY date, amount DESC, id")
      .bind(account.accountName, anchorDay.day)
      .all()).results || []
    const anchor = endOfDay(sameDay.results || [])
    const updates = planForwardBalances(following, anchor, { overwrite: true })
    if (updates.length) {
      await db
        .prepare(
          `UPDATE transactions AS t SET balance_after = j.balance
           FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.balance') AS balance FROM json_each(?)) AS j
           WHERE t.id = j.id`,
        )
        .bind(JSON.stringify(updates))
        .run()
    }
    computed = forwardEnd(following, anchor)
  } else if (bank?.booked) {
    // No settled balance yet (first sync): work back from the bank's booked balance.
    await db
      .prepare(
        `WITH calc AS (
           SELECT id, ROUND(? - COALESCE(SUM(amount) OVER (ORDER BY date DESC, id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0), 2) AS balance
           FROM transactions WHERE account = ?
         )
         UPDATE transactions SET balance_after = (SELECT balance FROM calc WHERE calc.id = transactions.id)
         WHERE account = ? AND balance_after IS NULL`,
      )
      .bind(bank.booked.amount, account.accountName, account.accountName)
      .run()
    computed = bank.booked.amount
  }
  if (bank?.booked || bank?.available != null) {
    await setMeta(db, `bank_balance:${account.accountName}`, JSON.stringify({
      booked: bank.booked?.amount ?? null,
      available: bank.available,
      computed,
      at: now,
    }))
  }
}

export async function onRequestPost(context) {
  const { env, request } = context
  const db = env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  if (!isConfigured(env)) return json({ error: "Falta configurar EB_APP_ID y EB_PRIVATE_KEY en Cloudflare." }, { status: 400 })
  await ensureSchema(db)

  const body = (await readJson(request)) || {}
  const now = new Date().toISOString()
  const sessions = (await loadBankSessions(db)).filter((session) => session.validUntil > now).reverse()
  if (!sessions.length) return json({ error: "No hay ninguna conexión con el banco vigente. Conecta BBVA de nuevo." }, { status: 409 })

  let cursor = body.cursor && typeof body.cursor === "object" ? body.cursor : null
  let sIndex = cursor ? sessions.findIndex((session) => session.id === cursor.sessionId) : 0
  if (sIndex < 0) {
    sIndex = 0
    cursor = null
  }
  const stats = cursor?.stats || { inserted: 0, updated: 0, skipped: 0, accounts: 0 }
  const errors = Array.isArray(cursor?.errors) ? cursor.errors : []
  const session = sessions[sIndex]
  const aIndex = Math.min(Number(cursor?.accountIndex) || 0, Math.max(session.accounts.length - 1, 0))
  const account = session.accounts[aIndex]
  let key = cursor?.key || null
  let dateFrom = cursor?.dateFrom || startDate(session)
  let accountDone = !account

  if (account) {
    try {
      if (!key && !session.lastSyncAt) await autoMatchAccount(env, db, session, account, request)
      const rows = []
      for (let page = 0; page < PAGES_PER_STEP; page += 1) {
        let data
        try {
          data = await fetchTransactionsPage(env, account.uid, dateFrom, key, request)
        } catch (error) {
          // Some banks only allow ~90 days of history: restart this account with a shorter window.
          if (!key && error instanceof BankError && /PERIOD|INTERVAL|DATE/i.test(String(error.code || error.message))) {
            dateFrom = daysAgo(FALLBACK_DAYS)
            data = await fetchTransactionsPage(env, account.uid, dateFrom, null, request)
          } else throw error
        }
        rows.push(...(data.transactions || []).map((raw) => mapBankTransaction(raw, account.accountName, accountKey(account), account.uid)).filter(Boolean))
        key = data.continuation_key || null
        if (!key) break
      }
      const written = await writeRows(db, account, rows, now)
      stats.inserted += written.inserted
      stats.updated += written.updated
      stats.skipped += written.skipped
      if (!key) {
        // The API sends no balance per movement: fill the missing ones on every sync.
        await backfillBalances(env, db, account, request, now)
        stats.accounts += 1
        accountDone = true
      }
    } catch (error) {
      const expired = error instanceof BankError && /EXPIRED|REVOKED|SESSION_DOES_NOT_EXIST/i.test(String(error.code))
      errors.push({ account: account.accountName, message: expired ? "La autorización del banco ha caducado: vuelve a conectar." : error.message })
      if (expired) await db.prepare(`UPDATE bank_sessions SET valid_until = ? WHERE id = ?`).bind(now, session.id).run()
      accountDone = true
      key = null
    }
  }

  if (!accountDone) {
    return json({ done: false, cursor: { sessionId: session.id, accountIndex: aIndex, key, dateFrom, stats, errors }, stats })
  }

  // Move to the next account, or close this session and move to the next one.
  if (aIndex + 1 < session.accounts.length) {
    return json({ done: false, cursor: { sessionId: session.id, accountIndex: aIndex + 1, key: null, dateFrom: null, stats, errors }, stats })
  }
  if (!errors.some((item) => session.accounts.some((acc) => acc.accountName === item.account))) {
    await db.prepare(`UPDATE bank_sessions SET last_sync_at = ? WHERE id = ?`).bind(now, session.id).run()
  }
  const next = sessions[sIndex + 1]
  if (next) {
    return json({ done: false, cursor: { sessionId: next.id, accountIndex: 0, key: null, dateFrom: null, stats, errors }, stats })
  }

  if (stats.inserted || stats.updated) await setUpdatedAt(db, now)
  return json({ done: true, ...(await loadAll(db)), syncStats: stats, syncErrors: errors, bankSessions: await loadBankSessions(db) })
}
