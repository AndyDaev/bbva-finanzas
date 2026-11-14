import { createSessionCookie, json, passwordMatches } from "../_lib/auth.js"

export async function onRequestPost(context) {
  let body
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "JSON inválido" }, { status: 400 })
  }
  const ok = await passwordMatches(context.env, body?.password)
  if (!ok) return json({ error: "Contraseña incorrecta" }, { status: 401 })
  const cookie = await createSessionCookie(context.env)
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": cookie,
      },
    },
  )
}
