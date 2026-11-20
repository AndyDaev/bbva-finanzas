import {
  BIZUM_NET,
  categorize,
  cleanName,
  describeMerchant,
  isFixedCategory,
  merchantKey,
  sortRules,
  type UserRule,
} from "./categorize"
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  euro,
  formatDay,
  formatPct,
  isoDate,
  labelMonth,
  monthKey,
  shortMonth,
} from "./format"
import { accountsFromTransactions, endOfDayBalance, type Budget, type Transaction } from "./ids"

// ───────────────────────────── Types ─────────────────────────────

export type MonthPoint = {
  index: number
  month: string
  label: string
  income: number
  expense: number
  savings: number
  savingsRate: number | null
  categories: Record<string, number>
}

export type NamedAmount = {
  name: string
  amount: number
  share: number
  count?: number
  category?: string
  date?: string
  kind?: string
}

export type TrendDelta = {
  name: string
  previous: number
  current: number
  delta: number
  deltaPct: number | null
  kind: "category" | "merchant" | "total"
}

export type MonthCompare = {
  previousMonth: string
  currentMonth: string
  previousLabel: string
  currentLabel: string
  totalDeltaPct: number | null
  totalDelta: number
  categories: TrendDelta[]
  merchants: TrendDelta[]
  badges: string[]
}

export type BudgetStatus = {
  category: string
  limit: number
  spent: number
  remaining: number
  ratio: number
  state: "ok" | "warn" | "over"
  paceOverage: number | null
  paceNote: string | null
}

export type RecurringCharge = {
  key: string
  name: string
  category: string
  /** Latest monthly amount (current price). */
  amount: number
  /** Median monthly amount before the latest charge. */
  previousAmount: number
  annual: number
  months: number
  lastDate: string
  nextDate: string
  chargedThisMonth: boolean
  status: "stable" | "increase" | "new"
}

export type Advice = {
  summary: string[]
  actions: string[]
}

export type TicketLike = {
  merchant: string
  date?: string | null
  total: number
  items: Array<{ name: string, amount: number }>
  transactionId?: string | null
}

export type View = {
  income: number
  expense: number
  toSavings: number
  net: number
  unassigned: number
  savingsRate: number
  avgExpense: number
  avgTicket: number
  purchaseCount: number
  fixedSpend: number
  flexibleSpend: number
  bizumNet: number
  months: MonthPoint[]
  categories: NamedAmount[]
  incomeSources: NamedAmount[]
  merchants: NamedAmount[]
  biggest: NamedAmount[]
  ticketItems: NamedAmount[]
  monthCompare: MonthCompare | null
  vsAverageBadge: string | null
}

export type Delta = { previous: number, delta: number, pct: number | null }

export type PeriodCompare = {
  from: string
  to: string
  label: string
  income: Delta
  expense: Delta
  toSavings: Delta
  unassigned: Delta
  /** Difference in percentage points (0.05 = +5 pts). */
  savingsRate: Delta
  categories: TrendDelta[]
}

export type Forecast = {
  month: string
  label: string
  spent: number
  projected: number
  pending: number
  average: number | null
  daysElapsed: number
  daysInMonth: number
}

export type BalanceSeries = {
  accounts: string[]
  points: Array<{ index: number, month: string, label: string, values: number[], total: number }>
}

export type Cushion = { balance: number, avgExpense: number, months: number }

export type Analysis = {
  view: View
  compare: PeriodCompare | null
  budgets: BudgetStatus[]
  recurring: RecurringCharge[]
  forecast: Forecast | null
  balances: BalanceSeries
  cushion: Cushion | null
  insights: string[]
  trendBadges: string[]
  advice: Advice
}

// ─────────────────────── Category resolution ───────────────────────

export function resolveCategory(tx: Transaction, sortedRules: UserRule[] = []) {
  if (tx.categoryLocked && tx.category) return tx.category
  return categorize(tx.text, tx.amount, sortedRules)
}

/** Applies locked categories > user rules > built-in rules. Unchanged rows keep identity. */
export function normalizeTransactions(transactions: Transaction[], rules: UserRule[] = []) {
  const sorted = sortRules(rules)
  return transactions.map((tx) => {
    const category = resolveCategory(tx, sorted)
    return category === tx.category ? tx : { ...tx, category }
  })
}

// ─────────────────────────── Aggregation ───────────────────────────

type Kind = "skip" | "savings" | "bizum" | "refund" | "income" | "expense"

function classify(tx: Transaction): Kind {
  const c = tx.category
  if (c === "Traspaso interno") return "skip"
  if (c === "Ahorro") return "savings"
  if (c === "Bizum recibido" || c === "Bizum enviado") return "bizum"
  if (tx.amount > 0 && c === "Devolución") return "refund"
  return tx.amount >= 0 ? "income" : "expense"
}

