import { json } from "../../_lib/auth.js"
import { ensureSchema, loadAll, setUpdatedAt } from "../../_lib/db.js"

export async function onRequestDelete(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const id = context.params.id
  if (!id) return json({ error: "Falta id" }, { status: 400 })
  await ensureSchema(db)
  await db.prepare(`DELETE FROM tickets WHERE id = ?`).bind(id).run()
  await setUpdatedAt(db)
  return json(await loadAll(db))
}
