export const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" })
export const euroWhole = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})

export type Transaction = {
  id?: string
  date: string
  amount: number
  text: string
  category: string
  categoryLocked?: boolean
  account: string
  balanceAfter?: number
}

export type Budget = {
  category: string
  monthlyLimit: number
}

export type MonthPoint = {
  index: number
  month: string
  label: string
  income: number
  expense: number
  savings: number
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
  name: string
  category: string
  amount: number
  months: number
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
  months: MonthPoint[]
  categories: NamedAmount[]
  incomeSources: NamedAmount[]
  merchants: NamedAmount[]
  biggest: NamedAmount[]
  ticketItems: NamedAmount[]
  recurring: RecurringCharge[]
  monthCompare: MonthCompare | null
  vsAverageBadge: string | null
  budgets: BudgetStatus[]
  insights: string[]
  trendBadges: string[]
  advice: Advice
}

export const FIXED_CATEGORIES = new Set([
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Comisiones",
])

export const CATEGORY_OPTIONS = [
  "Nómina",
  "Otros ingresos",
  "Bizum recibido",
  "Bizum enviado",
  "Ahorro",
  "Traspaso interno",
  "Transferencias",
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Supermercado",
  "Restauración",
  "Comida a domicilio",
  "Transporte",
  "Salud",
  "Compras",
  "Ocio",
  "Viajes",
  "Comisiones",
  "Devolución",
  "Otros gastos",
]

const RULES: Array<[RegExp, string, ("in" | "out")?]> = [
  [/traspaso a (cuenta|ahorro)|traspaso.*ahorro/i, "Ahorro", "out"],
  [/traspaso/i, "Traspaso interno"],
  [/\bbizum\b/i, "Bizum", "in"],
  [/\bbizum\b/i, "Bizum", "out"],
  [/\bn[oó]mina\b|\bsalario\b|\bhaberes\b|\bpayroll\b/i, "Nómina", "in"],
  [/\bn[oó]mina inversa\b/i, "Otros ingresos", "in"],
  [/\bdevoluci[oó]n\b|\breembolso\b/i, "Devolución", "in"],
  [/\balquiler\b|\brenta piso\b|\barrendamiento\b/i, "Vivienda", "out"],
  [/\bhipoteca\b|\bpr[eé]stamo vivienda\b/i, "Vivienda", "out"],
  [/\bluz\b|\belectric|\biberdrola\b|\bendesa\b|\bnaturgy\b|\bgas natural\b|\bagua\b|\bcanal isabel/i, "Suministros", "out"],
  [/netflix|spotify|\bhbo\b|disney|prime video|\bdazn\b|\bfilmin\b|youtube premium|\bicloud\b|google one/i, "Suscripciones", "out"],
  [/movistar|vodafone|\borange\b|\bdigi\b|masmovil|m[aá]sm[oó]vil|pepephone|\bsimyo\b/i, "Telecomunicaciones", "out"],
  [/mercadona|carrefour|\blidl\b|\baldi\b|\beroski\b|\bconsum\b|\bdia\b|\balcampo\b|\bhipercor\b|ahorramas|ahorra m[aá]s|supermercado|autoservicio/i, "Supermercado", "out"],
  [/\bglovo\b|just eat|uber eats|uber\s*eats/i, "Comida a domicilio", "out"],
  [/restaur|\bbar\b|cafeter|mcdonald|burger|telepizza|\bgoiko\b|\bkfc\b|starbucks|domino/i, "Restauración", "out"],
  [/\brepsol\b|\bcepsa\b|\bgalp\b|\bbp\b|\bshell\b|gasolin|\bparking\b|\bemt\b|\bmetro\b|\bcabify\b|\buber\b|\bbolt\b/i, "Transporte", "out"],
  [/\bryanair\b|\bvueling\b|\biberia\b|\bair europa\b|\bbooking\b|\bairbnb\b|\brenfe\b|\bavlo\b|\beurowings\b|\bhotel\b|\bhostal\b/i, "Viajes", "out"],
  [/farmacia|\bhospital\b|\bsanitas\b|\badeslas\b|mapfre salud|\bdentista\b|cl[ií]nica/i, "Salud", "out"],
  [/\bzara\b|\bmango\b|\bprimark\b|el corte|\bamazon\b|mediamarkt|\bikea\b|\bdecathlon\b|pccomponentes|\bfnac\b/i, "Compras", "out"],
  [/gimnas|fitness|basic[- ]?fit|\bmcfit\b|entrenador|\bcine\b|\bteatro\b|\bsteam\b|playstation|\bnintendo\b/i, "Ocio", "out"],
  [/transferencia/i, "Transferencias"],
  [/comisi[oó]n|mantenimiento cuenta/i, "Comisiones", "out"],
]

