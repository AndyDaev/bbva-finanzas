import { flowType, type Analysis, type TicketLike } from "./analysis"
import { cleanName, merchantKey } from "./categorize"
import { buildCycleCalendar } from "./cycles"
import { labelMonth } from "./format"
import type { Transaction } from "./ids"

/**
 * CSV exports meant to be uploaded to ChatGPT (or opened in a spreadsheet): one file with
 * every movement of the selected period, one with a summary per month (pay cycle).
 * UTF-8 with BOM, comma separator, dot decimals, ISO dates.
 */

/** Long digit runs (card numbers, account numbers, IBAN digits) keep only their last 4 digits. */
export function maskNumbers(text: string) {
  return String(text || "").replace(/\d{6,}(\d{4})/g, "•••• $1")
}

function cell(value: string | number | null | undefined) {
  if (value == null) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : ""
  return `"${value.replace(/"/g, '""')}"`
}

function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  return `﻿${[header.map(cell), ...rows.map((row) => row.map(cell))].map((row) => row.join(",")).join("\r\n")}\r\n`
}

const RECURRING_LABEL = { subscription: "suscripción", bill: "recibo" } as const

export function buildMovementsCsv(analysis: Analysis, transactions: Transaction[], savingsAccounts: string[]) {
  const calendar = buildCycleCalendar(transactions)
  const { from, to } = analysis.cycle
  const recurring = new Map(analysis.recurring.map((item) => [item.key.split("#")[0]!, RECURRING_LABEL[item.kind]]))
  const rows = transactions
    .filter((tx) => tx.date >= from && tx.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account))
    .map((tx) => [
      tx.date,
      calendar.toSynthetic(tx.date).slice(0, 7),
      tx.account,
      cleanName(tx.text),
      maskNumbers(tx.text),
      tx.category,
      flowType(tx, savingsAccounts),
      tx.amount < 0 ? recurring.get(merchantKey(tx.text)) ?? "" : "",
      tx.amount,
      tx.balanceAfter ?? null,
    ])
  return toCsv(["fecha", "mes", "cuenta", "comercio", "descripcion", "categoria", "tipo", "recurrente", "importe", "saldo_despues"], rows)
}

export function buildMonthlyCsv(analysis: Analysis) {
  const { view } = analysis
  const periods = new Map(analysis.cycle.periods.map((period) => [period.label, period]))
  const ledger = new Map((analysis.savingsLedger?.byMonth || []).map((row) => [row.month, row]))
  const categories = view.categories.map((item) => item.name)
  const rows = view.months.map((month) => {
    const period = periods.get(month.month)
    const savings = ledger.get(month.month)
    // A rate over a near-empty income month is meaningless (−98.000 %): leave it blank.
    const rate = (part: number) => (month.income >= 100 ? Math.round((part / month.income) * 1000) / 10 : null)
    return [
      month.month,
      period?.from ?? `${month.month}-01`,
      period?.to ?? null,
      month.income,
      month.expense,
      month.savings,
      savings?.added ?? null,
      savings?.withdrawn ?? null,
      savings?.closing ?? null,
      rate(month.savings),
      rate(month.income - month.expense),
      ...categories.map((name) => month.categories[name] ?? 0),
    ]
  })
  return toCsv(
    ["mes", "desde", "hasta", "ingresos", "gastos", "ahorro_neto", "metiste_ahorro", "sacaste_ahorro", "saldo_ahorro_fin", "tasa_al_ahorro_pct", "tasa_sin_gastar_pct", ...categories.map((name) => `gasto_${name}`)],
    rows,
  )
}

/** One row per product of the receipts scanned in the period (empty when there are none). */
export function buildProductsCsv(analysis: Analysis, tickets: TicketLike[]) {
  const { from, to } = analysis.cycle
  const rows = tickets
    .filter((ticket) => !ticket.date || (ticket.date >= from && ticket.date <= to))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .flatMap((ticket) =>
      ticket.items.map((item) => [ticket.date || "", ticket.merchant, maskNumbers(item.name), item.category ?? "", item.quantity ?? 1, item.unitPrice ?? null, item.amount]),
    )
  if (!rows.length) return null
  return toCsv(["fecha", "tienda", "producto", "tipo", "cantidad", "precio_unidad", "importe"], rows)
}

/** Text to paste in ChatGPT together with the files. */
export function chatGptPrompt(analysis: Analysis, files: { movements: string, monthly: string, products?: string }) {
  const months = analysis.cycle.periods.map((period) => labelMonth(period.label)).join(", ")
  return [
    (files.products ? "Te adjunto tres CSV con" : "Te adjunto dos CSV con") + " mis finanzas personales (cuentas BBVA, datos reales del banco).",
    "",
    `1. ${files.movements}: un movimiento por fila. Columnas: fecha (día del banco), mes (mes de nómina), cuenta, comercio, descripcion (texto del banco), categoria, tipo, recurrente, importe (negativo = sale dinero), saldo_despues.`,
    `2. ${files.monthly}: resumen por mes con ingresos, gastos, ahorro neto, lo que metí y saqué de la cuenta de ahorro, su saldo y el gasto por categoría.`,
    ...(files.products ? [`3. ${files.products}: los productos de mis tickets de compra escaneados (tienda, producto, tipo, cantidad, precio por unidad e importe).`] : []),
    "",
    "Cómo leer los datos:",
    `- Los meses van de nómina a nómina, no del 1 al 31 (${months}).`,
    "- tipo «traspaso interno» son movimientos entre mis propias cuentas: no son gasto ni ingreso.",
    "- tipo «ahorro: entrada/salida» es lo que meto o saco de mi cuenta de ahorro.",
    "- Las devoluciones restan del gasto de su categoría; el Bizum se compensa (recibido − enviado).",
    "- recurrente indica si es una suscripción o un recibo detectado por su ritmo de cobro.",
    "",
    "Analiza:",
    "1. En qué se me va el dinero cada mes y qué ha cambiado entre meses.",
    "2. Gastos evitables o que se pueden reducir, con importes concretos.",
    "3. Suscripciones y recibos: cuáles revisar, cancelar o renegociar.",
    ...(files.products ? ["   Con los tickets: en qué tipo de productos gasto más en el súper y qué podría cambiar o comprar más barato."] : []),
    "4. Por qué ahorro más unos meses que otros y cuándo tiro de la cuenta de ahorro.",
    "5. Un plan mensual realista: cuánto ahorrar el día de cobro y un tope semanal de gasto variable.",
    "Responde en español, con cifras y tablas cuando ayuden.",
  ].join("\n")
}
