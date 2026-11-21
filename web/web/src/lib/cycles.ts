import { addDays, addMonths, daysBetween, daysInMonth, monthKey } from "./format"
import type { Transaction } from "./ids"

/**
 * Pay cycles: for someone paid around the turn of the month, a "month" runs from one payday
 * to the day before the next one. October = 30/09 → 01/11 when the payrolls land on 30/09
 * and 02/11. Income, spending and savings then belong to the same block, and because the
 * boundaries are real dates, balances still reconcile with the bank.
 *
 * Month-based analysis runs on a synthetic calendar: each movement gets the date
 * `<cycle month>-<day of cycle>` (keeping its bank date in `realDate`), so all the existing
 * month logic works unchanged.
 */
export type PayCycle = {
  /** Month the cycle stands for, YYYY-MM. */
  label: string
  /** First real day (the payday). */
  from: string
  /** Last real day (the day before the next payday), or null for the open, current cycle. */
  to: string | null
}

export type CycleCalendar = {
  active: boolean
  cycles: PayCycle[]
  /** Real bank date → synthetic cycle date. */
  toSynthetic: (date: string) => string
  /** Synthetic date → real date (start of a cycle for day 01). */
  toReal: (date: string) => string
  /** Real date ranges of the cycles between two synthetic dates. */
  periods: (from: string, to: string) => Array<{ label: string, from: string, to: string }>
}

const MAX_CYCLE_DAYS = 45

const identity: CycleCalendar = {
  active: false,
  cycles: [],
  toSynthetic: (date) => date,
  toReal: (date) => date,
  periods: (from, to) => {
    const out: Array<{ label: string, from: string, to: string }> = []
    for (let cursor = monthKey(from); cursor <= monthKey(to); cursor = monthKey(addMonths(`${cursor}-01`, 1))) {
      const [y, m] = cursor.split("-").map(Number)
      const start = `${cursor}-01`
      const end = `${cursor}-${String(daysInMonth(y!, m! - 1)).padStart(2, "0")}`
      out.push({ label: cursor, from: start < from ? from : start, to: end > to ? to : end })
    }
    return out
  },
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Paydays = days with a payroll at least half the usual size (split payrolls add up per day). */
export function detectPaydays(transactions: Transaction[]) {
  const byDay = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.amount > 0 && tx.category === "Nómina") byDay.set(tx.date, (byDay.get(tx.date) || 0) + tx.amount)
  }
  if (!byDay.size) return []
  const typical = median([...byDay.values()])
  return [...byDay.entries()].filter(([, total]) => total >= typical * 0.5).map(([day]) => day).sort()
}

export function buildCycleCalendar(transactions: Transaction[]): CycleCalendar {
  const paydays = detectPaydays(transactions)
  const dayOf = (date: string) => Number(date.slice(8, 10))
  const turnOfMonth = paydays.filter((date) => dayOf(date) >= 25 || dayOf(date) <= 5).length
  if (paydays.length < 2 || turnOfMonth / paydays.length < 0.6) return identity

  // Late-month payday → next month's cycle; early-month payday → its own month.
  const labelOf = (payday: string) => (dayOf(payday) >= 15 ? monthKey(addMonths(`${monthKey(payday)}-01`, 1)) : monthKey(payday))
  const cycles: PayCycle[] = []
  paydays.forEach((payday, i) => {
    const label = labelOf(payday)
    const next = paydays[i + 1]
    // A missing payroll must not swallow several months: cap the cycle length.
    const cap = addDays(payday, MAX_CYCLE_DAYS - 1)
    const end = next ? addDays(next, -1) : null
    const to = end && end > cap ? cap : end
    const previous = cycles[cycles.length - 1]
    if (previous && previous.label === label) previous.to = to
    else cycles.push({ label, from: payday, to })
  })

  const findByDate = (date: string) => cycles.find((cycle) => date >= cycle.from && (cycle.to == null || date <= cycle.to))
  const findByLabel = (label: string) => cycles.find((cycle) => cycle.label === label)

  const toSynthetic = (date: string) => {
    const cycle = findByDate(date)
    if (!cycle) return date
    const [y, m] = cycle.label.split("-").map(Number)
    const day = Math.min(daysBetween(cycle.from, date) + 1, daysInMonth(y!, m! - 1))
    return `${cycle.label}-${String(day).padStart(2, "0")}`
  }

  const toReal = (date: string) => {
    const cycle = findByLabel(monthKey(date))
    if (!cycle) return date
    const [y, m] = cycle.label.split("-").map(Number)
    // Cycles can be longer than the month: its last synthetic day stands for the whole tail.
    if (cycle.to && Number(date.slice(8, 10)) >= daysInMonth(y!, m! - 1)) return cycle.to
    const real = addDays(cycle.from, Number(date.slice(8, 10)) - 1)
    return cycle.to && real > cycle.to ? cycle.to : real
  }

  const periods = (from: string, to: string) => {
    const out: Array<{ label: string, from: string, to: string }> = []
    for (let cursor = monthKey(from); cursor <= monthKey(to); cursor = monthKey(addMonths(`${cursor}-01`, 1))) {
      const cycle = findByLabel(cursor)
      if (cycle) {
        const start = cursor === monthKey(from) ? toReal(from) : cycle.from
        const end = cursor === monthKey(to) ? toReal(to) : cycle.to ?? toReal(to)
        out.push({ label: cursor, from: start, to: end })
      } else {
        // A calendar month without its own cycle stops where a neighbouring cycle takes over.
        let start = cursor === monthKey(from) ? from : `${cursor}-01`
        let end = cursor === monthKey(to) ? to : addDays(addMonths(`${cursor}-01`, 1), -1)
        for (const cycle of cycles) {
          if (cycle.from > start && cycle.from <= end) end = addDays(cycle.from, -1)
          if (cycle.to && cycle.to >= start && cycle.from <= start) start = addDays(cycle.to, 1)
        }
        if (start <= end) out.push(...identity.periods(start, end))
      }
    }
    return out
  }

  return { active: true, cycles, toSynthetic, toReal, periods }
}
