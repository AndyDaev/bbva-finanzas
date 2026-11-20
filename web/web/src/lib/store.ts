import type { UserRule } from "./categorize"
import type { Budget, Transaction } from "./ids"
import type { TicketDraft } from "./tickets"

const KEY = "bbva-finanzas-v2"
const LEGACY_KEY = "bbva-finanzas-v1"

export type StoredTicket = TicketDraft & {
  id: string
  createdAt: string
  transactionId?: string | null
  account?: string | null
}

export type StoreData = {
  transactions: Transaction[]
  tickets: StoredTicket[]
  budgets: Budget[]
  rules: UserRule[]
  updatedAt: string | null
}

export type ImportStats = { inserted: number, updated: number, total: number }

function empty(): StoreData {
  return { transactions: [], tickets: [], budgets: [], rules: [], updatedAt: null }
}

const list = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : [])

function normalize(data: Partial<StoreData> | null | undefined): StoreData {
  return {
    transactions: list<Transaction>(data?.transactions),
    tickets: list<StoredTicket>(data?.tickets),
    budgets: list<Budget>(data?.budgets),
    rules: list<UserRule>(data?.rules),
    updatedAt: data?.updatedAt || null,
  }
}

export function loadCache(): StoreData {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    return raw ? normalize(JSON.parse(raw)) : empty()
  } catch {
    return empty()
  }
}

export function saveCache(data: StoreData) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, updatedAt: data.updatedAt || new Date().toISOString() }))
  } catch {
    // Storage full or blocked: the cloud copy is still authoritative.
  }
}

export function clearLocalData() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // ignore
  }
}

export async function clearApiCaches() {
  if (!("caches" in window)) return
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => /api-cache|workbox|bbva/i.test(key)).map((key) => caches.delete(key)))
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  if (response.status === 401) throw new Error("UNAUTHORIZED")
  if (response.status === 429) throw new Error("Demasiados intentos. Espera un minuto.")
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error || `Error ${response.status}`)
  return data as T
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export async function checkSession() {
  try {
    const data = await api<{ authenticated: boolean }>("/api/me")
    return Boolean(data.authenticated)
  } catch {
    return false
  }
}

export async function login(password: string) {
  await api<{ ok: boolean }>("/api/login", send("POST", { password }))
}

export async function logout() {
  await api<{ ok: boolean }>("/api/logout", send("POST"))
}

export async function fetchData(): Promise<StoreData> {
  return normalize(await api<Partial<StoreData>>("/api/data"))
}

export async function importTransactions(transactions: Transaction[]) {
  const raw = await api<Partial<StoreData> & { importStats?: ImportStats }>("/api/import", send("POST", { transactions }))
  return { ...normalize(raw), importStats: raw.importStats }
}

export async function saveTicket(ticket: StoredTicket) {
  return api<{ tickets: StoredTicket[], updatedAt: string }>("/api/tickets", send("PUT", { ticket }))
}

export async function deleteTicket(id: string) {
  return api<{ tickets: StoredTicket[], updatedAt: string }>(`/api/tickets/${encodeURIComponent(id)}`, send("DELETE"))
}

export async function saveBudgets(budgets: Budget[]) {
  return api<{ budgets: Budget[], updatedAt: string }>("/api/budgets", send("PUT", { budgets }))
}

export async function patchTransactionCategory(id: string, category: string, locked = true) {
  return api<{ transaction: Transaction, updatedAt: string }>(
    `/api/transactions/${encodeURIComponent(id)}`,
    send("PATCH", { category, locked }),
  )
}

export async function saveRule(rule: UserRule) {
  return api<{ rules: UserRule[], updatedAt: string }>("/api/rules", send("PUT", { rule }))
}

export async function deleteRule(id: string) {
  return api<{ rules: UserRule[], updatedAt: string }>(`/api/rules/${encodeURIComponent(id)}`, send("DELETE"))
}

// ───── Bank connection (Enable Banking, read-only) ─────

export type BankAccount = { uid: string, label: string, name: string, accountName: string }
export type BankSession = { id: string, validUntil: string, accounts: BankAccount[], createdAt: string, lastSyncAt: string | null, expired?: boolean }
export type SyncStats = { inserted: number, updated: number, skipped: number, accounts: number }

export function bankStatus() {
  return api<{ configured: boolean, sessions: BankSession[] }>("/api/bank/status")
}

export function bankConnect() {
  return api<{ url: string }>("/api/bank/connect", send("POST"))
}

type SyncStep = Partial<StoreData> & {
  done: boolean
  cursor?: unknown
  stats?: SyncStats
  syncStats?: SyncStats
  syncErrors?: Array<{ account: string, message: string }>
  bankSessions?: BankSession[]
}

/** The server syncs in bounded steps; keep calling with its cursor until it is done. */
export async function bankSync(onProgress?: (stats: SyncStats) => void) {
  let cursor: unknown = null
  for (let step = 0; step < 400; step += 1) {
    const raw: SyncStep = await api<SyncStep>("/api/bank/sync", send("POST", { cursor }))
    if (raw.done) {
      return { data: normalize(raw), stats: raw.syncStats!, errors: raw.syncErrors || [], sessions: raw.bankSessions || [] }
    }
    if (raw.stats) onProgress?.(raw.stats)
    cursor = raw.cursor
  }
  throw new Error("La sincronización no terminó. Vuelve a pulsar «Sincronizar».")
}

export function bankRenameAccount(sessionId: string, uid: string, accountName: string) {
  return api<{ bankSessions: BankSession[] }>("/api/bank/accounts", send("PATCH", { sessionId, uid, accountName }))
}

export function bankDisconnect(id: string) {
  return api<{ bankSessions: BankSession[] }>(`/api/bank/sessions/${encodeURIComponent(id)}`, send("DELETE"))
}

/** Offline-friendly: seed the server from the local cache once if the cloud is empty. */
export async function migrateLocalIfNeeded(local: StoreData): Promise<StoreData | null> {
  if (!local.transactions.length && !local.tickets.length && !local.budgets.length && !local.rules.length) return null
  const remote = await fetchData()
  if (remote.transactions.length || remote.tickets.length || remote.budgets.length || remote.rules.length) return remote
  let data = remote
  if (local.transactions.length) data = await importTransactions(local.transactions)
  for (const ticket of local.tickets) data = { ...data, ...(await saveTicket(ticket)) }
  if (local.budgets.length) data = { ...data, ...(await saveBudgets(local.budgets)) }
  for (const rule of local.rules) data = { ...data, ...(await saveRule(rule)) }
  return data
}
