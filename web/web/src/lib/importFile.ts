import * as XLSX from "xlsx"
import { categorize, withStableIds, type Transaction } from "./money"

export async function parseBankFile(file: File, account: string): Promise<Transaction[]> {
  const buffer = await file.arrayBuffer()
  const name = file.name.toLowerCase()
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || isZip(buffer)) {
    return parseWorkbook(buffer, account)
  }
  const text = new TextDecoder("utf-8").decode(buffer)
  return rowsToTransactions(csvToRows(text), account)
}

function isZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function parseWorkbook(buffer: ArrayBuffer, account: string) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, { header: 1, defval: "", raw: true })
  return rowsToTransactions(rows, account)
}

function csvToRows(text: string) {
  const cleaned = text.replace(/^\uFEFF/, "").trim()
  if (!cleaned) return []
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim())
  const separator = (lines[0]!.match(/;/g) || []).length >= (lines[0]!.match(/,/g) || []).length ? ";" : ","
  return lines.map((line) => splitRow(line, separator))
}

function splitRow(line: string, separator: string) {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else quoted = !quoted
    } else if (char === separator && !quoted) {
      cells.push(current.trim())
      current = ""
    } else current += char
  }
  cells.push(current.trim())
  return cells
}

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

function findColumn(header: string[], names: string[]) {
  const wanted = names.map(normalizeHeader)
  return header.findIndex((column) => wanted.some((name) => column === name || column.includes(name)))
}

function rowsToTransactions(rows: Array<Array<string | number | Date>>, account: string) {
  let headerIndex = -1
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const header = (rows[i] || []).map((cell) => normalizeHeader(String(cell ?? "")))
    if (findColumn(header, ["fecha", "bookingdate"]) >= 0 && findColumn(header, ["importe", "cantidad", "amount"]) >= 0) {
      headerIndex = i
      break
    }
  }
  if (headerIndex < 0) throw new Error("El extracto necesita columnas de fecha e importe.")

  const header = (rows[headerIndex] || []).map((cell) => normalizeHeader(String(cell ?? "")))
  const dateIndex = findColumn(header, ["fecha operacion", "fecha", "bookingdate"])
  const valueDateIndex = findColumn(header, ["f.valor", "fecha valor", "valor"])
  const conceptIndex = findColumn(header, ["concepto", "descripcion", "descripción"])
  const movementIndex = findColumn(header, ["movimiento"])
  const notesIndex = findColumn(header, ["observaciones"])
  const amountIndex = findColumn(header, ["importe", "cantidad", "amount"])
  const accountIndex = findColumn(header, ["cuenta", "iban", "alias"])
  const balanceIndex = findColumn(header, ["disponible", "saldo"])

  const transactions: Transaction[] = []
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index] || []
    if (!cells.some((cell) => String(cell ?? "").trim())) continue
    const date = parseDate(cells[dateIndex]!) || (valueDateIndex >= 0 ? parseDate(cells[valueDateIndex]!) : null)
    const amount = parseAmount(cells[amountIndex]!)
    if (!date || Number.isNaN(amount)) continue
    const parts = [conceptIndex, movementIndex, notesIndex]
      .filter((i) => i >= 0)
      .map((i) => String(cells[i] ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
    const text = [...new Set(parts)].join(" · ") || "Movimiento"
    const accountName =
      accountIndex >= 0 && String(cells[accountIndex] || "").trim()
        ? String(cells[accountIndex]).trim()
        : account
    const entry: Transaction = {
      date,
      amount,
      text,
      account: accountName,
      category: categorize(text, amount),
    }
    if (balanceIndex >= 0) {
      const balance = parseAmount(cells[balanceIndex]!)
      if (!Number.isNaN(balance)) entry.balanceAfter = balance
    }
    transactions.push(entry)
  }
  if (!transactions.length) throw new Error("No encontré movimientos en ese archivo.")
  return withStableIds(transactions)
}

function parseDate(value: string | number | Date) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${value.getFullYear()}-${month}-${day}`
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
  }
  const text = String(value || "").trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!local) return null
  const year = local[3]!.length === 2 ? `20${local[3]}` : local[3]!
  return `${year}-${local[2]!.padStart(2, "0")}-${local[1]!.padStart(2, "0")}`
}

function parseAmount(value: string | number | Date) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  let text = String(value || "").trim().replace(/\s/g, "").replace(/€/g, "")
  if (!text) return NaN
  let negative = false
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.endsWith("-") || text.startsWith("-")) {
    negative = true
    text = text.replace(/-/g, "")
  }
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".")
    else text = text.replace(/,/g, "")
  } else if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".")
  const amount = Number(text)
  if (Number.isNaN(amount)) return NaN
  return negative ? -Math.abs(amount) : amount
}
