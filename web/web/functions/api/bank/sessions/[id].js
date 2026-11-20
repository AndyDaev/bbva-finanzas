import { json } from "../../../_lib/auth.js"
import { ensureSchema, loadBankSessions } from "../../../_lib/db.js"
import { deleteSession, isConfigured } from "../../../_lib/enablebanking.js"

/** Disconnects the bank: closes the consent at Enable Banking/BBVA and forgets the session. Data stays. */
export async function onRequestDelete(context) {
  const { env } = context
  const id = context.params.id
  if (!env.DB) return json({ error: "D1 no configurada" }, { status: 500 })
  if (!id) return json({ error: "Falta id" }, { status: 400 })
  await ensureSchema(env.DB)
  if (isConfigured(env)) {
    try {
      await deleteSession(env, id)
    } catch {
      // Already expired or revoked at the bank: nothing else to close.
    }
  }
  await env.DB.prepare(`DELETE FROM bank_sessions WHERE id = ?`).bind(id).run()
  return json({ bankSessions: await loadBankSessions(env.DB) })
}
