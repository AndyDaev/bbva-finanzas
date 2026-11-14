const COOKIE = "bbva_session"
const MAX_AGE_SEC = 60 * 60 * 24 * 30

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function base64UrlEncode(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return bytesToHex(new Uint8Array(digest))
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return base64UrlEncode(new Uint8Array(signature))
}

export async function createSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ exp })))
  const signature = await hmacSign(env.SESSION_SECRET, payload)
  const value = `${payload}.${signature}`
  const secure = "Secure; "
  return `${COOKIE}=${value}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${MAX_AGE_SEC}`
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || ""
  const parts = header.split(";").map((part) => part.trim())
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) return part.slice(name.length + 1)
  }
  return null
}

export async function isAuthenticated(request, env) {
  if (!env.SESSION_SECRET || !env.APP_PASSWORD_HASH) return false
  const raw = readCookie(request, COOKIE)
  if (!raw) return false
  const [payload, signature] = raw.split(".")
  if (!payload || !signature) return false
  const expected = await hmacSign(env.SESSION_SECRET, payload)
  if (expected !== signature) return false
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)))
    if (!json.exp || json.exp < Math.floor(Date.now() / 1000)) return false
    return true
  } catch {
    return false
  }
}

export async function passwordMatches(env, password) {
  if (!env.APP_PASSWORD_HASH) return false
  const hash = await sha256Hex(String(password || ""))
  return hash === String(env.APP_PASSWORD_HASH).toLowerCase()
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set("Content-Type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function unauthorized() {
  return json({ error: "No autorizado" }, { status: 401 })
}
