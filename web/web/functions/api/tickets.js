import { json } from "../_lib/auth.js"
import { ensureSchema, loadTickets, readJson, setUpdatedAt } from "../_lib/db.js"

export async function onRequestPut(context) {
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })
  const body = await readJson(context.request)
  if (!body) return json({ error: "JSON inválido" }, { status: 400 })

  const ticket = body.ticket
  if (!ticket?.id || !ticket.merchant) return json({ error: "Ticket incompleto" }, { status: 400 })

  await ensureSchema(db)
  await db
    .prepare(
      `INSERT INTO tickets (id, merchant, date, total, items_json, transaction_id, account, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         merchant = excluded.merchant,
         date = excluded.date,
         total = excluded.total,
         items_json = excluded.items_json,
         transaction_id = excluded.transaction_id,
         account = excluded.account`,
    )
    .bind(
      String(ticket.id),
      String(ticket.merchant),
      ticket.date || null,
      Number(ticket.total) || 0,
      JSON.stringify(Array.isArray(ticket.items) ? ticket.items : []),
      ticket.transactionId || null,
      ticket.account || null,
      ticket.createdAt || new Date().toISOString(),
    )
    .run()

  const updatedAt = await setUpdatedAt(db)
  return json({ tickets: await loadTickets(db), updatedAt })
}
