import { isAuthenticated, unauthorized } from "../_lib/auth.js"

const PUBLIC = new Set(["/api/login", "/api/me"])

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
