import { json } from "../../_lib/auth.js"
import { ensureSchema, loadRules, setUpdatedAt } from "../../_lib/db.js"

export async function onRequestDelete(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const id = context.params.id
  if (!id) return json({ error: "Falta id" }, { status: 400 })
  await ensureSchema(db)
  await db.prepare(`DELETE FROM rules WHERE id = ?`).bind(id).run()
  const updatedAt = await setUpdatedAt(db)
  return json({ rules: await loadRules(db), updatedAt })
}