type MerchantAgg = { name: string, category: string, amount: number, count: number }

type MonthAgg = {
  income: number
  expense: number
  savings: number
  bizumIn: number
  bizumOut: number
  purchases: number
  purchaseSpend: number
  expenseByCat: Map<string, number>
  incomeByCat: Map<string, number>
  merchants: Map<string, MerchantAgg>
}

type Aggregate = {
  months: Map<string, MonthAgg>
  expenses: Transaction[]
}

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) || 0) + value)
}

function sum(values: Iterable<number>) {
  let total = 0
  for (const value of values) total += value
  return total
}

function emptyMonth(): MonthAgg {
  return {
    income: 0,
    expense: 0,
    savings: 0,
    bizumIn: 0,
    bizumOut: 0,
    purchases: 0,
    purchaseSpend: 0,
    expenseByCat: new Map(),
    incomeByCat: new Map(),
    merchants: new Map(),
  }
}

/**
 * One pass over (already normalized) transactions. Refunds are netted against
 * their category and merchant in the month they arrive; Bizum is netted per month.
 */
function aggregate(transactions: Transaction[], tickets: TicketLike[], sortedRules: UserRule[]): Aggregate {
  const months = new Map<string, MonthAgg>()
  const expenses: Transaction[] = []
  const linked = new Map<string, TicketLike>()
  for (const ticket of tickets) if (ticket.transactionId) linked.set(ticket.transactionId, ticket)

  const bucket = (month: string) => {
    let agg = months.get(month)
    if (!agg) {
      agg = emptyMonth()
      months.set(month, agg)
    }
    return agg
  }

  for (const tx of transactions) {
    const kind = classify(tx)
    if (kind === "skip") continue
    const agg = bucket(monthKey(tx.date))

    if (kind === "savings") {
      agg.savings -= tx.amount
      continue
    }
    if (kind === "bizum") {
      if (tx.amount > 0) agg.bizumIn += tx.amount
      else agg.bizumOut -= tx.amount
      continue
    }
    if (kind === "income") {
      add(agg.incomeByCat, tx.category, tx.amount)
      continue
    }

    const label = (tx.id && linked.get(tx.id)?.merchant?.trim()) || cleanName(tx.text)
    const key = merchantKey(label) || merchantKey(tx.text)

    if (kind === "refund") {
      const category = categorize(tx.text, -tx.amount, sortedRules)
      add(agg.expenseByCat, category, -tx.amount)
      const merchant = key ? agg.merchants.get(key) : undefined
      if (merchant) merchant.amount -= tx.amount
      continue
    }

    const spent = -tx.amount
    add(agg.expenseByCat, tx.category, spent)
    agg.purchases += 1
    agg.purchaseSpend += spent
    expenses.push(tx)
    if (!key) continue
    const merchant = agg.merchants.get(key) || { name: label, category: tx.category, amount: 0, count: 0 }
    merchant.amount += spent
    merchant.count += 1
    agg.merchants.set(key, merchant)
  }

  for (const agg of months.values()) {
    const bizum = agg.bizumIn - agg.bizumOut
    if (bizum < -0.004) add(agg.expenseByCat, BIZUM_NET, -bizum)
    else if (bizum > 0.004) add(agg.incomeByCat, BIZUM_NET, bizum)
    agg.expense = Math.max(0, sum(agg.expenseByCat.values()))
    agg.income = sum(agg.incomeByCat.values())
  }

  return { months, expenses }
}

