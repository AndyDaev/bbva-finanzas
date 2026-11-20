import type { Budget, Transaction } from "./money"
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
  updatedAt: string | null
}

type ApiData = StoreData & {
  importStats?: { inserted: number, updated: number, total: number }
}

function empty(): StoreData {
  return { transactions: [], tickets: [], budgets: [], updatedAt: null }
}

export function loadCache(): StoreData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (!legacy) return empty()
      const parsed = JSON.parse(legacy) as Partial<StoreData>
      return {
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
        budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
        updatedAt: parsed.updatedAt || null,
      }
    }
    const parsed = JSON.parse(raw) as StoreData
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
      updatedAt: parsed.updatedAt || null,
    }
  } catch {
    return empty()
  }
}

export function saveCache(data: StoreData) {
  localStorage.setItem(KEY, JSON.stringify({
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString(),
  }))
}

export function clearLocalData() {
  localStorage.removeItem(KEY)
  localStorage.removeItem(LEGACY_KEY)
}

export async function clearApiCaches() {
  if (!("caches" in window)) return
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => /api-cache|workbox|bbva/i.test(key))
      .map((key) => caches.delete(key)),
  )
}

function normalize(data: ApiData): StoreData {
  return {
    transactions: data.transactions || [],
    tickets: data.tickets || [],
    budgets: data.budgets || [],
    updatedAt: data.updatedAt || null,
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  })
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED")
  }
  if (response.status === 429) {
    throw new Error("Demasiados intentos. Espera un minuto.")
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `Error ${response.status}`)
  }
  return data as T
}

export async function checkSession() {
  try {
    const data = await api<{ authenticated: boolean }>("/api/me")
    return Boolean(data.authenticated)
  } catch {
    return false
  }
}

export async function login(password: string) {
  await api<{ ok: boolean }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

export async function logout() {
  await api<{ ok: boolean }>("/api/logout", { method: "POST" })
}

export async function fetchData(): Promise<StoreData> {
  const data = normalize(await api<ApiData>("/api/data"))
  saveCache(data)
  return data
}

export async function importTransactions(transactions: Transaction[]) {
  const raw = await api<ApiData>("/api/import", {
    method: "POST",
    body: JSON.stringify({ transactions }),
  })
  const data = normalize(raw)
  saveCache(data)
  return Object.assign(data, { importStats: raw.importStats }) as StoreData & {
    importStats?: { inserted: number, updated: number, total: number }
  }
}

export async function saveTicket(ticket: StoredTicket) {
  const data = normalize(await api<ApiData>("/api/tickets", {
    method: "PUT",
    body: JSON.stringify({ ticket }),
  }))
  saveCache(data)
  return data
}

export async function deleteTicket(id: string) {
  const data = normalize(await api<ApiData>(`/api/tickets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }))
  saveCache(data)
  return data
}

export async function saveBudgets(budgets: Budget[]) {
  const data = normalize(await api<ApiData>("/api/budgets", {
    method: "PUT",
    body: JSON.stringify({ budgets }),
  }))
  saveCache(data)
  return data
}

export async function patchTransactionCategory(id: string, category: string) {
  const data = normalize(await api<ApiData>(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ category }),
  }))
  saveCache(data)
  return data
}

/** Offline-friendly: seed server from local cache once if cloud is empty. */
export async function migrateLocalIfNeeded(local: StoreData) {
  if (!local.transactions.length && !local.tickets.length && !local.budgets.length) return null
  const remote = await fetchData()
  if (remote.transactions.length || remote.tickets.length || remote.budgets.length) return remote
  let data = remote
  if (local.transactions.length) {
    data = await importTransactions(local.transactions)
  }
  for (const ticket of local.tickets) {
    data = await saveTicket(ticket)
  }
  if (local.budgets.length) {
    data = await saveBudgets(local.budgets)
  }
  return data
}
