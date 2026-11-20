import { json } from "../_lib/auth.js"
import { ensureSchema, loadRules, readJson, setUpdatedAt } from "../_lib/db.js"

export async function onRequestGet(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  await ensureSchema(db)
  return json({ rules: await loadRules(db) })
}

/** Create or update one categorization rule. */
export async function onRequestPut(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const body = await readJson(context.request)
  const rule = body?.rule
  const pattern = String(rule?.pattern || "").trim()
  const category = String(rule?.category || "").trim()
  if (!rule?.id || !pattern || !category) return json({ error: "Regla incompleta" }, { status: 400 })
  if (pattern.length > 200) return json({ error: "Patrón demasiado largo" }, { status: 400 })
  const matchType = rule.matchType === "regex" ? "regex" : "contains"
  if (matchType === "regex") {
    try {
      new RegExp(pattern, "i")
    } catch {
      return json({ error: "Expresión regular no válida" }, { status: 400 })
    }
  }
  const direction = rule.direction === "in" || rule.direction === "out" ? rule.direction : null

  await ensureSchema(db)
  await db
    .prepare(
      `INSERT INTO rules (id, pattern, match_type, category, direction, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         pattern = excluded.pattern,
         match_type = excluded.match_type,
         category = excluded.category,
         direction = excluded.direction,
         priority = excluded.priority`,
    )
    .bind(String(rule.id), pattern, matchType, category, direction, Number(rule.priority) || 0, new Date().toISOString())
    .run()
  const updatedAt = await setUpdatedAt(db)
  return json({ rules: await loadRules(db), updatedAt })
}
