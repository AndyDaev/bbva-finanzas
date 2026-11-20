// Enable Banking (PSD2 account information, read-only) client for Cloudflare Workers.
// Secrets (Cloudflare Pages → Settings → Variables, type "Secret"):
//   EB_APP_ID       application id from the Enable Banking control panel (JWT "kid")
//   EB_PRIVATE_KEY  the application's RSA private key in PEM (PKCS#8 or PKCS#1)
// Docs: https://enablebanking.com/docs/api/reference/

export const EB_API = "https://api.enablebanking.com"
export const BANK = { name: "BBVA", country: "ES" }
const DEFAULT_CONSENT_DAYS = 90

export function isConfigured(env) {
  return Boolean(env.EB_APP_ID && env.EB_PRIVATE_KEY)
}

// ───────────── JWT (RS256 with WebCrypto) ─────────────

function base64UrlFromBytes(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlFromJson(value) {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function derLength(length) {
  if (length < 0x80) return [length]
  const bytes = []
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

function der(tag, content) {
  return new Uint8Array([tag, ...derLength(content.length), ...content])
}

/** Wraps a PKCS#1 RSAPrivateKey into PKCS#8 PrivateKeyInfo (WebCrypto only imports PKCS#8). */
export function pkcs1ToPkcs8(pkcs1) {
  const version = [0x02, 0x01, 0x00]
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octet = der(0x04, pkcs1)
  return der(0x30, new Uint8Array([...version, ...rsaAlgorithm, ...octet]))
}

export function pemToPkcs8(pem) {
  const text = String(pem || "").replace(/\\n/g, "\n").trim()
  const isPkcs1 = text.includes("BEGIN RSA PRIVATE KEY")
  const body = text.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "")
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return isPkcs1 ? pkcs1ToPkcs8(bytes) : bytes
}

const keyCache = new Map()

async function signingKey(pem) {
  if (!keyCache.has(pem)) {
    keyCache.set(
      pem,
      crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]),
    )
  }
  return keyCache.get(pem)
}

export async function createJwt(appId, pem, now = Math.floor(Date.now() / 1000)) {
  const header = base64UrlFromJson({ typ: "JWT", alg: "RS256", kid: appId })
  const body = base64UrlFromJson({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 })
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(pem), new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

// ───────────── HTTP ─────────────

export class BankError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** PSU headers tell the bank the user is present (higher access limits than unattended calls). */
export function psuHeaders(request) {
  const headers = {}
  const ip = request?.headers.get("CF-Connecting-IP")
  const agent = request?.headers.get("User-Agent")
  if (ip) headers["Psu-Ip-Address"] = ip
  if (agent) headers["Psu-User-Agent"] = agent.slice(0, 250)
  return headers
}

export async function ebFetch(env, path, { method = "GET", body, headers = {} } = {}) {
  const jwt = await createJwt(env.EB_APP_ID, env.EB_PRIVATE_KEY)
  const response = await fetch(`${EB_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new BankError(data.message || `Enable Banking ${response.status}`, response.status, data.error || data.code)
  }
  return data
}

export async function startAuthorization(env, { state, redirectUrl, request }) {
  let seconds = DEFAULT_CONSENT_DAYS * 86400
  try {
    const list = await ebFetch(env, `/aspsps?country=${BANK.country}`)
    const bank = (list.aspsps || []).find((item) => String(item.name).toUpperCase() === BANK.name)
    if (bank?.maximum_consent_validity) seconds = Math.min(seconds, Number(bank.maximum_consent_validity))
  } catch {
    // Fall back to the default validity.
  }
  const validUntil = new Date(Date.now() + seconds * 1000).toISOString()
  return ebFetch(env, "/auth", {
    method: "POST",
    headers: psuHeaders(request),
    body: {
      access: { valid_until: validUntil, balances: true, transactions: true },
      aspsp: BANK,
      state,
      redirect_url: redirectUrl,
      psu_type: "personal",
      language: "es",
    },
  })
}

export function createSession(env, code, request) {
  return ebFetch(env, "/sessions", { method: "POST", body: { code }, headers: psuHeaders(request) })
}

export function deleteSession(env, sessionId) {
  return ebFetch(env, `/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
}

export async function fetchAllTransactions(env, accountUid, dateFrom, request, maxPages = 40) {
  const rows = []
  let key = null
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ date_from: dateFrom, transaction_status: "BOOK" })
    if (key) params.set("continuation_key", key)
    const data = await ebFetch(env, `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`, { headers: psuHeaders(request) })
    rows.push(...(data.transactions || []))
    key = data.continuation_key
    if (!key) break
  }
  return rows
}

