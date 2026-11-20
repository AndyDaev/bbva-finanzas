import { computed, ref } from "vue"
import {
  accountsFromTransactions,
  analyze,
  chatgptBrief,
  cleanName,
  formatDay,
  guessAccountName,
  isoDate,
  normalizeTransactions,
  replaceAccountTransactions,
  ruleMatches,
  sortRules,
  suggestPattern,
  type Budget,
  type Transaction,
  type UserRule,
} from "./money"
import { parseBankFile } from "./importFile"
import {
  checkSession,
  clearApiCaches,
  clearLocalData,
  deleteRule,
  deleteTicket,
  fetchData,
  importTransactions,
  loadCache,
  login,
  logout,
  migrateLocalIfNeeded,
  patchTransactionCategory,
  saveBudgets,
  saveCache,
  saveRule,
  saveTicket,
  type StoreData,
  type StoredTicket,
} from "./store"
import { matchTransactions, parseTicketText, scanTicketImage, type TicketDraft } from "./tickets"

export type Tab = "resumen" | "evolucion" | "comercios" | "tickets" | "movimientos" | "reglas"
export type Period = "1m" | "3m" | "6m" | "1y" | "custom"

export const BUDGET_CATEGORIES = [
  "Supermercado",
  "Restauración",
  "Comida a domicilio",
  "Compras",
  "Ocio",
  "Viajes",
  "Transporte",
  "Salud",
  "Suscripciones",
]

export type RuleSuggestion = {
  pattern: string
  category: string
  direction: "in" | "out"
  count: number
  sample: string
}

const PERIOD_MONTHS: Record<Exclude<Period, "custom">, number> = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 }

/** First day of the month that makes the range cover exactly `months` calendar months, today included. */
export function periodStart(period: Exclude<Period, "custom">, today = new Date()) {
  return isoDate(new Date(today.getFullYear(), today.getMonth() - (PERIOD_MONTHS[period] - 1), 1))
}

// ───── Module-level singleton state (one app, one store) ─────

const authed = ref(false)
const authChecked = ref(false)
const tab = ref<Tab>("resumen")
const transactions = ref<Transaction[]>([])
const tickets = ref<StoredTicket[]>([])
const budgets = ref<Budget[]>([])
const rules = ref<UserRule[]>([])
const budgetDraft = ref<Record<string, string>>({})
const updatedAt = ref<string | null>(null)
const notice = ref("")
const busy = ref(false)
const offline = ref(false)
const account = ref("all")
const category = ref("all")
const query = ref("")
const period = ref<Period>("6m")
const from = ref(periodStart("6m"))
const to = ref(isoDate(new Date()))
const draft = ref<TicketDraft | null>(null)
const selectedTxId = ref("none")
const scanBusy = ref(false)
const suggestion = ref<RuleSuggestion | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

// ───── Derived data ─────

const sortedRules = computed(() => sortRules(rules.value))
const normalized = computed(() => normalizeTransactions(transactions.value, rules.value))
const accountTx = computed(() =>
  account.value === "all" ? normalized.value : normalized.value.filter((tx) => tx.account === account.value),
)
const analysis = computed(() =>
  analyze({
    transactions: accountTx.value,
    tickets: tickets.value,
    budgets: budgets.value,
    rules: rules.value,
    from: from.value,
    to: to.value,
  }),
)
const view = computed(() => analysis.value.view)
const periodTx = computed(() => accountTx.value.filter((tx) => tx.date >= from.value && tx.date <= to.value))
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase("es")
  return periodTx.value.filter((tx) => {
    if (category.value !== "all" && tx.category !== category.value) return false
    if (needle && !`${tx.text} ${tx.category}`.toLocaleLowerCase("es").includes(needle)) return false
    return true
  })
})
const accounts = computed(() => accountsFromTransactions(transactions.value))
const categories = computed(() => [...new Set(normalized.value.map((tx) => tx.category))].sort())
const hasData = computed(() => transactions.value.length > 0 || tickets.value.length > 0)
const ticketMatches = computed(() => (draft.value ? matchTransactions(draft.value, transactions.value) : []))
const ruleCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const rule of rules.value) {
    counts.set(rule.id, transactions.value.filter((tx) => !tx.categoryLocked && ruleMatches(rule, tx.text, tx.amount)).length)
  }
  return counts
})
/**
 * Stable category → color map: the 6 biggest spending categories across the whole
 * history get the categorical slots; everything else is "Resto" gray. Filters never repaint.
 */
