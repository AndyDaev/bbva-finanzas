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
import { buildCycleCalendar, detectPaydays } from "./cycles"
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
  cadence: "monthly" | "yearly"
  /** Latest charge (current price). */
  amount: number
  /** Median charge before the latest one. */
  previousAmount: number
  /** Cost per month (yearly charges are spread over 12). */
  monthly: number
  annual: number
  /** Number of charges seen. */
  count: number
  /** Kept for compatibility: distinct months with a charge. */
  months: number
  lastDate: string
  nextDate: string
  chargedThisMonth: boolean
  status: "stable" | "increase" | "new"
  /** Bills keep the house running (rent, utilities, phone, insurance); subscriptions are services you choose. */
  kind: "subscription" | "bill"
}

/** Cumulative spend by day of month: this month against the average of recent months. */
export type DailyPace = {
  month: string
  label: string
  today: number
  points: Array<{ day: number, current: number | null, average: number | null }>
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
  /** Gross money put into and taken out of savings (toSavings is the net). */
  savingsIn: number
  savingsOut: number
  net: number
  unassigned: number
  savingsRate: number
  avgExpense: number
  avgTicket: number
  purchaseCount: number
  fixedSpend: number
  flexibleSpend: number
  bizumNet: number
  /** Small "ant" purchases under SMALL_PURCHASE euros. */
  smallPurchases: { count: number, total: number, threshold: number }
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
  /** Spend per category in the previous period, for per-row deltas. */
  previousByCategory: Record<string, number>
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

/** Savings account reconciliation with bank dates: opening + added − withdrawn = closing. */
export type SavingsLedger = {
  accounts: string[]
  from: string
  to: string
  opening: number | null
  added: number
  withdrawn: number
  closing: number | null
  /** Difference when the movements do not explain the balances (missing data), else null. */
  mismatch: number | null
  byMonth: Array<{ month: string, label: string, from: string, to: string, added: number, withdrawn: number, net: number, closing: number | null }>
}

export type Analysis = {
  view: View
  compare: PeriodCompare | null
  budgets: BudgetStatus[]
  recurring: RecurringCharge[]
  forecast: Forecast | null
  pace: DailyPace | null
  savingsAccounts: string[]
  /** Months are pay cycles (payday → day before next payday) when the payroll pattern allows. */
  cycle: { active: boolean, from: string, to: string, periods: Array<{ label: string, from: string, to: string }> }
  savingsLedger: SavingsLedger | null
  /** Money left until the next payday (only when the period reaches today). */
  payday: PaydayBudget | null
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

type Kind = "transfer" | "savings" | "bizum" | "refund" | "income" | "expense"

function classify(tx: Transaction): Kind {
  const c = tx.category
  if (c === "Traspaso interno") return "transfer"
  if (c === "Ahorro") return "savings"
  if (c === "Bizum recibido" || c === "Bizum enviado") return "bizum"
  if (tx.amount > 0 && c === "Devolución") return "refund"
  return tx.amount >= 0 ? "income" : "expense"
}

export type FlowType =
  | "gasto"
  | "ingreso"
  | "devolución"
  | "bizum enviado"
  | "bizum recibido"
  | "ahorro: entrada"
  | "ahorro: salida"
  | "traspaso interno"

/**
 * How a movement counts in the analysis, in plain words (for exports). Movements in a
 * savings account are savings flows; the matching leg in the main account is an internal
 * transfer, so nothing is counted twice.
 */
export function flowType(tx: Transaction, savingsAccounts: string[] = []): FlowType {
  if (savingsAccounts.includes(tx.account)) return tx.amount >= 0 ? "ahorro: entrada" : "ahorro: salida"
  switch (classify(tx)) {
    case "transfer": return "traspaso interno"
    case "savings": return tx.amount < 0 ? "ahorro: entrada" : "ahorro: salida"
    case "bizum": return tx.amount > 0 ? "bizum recibido" : "bizum enviado"
    case "refund": return "devolución"
    case "income": return "ingreso"
    default: return "gasto"
  }
}

type MerchantAgg = { name: string, category: string, amount: number, count: number }

type MonthAgg = {
  income: number
  expense: number
  savings: number
  savingsIn: number
  savingsOut: number
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
    savingsIn: 0,
    savingsOut: 0,
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
/**
 * Accounts that are savings pots: almost everything in them is a transfer between own
 * accounts (e.g. BBVA "Programa Tu Cuenta" / a savings account).
 */
export function detectSavingsAccounts(transactions: Transaction[]) {
  const stats = new Map<string, { total: number, internal: number }>()
  for (const tx of transactions) {
    const entry = stats.get(tx.account) || { total: 0, internal: 0 }
    entry.total += 1
    if (tx.category === "Traspaso interno" || tx.category === "Ahorro") entry.internal += 1
    stats.set(tx.account, entry)
  }
  return [...stats.entries()].filter(([, s]) => s.total >= 5 && s.internal / s.total >= 0.8).map(([name]) => name)
}

type SavingsContext = { accounts: Set<string>, inView: boolean }

function savingsContext(transactions: Transaction[], savingsAccounts: string[] = []): SavingsContext {
  const accounts = new Set(savingsAccounts)
  return { accounts, inView: transactions.some((tx) => accounts.has(tx.account)) }
}

/**
 * Savings = money that ends up in savings accounts. If a savings account is in view, count its
 * side of the transfers; otherwise count what left the current accounts to other own accounts.
 */
function savingsDelta(tx: Transaction, context: SavingsContext) {
  if (context.accounts.has(tx.account)) return tx.amount
  return context.inView ? 0 : -tx.amount
}

function addSavings(agg: MonthAgg, delta: number) {
  agg.savings += delta
  if (delta > 0) agg.savingsIn += delta
  else agg.savingsOut -= delta
}

function aggregate(transactions: Transaction[], tickets: TicketLike[], sortedRules: UserRule[], savings: SavingsContext): Aggregate {
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
    const agg = bucket(monthKey(tx.date))

    // Everything that happens in a savings account (transfers, cash deposits, interest) is a
    // savings flow, never income or spending: the sum over time equals the account balance.
    if (savings.accounts.has(tx.account)) {
      addSavings(agg, tx.amount)
      continue
    }
    if (kind === "transfer") {
      addSavings(agg, savingsDelta(tx, savings))
      continue
    }
    if (kind === "savings") {
      addSavings(agg, -tx.amount)
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
const SMALL_PURCHASE = 5

// ──────────────────────────── Period view ────────────────────────────

export function buildView(
  transactions: Transaction[],
  tickets: TicketLike[] = [],
  options: { today?: string, rules?: UserRule[], from?: string, to?: string, savingsAccounts?: string[] } = {},
): View {
  const todayIso = options.today || isoDate(new Date())
  const sortedRules = sortRules(options.rules || [])
  const { months: monthMap, expenses } = aggregate(transactions, tickets, sortedRules, savingsContext(transactions, options.savingsAccounts))

  const byCategory = new Map<string, number>()
  const byIncome = new Map<string, number>()
  const byMerchant = new Map<string, MerchantAgg>()
  let toSavings = 0
  let savingsIn = 0
  let savingsOut = 0
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
    savingsIn += agg.savingsIn
    savingsOut += agg.savingsOut
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
      date: tx.realDate ?? tx.date,
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

  // Note: BBVA only sends the booking date (weekend card payments book on Monday), so no
  // day-of-week analysis is attempted.
  const smallPurchases = { count: 0, total: 0, threshold: SMALL_PURCHASE }
  for (const tx of expenses) {
    const spent = -tx.amount
    if (spent < SMALL_PURCHASE && !isFixedCategory(tx.category)) {
      smallPurchases.count += 1
      smallPurchases.total += spent
    }
  }

  return {
    smallPurchases,
    income,
    expense,
    toSavings,
    savingsIn,
    savingsOut,
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
    previousByCategory: Object.fromEntries(previous.categories.map((item) => [item.name, item.amount])),
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

/** Recurring charges in these categories are bills (housing and obligations), the rest subscriptions. */
const BILL_CATEGORIES = new Set(["Vivienda", "Suministros", "Telecomunicaciones", "Recibos", "Impuestos y seguros", "Comisiones", "Transferencias"])

export function splitRecurring(recurring: RecurringCharge[]) {
  return {
    subscriptions: recurring.filter((item) => item.kind === "subscription"),
    bills: recurring.filter((item) => item.kind === "bill"),
  }
}

/** Categories where a 2-charge history is already enough to flag a new subscription. */
const SUBSCRIPTION_LIKE = new Set(["Suscripciones", "Telecomunicaciones", "Suministros", "Recibos", "Vivienda", "Impuestos y seguros"])

type Charge = { date: string, amount: number }

/**
 * Detects subscriptions and bills from the charge pattern of each merchant:
 *  - monthly: consecutive charges ~1 month apart (20–40 days) with a stable price
 *  - yearly:  charges ~1 year apart with a similar price
 * Price changes are allowed (and reported) as long as recent charges agree.
 */
export function detectRecurring(transactions: Transaction[], todayIso: string): RecurringCharge[] {
  const byKey = new Map<string, { name: string, category: string, charges: Charge[] }>()
  let latest = ""
  for (const tx of transactions) {
    if (tx.date > latest) latest = tx.date
    if (classify(tx) !== "expense") continue
    // Everyday shopping is never a subscription; rent paid by transfer can be, so transfers stay in.
    if (["Efectivo", "Supermercado", "Restauración"].includes(tx.category)) continue
    const name = cleanName(tx.text)
    const key = merchantKey(tx.text)
    if (!key) continue
    const entry = byKey.get(key) || { name, category: tx.category, charges: [] }
    entry.charges.push({ date: tx.date, amount: -tx.amount })
    byKey.set(key, entry)
  }

  // Reference date: today, or the last synced movement if the data is older.
  const reference = latest && latest < todayIso ? latest : todayIso
  const refMonth = monthKey(reference)
  const result: RecurringCharge[] = []

  // A merchant may bill several subscriptions (e.g. two Google plans): when the merchant as a
  // whole has no clear rhythm, also try each price point on its own.
  const groups: Array<[string, { name: string, category: string, charges: Charge[] }]> = []
  for (const [key, entry] of byKey) {
    groups.push([key, entry])
    const byPrice = new Map<string, Charge[]>()
    for (const charge of entry.charges) {
      const price = charge.amount.toFixed(2)
      byPrice.set(price, [...(byPrice.get(price) || []), charge])
    }
    if (byPrice.size > 1) {
      for (const [price, charges] of byPrice) {
        if (charges.length >= 2) groups.push([`${key}#${price}`, { ...entry, name: `${entry.name} (${price.replace(".", ",")} €)`, charges }])
      }
    }
  }
  const found = new Set<string>()

  for (const [key, entry] of groups) {
    const baseKey = key.split("#")[0]!
    if (found.has(baseKey)) continue
    const charges = [...entry.charges].sort((a, b) => a.date.localeCompare(b.date))
    if (charges.length < 2) continue
    const last = charges[charges.length - 1]!
    const recent = charges.slice(-6)
    const intervals = recent.slice(1).map((charge, i) => daysBetween(recent[i]!.date, charge.date))
    const reference3 = median(recent.slice(-3).map((c) => c.amount))
    const similar = (amount: number, tolerance: number) => Math.abs(amount - reference3) / Math.max(reference3, 0.01) <= tolerance

    let cadence: RecurringCharge["cadence"] | null = null
    const monthlyIntervals = intervals.filter((d) => d >= 20 && d <= 40).length
    const yearlyIntervals = intervals.filter((d) => d >= 340 && d <= 390).length
    if (intervals.length && monthlyIntervals / intervals.length >= 0.75 && recent.filter((c) => similar(c.amount, 0.25)).length / recent.length >= 0.75) {
      cadence = "monthly"
    } else if (yearlyIntervals && yearlyIntervals === intervals.length && similar(recent[0]!.amount, 0.25)) {
      cadence = "yearly"
    }
    if (!cadence) continue

    // Only active ones: the next charge is not long overdue.
    const period = cadence === "monthly" ? 31 : 365
    if (daysBetween(last.date, reference) > period * 1.6) continue

    let status: RecurringCharge["status"] = "stable"
    const previousAmount = charges.length > 1 ? median(charges.slice(-4, -1).map((c) => c.amount)) : last.amount
    if (cadence === "monthly" && charges.length === 2) {
      // Two charges are only trusted for subscription-like categories, and flagged as new.
      if (!SUBSCRIPTION_LIKE.has(entry.category) || !similar(charges[0]!.amount, 0.05)) continue
      status = "new"
    } else if (last.amount > previousAmount * 1.03 && last.amount - previousAmount >= 0.3) {
      status = "increase"
    } else if (cadence === "monthly" && charges.length <= 3 && daysBetween(charges[0]!.date, reference) <= 100) {
      status = "new"
    }

    // The merchant as a whole matched: skip its per-price variants.
    if (!key.includes("#")) found.add(baseKey)
    const monthly = cadence === "monthly" ? last.amount : last.amount / 12
    result.push({
      key,
      name: entry.name,
      category: entry.category,
      kind: BILL_CATEGORIES.has(entry.category) ? "bill" : "subscription",
      cadence,
      amount: last.amount,
      previousAmount,
      monthly,
      annual: monthly * 12,
      count: charges.length,
      months: new Set(charges.map((c) => monthKey(c.date))).size,
      lastDate: last.date,
      nextDate: cadence === "monthly" ? addMonths(last.date, 1) : addMonths(last.date, 12),
      chargedThisMonth: monthKey(last.date) === refMonth,
      status,
    })
  }
  return result.sort((a, b) => b.monthly - a.monthly)
}

// ───────────────────────────── Daily pace ─────────────────────────────

/** Spend contribution of one movement (refunds and received Bizum reduce it). */
function spendOf(tx: Transaction) {
  const kind = classify(tx)
  if (kind === "expense" || kind === "refund" || kind === "bizum") return -tx.amount
  return 0
}

/** Cumulative spend per day this month vs the average of the last 3 complete months. */
export function buildDailyPace(transactions: Transaction[], todayIso: string): DailyPace | null {
  const month = monthKey(todayIso)
  const previousMonths = [1, 2, 3].map((n) => monthKey(addMonths(`${month}-01`, -n)))
  const perMonth = new Map<string, number[]>()
  for (const key of [month, ...previousMonths]) perMonth.set(key, Array(32).fill(0))
  for (const tx of transactions) {
    const days = perMonth.get(monthKey(tx.date))
    if (!days) continue
    days[Number(tx.date.slice(8, 10))]! += spendOf(tx)
  }
  const current = perMonth.get(month)!
  if (!current.some((value) => value !== 0)) return null

  const cumulative = (days: number[], length: number) => {
    const out: number[] = []
    let total = 0
    for (let day = 1; day <= length; day += 1) {
      total += days[day] || 0
      out.push(Math.max(0, total))
    }
    return out
  }
  const [y, m] = month.split("-").map(Number)
  const dim = daysInMonth(y!, m! - 1)
  const today = Math.min(dim, Number(todayIso.slice(8, 10)))
  const history = previousMonths
    .filter((key) => perMonth.get(key)!.some((value) => value !== 0))
    .map((key) => {
      const [py, pm] = key.split("-").map(Number)
      const series = cumulative(perMonth.get(key)!, daysInMonth(py!, pm! - 1))
      // Shorter months keep their final total for the remaining days.
      return Array.from({ length: dim }, (_, i) => series[Math.min(i, series.length - 1)]!)
    })
  const currentSeries = cumulative(current, dim)
  return {
    month,
    label: labelMonth(month),
    today,
    points: Array.from({ length: dim }, (_, i) => ({
      day: i + 1,
      current: i < today ? currentSeries[i]! : null,
      average: history.length ? sum(history.map((series) => series[i]!)) / history.length : null,
    })),
  }
}

// ───────────────────────────── Forecast ─────────────────────────────

/** Spending that happens once (not a daily habit): never projected over the rest of the month. */
const LUMPY_CATEGORIES = new Set(["Transferencias", "Vivienda", "Impuestos y seguros", "Viajes", "Efectivo"])
const LUMPY_AMOUNT = 100

function buildForecast(months: Map<string, MonthAgg>, recurring: RecurringCharge[], todayIso: string, transactions: Transaction[]): Forecast | null {
  const month = monthKey(todayIso)
  const agg = months.get(month)
  if (!agg) return null
  const [year, m] = month.split("-").map(Number)
  const dim = daysInMonth(year!, m! - 1)
  const daysElapsed = Math.min(dim, Math.max(1, Number(todayIso.slice(8, 10))))
  const recurringKeys = new Set(recurring.map((item) => item.key.split("#")[0]))
  // Only everyday spending is extrapolated; one-offs and bills count once, as they are.
  let lumpySoFar = 0
  for (const tx of transactions) {
    if (monthKey(tx.date) !== month || classify(tx) !== "expense") continue
    const spent = -tx.amount
    if (spent >= LUMPY_AMOUNT || LUMPY_CATEGORIES.has(tx.category) || isFixedCategory(tx.category) || recurringKeys.has(merchantKey(tx.text))) {
      lumpySoFar += spent
    }
  }
  const recurringSoFar = Math.min(lumpySoFar, agg.expense)
  const variable = Math.max(0, agg.expense - recurringSoFar)
  const pending = sum(
    recurring
      .filter((item) => !item.chargedThisMonth && monthKey(item.nextDate) === month && item.nextDate >= todayIso)
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

// ───────────────────────────── Savings ledger ─────────────────────────────

/** End-of-day balance on `date` for one account (before its first movement: the opening balance). */
function balanceOnFactory(rows: Transaction[]) {
  const byDay = new Map<string, Transaction[]>()
  for (const tx of rows) byDay.set(tx.date, [...(byDay.get(tx.date) || []), tx])
  const days = [...byDay.keys()].sort()
  const ends = days.map((day) => endOfDayBalance(byDay.get(day)!))
  return (date: string) => {
    let index = -1
    for (let i = 0; i < days.length && days[i]! <= date; i += 1) index = i
    if (index >= 0) return ends[index] ?? null
    const firstEnd = ends[0]
    if (firstEnd == null) return null
    return Math.round((firstEnd - sum(byDay.get(days[0]!)!.map((tx) => tx.amount))) * 100) / 100
  }
}

export function buildSavingsLedger(
  transactions: Transaction[],
  savingsAccounts: string[],
  periods: Array<{ label: string, from: string, to: string }>,
): SavingsLedger | null {
  if (!periods.length) return null
  const from = periods[0]!.from
  const to = periods[periods.length - 1]!.to
  const accounts = savingsAccounts.filter((name) => transactions.some((tx) => tx.account === name))
  if (!accounts.length) return null
  const lookups = accounts.map((name) => balanceOnFactory(transactions.filter((tx) => tx.account === name)))
  const balanceOn = (date: string) => {
    const values = lookups.map((lookup) => lookup(date))
    return values.some((value) => value == null) ? null : Math.round(sum(values as number[]) * 100) / 100
  }
  const rows = transactions.filter((tx) => accounts.includes(tx.account) && tx.date >= from && tx.date <= to)
  const added = sum(rows.filter((tx) => tx.amount > 0).map((tx) => tx.amount))
  const withdrawn = -sum(rows.filter((tx) => tx.amount < 0).map((tx) => tx.amount))
  const opening = balanceOn(addDays(from, -1))
  const closing = balanceOn(to)
  const gap = opening != null && closing != null ? opening + added - withdrawn - closing : 0
  const byMonth: SavingsLedger["byMonth"] = periods.map((period) => {
    const inPeriod = rows.filter((tx) => tx.date >= period.from && tx.date <= period.to)
    const periodAdded = sum(inPeriod.filter((tx) => tx.amount > 0).map((tx) => tx.amount))
    const periodWithdrawn = -sum(inPeriod.filter((tx) => tx.amount < 0).map((tx) => tx.amount))
    return {
      month: period.label,
      label: labelMonth(period.label),
      from: period.from,
      to: period.to,
      added: periodAdded,
      withdrawn: periodWithdrawn,
      net: periodAdded - periodWithdrawn,
      closing: balanceOn(period.to),
    }
  })
  return { accounts, from, to, opening, added, withdrawn, closing, mismatch: Math.abs(gap) > 1 ? Math.round(gap * 100) / 100 : null, byMonth }
}

// ───────────────────────────── Until payday ─────────────────────────────

export type PaydayBudget = {
  nextPayday: string
  /** Days from today until the payday (at least 1). */
  daysLeft: number
  /** Balance of the spending accounts (savings pots excluded). */
  available: number
  pendingBills: number
  pendingItems: Array<{ name: string, amount: number, date: string, kind: RecurringCharge["kind"] }>
  /** What can be spent per day once pending bills are covered. */
  perDay: number
  /** True when there is no payroll history and the end of the month is assumed. */
  estimated: boolean
}

function nextWorkingDay(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay()
  return day === 6 ? addDays(date, 2) : day === 0 ? addDays(date, 1) : date
}

function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number)
  return `${month}-${String(daysInMonth(y!, m! - 1)).padStart(2, "0")}`
}

/**
 * Next payday from the usual position of the payroll relative to the month end (a payroll
 * pushed from Saturday 31/10 to Monday 02/11 still means "paid at month end"), moved to the
 * next working day when it falls on a weekend.
 */
export function estimateNextPayday(paydays: string[], todayIso: string) {
  if (paydays.length < 2) return { date: nextWorkingDay(monthEnd(monthKey(todayIso))), estimated: true }
  const offsets = paydays.map((date) => {
    const day = Number(date.slice(8, 10))
    const dim = Number(monthEnd(monthKey(date)).slice(8, 10))
    if (day >= 15) return dim - day // days before the month end
    // Paid on the first working day after a month end that fell on a weekend: a month-end payroll.
    const previousEnd = addDays(`${monthKey(date)}-01`, -1)
    if (nextWorkingDay(previousEnd) !== previousEnd && nextWorkingDay(previousEnd) === date) return 0
    return -day // days after the previous month end
  })
  const offset = Math.round(median(offsets))
  const last = paydays[paydays.length - 1]!
  for (let step = -1; step <= 3; step += 1) {
    const month = monthKey(addMonths(`${monthKey(todayIso)}-01`, step))
    const candidate = nextWorkingDay(addDays(monthEnd(month), -offset))
    if (candidate > last && candidate >= todayIso) return { date: candidate, estimated: false }
  }
  return { date: nextWorkingDay(addMonths(last, 1)), estimated: true }
}

export function buildPaydayBudget(
  transactions: Transaction[],
  recurring: RecurringCharge[],
  savingsAccounts: string[],
  todayIso: string,
): PaydayBudget | null {
  const spendingAccounts = accountsFromTransactions(transactions).filter((item) => item.balance != null && !savingsAccounts.includes(item.name))
  if (!spendingAccounts.length) return null
  const { date: nextPayday, estimated } = estimateNextPayday(detectPaydays(transactions), todayIso)
  const daysLeft = Math.max(1, daysBetween(todayIso, nextPayday))
  const available = sum(spendingAccounts.map((item) => item.balance!))
  const pendingItems = recurring
    .filter((item) => item.nextDate >= todayIso && item.nextDate < nextPayday)
    .map((item) => ({ name: item.name, amount: item.amount, date: item.nextDate, kind: item.kind }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const pendingBills = sum(pendingItems.map((item) => item.amount))
  return {
    nextPayday,
    daysLeft,
    available,
    pendingBills,
    pendingItems,
    perDay: Math.max(0, available - pendingBills) / daysLeft,
    estimated,
  }
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
  /** Savings pots (see detectSavingsAccounts), computed over all accounts. */
  savingsAccounts?: string[]
  from: string
  to: string
  today?: string
}): Analysis {
  const todayIso = input.today || isoDate(new Date())
  const tickets = input.tickets || []
  const rules = input.rules || []
  const savingsAccounts = input.savingsAccounts ?? detectSavingsAccounts(input.transactions)
  // Month-based figures run on pay cycles (see cycles.ts) through a synthetic calendar;
  // recurring charges, balances and the savings ledger keep bank dates.
  const calendar = buildCycleCalendar(input.transactions)
  const cycled = calendar.active
    ? input.transactions.map((tx) => {
      const date = calendar.toSynthetic(tx.date)
      return date === tx.date ? tx : { ...tx, date, realDate: tx.date }
    })
    : input.transactions
  const today = calendar.toSynthetic(todayIso)
  // Presets start on day 1 (= the start of that month's cycle); custom dates are translated.
  const from = calendar.active && !input.from.endsWith("-01") ? calendar.toSynthetic(input.from) : input.from
  // A range ending on a month's last day means "until the end of that month's cycle".
  const [toYear, toMonth] = input.to.split("-").map(Number)
  const endsMonth = Number(input.to.slice(8, 10)) === daysInMonth(toYear!, toMonth! - 1) && input.to < todayIso
  const latestBooked = input.transactions.reduce((max, tx) => (tx.date > max ? tx.date : max), "")
  let to = calendar.active && endsMonth ? input.to : calendar.toSynthetic(input.to)
  // Up to today also means movements the bank already booked with a later date (so every
  // figure matches the balance the bank shows now).
  if (input.to >= todayIso && latestBooked > input.to) {
    const latestSynthetic = calendar.toSynthetic(latestBooked)
    if (latestSynthetic > to) to = latestSynthetic
  }
  const inRange = (start: string, end: string) => cycled.filter((tx) => tx.date >= start && tx.date <= end)
  const viewOptions = { today, rules, savingsAccounts }

  const view = buildView(inRange(from, to), tickets, { ...viewOptions, from: calendar.toReal(from), to: calendar.toReal(to) })
  const prev = previousRange(from, to)
  const previousView = buildView(inRange(prev.from, prev.to), tickets, { ...viewOptions, from: calendar.toReal(prev.from), to: calendar.toReal(prev.to) })
  const compare = comparePeriods(view, previousView, { from: calendar.toReal(prev.from), to: calendar.toReal(prev.to) })

  const all = aggregate(cycled, tickets, sortRules(rules), savingsContext(cycled, savingsAccounts))
  const recurring = detectRecurring(input.transactions, todayIso)
  const pace = buildDailyPace(cycled, today)
  const budgets = buildBudgetStatuses(input.budgets || [], all.months, today)
  const forecast = buildForecast(all.months, recurring, today, cycled)
  const periods = calendar.periods(from, to)
  const realFrom = periods[0]?.from ?? input.from
  const realTo = periods[periods.length - 1]?.to ?? input.to
  const balances = buildBalanceSeries(input.transactions, realFrom, realTo)
  // Same rule for the real-date ledger: include movements already booked with a later date.
  const lastPeriod = periods[periods.length - 1]
  if (lastPeriod && input.to >= todayIso && latestBooked > lastPeriod.to) lastPeriod.to = latestBooked

  // Cushion = what is saved (savings accounts; all accounts if there is none) ÷ how much you
  // spend now (average of the last 3 complete months/cycles), from the latest bank balances.
  const withBalance = accountsFromTransactions(input.transactions).filter((item) => item.balance != null)
  const savedBalances = withBalance.filter((item) => savingsAccounts.includes(item.name))
  const cushionAccounts = savedBalances.length ? savedBalances : withBalance
  const recent = completeMonths(all.months, today).slice(-3)
  const avgMonthly = recent.length ? sum(recent.map(([, agg]) => agg.expense)) / recent.length : 0
  const cushionBalance = sum(cushionAccounts.map((item) => item.balance!))
  const cushion = cushionAccounts.length && avgMonthly > 0
    ? { balance: cushionBalance, avgExpense: avgMonthly, months: cushionBalance / avgMonthly }
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
    pace,
    savingsAccounts,
    cycle: { active: calendar.active, from: realFrom, to: lastPeriod?.to ?? realTo, periods },
    savingsLedger: buildSavingsLedger(input.transactions, savingsAccounts, periods),
    payday: input.to >= todayIso ? buildPaydayBudget(input.transactions, recurring, savingsAccounts, todayIso) : null,
    balances,
    cushion,
    insights: buildInsights(view, recurring, budgets, forecast, cushion, compare),
    trendBadges,
    advice: buildAdvice(view, recurring, budgets, forecast, cushion),
  }
}

// ─────────────────────── Insights and advice ───────────────────────

function recurringMonthly(recurring: RecurringCharge[]) {
  return sum(recurring.map((item) => item.monthly))
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
  const { subscriptions, bills } = splitRecurring(recurring)
  if (subscriptions.length) insights.push(`${subscriptions.length} suscripciones: ~${euro.format(recurringMonthly(subscriptions))}/mes (${euro.format(recurringMonthly(subscriptions) * 12)}/año).`)
  if (bills.length) insights.push(`${bills.length} recibos: ~${euro.format(recurringMonthly(bills))}/mes (${euro.format(recurringMonthly(bills) * 12)}/año).`)
  for (const item of recurring.filter((r) => r.status === "increase")) {
    insights.push(`${item.name} ha subido de ${euro.format(item.previousAmount)} a ${euro.format(item.amount)}.`)
  }
  for (const item of recurring.filter((r) => r.status === "new")) {
    insights.push(`Posible suscripción nueva: ${item.name} (${euro.format(item.amount)}/${item.cadence === "yearly" ? "año" : "mes"}).`)
  }
  if (forecast && forecast.daysElapsed < forecast.daysInMonth) {
    insights.push(`Previsión de ${forecast.label}: ~${euro.format(forecast.projected)} de gasto.`)
  }
  if (cushion) insights.push(`Tus ahorros cubren ${cushion.months.toFixed(1)} meses de tu gasto actual.`)
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
  const split = splitRecurring(recurring)
  if (split.bills.length) summary.push(`Tus recibos suman ~${euro.format(recurringMonthly(split.bills))} al mes.`)
  if (split.subscriptions.length) summary.push(`Tus suscripciones suman ~${euro.format(recurringMonthly(split.subscriptions))} al mes.`)
  const increase = recurring.find((item) => item.status === "increase")
  if (increase) actions.push(`${increase.name} ha subido ${euro.format(increase.amount - increase.previousAmount)}/mes: revisa la tarifa o cámbiala.`)
  const subs = split.subscriptions
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
  if (view.smallPurchases.count >= 15 && view.smallPurchases.total >= 40) {
    actions.push(`${view.smallPurchases.count} compras de menos de ${view.smallPurchases.threshold} € suman ${euro.format(view.smallPurchases.total)}: los gastos hormiga cuentan.`)
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
  const recurringLine = (item: RecurringCharge) => {
    const note = item.status === "increase" ? ` (subió desde ${euro.format(item.previousAmount)})` : item.status === "new" ? " (nuevo)" : ""
    return `- ${item.name}: ${euro.format(item.amount)}/${item.cadence === "yearly" ? "año" : "mes"} (${euro.format(item.annual)}/año)${note}`
  }
  const groups = splitRecurring(analysis.recurring)
  if (groups.bills.length) lines.push("", "Recibos:", ...groups.bills.map(recurringLine))
  if (groups.subscriptions.length) lines.push("", "Suscripciones:", ...groups.subscriptions.map(recurringLine))
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