export async function fetchBookedBalance(env, accountUid, request) {
  const data = await ebFetch(env, `/accounts/${encodeURIComponent(accountUid)}/balances`, { headers: psuHeaders(request) })
  return pickBookedBalance(data.balances || [])
}

// ───────────── Pure mapping helpers (tested) ─────────────

const BOOKED_PREFERENCE = ["CLBD", "ITBD", "XPCD", "CLAV", "ITAV", "OPBD", "OTHR"]

export function pickBookedBalance(balances) {
  const sorted = [...balances].sort((a, b) => {
    const ia = BOOKED_PREFERENCE.indexOf(a.balance_type)
    const ib = BOOKED_PREFERENCE.indexOf(b.balance_type)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const best = sorted[0]
  if (!best) return null
  const amount = Number(best.balance_amount?.amount)
  return Number.isFinite(amount) ? { amount, date: best.reference_date || null, type: best.balance_type } : null
}

function hash32(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim()
}

/** Enable Banking transaction → app transaction row (category is resolved client-side). */
export function mapBankTransaction(raw, accountName, accountUid) {
  const value = Number(raw?.transaction_amount?.amount)
  const date = raw?.booking_date || raw?.value_date || raw?.transaction_date
  if (!Number.isFinite(value) || !date) return null
  const amount = raw.credit_debit_indicator === "DBIT" ? -Math.abs(value) : Math.abs(value)
  const counterparty = clean(amount < 0 ? raw.creditor?.name : raw.debtor?.name)
  const remittance = clean((raw.remittance_information || []).join(" "))
  const parts = [...new Set([remittance, counterparty].filter(Boolean))]
  const text = parts.join(" · ") || clean(raw.note) || "Movimiento"
  const balance = Number(raw.balance_after_transaction?.amount)
  const reference = raw.entry_reference || `${date}|${amount.toFixed(2)}|${text.toLowerCase()}`
  return {
    id: `eb_${hash32(`${accountUid}|${reference}`)}`,
    date: String(date).slice(0, 10),
    amount,
    text,
    account: accountName,
    balanceAfter: Number.isFinite(balance) ? balance : undefined,
  }
}

/**
 * Fills balanceAfter backwards from the current booked balance when the bank does not
 * send it. Only valid for a complete list of booked movements up to the balance date.
 */
export function backfillBalances(rows, booked) {
  if (!booked || rows.some((row) => typeof row.balanceAfter === "number")) return rows
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  if (booked.date && sorted[0] && sorted[0].date > booked.date) return rows
  let running = booked.amount
  for (const row of sorted) {
    row.balanceAfter = Math.round(running * 100) / 100
    running -= row.amount
  }
  return rows
}

/**
 * Decides what to write. Rows already imported from a CSV/Excel (same account, date and
 * amount, non-bank id) are skipped so the two sources never duplicate each other.
 */
export function planBankUpsert(existing, incoming) {
  const byId = new Map(existing.map((row) => [row.id, row]))
  const csvSlots = new Map()
  for (const row of existing) {
    if (String(row.id).startsWith("eb_")) continue
    const key = `${row.date}|${Number(row.amount).toFixed(2)}`
    csvSlots.set(key, (csvSlots.get(key) || 0) + 1)
  }
  const inserts = []
  const updates = []
  let skipped = 0
  for (const row of incoming) {
    if (byId.has(row.id)) {
      updates.push(row)
      continue
    }
    const key = `${row.date}|${row.amount.toFixed(2)}`
    const free = csvSlots.get(key) || 0
    if (free > 0) {
      csvSlots.set(key, free - 1)
      skipped += 1
      continue
    }
    inserts.push(row)
  }
  return { inserts, updates, skipped }
}

export function maskIban(iban) {
  const text = String(iban || "").replace(/\s+/g, "")
  return text.length > 8 ? `${text.slice(0, 4)} •••• ${text.slice(-4)}` : text
}
