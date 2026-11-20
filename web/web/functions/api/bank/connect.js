import { json } from "../../_lib/auth.js"
import { ensureSchema, setMeta } from "../../_lib/db.js"
import { BankError, isConfigured, startAuthorization } from "../../_lib/enablebanking.js"

/** Starts the bank consent: returns the URL where the user logs in on BBVA's own page. */
export async function onRequestPost(context) {
  const { env, request } = context
  if (!env.DB) return json({ error: "D1 no configurada" }, { status: 500 })
  if (!isConfigured(env)) return json({ error: "Falta configurar EB_APP_ID y EB_PRIVATE_KEY en Cloudflare." }, { status: 400 })

  await ensureSchema(env.DB)
  const state = crypto.randomUUID()
  await setMeta(env.DB, "bank_state", JSON.stringify({ state, createdAt: Date.now() }))
  const redirectUrl = new URL("/api/bank/callback", request.url).toString()
  try {
    const auth = await startAuthorization(env, { state, redirectUrl, request })
    return json({ url: auth.url })
  } catch (error) {
    const message = error instanceof BankError ? error.message : "No se pudo contactar con Enable Banking."
    return json({ error: message }, { status: 502 })
  }
}