const STOP = new Set(["pago", "con", "tarjeta", "compra", "compras", "es", "la", "el", "los", "las", "de", "del", "en", "a", "y", "por", "desde", "cuenta", "abono", "tpv"])

const MIN_TREND_EUR = 15

export function categorize(text: string, amount: number) {
  const source = String(text || "").normalize("NFKC")
  const direction = amount > 0 ? "in" : amount < 0 ? "out" : null
  for (const [pattern, category, when] of RULES) {
    if (when && direction && when !== direction) continue
    if (!pattern.test(source)) continue
    if (category === "Bizum") return amount >= 0 ? "Bizum recibido" : "Bizum enviado"
    return category
  }
  if (amount > 0 && /pago con tarjeta|abono/i.test(source)) return "Devolución"
  if (amount > 0) return "Otros ingresos"
  return "Otros gastos"
}

/** Stable fingerprint for matching the same bank row across imports. */
export function transactionFingerprint(tx: { date: string, amount: number, text: string, account: string }) {
  const amount = Number(tx.amount)
  const normalizedAmount = Number.isFinite(amount) ? amount.toFixed(2) : "0.00"
  return `${tx.date}|${normalizedAmount}|${String(tx.text || "").trim().toLocaleLowerCase("es")}|${String(tx.account || "").trim().toLocaleLowerCase("es")}`
}