function clampedEntries(map: Map<string, number>) {
  return [...map.entries()].map(([name, value]) => [name, Math.max(0, value)] as const).filter(([, value]) => value > 0.009)
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function pctDelta(current: number, previous: number) {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}

function monthDiff(a: string, b: string) {
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  return (by! - ay!) * 12 + (bm! - am!)
}

function completeMonths(months: Map<string, MonthAgg>, todayIso: string) {
  const current = monthKey(todayIso)
  return [...months.entries()].filter(([month]) => month < current).sort(([a], [b]) => a.localeCompare(b))
}

const MIN_TREND_EUR = 15

// ──────────────────────────── Period view ────────────────────────────

export function buildView(
  transactions: Transaction[],
  tickets: TicketLike[] = [],
  options: { today?: string, rules?: UserRule[], from?: string, to?: string } = {},
): View {
  const todayIso = options.today || isoDate(new Date())
  const sortedRules = sortRules(options.rules || [])
  const { months: monthMap, expenses } = aggregate(transactions, tickets, sortedRules)

  const byCategory = new Map<string, number>()
  const byIncome = new Map<string, number>()
  const byMerchant = new Map<string, MerchantAgg>()
  let toSavings = 0
  let purchaseCount = 0
  let purchaseSpend = 0
  let bizumNet = 0
  for (const agg of monthMap.values()) {
    for (const [name, value] of agg.expenseByCat) add(byCategory, name, value)
    for (const [name, value] of agg.incomeByCat) add(byIncome, name, value)
    for (const [key, merchant] of agg.merchants) {
      const current = byMerchant.get(key) || { ...merchant, amount: 0, count: 0 }
      current.amount += merchant.amount
      current.count += merchant.count
      byMerchant.set(key, current)
    }
    toSavings += agg.savings
    purchaseCount += agg.purchases
    purchaseSpend += agg.purchaseSpend
    bizumNet += agg.bizumIn - agg.bizumOut
  }

  const categoryEntries = clampedEntries(byCategory)
  const expense = sum(categoryEntries.map(([, value]) => value))
  const income = sum(byIncome.values())
  const share = (amount: number, total: number) => (total > 0 ? amount / total : 0)

  let fixedSpend = 0
  for (const [name, value] of categoryEntries) if (isFixedCategory(name)) fixedSpend += value

  const categories = categoryEntries
    .map(([name, amount]) => ({ name, amount, share: share(amount, expense) }))
    .sort((a, b) => b.amount - a.amount)
  const incomeSources = [...byIncome.entries()]
    .map(([name, amount]) => ({ name, amount, share: share(amount, income) }))
    .filter((item) => item.amount > 0.009)
    .sort((a, b) => b.amount - a.amount)
  const merchants = [...byMerchant.values()]
    .filter((item) => item.amount > 0.009)
    .map((item) => ({
      name: item.name,
      category: item.category,
      amount: item.amount,
      count: item.count,
      share: share(item.amount, expense),
      kind: describeMerchant(item.name, item.category),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
  const biggest = [...expenses]
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 8)
    .map((tx) => ({
      name: cleanName(tx.text),
      amount: Math.abs(tx.amount),
      share: share(Math.abs(tx.amount), expense),
      category: tx.category,
      date: tx.date,
      kind: describeMerchant(cleanName(tx.text), tx.category),
    }))

  const byTicketItem = new Map<string, { name: string, amount: number, count: number }>()
  for (const ticket of tickets) {
    if (ticket.date && ((options.from && ticket.date < options.from) || (options.to && ticket.date > options.to))) continue
    for (const item of ticket.items || []) {
      const name = String(item.name || "").trim()
      if (!name || !(item.amount > 0)) continue
      const key = name.toLocaleLowerCase("es")
      const current = byTicketItem.get(key) || { name, amount: 0, count: 0 }
      current.amount += item.amount
      current.count += 1
      byTicketItem.set(key, current)
    }
  }
  const ticketItems = [...byTicketItem.values()]
    .map((item) => ({ ...item, share: share(item.amount, expense || item.amount), kind: "Artículo de ticket" }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const months: MonthPoint[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, agg], index) => ({
      index,
      month,
      label: shortMonth(month),
      income: agg.income,
      expense: agg.expense,
      savings: agg.savings,
      savingsRate: agg.income > 0 ? (agg.income - agg.expense) / agg.income : null,
      categories: Object.fromEntries(clampedEntries(agg.expenseByCat)),
    }))

  const complete = completeMonths(monthMap, todayIso)
  const avgExpense = complete.length ? sum(complete.map(([, agg]) => agg.expense)) / complete.length : expense
  const net = income - expense

  return {
    income,
    expense,
    toSavings,
    net,
    unassigned: net - toSavings,
    savingsRate: income > 0 ? net / income : 0,
    avgExpense,
    avgTicket: purchaseCount ? purchaseSpend / purchaseCount : 0,
    purchaseCount,
    fixedSpend,
    flexibleSpend: expense - fixedSpend,
    bizumNet,
    months,
    categories,
    incomeSources,
    merchants,
    biggest,
    ticketItems,
    monthCompare: buildMonthCompare(monthMap, todayIso),
    vsAverageBadge: buildVsAverageBadge(complete),
  }
}

function buildMonthCompare(months: Map<string, MonthAgg>, todayIso: string): MonthCompare | null {
  const complete = completeMonths(months, todayIso)
  if (complete.length < 2) return null
  const [currentMonth, current] = complete[complete.length - 1]!
  const [previousMonth, previous] = complete[complete.length - 2]!
  const totalDelta = current.expense - previous.expense
  const totalDeltaPct = pctDelta(current.expense, previous.expense)

  const categories = diffMaps(new Map(clampedEntries(previous.expenseByCat)), new Map(clampedEntries(current.expenseByCat)), "category")
  const merchantAmounts = (agg: MonthAgg) => new Map([...agg.merchants.values()].map((item) => [item.name, Math.max(0, item.amount)]))
  const merchants = diffMaps(merchantAmounts(previous), merchantAmounts(current), "merchant")

  const badges: string[] = []
  if (totalDeltaPct != null && Math.abs(totalDeltaPct) >= 0.05) badges.push(`Gasto ${formatPct(totalDeltaPct)} vs mes anterior`)
  for (const item of categories) {
    if (item.deltaPct != null) badges.push(`${item.name} ${formatPct(item.deltaPct)} vs mes anterior`)
    else if (item.delta > 0) badges.push(`${item.name} +${euro.format(item.delta)}`)
  }
  for (const item of merchants.slice(0, 2)) {
    badges.push(`${item.name} ${item.delta >= 0 ? "+" : "−"}${euro.format(Math.abs(item.delta))}`)
  }

  return {
    previousMonth,
    currentMonth,
    previousLabel: labelMonth(previousMonth),
    currentLabel: labelMonth(currentMonth),
    totalDeltaPct,
    totalDelta,
    categories,
    merchants,
    badges,
  }
}

function diffMaps(prev: Map<string, number>, curr: Map<string, number>, kind: TrendDelta["kind"], limit = 3): TrendDelta[] {
  return [...new Set([...prev.keys(), ...curr.keys()])]
    .map((name) => {
      const previous = prev.get(name) || 0
      const current = curr.get(name) || 0
      return { name, previous, current, delta: current - previous, deltaPct: pctDelta(current, previous), kind }
    })
    .filter((item) => Math.abs(item.delta) >= MIN_TREND_EUR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
}

function buildVsAverageBadge(complete: Array<[string, MonthAgg]>) {
  if (complete.length < 2) return null
  const [lastMonth, last] = complete[complete.length - 1]!
  const previous = sum(complete.slice(0, -1).map(([, agg]) => agg.expense)) / (complete.length - 1)
  if (!(previous > 0)) return null
  const delta = (last.expense - previous) / previous
  const label = labelMonth(lastMonth)
  if (delta > 0.08) return `En ${label} gastaste un ${Math.round(delta * 100)} % más que tu media`
  if (delta < -0.08) return `En ${label} gastaste un ${Math.round(Math.abs(delta) * 100)} % menos que tu media`
  return `El gasto de ${label} estuvo en línea con tu media`
}

// ───────────────────────── Period comparison ─────────────────────────

/**
 * Previous comparable range. Month-aligned ranges (starting on day 1) shift by
 * whole months keeping the same day offset (1–20 nov → 1–20 oct); others shift by length.
 */
export function previousRange(from: string, to: string) {
  if (from.endsWith("-01")) {
    const months = monthDiff(monthKey(from), monthKey(to)) + 1
    return { from: addMonths(from, -months), to: addMonths(to, -months) }
  }
  const length = daysBetween(from, to)
  const prevTo = addDays(from, -1)
  return { from: addDays(prevTo, -length), to: prevTo }
}

function delta(current: number, previous: number): Delta {
  return { previous, delta: current - previous, pct: pctDelta(current, previous) }
}

export function comparePeriods(current: View, previous: View, range: { from: string, to: string }): PeriodCompare | null {
  if (!previous.months.length) return null
  return {
    ...range,
    label: `${formatDay(range.from)} – ${formatDay(range.to)}`,
    income: delta(current.income, previous.income),
    expense: delta(current.expense, previous.expense),
    toSavings: delta(current.toSavings, previous.toSavings),
    unassigned: { previous: previous.unassigned, delta: current.unassigned - previous.unassigned, pct: null },
    savingsRate: { previous: previous.savingsRate, delta: current.savingsRate - previous.savingsRate, pct: null },
    categories: diffMaps(
      new Map(previous.categories.map((item) => [item.name, item.amount])),
      new Map(current.categories.map((item) => [item.name, item.amount])),
      "category",
      5,
    ),
  }
}

// ──────────────────────────── Budgets ────────────────────────────

function buildBudgetStatuses(budgets: Budget[], months: Map<string, MonthAgg>, todayIso: string): BudgetStatus[] {
  if (!budgets.length) return []
  const today = new Date(`${todayIso}T12:00:00`)
  const currentMonth = monthKey(todayIso)
  const targetMonth = months.has(currentMonth) ? currentMonth : [...months.keys()].sort().at(-1) || currentMonth
  const spentByCat = new Map(clampedEntries(months.get(targetMonth)?.expenseByCat || new Map()))
  const [year, month] = targetMonth.split("-").map(Number)
  const dim = daysInMonth(year!, (month || 1) - 1)
  const isCurrent = targetMonth === currentMonth
  const isPartial = isCurrent && today.getDate() < dim
  const daysElapsed = isCurrent ? Math.max(1, today.getDate()) : dim

  return budgets
    .map((budget) => {
      const spent = spentByCat.get(budget.category) || 0
      const remaining = budget.monthlyLimit - spent
      const ratio = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : 0
      let state: BudgetStatus["state"] = ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok"
      let paceOverage: number | null = null
      let paceNote: string | null = null
      if (isPartial && budget.monthlyLimit > 0 && state !== "over") {
        const projected = (spent / daysElapsed) * dim
        if (projected > budget.monthlyLimit) {
          paceOverage = projected - budget.monthlyLimit
          paceNote = `A este ritmo te pasas ~${euro.format(paceOverage)} en ${budget.category}`
          if (state === "ok") state = "warn"
        }
      }
      return { category: budget.category, limit: budget.monthlyLimit, spent, remaining, ratio, state, paceOverage, paceNote }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

// ─────────────────────── Recurring / subscriptions ───────────────────────

export function detectRecurring(transactions: Transaction[], todayIso: string): RecurringCharge[] {
  const byKey = new Map<string, { name: string, category: string, months: Map<string, { amount: number, count: number, lastDate: string }> }>()
  let latest = ""
  for (const tx of transactions) {
    if (tx.date > latest) latest = tx.date
    if (classify(tx) !== "expense") continue
    const name = cleanName(tx.text)
    const key = merchantKey(name)
    if (!key) continue
    const entry = byKey.get(key) || { name, category: tx.category, months: new Map() }
    const month = monthKey(tx.date)
    const slot = entry.months.get(month) || { amount: 0, count: 0, lastDate: "" }
    slot.amount += -tx.amount
    slot.count += 1
    if (tx.date > slot.lastDate) {
      slot.lastDate = tx.date
      entry.name = name
      entry.category = tx.category
    }
    entry.months.set(month, slot)
    byKey.set(key, entry)
  }

  // Reference date: today, or the last imported movement if the data is older.
  const reference = latest && latest < todayIso ? latest : todayIso
  const refMonth = monthKey(reference)
  const result: RecurringCharge[] = []

  for (const [key, entry] of byKey) {
    const months = [...entry.months.entries()].sort(([a], [b]) => a.localeCompare(b))
    const [lastMonth, last] = months[months.length - 1]!
    if (monthDiff(lastMonth, refMonth) > 1) continue // cancelled / not seen lately
    const values = months.map(([, slot]) => slot.amount)
    const charges = sum(months.map(([, slot]) => slot.count))
    const span = monthDiff(months[0]![0], lastMonth) + 1

    let status: RecurringCharge["status"] | null = null
    let previousAmount = last.amount
    if (months.length >= 3) {
      const med = median(values)
      const stable = values.every((value) => Math.abs(value - med) / med < 0.18)
      if (!stable || months.length / span < 0.6 || charges / months.length > 1.5) continue
      previousAmount = median(values.slice(0, -1))
      status = last.amount > previousAmount * 1.05 && last.amount - previousAmount >= 0.5 ? "increase" : "stable"
    } else if (months.length === 2) {
      const [a, b] = values as [number, number]
      const firstDate = months[0]![1].lastDate
      if (span !== 2 || charges !== 2 || Math.abs(a - b) / Math.max(a, b) > 0.05) continue
      if (daysBetween(firstDate, reference) > 75) continue
      status = "new"
      previousAmount = a
    }
    if (!status) continue

    result.push({
      key,
      name: entry.name,
      category: entry.category,
      amount: last.amount,
      previousAmount,
      annual: last.amount * 12,
      months: months.length,
      lastDate: last.lastDate,
      nextDate: addMonths(last.lastDate, 1),
      chargedThisMonth: lastMonth === refMonth,
      status,
    })
  }
  return result.sort((a, b) => b.amount - a.amount)
}

// ───────────────────────────── Forecast ─────────────────────────────

function buildForecast(months: Map<string, MonthAgg>, recurring: RecurringCharge[], todayIso: string): Forecast | null {
  const month = monthKey(todayIso)
  const agg = months.get(month)
  if (!agg) return null
  const [year, m] = month.split("-").map(Number)
  const dim = daysInMonth(year!, m! - 1)
  const daysElapsed = Math.min(dim, Math.max(1, Number(todayIso.slice(8, 10))))
  const recurringKeys = new Set(recurring.map((item) => item.key))
  let recurringSoFar = 0
  for (const [key, merchant] of agg.merchants) if (recurringKeys.has(key)) recurringSoFar += Math.max(0, merchant.amount)
  const variable = Math.max(0, agg.expense - recurringSoFar)
  const pending = sum(
    recurring
      .filter((item) => !item.chargedThisMonth && monthKey(item.nextDate) === month && item.nextDate > todayIso)
      .map((item) => item.amount),
  )
  const projected = recurringSoFar + pending + (daysElapsed >= dim ? variable : (variable / daysElapsed) * dim)
  const complete = completeMonths(months, todayIso).slice(-6)
  return {
    month,
    label: labelMonth(month),
    spent: agg.expense,
    projected,
    pending,
    average: complete.length ? sum(complete.map(([, item]) => item.expense)) / complete.length : null,
    daysElapsed,
    daysInMonth: dim,
  }
}

// ───────────────────────────── Balances ─────────────────────────────

export function buildBalanceSeries(transactions: Transaction[], from: string, to: string): BalanceSeries {
  const byAccountDay = new Map<string, Map<string, Transaction[]>>()
  for (const tx of transactions) {
    if (typeof tx.balanceAfter !== "number" || tx.date > to) continue
    const days = byAccountDay.get(tx.account) || new Map<string, Transaction[]>()
    const list = days.get(tx.date) || []
    list.push(tx)
    days.set(tx.date, list)
    byAccountDay.set(tx.account, days)
  }
  const accounts = [...byAccountDay.keys()].sort()
  if (!accounts.length) return { accounts, points: [] }

  // Month-end balance per account (last known day on or before the month end).
  const monthEnds = accounts.map((account) => {
    const days = [...byAccountDay.get(account)!.entries()].sort(([a], [b]) => a.localeCompare(b))
    const perMonth = new Map<string, number>()
    for (const [day, rows] of days) {
      const balance = endOfDayBalance(rows)
      if (balance != null) perMonth.set(monthKey(day), balance)
    }
    return { firstMonth: monthKey(days[0]![0]), perMonth }
  })

  const points: BalanceSeries["points"] = []
  let cursor = monthKey(from)
  const end = monthKey(to)
  const carry = accounts.map(() => null as number | null)
  // Seed carry with balances before the range.
  monthEnds.forEach((item, i) => {
    for (const [month, balance] of [...item.perMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (month < cursor) carry[i] = balance
    }
  })
  while (cursor <= end) {
    const values = monthEnds.map((item, i) => {
      const value = item.perMonth.get(cursor)
      if (value != null) carry[i] = value
      return cursor >= item.firstMonth ? carry[i] ?? 0 : 0
    })
    if (values.some((value) => value !== 0)) {
      points.push({ index: points.length, month: cursor, label: shortMonth(cursor), values, total: sum(values) })
    }
    cursor = monthKey(addMonths(`${cursor}-01`, 1))
  }
  return { accounts, points }
}

// ───────────────────────────── Orchestrator ─────────────────────────────

/**
 * Full analysis. `transactions` must already be normalized (see normalizeTransactions)
 * and filtered by account; the date range is applied here so history-based metrics
 * (recurring charges, budgets, forecast, balances) can look outside it.
 */
export function analyze(input: {
  transactions: Transaction[]
  tickets?: TicketLike[]
  budgets?: Budget[]
  rules?: UserRule[]
  from: string
  to: string
  today?: string
}): Analysis {
  const todayIso = input.today || isoDate(new Date())
  const tickets = input.tickets || []
  const rules = input.rules || []
  const inRange = (from: string, to: string) => input.transactions.filter((tx) => tx.date >= from && tx.date <= to)

  const view = buildView(inRange(input.from, input.to), tickets, { today: todayIso, rules, from: input.from, to: input.to })
  const prev = previousRange(input.from, input.to)
  const previousView = buildView(inRange(prev.from, prev.to), tickets, { today: todayIso, rules, from: prev.from, to: prev.to })
  const compare = comparePeriods(view, previousView, prev)

  const all = aggregate(input.transactions, tickets, sortRules(rules))
  const recurring = detectRecurring(input.transactions, todayIso)
  const budgets = buildBudgetStatuses(input.budgets || [], all.months, todayIso)
  const forecast = buildForecast(all.months, recurring, todayIso)
  const balances = buildBalanceSeries(input.transactions, input.from, input.to)

  const accountBalances = accountsFromTransactions(input.transactions).filter((item) => item.balance != null)
  const lastSix = completeMonths(all.months, todayIso).slice(-6)
  const avgMonthly = lastSix.length ? sum(lastSix.map(([, agg]) => agg.expense)) / lastSix.length : 0
  const totalBalance = sum(accountBalances.map((item) => item.balance!))
  const cushion = accountBalances.length && avgMonthly > 0
    ? { balance: totalBalance, avgExpense: avgMonthly, months: totalBalance / avgMonthly }
    : null

  const trendBadges: string[] = []
  if (view.vsAverageBadge) trendBadges.push(view.vsAverageBadge)
  if (view.monthCompare) trendBadges.push(...view.monthCompare.badges)

  return {
    view,
    compare,
    budgets,
    recurring,
    forecast,
    balances,
    cushion,
    insights: buildInsights(view, recurring, budgets, forecast, cushion, compare),
    trendBadges,
    advice: buildAdvice(view, recurring, budgets, forecast, cushion),
  }
}

// ─────────────────────── Insights and advice ───────────────────────

function recurringMonthly(recurring: RecurringCharge[]) {
  return sum(recurring.map((item) => item.amount))
}

function buildInsights(
  view: View,
  recurring: RecurringCharge[],
  budgets: BudgetStatus[],
  forecast: Forecast | null,
  cushion: Cushion | null,
  compare: PeriodCompare | null,
) {
  const insights: string[] = []
  if (view.incomeSources[0]) insights.push(`Tu ingreso principal es ${view.incomeSources[0].name}: ${euro.format(view.incomeSources[0].amount)}.`)
  if (view.toSavings > 0) insights.push(`Has movido ${euro.format(view.toSavings)} a ahorro.`)
  if (view.categories[0]) insights.push(`La mayor partida de gasto es ${view.categories[0].name}: ${euro.format(view.categories[0].amount)}.`)
  if (view.merchants[0]) insights.push(`Donde más gastas es ${view.merchants[0].name}: ${euro.format(view.merchants[0].amount)}.`)
  if (compare?.expense.pct != null && Math.abs(compare.expense.pct) >= 0.05) {
    insights.push(`Gastas un ${formatPct(compare.expense.pct)} respecto al periodo anterior.`)
  }
  if (recurring.length) insights.push(`${recurring.length} cargos recurrentes: ~${euro.format(recurringMonthly(recurring))}/mes (${euro.format(recurringMonthly(recurring) * 12)}/año).`)
  for (const item of recurring.filter((r) => r.status === "increase")) {
    insights.push(`${item.name} ha subido de ${euro.format(item.previousAmount)} a ${euro.format(item.amount)}.`)
  }
  for (const item of recurring.filter((r) => r.status === "new")) {
    insights.push(`Posible suscripción nueva: ${item.name} (${euro.format(item.amount)}/mes).`)
  }
  if (forecast && forecast.daysElapsed < forecast.daysInMonth) {
    insights.push(`Previsión de ${forecast.label}: ~${euro.format(forecast.projected)} de gasto.`)
  }
  if (cushion) insights.push(`Tu saldo cubre ${cushion.months.toFixed(1)} meses de gasto medio.`)
  if (Math.abs(view.bizumNet) >= 1) {
    insights.push(`Bizum neto: ${view.bizumNet >= 0 ? "+" : "−"}${euro.format(Math.abs(view.bizumNet))} (recibidos menos enviados).`)
  }
  if (view.ticketItems[0]) insights.push(`En tickets destaca «${view.ticketItems[0].name}»: ${euro.format(view.ticketItems[0].amount)}.`)
  for (const budget of budgets) {
    if (budget.state === "over") insights.push(`Presupuesto ${budget.category}: te pasas ${euro.format(Math.abs(budget.remaining))}.`)
    else if (budget.paceNote) insights.push(budget.paceNote)
  }
  return insights
}

function buildAdvice(
  view: View,
  recurring: RecurringCharge[],
  budgets: BudgetStatus[],
  forecast: Forecast | null,
  cushion: Cushion | null,
): Advice {
  const actions: string[] = []
  const summary: string[] = []
  const top = view.categories[0]
  if (top) {
    summary.push(`La categoría que más te pesa es ${top.name} (${euro.format(top.amount)}).`)
    if (top.share >= 0.28 && !isFixedCategory(top.name)) {
      actions.push(`Recorta un 10–15 % en ${top.name}: unos ${euro.format(top.amount * 0.12)}.`)
    }
  }
  if (view.fixedSpend > 0) summary.push(`Unos ${euro.format(view.fixedSpend)} son fijos; ${euro.format(view.flexibleSpend)} son flexibles.`)
  if (recurring.length) {
    summary.push(`${recurring.length} cargos recurrentes suman ~${euro.format(recurringMonthly(recurring))} al mes.`)
  }
  const increase = recurring.find((item) => item.status === "increase")
  if (increase) actions.push(`${increase.name} ha subido ${euro.format(increase.amount - increase.previousAmount)}/mes: revisa la tarifa o cámbiala.`)
  const subs = recurring.filter((item) => item.category === "Suscripciones")
  if (subs.length >= 3) actions.push(`Tienes ${subs.length} suscripciones (${euro.format(sum(subs.map((s) => s.annual)))}/año): ¿usas todas?`)
  const mover = view.monthCompare?.categories[0]
  if (mover && mover.delta > 0) actions.push(`${mover.name} subió ${euro.format(mover.delta)} vs el mes anterior: ahí hay margen.`)
  if (forecast?.average && forecast.projected > forecast.average * 1.1 && forecast.daysElapsed < forecast.daysInMonth) {
    actions.push(`Este mes vas camino de gastar ${euro.format(forecast.projected - forecast.average)} más que tu media.`)
  }
  const over = budgets.find((item) => item.state === "over")
  if (over) actions.push(`Baja ${over.category}: ya superas el tope en ${euro.format(Math.abs(over.remaining))}.`)
  else {
    const pace = budgets.find((item) => item.paceOverage && item.paceOverage > 0)
    if (pace?.paceNote) actions.push(pace.paceNote)
  }
  const merchant = view.merchants[0]
  if (merchant && (merchant.count || 0) >= 2) {
    summary.push(`${merchant.name} concentra ${euro.format(merchant.amount)} en ${merchant.count} compras.`)
  }
  if (cushion && cushion.months < 3) actions.push(`Tu colchón cubre ${cushion.months.toFixed(1)} meses; apunta a 3–6 meses de gasto.`)
  if (view.toSavings > 0) summary.push(`Ya mueves ${euro.format(view.toSavings)} a ahorro; mantén ese hábito.`)
  else if (view.income > 0 && view.savingsRate < 0.1) {
    actions.push(`Tu tasa de ahorro es del ${Math.round(view.savingsRate * 100)} %. Traspasa un fijo el día de nómina.`)
  }
  if (view.avgTicket > 0 && view.avgTicket < 12 && view.expense > 80) {
    actions.push(`Ticket medio bajo (${euro.format(view.avgTicket)}): agrupa recados en menos salidas.`)
  }
  const fillers = [
    "Importa más meses para afinar tendencias y recurrentes.",
    "Crea reglas de categoría para lo que caiga en «Otros gastos».",
    "Copia el resumen a ChatGPT si quieres un plan semanal.",
  ]
  for (const filler of fillers) if (actions.length < 3) actions.push(filler)
  return { summary, actions: actions.slice(0, 4) }
}

export function chatgptBrief(analysis: Analysis) {
  const { view } = analysis
  const lines = [
    "Analiza mi consumo bancario y dame un plan concreto para gastar menos.",
    `Ingresos: ${euro.format(view.income)}`,
    `Gastos (sin ahorro ni traspasos internos, Bizum neto): ${euro.format(view.expense)}`,
    `Fijos ≈ ${euro.format(view.fixedSpend)} · Flexibles ≈ ${euro.format(view.flexibleSpend)}`,
    `Movido a ahorro: ${euro.format(view.toSavings)}`,
    `Tasa de ahorro aprox.: ${Math.round(view.savingsRate * 100)} %`,
    `Gasto medio mensual (meses completos): ${euro.format(view.avgExpense)}`,
    `Compras: ${view.purchaseCount}, ticket medio ${euro.format(view.avgTicket)}`,
  ]
  if (analysis.compare) {
    const c = analysis.compare
    lines.push(`Periodo anterior (${c.label}): gastos ${euro.format(c.expense.previous)}, ingresos ${euro.format(c.income.previous)}`)
  }
  if (analysis.cushion) lines.push(`Colchón: ${analysis.cushion.months.toFixed(1)} meses de gasto`)
  if (analysis.forecast) lines.push(`Previsión ${analysis.forecast.label}: ${euro.format(analysis.forecast.projected)}`)
  lines.push(
    "",
    "Categorías:",
    ...view.categories.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} (${Math.round(item.share * 100)} %)`),
    "",
    "Comercios:",
    ...view.merchants.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} · ${item.count || 0} veces`),
  )
  if (analysis.recurring.length) {
    lines.push(
      "",
      "Cargos recurrentes:",
      ...analysis.recurring.map((item) => {
        const note = item.status === "increase" ? ` (subió desde ${euro.format(item.previousAmount)})` : item.status === "new" ? " (nuevo)" : ""
        return `- ${item.name}: ~${euro.format(item.amount)}/mes, ${euro.format(item.annual)}/año${note}`
      }),
    )
  }
  if (view.monthCompare) {
    lines.push("", `Tendencia ${view.monthCompare.currentLabel} vs ${view.monthCompare.previousLabel}:`, ...view.monthCompare.badges.map((item) => `- ${item}`))
  }
  if (analysis.budgets.length) {
    lines.push(
      "",
      "Presupuestos del mes:",
      ...analysis.budgets.map((item) => {
        const status = item.state === "over" ? "PASADO" : item.state === "warn" ? "cerca" : "ok"
        return `- ${item.category}: ${euro.format(item.spent)} / ${euro.format(item.limit)} (${status})`
      }),
    )
  }
  if (view.ticketItems.length) {
    lines.push("", "Artículos de tickets:", ...view.ticketItems.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} · ${item.count || 0} veces`))
  }
  lines.push("", "Sin IBAN ni datos de tarjeta. Responde en español.")
  return lines.join("\n")
}
