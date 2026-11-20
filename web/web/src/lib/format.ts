export const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" })
export const euroWhole = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})

const longMonth = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" })
const shortMonthFmt = new Intl.DateTimeFormat("es-ES", { month: "short" })
const shortMonthYearFmt = new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit" })

export function labelMonth(key: string) {
  return longMonth.format(new Date(`${key}-01T00:00:00`))
}

export function shortMonth(key: string) {
  return shortMonthFmt.format(new Date(`${key}-01T00:00:00`))
}

export function shortMonthYear(key: string) {
  return shortMonthYearFmt.format(new Date(`${key}-01T00:00:00`))
}

export function formatPct(value: number) {
  const rounded = Math.round(value * 100)
  return `${rounded > 0 ? "+" : ""}${rounded} %`
}

export function formatDay(iso: string) {
  const [year, month, day] = iso.split("-")
  return `${day}/${month}/${year}`
}

export function isoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

export function monthKey(iso: string) {
  return iso.slice(0, 7)
}

export function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** Adds `delta` months to an ISO date, clamping the day to the target month length. */
export function addMonths(iso: string, delta: number) {
  const [y, m, d] = iso.split("-").map(Number)
  const target = new Date(y!, (m! - 1) + delta, 1)
  const day = Math.min(d!, daysInMonth(target.getFullYear(), target.getMonth()))
  return isoDate(new Date(target.getFullYear(), target.getMonth(), day))
}

export function addDays(iso: string, delta: number) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + delta)
  return isoDate(date)
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000)
}

/** Lower-case, accent-free, punctuation collapsed to spaces. */
export function normalizeText(text: string) {
  return String(text || "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
}
