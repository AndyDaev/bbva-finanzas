import { json } from "../../_lib/auth.js"
import { ensureSchema, loadBankSessions } from "../../_lib/db.js"
import { isConfigured } from "../../_lib/enablebanking.js"

export async function onRequestGet(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  await ensureSchema(db)
  const now = new Date().toISOString()
  const sessions = (await loadBankSessions(db)).map((session) => ({ ...session, expired: session.validUntil <= now }))
  return json({ configured: isConfigured(context.env), sessions })
}
