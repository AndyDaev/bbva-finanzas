import { json } from "../../_lib/auth.js"
import { ensureSchema, loadBankSessions, mapBankSession, readJson } from "../../_lib/db.js"

/** Renames the app account a bank account syncs into (e.g. to match an earlier Excel import). */
export async function onRequestPatch(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const body = await readJson(context.request)
  const sessionId = String(body?.sessionId || "")
  const uid = String(body?.uid || "")
  const accountName = String(body?.accountName || "").trim().slice(0, 48)
  if (!sessionId || !uid || !accountName) return json({ error: "Datos incompletos" }, { status: 400 })

  await ensureSchema(db)
  const row = await db.prepare(`SELECT * FROM bank_sessions WHERE id = ?`).bind(sessionId).first()
  if (!row) return json({ error: "Conexión no encontrada" }, { status: 404 })
  const session = mapBankSession(row)
  const account = session.accounts.find((item) => item.uid === uid)
  if (!account) return json({ error: "Cuenta no encontrada" }, { status: 404 })

  const previous = account.accountName
  account.accountName = accountName
  await db.batch([
    db.prepare(`UPDATE bank_sessions SET accounts_json = ? WHERE id = ?`).bind(JSON.stringify(session.accounts), sessionId),
    // Bank-synced rows follow the rename; rows from Excel imports are left as they are.
    db.prepare(`UPDATE transactions SET account = ? WHERE account = ? AND id LIKE 'eb\\_%' ESCAPE '\\'`).bind(accountName, previous),
  ])
  return json({ bankSessions: await loadBankSessions(db) })
}