const SERIES_SLOTS = 6
const categoryColors = computed(() => {
  const totals = new Map<string, number>()
  for (const tx of normalized.value) {
    if (tx.amount < 0 && !["Ahorro", "Traspaso interno"].includes(tx.category)) {
      totals.set(tx.category, (totals.get(tx.category) || 0) - tx.amount)
    }
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, SERIES_SLOTS).map(([name]) => name)
  const map = new Map(top.map((name, index) => [name, `var(--series-${index + 1})`]))
  return { top, color: (name: string) => map.get(name) || "var(--series-other)" }
})
const updatedLabel = computed(() => {
  if (!updatedAt.value) return null
  const date = new Date(updatedAt.value)
  if (Number.isNaN(date.valueOf())) return null
  const time = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  return isoDate(date) === isoDate(new Date()) ? `Actualizado hoy ${time}` : `Actualizado ${formatDay(isoDate(date))} ${time}`
})

// ───── Helpers ─────

function flash(message: string) {
  notice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ""
  }, 4200)
}

function snapshot(): StoreData {
  return {
    transactions: transactions.value,
    tickets: tickets.value,
    budgets: budgets.value,
    rules: rules.value,
    updatedAt: updatedAt.value,
  }
}

function persist(stamp: string | null = new Date().toISOString()) {
  if (stamp) updatedAt.value = stamp
  saveCache(snapshot())
}

function syncBudgetDraft() {
  const draftMap: Record<string, string> = {}
  for (const name of BUDGET_CATEGORIES) {
    const found = budgets.value.find((item) => item.category === name)
    draftMap[name] = found ? String(found.monthlyLimit) : ""
  }
  for (const item of budgets.value) if (!(item.category in draftMap)) draftMap[item.category] = String(item.monthlyLimit)
  budgetDraft.value = draftMap
}

function applyData(data: StoreData) {
  transactions.value = data.transactions
  tickets.value = data.tickets
  budgets.value = data.budgets
  rules.value = data.rules
  updatedAt.value = data.updatedAt || null
  syncBudgetDraft()
  saveCache(data)
}

function isUnauthorized(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHORIZED"
}

function handleUnauthorized() {
  authed.value = false
  flash("Sesión caducada. Vuelve a entrar.")
}

/** Runs a cloud write; on network failure applies `offlineApply` locally instead. */
async function cloudOrLocal<T>(remote: () => Promise<T>, onRemote: (result: T) => void, offlineApply: () => void, offlineMessage: string) {
  try {
    onRemote(await remote())
    offline.value = false
    return true
  } catch (error) {
    if (isUnauthorized(error)) {
      handleUnauthorized()
      return false
    }
    offlineApply()
    persist()
    offline.value = true
    flash(offlineMessage)
    return false
  }
}

// ───── Actions ─────

function applyPeriod(next: Period) {
  period.value = next
  if (next === "custom") return
  from.value = periodStart(next)
  to.value = isoDate(new Date())
}

async function init() {
  const cache = loadCache()
  if (cache.transactions.length || cache.tickets.length) applyData(cache)
  const ok = await checkSession()
  authChecked.value = true
  authed.value = ok
  if (!ok) return
  try {
    applyData((await migrateLocalIfNeeded(cache)) || (await fetchData()))
    offline.value = false
  } catch (error) {
    offline.value = true
    flash(isUnauthorized(error) ? "Sesión caducada. Vuelve a entrar." : "Sin conexión: mostrando la última copia local.")
  }
}

async function doLogin(password: string) {
  await login(password)
  authed.value = true
  applyData((await migrateLocalIfNeeded(loadCache())) || (await fetchData()))
  flash("Sesión iniciada.")
}

async function doLogout() {
  try {
    await logout()
  } catch {
    // ignore
  }
  clearLocalData()
  await clearApiCaches()
  applyData({ transactions: [], tickets: [], budgets: [], rules: [], updatedAt: null })
  clearLocalData()
  authed.value = false
  flash("Sesión cerrada.")
}

