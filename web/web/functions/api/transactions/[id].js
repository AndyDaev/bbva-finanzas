import { json } from "../../_lib/auth.js"
import { ensureSchema, loadAll, setUpdatedAt } from "../../_lib/db.js"

export async function onRequestPatch(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const id = context.params.id
  if (!id) return json({ error: "Falta id" }, { status: 400 })

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "JSON inválido" }, { status: 400 })
  }

  const category = String(body?.category || "").trim()
  if (!category) return json({ error: "Falta categoría" }, { status: 400 })

  await ensureSchema(db)
  const result = await db
    .prepare(
      `UPDATE transactions
       SET category = ?, category_locked = 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(category, new Date().toISOString(), id)
    .run()

  if (!result.meta?.changes) return json({ error: "Movimiento no encontrado" }, { status: 404 })
  await setUpdatedAt(db)
  return json(await loadAll(db))
}
