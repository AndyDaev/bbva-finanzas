import { isAuthenticated, unauthorized } from "../_lib/auth.js"

// The bank callback is reached from BBVA/Enable Banking, where the session cookie may not
// travel (bank app, another browser, cross-site redirects). It is protected instead by the
// single-use random `state` (30 min TTL) and only stores the consent; it returns no data.
const PUBLIC = new Set(["/api/login", "/api/me", "/api/bank/callback"])

export async function onRequest(context) {
  const url = new URL(context.request.url)
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
      },
    })
  }

  if (PUBLIC.has(url.pathname) || url.pathname === "/api/login/") {
    return context.next()
  }

  const ok = await isAuthenticated(context.request, context.env)
  if (!ok) return unauthorized()
  return context.next()
}