async function importFiles(files: File[], targetAccount = "") {
  if (!files.length) return
  busy.value = true
  notice.value = ""
  try {
    let next = [...transactions.value]
    const incomingAll: Transaction[] = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!
      const guessed = targetAccount || guessAccountName(file.name, files.length > 1 ? index + 1 : 0)
      const name = window.prompt(`Nombre de la cuenta para «${file.name}»`, guessed)
      if (name === null) return
      const incoming = await parseBankFile(file, name.trim() || guessed)
      incomingAll.push(...incoming)
      next = replaceAccountTransactions(next, incoming)
    }
    if (!incomingAll.length) return
    await cloudOrLocal(
      () => importTransactions(incomingAll),
      (result) => {
        applyData(result)
        const stats = result.importStats
        flash(
          stats
            ? `Importado: ${stats.inserted} nuevos, ${stats.updated} ya existentes · ${transactions.value.length} en total.`
            : `Extracto actualizado · ${transactions.value.length} movimientos en total.`,
        )
      },
      () => {
        transactions.value = next
      },
      "Guardado en local (sin nube). Reintenta cuando haya conexión.",
    )
  } catch (error) {
    flash(error instanceof Error ? error.message : "No se pudo importar.")
  } finally {
    busy.value = false
  }
}

async function scanTicket(file: File) {
  scanBusy.value = true
  notice.value = ""
  try {
    draft.value = await scanTicketImage(file)
    selectedTxId.value = matchTransactions(draft.value, periodTx.value)[0]?.id || "none"
    tab.value = "tickets"
  } catch (error) {
    flash(error instanceof Error ? error.message : "No se pudo leer el ticket.")
    draft.value = parseTicketText("")
    tab.value = "tickets"
  } finally {
    scanBusy.value = false
  }
}

async function saveTicketDraft() {
  if (!draft.value) return
  const linked = transactions.value.find((tx) => tx.id === selectedTxId.value)
  const ticket: StoredTicket = {
    ...draft.value,
    id: `ticket-${Date.now()}`,
    createdAt: new Date().toISOString(),
    transactionId: linked?.id || null,
    account: linked?.account || null,
  }
  await cloudOrLocal(
    () => saveTicket(ticket),
    (result) => {
      tickets.value = result.tickets
      persist(result.updatedAt)
      flash("Ticket guardado en la nube.")
    },
    () => {
      tickets.value = [ticket, ...tickets.value]
    },
    "Ticket guardado en local (sin nube).",
  )
  draft.value = null
  selectedTxId.value = "none"
}

async function removeTicket(id: string) {
  await cloudOrLocal(
    () => deleteTicket(id),
    (result) => {
      tickets.value = result.tickets
      persist(result.updatedAt)
    },
    () => {
      tickets.value = tickets.value.filter((item) => item.id !== id)
    },
    "Ticket eliminado en local (sin nube).",
  )
}

async function persistBudgets() {
  const next: Budget[] = Object.entries(budgetDraft.value)
    .map(([name, value]) => ({ category: name, monthlyLimit: Number(String(value).replace(",", ".")) }))
    .filter((item) => item.monthlyLimit > 0)
  await cloudOrLocal(
    () => saveBudgets(next),
    (result) => {
      budgets.value = result.budgets
      persist(result.updatedAt)
      flash("Presupuestos guardados.")
    },
    () => {
      budgets.value = next
    },
    "Presupuestos en local (sin nube).",
  )
}

function replaceTransaction(updated: Transaction) {
  const index = transactions.value.findIndex((tx) => tx.id === updated.id)
  if (index >= 0) transactions.value.splice(index, 1, updated)
}

