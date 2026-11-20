import { ensureSchema, getMeta, loadBankSessions, setMeta } from "../../_lib/db.js"
import { createSession, deleteSession, maskIban } from "../../_lib/enablebanking.js"

const STATE_TTL_MS = 30 * 60 * 1000

function back(request, params) {
  const url = new URL("/", request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

/** The bank redirects here after the user approves (or cancels) the consent. */
export async function onRequestGet(context) {
  const { env, request } = context
  const url = new URL(request.url)
  if (url.searchParams.get("error")) {
    return back(request, { bank: "error", reason: url.searchParams.get("error_description") || url.searchParams.get("error") })
  }
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!env.DB || !code || !state) return back(request, { bank: "error", reason: "Respuesta incompleta del banco" })

  await ensureSchema(env.DB)
  let expected = null
  try {
    expected = JSON.parse((await getMeta(env.DB, "bank_state")) || "null")
  } catch {
    expected = null
  }
  await setMeta(env.DB, "bank_state", "null")
  if (!expected || expected.state !== state || Date.now() - expected.createdAt > STATE_TTL_MS) {
    return back(request, { bank: "error", reason: "La autorización caducó o no coincide. Vuelve a intentarlo." })
  }

  try {
    const session = await createSession(env, code, request)
    // Default account name: reuse the only existing account so earlier Excel imports are de-duplicated.
    // A renewal replaces earlier consents; keep the names the user gave each account.
    const previous = await loadBankSessions(env.DB)
    const previousNames = new Map(previous.flatMap((item) => item.accounts.map((acc) => [acc.label, acc.accountName])))
    const accounts = (session.accounts || []).map((item, index) => {
      const uid = typeof item === "string" ? item : item.uid
      const iban = typeof item === "string" ? "" : item.account_id?.iban || ""
      const label = maskIban(iban) || (typeof item === "string" ? "" : item.name) || `Cuenta ${index + 1}`
      const accountName = previousNames.get(label) || `BBVA ${iban ? iban.slice(-4) : index + 1}`
      return { uid, label, name: typeof item === "string" ? "" : item.name || "", accountName }
    }).filter((item) => item.uid)

    const validUntil = session.access?.valid_until || new Date(Date.now() + 90 * 86400000).toISOString()
    const last = previous.map((item) => item.lastSyncAt).filter(Boolean).sort().at(-1) || null
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM bank_sessions WHERE id != ?`).bind(session.session_id),
      env.DB
        .prepare(`INSERT INTO bank_sessions (id, valid_until, accounts_json, created_at, last_sync_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET valid_until = excluded.valid_until, accounts_json = excluded.accounts_json`)
        .bind(session.session_id, new Date(validUntil).toISOString(), JSON.stringify(accounts), new Date().toISOString(), last),
    ])
    for (const old of previous) {
      if (old.id !== session.session_id) await deleteSession(env, old.id).catch(() => null)
    }
    return back(request, { bank: "connected" })
  } catch (error) {
    return back(request, { bank: "error", reason: error instanceof Error ? error.message : "No se pudo crear la sesión" })
  }
}
