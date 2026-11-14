import { json } from "../_lib/auth.js"
import { ensureSchema, loadAll, setUpdatedAt } from "../_lib/db.js"

export async function onRequestPut(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })

  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "JSON inválido" }, { status: 400 })
  }

  const budgets = Array.isArray(body?.budgets) ? body.budgets : []
  await ensureSchema(db)
  const statements = [db.prepare(`DELETE FROM budgets`)]
  for (const item of budgets) {
    const category = String(item.category || "").trim()
    const limit = Number(item.monthlyLimit)
    if (!category || !(limit > 0)) continue
    statements.push(
      db.prepare(`INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)`).bind(category, limit),
    )
  }
  await db.batch(statements)
  await setUpdatedAt(db)
  return json(await loadAll(db))
}
