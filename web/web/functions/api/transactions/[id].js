import { json } from "../../_lib/auth.js"
import { ensureSchema, mapTransaction, readJson, setUpdatedAt } from "../../_lib/db.js"

export async function onRequestPatch(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const id = context.params.id
  if (!id) return json({ error: "Falta id" }, { status: 400 })
  const body = await readJson(context.request)
  if (!body) return json({ error: "JSON inválido" }, { status: 400 })

  const category = String(body.category || "").trim()
  if (!category) return json({ error: "Falta categoría" }, { status: 400 })
  // locked: false hands the row back to automatic rules.
  const locked = body.locked === false ? 0 : 1

  await ensureSchema(db)
  const row = await db
    .prepare(`UPDATE transactions SET category = ?, category_locked = ?, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(category, locked, new Date().toISOString(), id)
    .first()

  if (!row) return json({ error: "Movimiento no encontrado" }, { status: 404 })
  const updatedAt = await setUpdatedAt(db)
  return json({ transaction: mapTransaction(row), updatedAt })
}
