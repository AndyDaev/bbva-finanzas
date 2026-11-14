import { isAuthenticated, json } from "../_lib/auth.js"

export async function onRequestGet(context) {
  const ok = await isAuthenticated(context.request, context.env)
  return json({ authenticated: ok })
}