async function setCategory(tx: Transaction, nextCategory: string) {
  if (!tx.id || tx.category === nextCategory) return
  const original = transactions.value.find((item) => item.id === tx.id)
  if (!original) return
  const previous = { ...original }
  replaceTransaction({ ...original, category: nextCategory, categoryLocked: true })

  // Offer a rule for the other movements of the same merchant.
  const pattern = suggestPattern(tx.text)
  const direction = tx.amount < 0 ? "out" : "in"
  const probe: UserRule = { id: "probe", pattern, matchType: "contains", category: nextCategory, direction }
  const count = pattern
    ? normalized.value.filter((item) => item.id !== tx.id && !item.categoryLocked && item.category !== nextCategory && ruleMatches(probe, item.text, item.amount)).length
    : 0
  suggestion.value = count > 0 ? { pattern, category: nextCategory, direction, count, sample: cleanName(tx.text) } : null

  try {
    const result = await patchTransactionCategory(tx.id, nextCategory)
    replaceTransaction(result.transaction)
    persist(result.updatedAt)
    offline.value = false
    if (!suggestion.value) flash(`Categoría fijada: ${nextCategory}`)
  } catch (error) {
    if (isUnauthorized(error)) {
      replaceTransaction(previous)
      return handleUnauthorized()
    }
    persist()
    offline.value = true
    flash("Categoría guardada en local (sin nube).")
  }
}

/** Releases a manual category so rules decide again. */
async function unlockCategory(tx: Transaction) {
  const original = transactions.value.find((item) => item.id === tx.id)
  if (!original?.id) return
  replaceTransaction({ ...original, categoryLocked: false })
  try {
    const result = await patchTransactionCategory(original.id, original.category, false)
    replaceTransaction(result.transaction)
    persist(result.updatedAt)
  } catch (error) {
    if (isUnauthorized(error)) return handleUnauthorized()
    persist()
    offline.value = true
  }
}

function nextRuleId() {
  return `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

async function upsertRule(rule: Omit<UserRule, "id"> & { id?: string }) {
  const full: UserRule = {
    ...rule,
    id: rule.id || nextRuleId(),
    // Newer rules win over older ones unless a priority is given.
    priority: rule.priority ?? Math.max(0, ...rules.value.map((item) => item.priority || 0)) + 1,
  }
  const ok = await cloudOrLocal(
    () => saveRule(full),
    (result) => {
      rules.value = result.rules
      persist(result.updatedAt)
    },
    () => {
      rules.value = [...rules.value.filter((item) => item.id !== full.id), full]
    },
    "Regla guardada en local (sin nube).",
  )
  if (ok) flash(`Regla guardada: «${full.pattern}» → ${full.category}`)
}

async function acceptSuggestion(pattern?: string) {
  const current = suggestion.value
  if (!current) return
  suggestion.value = null
  await upsertRule({ pattern: pattern || current.pattern, matchType: "contains", category: current.category, direction: current.direction })
}

async function removeRule(id: string) {
  await cloudOrLocal(
    () => deleteRule(id),
    (result) => {
      rules.value = result.rules
      persist(result.updatedAt)
    },
    () => {
      rules.value = rules.value.filter((item) => item.id !== id)
    },
    "Regla eliminada en local (sin nube).",
  )
}

async function copyChatgpt() {
  await navigator.clipboard.writeText(chatgptBrief(analysis.value))
  flash("Resumen copiado. Pégalo en ChatGPT.")
}

function clearLocal() {
  if (!window.confirm("¿Borrar la copia local de este dispositivo? Los datos en la nube no se borran.")) return
  clearLocalData()
  flash("Copia local borrada.")
}

function openMerchant(name: string) {
  query.value = name
  category.value = "all"
  tab.value = "movimientos"
}

function openCategory(name: string) {
  category.value = name
  query.value = ""
  tab.value = "movimientos"
}

export function useFinance() {
  return {
    // state
    authed, authChecked, tab, transactions, tickets, budgets, rules, budgetDraft, updatedAt, notice, busy,
    offline, account, category, query, period, from, to, draft, selectedTxId, scanBusy, suggestion,
    // derived
    sortedRules, normalized, analysis, view, periodTx, filtered, accounts, categories, hasData, ticketMatches,
    ruleCounts, updatedLabel, categoryColors,
    // actions
    flash, applyPeriod, init, doLogin, doLogout, importFiles, scanTicket, saveTicketDraft, removeTicket,
    persistBudgets, setCategory, unlockCategory, upsertRule, acceptSuggestion, removeRule, copyChatgpt,
    clearLocal, openMerchant, openCategory,
  }
}