function hash32(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Assign deterministic IDs (occurrence-aware) so ticket links survive reimport. */
export function withStableIds(rows: Transaction[]): Transaction[] {
  const seen = new Map<string, number>()
  return rows.map((tx) => {
    const fp = transactionFingerprint(tx)
    const n = seen.get(fp) || 0
    seen.set(fp, n + 1)
    return { ...tx, id: `tx_${hash32(`${fp}#${n}`)}` }
  })
}

export function isFixedCategory(category: string) {
  return FIXED_CATEGORIES.has(category)
}

export function cleanName(text: string) {
  return String(text || "").split(" · ")[0]?.replace(/\s+/g, " ").trim() || "Movimiento"
}

function merchantKey(text: string) {
  const words = cleanName(text)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
  const unique = words.filter((word, index) => word !== words[index - 1])
  return unique.slice(0, 3).join(" ")
}

export function describeMerchant(name: string, category: string) {
  const text = String(name || "").toLowerCase()
  if (/hotel|hostal|hostel|airbnb|ryanair|vueling|booking/.test(text)) return "Viajes / alojamiento."
  if (/farmacia|clinica|clínica|hospital|dentista/.test(text)) return "Salud: farmacia o clínica."
  if (/supermercado|mercadona|lidl|carrefour|aldi|consum|autoservicio|familia/.test(text)) return "Alimentación / supermercado."
  if (/glovo|just eat|uber eats/.test(text)) return "Comida a domicilio."
  if (/restaur|bar |cafeter|mcdonald|burger/.test(text)) return "Comida fuera / restauración."
  if (/fnac|zara|mango|amazon|ikea|decathlon|primark|corte/.test(text)) return "Compras de retail."
  if (/repsol|cepsa|galp|parking|metro|uber|cabify|emt/.test(text)) return "Transporte o combustible."
  if (/netflix|spotify|disney|prime|icloud/.test(text)) return "Suscripción digital."
  return `Gasto clasificado como ${category}.`
}

function labelMonth(key: string) {
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00`))
}

function shortMonth(key: string) {
  return new Intl.DateTimeFormat("es-ES", { month: "short" }).format(new Date(`${key}-01T00:00:00`))
}

function pctDelta(current: number, previous: number) {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}

function formatPct(value: number) {
  const signed = value > 0 ? `+${Math.round(value * 100)}` : `${Math.round(value * 100)}`
  return `${signed} %`
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function resolveCategory(tx: Transaction) {
  if (tx.categoryLocked && tx.category) return tx.category
  return categorize(tx.text, tx.amount)
}

export function recompute(
  transactions: Transaction[],
  tickets: TicketLike[] = [],
  budgets: Budget[] = [],
  options: { today?: string } = {},
): View {
  let income = 0
  let expense = 0
  let toSavings = 0
  let purchaseCount = 0
  let fixedSpend = 0
  let flexibleSpend = 0
  const byMonth = new Map<string, { income: number, expense: number, savings: number }>()
  const byCategory = new Map<string, number>()
  const byIncome = new Map<string, number>()
  const byMerchant = new Map<string, { name: string, category: string, amount: number, count: number, amounts: number[], months: Set<string> }>()
  const byTicketItem = new Map<string, { name: string, amount: number, count: number }>()
  const byMonthCategory = new Map<string, Map<string, number>>()
  const byMonthMerchant = new Map<string, Map<string, { name: string, amount: number }>>()
  const biggest: Transaction[] = []
  const refunds: Transaction[] = []
  const linkedTicketByTx = new Map<string, TicketLike>()
  const todayIso = options.today || isoDate(new Date())

  for (const ticket of tickets) {
    if (ticket.transactionId) linkedTicketByTx.set(ticket.transactionId, ticket)
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

  const normalized = transactions.map((tx) => ({
    ...tx,
    category: resolveCategory(tx),
  }))

  for (const tx of normalized) {
    if (tx.category === "Traspaso interno") continue
    if (tx.amount > 0 && tx.category === "Devolución") {
      refunds.push(tx)
      continue
    }

    const month = tx.date.slice(0, 7)
    if (!byMonth.has(month)) byMonth.set(month, { income: 0, expense: 0, savings: 0 })
    const bucket = byMonth.get(month)!

    if (tx.amount >= 0) {
      income += tx.amount
      bucket.income += tx.amount
      byIncome.set(tx.category, (byIncome.get(tx.category) || 0) + tx.amount)
      continue
    }

    const spent = Math.abs(tx.amount)
    if (tx.category === "Ahorro") {
      toSavings += spent
      bucket.savings += spent
      continue
    }

    expense += spent
    purchaseCount += 1
    bucket.expense += spent
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + spent)
    if (isFixedCategory(tx.category)) fixedSpend += spent
    else flexibleSpend += spent
    biggest.push(tx)

    if (!byMonthCategory.has(month)) byMonthCategory.set(month, new Map())
    const catMonth = byMonthCategory.get(month)!
    catMonth.set(tx.category, (catMonth.get(tx.category) || 0) + spent)

    const linked = tx.id ? linkedTicketByTx.get(tx.id) : undefined
    const label = linked?.merchant?.trim() || cleanName(tx.text)
    const key = merchantKey(label) || merchantKey(tx.text)
    if (!key) continue

    if (!byMerchant.has(key)) {
      byMerchant.set(key, { name: label, category: tx.category, amount: 0, count: 0, amounts: [], months: new Set() })
    }
    const merchant = byMerchant.get(key)!
    merchant.amount += spent
    merchant.count += 1
    merchant.amounts.push(tx.amount)
    merchant.months.add(month)

    if (!byMonthMerchant.has(month)) byMonthMerchant.set(month, new Map())
    const merchMonth = byMonthMerchant.get(month)!
    const currentMerch = merchMonth.get(key) || { name: label, amount: 0 }
    currentMerch.amount += spent
    merchMonth.set(key, currentMerch)
  }

  for (const tx of refunds) {
    const refund = tx.amount
    const category = categorize(tx.text, -refund)
    expense = Math.max(0, expense - refund)
    if (isFixedCategory(category)) fixedSpend = Math.max(0, fixedSpend - refund)
    else flexibleSpend = Math.max(0, flexibleSpend - refund)
    if (byCategory.has(category)) {
      byCategory.set(category, Math.max(0, byCategory.get(category)! - refund))
    }
    const key = merchantKey(tx.text)
    const merchant = key ? byMerchant.get(key) : undefined
    if (merchant) merchant.amount = Math.max(0, merchant.amount - refund)
  }

  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, values], index) => ({
      index,
      month,
      label: shortMonth(month),
      ...values,
    }))

  const share = (amount: number, total: number) => (total > 0 ? amount / total : 0)
  const categories = [...byCategory.entries()]
    .map(([name, amount]) => ({ name, amount, share: share(amount, expense) }))
    .filter((item) => item.amount > 0.009)
    .sort((a, b) => b.amount - a.amount)
  const incomeSources = [...byIncome.entries()]
    .map(([name, amount]) => ({ name, amount, share: share(amount, income) }))
    .sort((a, b) => b.amount - a.amount)
  const merchants = [...byMerchant.values()]
    .map((item) => ({
      name: item.name,
      category: item.category,
      amount: item.amount,
      count: item.count,
      share: share(item.amount, expense),
      kind: describeMerchant(item.name, item.category),
    }))
    .filter((item) => item.amount > 0.009)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
  const top = biggest
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
  const ticketItems = [...byTicketItem.values()]
    .map((item) => ({
      ...item,
      share: share(item.amount, expense || item.amount),
      kind: "Artículo de ticket",
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const recurring: RecurringCharge[] = []
  for (const merchant of byMerchant.values()) {
    if (merchant.months.size < 3 || merchant.amounts.length < 3) continue
    const avg = merchant.amounts.reduce((sum, value) => sum + value, 0) / merchant.amounts.length
    const stable = merchant.amounts.every((value) => Math.abs(value - avg) / Math.abs(avg) < 0.18)
    if (!stable) continue
    recurring.push({
      name: merchant.name,
      category: merchant.category,
      amount: Math.abs(avg),
      months: merchant.months.size,
    })
  }
  recurring.sort((a, b) => b.amount - a.amount)

  const monthCompare = buildMonthCompare(months, byMonthCategory, byMonthMerchant)
  const vsAverageBadge = buildVsAverageBadge(months)
  const budgetStatuses = buildBudgetStatuses(budgets, byMonthCategory, todayIso, months)

  const net = income - expense
  const unassigned = net - toSavings
  const savingsRate = income > 0 ? net / income : 0
  const insights: string[] = []
  const trendBadges: string[] = []

  if (incomeSources[0]) insights.push(`Tu ingreso principal es ${incomeSources[0].name}: ${euro.format(incomeSources[0].amount)}.`)
  if (toSavings > 0) insights.push(`Has movido ${euro.format(toSavings)} a ahorro.`)
  if (categories[0]) insights.push(`La mayor partida de gasto es ${categories[0].name}: ${euro.format(categories[0].amount)}.`)
  if (merchants[0]) insights.push(`Donde más compras es ${merchants[0].name}: ${euro.format(merchants[0].amount)}.`)
  if (ticketItems[0]) insights.push(`En tickets destaca «${ticketItems[0].name}»: ${euro.format(ticketItems[0].amount)}.`)
  if (recurring.length) {
    const recurringTotal = recurring.reduce((sum, item) => sum + item.amount, 0)
    insights.push(`Hay ${recurring.length} cargos recurrentes, unos ${euro.format(recurringTotal)} al mes.`)
  }
  if (fixedSpend > 0) insights.push(`Gasto fijo aprox. ${euro.format(fixedSpend)}; flexible ${euro.format(flexibleSpend)}.`)
  if (vsAverageBadge) trendBadges.push(vsAverageBadge)
  if (monthCompare) trendBadges.push(...monthCompare.badges)
  for (const budget of budgetStatuses) {
    if (budget.state === "over") insights.push(`Presupuesto ${budget.category}: te pasas ${euro.format(Math.abs(budget.remaining))}.`)
    else if (budget.paceNote) insights.push(budget.paceNote)
  }

  return {
    income,
    expense,
    toSavings,
    net,
    unassigned,
    savingsRate,
    avgExpense: expense / Math.max(months.length, 1),
    avgTicket: purchaseCount ? expense / purchaseCount : 0,
    purchaseCount,
    fixedSpend,
    flexibleSpend,
    months,
    categories,
    incomeSources,
    merchants,
    biggest: top,
    ticketItems,
    recurring: recurring.slice(0, 8),
    monthCompare,
    vsAverageBadge,
    budgets: budgetStatuses,
    insights,
    trendBadges,
    advice: buildAdvice({
      income,
      expense,
      toSavings,
      savingsRate,
      avgTicket: purchaseCount ? expense / purchaseCount : 0,
      categories,
      merchants,
      ticketItems,
      months,
      recurring,
      fixedSpend,
      flexibleSpend,
      monthCompare,
      budgets: budgetStatuses,
    }),
  }
}

function buildMonthCompare(
  months: MonthPoint[],
  byMonthCategory: Map<string, Map<string, number>>,
  byMonthMerchant: Map<string, Map<string, { name: string, amount: number }>>,
): MonthCompare | null {
  const today = new Date()
  const currentPartial = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  const complete = months.filter((item) => item.month < currentPartial)
  if (complete.length < 2) return null
  const current = complete[complete.length - 1]!
  const previous = complete[complete.length - 2]!
  const totalDelta = current.expense - previous.expense
  const totalDeltaPct = pctDelta(current.expense, previous.expense)

  const prevCats = byMonthCategory.get(previous.month) || new Map()
  const currCats = byMonthCategory.get(current.month) || new Map()
  const catNames = new Set([...prevCats.keys(), ...currCats.keys()])
  const categories: TrendDelta[] = [...catNames]
    .map((name) => {
      const prev = prevCats.get(name) || 0
      const curr = currCats.get(name) || 0
      return {
        name,
        previous: prev,
        current: curr,
        delta: curr - prev,
        deltaPct: pctDelta(curr, prev),
        kind: "category" as const,
      }
    })
    .filter((item) => Math.abs(item.delta) >= MIN_TREND_EUR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)

  const prevMerch = byMonthMerchant.get(previous.month) || new Map()
  const currMerch = byMonthMerchant.get(current.month) || new Map()
  const merchKeys = new Set([...prevMerch.keys(), ...currMerch.keys()])
  const merchants: TrendDelta[] = [...merchKeys]
    .map((key) => {
      const prev = prevMerch.get(key)?.amount || 0
      const curr = currMerch.get(key)
      const name = curr?.name || prevMerch.get(key)?.name || key
      const currentAmount = curr?.amount || 0
      return {
        name,
        previous: prev,
        current: currentAmount,
        delta: currentAmount - prev,
        deltaPct: pctDelta(currentAmount, prev),
        kind: "merchant" as const,
      }
    })
    .filter((item) => Math.abs(item.delta) >= MIN_TREND_EUR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)

  const badges: string[] = []
  if (totalDeltaPct != null && Math.abs(totalDeltaPct) >= 0.05) {
    badges.push(`Gasto ${formatPct(totalDeltaPct)} vs mes anterior`)
  }
  for (const item of categories.slice(0, 3)) {
    if (item.deltaPct != null) badges.push(`${item.name} ${formatPct(item.deltaPct)} vs mes anterior`)
    else if (item.delta > 0) badges.push(`${item.name} +${euro.format(item.delta)}`)
  }
  for (const item of merchants.slice(0, 2)) {
    const sign = item.delta >= 0 ? "+" : "−"
    badges.push(`${item.name} ${sign}${euro.format(Math.abs(item.delta))}`)
  }

  return {
    previousMonth: previous.month,
    currentMonth: current.month,
    previousLabel: labelMonth(previous.month),
    currentLabel: labelMonth(current.month),
    totalDeltaPct,
    totalDelta,
    categories,
    merchants,
    badges,
  }
}

function buildVsAverageBadge(months: MonthPoint[]) {
  if (months.length < 2) return null
  const last = months[months.length - 1]!
  const previous = months.slice(0, -1).reduce((sum, item) => sum + item.expense, 0) / (months.length - 1)
  if (!(previous > 0)) return null
  const delta = (last.expense - previous) / previous
  const monthLabel = labelMonth(last.month)
  if (delta > 0.08) return `En ${monthLabel} el gasto va un ${Math.round(delta * 100)} % por encima de la media`
  if (delta < -0.08) return `En ${monthLabel} el gasto va un ${Math.round(Math.abs(delta) * 100)} % por debajo de la media`
  return `El gasto de ${monthLabel} está en línea con la media`
}

function buildBudgetStatuses(
  budgets: Budget[],
  byMonthCategory: Map<string, Map<string, number>>,
  todayIso: string,
  months: MonthPoint[],
): BudgetStatus[] {
  if (!budgets.length) return []
  const today = new Date(`${todayIso}T12:00:00`)
  const monthKey = todayIso.slice(0, 7)
  const hasCurrentMonth = months.some((item) => item.month === monthKey) || byMonthCategory.has(monthKey)
  const targetMonth = hasCurrentMonth
    ? monthKey
    : [...byMonthCategory.keys()].sort().at(-1) || monthKey
  const spentByCat = byMonthCategory.get(targetMonth) || new Map()
  const [year, month] = targetMonth.split("-").map(Number)
  const dim = daysInMonth(year!, (month || 1) - 1)
  const isPartial = targetMonth === monthKey && today.getDate() < dim
  const daysElapsed = targetMonth === monthKey ? Math.max(1, today.getDate()) : dim

  return budgets
    .map((budget) => {
      const spent = spentByCat.get(budget.category) || 0
      const remaining = budget.monthlyLimit - spent
      const ratio = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : 0
      let state: BudgetStatus["state"] = "ok"
      if (ratio >= 1) state = "over"
      else if (ratio >= 0.8) state = "warn"
      let paceOverage: number | null = null
      let paceNote: string | null = null
      if (isPartial && budget.monthlyLimit > 0) {
        const projected = (spent / daysElapsed) * dim
        if (projected > budget.monthlyLimit) {
          paceOverage = projected - budget.monthlyLimit
          paceNote = `A este ritmo te pasas ~${euro.format(paceOverage)} en ${budget.category}`
          if (state === "ok") state = "warn"
        }
      }
      return {
        category: budget.category,
        limit: budget.monthlyLimit,
        spent,
        remaining,
        ratio,
        state,
        paceOverage,
        paceNote,
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

function buildAdvice(input: {
  income: number
  expense: number
  toSavings: number
  savingsRate: number
  avgTicket: number
  categories: NamedAmount[]
  merchants: NamedAmount[]
  ticketItems: NamedAmount[]
  months: MonthPoint[]
  recurring: RecurringCharge[]
  fixedSpend: number
  flexibleSpend: number
  monthCompare: MonthCompare | null
  budgets: BudgetStatus[]
}): Advice {
  const actions: string[] = []
  const summary: string[] = []
  if (input.categories[0]) {
    summary.push(`La categoría que más te pesa es ${input.categories[0].name} (${euro.format(input.categories[0].amount)}).`)
    if ((input.categories[0].share || 0) >= 0.28) {
      actions.push(`Recorta un 10–15 % en ${input.categories[0].name}: unos ${euro.format(input.categories[0].amount * 0.12)}.`)
    }
  }
  if (input.fixedSpend > 0) {
    summary.push(`Unos ${euro.format(input.fixedSpend)} son fijos; te quedan ${euro.format(input.flexibleSpend)} flexibles.`)
  }
  if (input.recurring.length) {
    const total = input.recurring.reduce((sum, item) => sum + item.amount, 0)
    summary.push(`${input.recurring.length} cargos recurrentes suman ~${euro.format(total)} al mes.`)
  }
  if (input.monthCompare?.categories[0] && (input.monthCompare.categories[0].delta || 0) > 0) {
    const mover = input.monthCompare.categories[0]
    actions.push(`${mover.name} subió ${euro.format(mover.delta)} vs el mes anterior: ahí hay margen.`)
  }
  if (input.merchants[0] && (input.merchants[0].count || 0) >= 2) {
    summary.push(`${input.merchants[0].name} concentra ${euro.format(input.merchants[0].amount)} en ${input.merchants[0].count} visitas.`)
    actions.push(`Limita las visitas a ${input.merchants[0].name} o fija un tope semanal.`)
  }
  const over = input.budgets.find((item) => item.state === "over")
  if (over) actions.push(`Baja ${over.category}: ya superas el tope en ${euro.format(Math.abs(over.remaining))}.`)
  else {
    const pace = input.budgets.find((item) => item.paceOverage && item.paceOverage > 0)
    if (pace?.paceNote) actions.push(pace.paceNote)
  }
  if (input.ticketItems[0] && (input.ticketItems[0].count || 0) >= 2) {
    actions.push(`Revisa si puedes reducir «${input.ticketItems[0].name}» o buscar alternativa más barata.`)
  }
  if (input.avgTicket > 0 && input.avgTicket < 12 && input.expense > 80) {
    actions.push(`Ticket medio bajo (${euro.format(input.avgTicket)}): agrupa recados en menos salidas.`)
  }
  if (input.toSavings > 0) summary.push(`Ya mueves ${euro.format(input.toSavings)} a ahorro; mantén ese hábito.`)
  else if (input.income > 0 && input.savingsRate < 0.1) {
    actions.push(`Tu tasa de ahorro es del ${Math.round(input.savingsRate * 100)} %. Traspasa un fijo el día de nómina.`)
  }
  while (actions.length < 3) {
    actions.push(
      actions.length === 0
        ? "Importa más meses o escanea tickets para afinar el consejo."
        : actions.length === 1
          ? "Revisa cada comercio: ¿necesidad o impulso?"
          : "Copia el resumen a ChatGPT si quieres un plan semanal.",
    )
  }
  return { summary, actions: actions.slice(0, 3) }
}

export function chatgptBrief(view: View) {
  const lines = [
    "Analiza mi consumo bancario y dame un plan concreto para gastar menos.",
    `Ingresos: ${euro.format(view.income)}`,
    `Gastos (sin ahorro ni traspasos internos): ${euro.format(view.expense)}`,
    `Fijos ≈ ${euro.format(view.fixedSpend)} · Flexibles ≈ ${euro.format(view.flexibleSpend)}`,
    `Movido a ahorro: ${euro.format(view.toSavings)}`,
    `Tasa de ahorro aprox.: ${Math.round(view.savingsRate * 100)} %`,
    `Compras: ${view.purchaseCount}, ticket medio ${euro.format(view.avgTicket)}`,
    "",
    "Categorías:",
    ...view.categories.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} (${Math.round(item.share * 100)} %)`),
    "",
    "Comercios:",
    ...view.merchants.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} · ${item.count || 0} veces · ${item.kind || ""}`),
  ]
  if (view.recurring.length) {
    lines.push(
      "",
      "Cargos recurrentes:",
      ...view.recurring.map((item) => `- ${item.name}: ~${euro.format(item.amount)}/mes (${item.months} meses)`),
    )
  }
  if (view.monthCompare) {
    lines.push(
      "",
      `Tendencia ${view.monthCompare.currentLabel} vs ${view.monthCompare.previousLabel}:`,
      ...view.monthCompare.badges.map((item) => `- ${item}`),
    )
  }
  if (view.budgets.length) {
    lines.push(
      "",
      "Presupuestos del mes:",
      ...view.budgets.map((item) => {
        const status = item.state === "over" ? "PASADO" : item.state === "warn" ? "cerca" : "ok"
        return `- ${item.category}: ${euro.format(item.spent)} / ${euro.format(item.limit)} (${status})`
      }),
    )
  }
  if (view.ticketItems.length) {
    lines.push(
      "",
      "Artículos de tickets:",
      ...view.ticketItems.slice(0, 8).map((item) => `- ${item.name}: ${euro.format(item.amount)} · ${item.count || 0} veces`),
    )
  }
  lines.push("", "Sin IBAN ni datos de tarjeta. Responde en español.")
  return lines.join("\n")
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

export function guessAccountName(filename: string, index = 0) {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{4}Y-\d{2}M-\d{2}D-\d{2}_\d{2}_\d{2}-/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  if (base && !/ultimos movimientos|últimos movimientos|movimientos/i.test(base)) return base.slice(0, 48)
  return index > 0 ? `BBVA cuenta ${index}` : "BBVA importado"
}

/**
 * Non-destructive merge: keeps history not present in the new file,
 * updates matched rows (preserving locked categories and existing ids).
 */
export function replaceAccountTransactions(existing: Transaction[], incoming: Transaction[]) {
  const incomingStable = withStableIds(incoming)
  const buckets = new Map<string, Transaction[]>()
  for (const item of existing) {
    const fp = transactionFingerprint(item)
    const list = buckets.get(fp) || []
    list.push(item)
    buckets.set(fp, list)
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
  }

  const matched = new Set<Transaction>()
  const mergedIncoming: Transaction[] = []
  for (const item of incomingStable) {
    const bucket = buckets.get(transactionFingerprint(item)) || []
    const match = bucket.find((row) => !matched.has(row))
    if (match) {
      matched.add(match)
      mergedIncoming.push({
        ...item,
        id: match.id || item.id,
        category: match.categoryLocked ? match.category : item.category,
        categoryLocked: Boolean(match.categoryLocked),
        balanceAfter: typeof item.balanceAfter === "number" ? item.balanceAfter : match.balanceAfter,
      })
    } else {
      mergedIncoming.push(item)
    }
  }

  const keptHistory = existing.filter((item) => !matched.has(item))
  const map = new Map<string, Transaction>()
  for (const item of [...keptHistory, ...mergedIncoming]) {
    const key = item.id || `${transactionFingerprint(item)}|${map.size}`
    map.set(key, item)
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function accountsFromTransactions(transactions: Transaction[]) {
  const map = new Map<string, { name: string, balance: number | null, balanceDate: string }>()
  for (const tx of transactions) {
    const current = map.get(tx.account) || { name: tx.account, balance: null, balanceDate: "" }
    if (typeof tx.balanceAfter === "number") {
      if (!current.balanceDate || tx.date > current.balanceDate) {
        current.balance = tx.balanceAfter
        current.balanceDate = tx.date
      }
    }
    map.set(tx.account, current)
  }
  return [...map.values()].map((item) => ({
    name: item.name,
    balance: item.balance,
  }))
}
