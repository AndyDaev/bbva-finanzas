import { json } from "../_lib/auth.js"
import { loadAll } from "../_lib/db.js"

export async function onRequestGet(context) {
  if (!context.env.DB) return json({ error: "D1 no configurada" }, { status: 500 })
  const data = await loadAll(context.env.DB)
  return json(data)
}
