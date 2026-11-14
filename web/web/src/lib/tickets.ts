import Tesseract from "tesseract.js"
import type { Transaction } from "./money"

export type TicketItem = { name: string, amount: number }

export type TicketDraft = {
  merchant: string
  date: string | null
  total: number
  items: TicketItem[]
  rawText: string
}

export async function scanTicketImage(file: File): Promise<TicketDraft> {
  const result = await Tesseract.recognize(file, "spa+eng", {
    logger: () => undefined,
  })
  return parseTicketText(result.data.text || "")
}

export function parseTicketText(text: string): TicketDraft {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  const items: TicketItem[] = []
  let total = 0
  let date: string | null = null
  let merchant = lines[0]?.slice(0, 48) || "Ticket"

  for (const line of lines) {
    const dateMatch = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
    if (dateMatch && !date) {
      const year = dateMatch[3]!.length === 2 ? `20${dateMatch[3]}` : dateMatch[3]!
      date = `${year}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[1]!.padStart(2, "0")}`
    }

    if (/total|importe|pagado|a pagar/i.test(line)) {
      const amount = extractAmount(line)
      if (amount !== null) total = Math.abs(amount)
      continue
    }

    if (/iva|nif|cif|tarjeta|visa|auth|cambio|efectivo|gracias|ticket|factura/i.test(line)) continue

    const amount = extractAmount(line)
    if (amount === null || Math.abs(amount) < 0.01) continue
    const name = line
      .replace(/[-+]?\d+[.,]\d{2}\s*€?$/i, "")
      .replace(/€/g, "")
      .trim()
    if (name.length < 2) continue
    items.push({ name: name.slice(0, 64), amount: Math.abs(amount) })
  }

  if (!total && items.length) {
    total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100
  }

  if (/total|ticket|factura|recibo/i.test(merchant) && lines[1]) {
    merchant = lines[1].slice(0, 48)
  }

  return { merchant, date, total, items: items.slice(0, 40), rawText: text }
}

function extractAmount(line: string) {
  const match = line.match(/(-?\d+[.,]\d{2})\s*€?$/)
  if (!match) return null
  return Number(match[1]!.replace(",", "."))
}

export function matchTransactions(draft: TicketDraft, transactions: Transaction[]) {
  return transactions
    .filter((tx) => tx.amount < 0)
    .map((tx) => {
      const spent = Math.abs(tx.amount)
      let score = 0
      if (draft.total > 0 && Math.abs(spent - draft.total) < 0.03) score += 5
      else if (draft.total > 0 && Math.abs(spent - draft.total) / draft.total < 0.05) score += 3
      if (draft.date && tx.date === draft.date) score += 3
      else if (draft.date && Math.abs(Date.parse(tx.date) - Date.parse(draft.date)) <= 2 * 86400000) score += 1
      const merchant = draft.merchant.toLocaleLowerCase("es")
      const text = tx.text.toLocaleLowerCase("es")
      if (merchant && text.includes(merchant.slice(0, 8))) score += 3
      return { tx, score }
    })
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.tx)
}
