import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import { json } from "../../_lib/auth.js"
import { ensureSchema, getMeta, readJson, setMeta } from "../../_lib/db.js"

/**
 * Reads a receipt photo with Claude (vision) and returns its products, each with a product
 * category, so the app can tell what the supermarket money goes on. The photo is only sent
 * to the Anthropic API; nothing is stored here. Needs the ANTHROPIC_API_KEY secret.
 */

export const PRODUCT_CATEGORIES = [
  "Frutas y verduras",
  "Carne y pescado",
  "Lácteos y huevos",
  "Pan y bollería",
  "Despensa",
  "Congelados",
  "Platos preparados",
  "Bebidas",
  "Alcohol",
  "Snacks y dulces",
  "Limpieza y hogar",
  "Higiene y cuidado",
  "Mascotas",
  "Otros",
]

const Receipt = z.object({
  merchant: z.string().describe("Nombre comercial de la tienda, p. ej. «Mercadona» o «Gadis»"),
  date: z.string().nullable().describe("Fecha de la compra en formato AAAA-MM-DD, o null si no se ve"),
  total: z.number().describe("Total pagado en euros"),
  items: z.array(
    z.object({
      name: z.string().describe("Nombre del producto completo y legible, sin abreviaturas, p. ej. «Leche semidesnatada Hacendado 6×1 L»"),
      raw: z.string().describe("Texto de la línea tal y como aparece en el ticket"),
      quantity: z.number().describe("Unidades o kilos; 1 si no se indica"),
      unitPrice: z.number().nullable().describe("Precio por unidad o por kilo, si aparece"),
      amount: z.number().describe("Importe final de la línea en euros, ya con su descuento si lo tiene"),
      category: z.enum(PRODUCT_CATEGORIES),
    }),
  ),
})

const INSTRUCTIONS = `Lee este ticket de compra español y extrae cada producto.
- Una entrada por línea de producto. Si un descuento o promoción corresponde a un producto, réstalo de ese producto; si es un descuento general, añádelo como línea «Descuento» con importe negativo y categoría «Otros».
- No incluyas como productos el total, el IVA, el cambio, la forma de pago ni datos de la tarjeta.
- Escribe los nombres completos en español aunque el ticket los abrevie.
- Si un número no se lee bien, da tu mejor lectura; la suma de los productos debe acercarse al total.`

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

// ── Spending guard ──
// Claude Haiku 5.5 list price, USD per million tokens (input / output).
const PRICE_IN = 0.1
const PRICE_OUT = 0.5
/** Hard caps: one ticket costs about $0.001, so these keep the worst month well under $1. */
export const LIMITS = { perDay: 20, perMonth: 150, usdPerMonth: 0.5 }
/** Caps the answer of one call (a long receipt needs ~3,000 tokens): at most ~$0.003 per call. */
const MAX_OUTPUT_TOKENS = 6000

export function usageCost(usage) {
  return (usage.input * PRICE_IN + usage.output * PRICE_OUT) / 1_000_000
}

async function loadUsage(db, month) {
  const raw = await getMeta(db, `ai_usage:${month}`)
  try {
    return { scans: 0, input: 0, output: 0, days: {}, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { scans: 0, input: 0, output: 0, days: {} }
  }
}

/** Why a new scan is not allowed right now, or null. */
export function overLimit(usage, day) {
  if ((usage.days[day] || 0) >= LIMITS.perDay) return `Has llegado al máximo de ${LIMITS.perDay} tickets al día.`
  if (usage.scans >= LIMITS.perMonth) return `Has llegado al máximo de ${LIMITS.perMonth} tickets este mes.`
  if (usageCost(usage) >= LIMITS.usdPerMonth) return "Has llegado al tope de gasto de este mes en lectura de tickets."
  return null
}

export async function onRequestPost(context) {
  const apiKey = context.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: "no-key", message: "Falta la clave ANTHROPIC_API_KEY" }, { status: 503 })
  const db = context.env.DB
  if (!db) return json({ error: "D1 no configurada" }, { status: 500 })

  const body = await readJson(context.request)
  const image = typeof body?.image === "string" ? body.image : ""
  const mediaType = MEDIA_TYPES.has(body?.mediaType) ? body.mediaType : "image/jpeg"
  if (!image) return json({ error: "Falta la foto del ticket" }, { status: 400 })
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "La foto es demasiado grande" }, { status: 413 })

  // Count the scan before calling the API, so retries or double taps cannot exceed the caps.
  await ensureSchema(db)
  const now = new Date().toISOString()
  const month = now.slice(0, 7)
  const day = now.slice(8, 10)
  const usage = await loadUsage(db, month)
  const blocked = overLimit(usage, day)
  if (blocked) return json({ error: blocked }, { status: 429 })
  usage.scans += 1
  usage.days[day] = (usage.days[day] || 0) + 1
  await setMeta(db, `ai_usage:${month}`, JSON.stringify(usage))

  // One retry at most: every attempt is billed.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  try {
    const response = await client.messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: "low", format: zodOutputFormat(Receipt) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: INSTRUCTIONS },
          ],
        },
      ],
    })
    // Record what was spent (billed even when the answer is unusable).
    usage.input += response.usage.input_tokens
    usage.output += response.usage.output_tokens
    await setMeta(db, `ai_usage:${month}`, JSON.stringify(usage))
    if (response.stop_reason === "refusal") return json({ error: "No se pudo leer este ticket" }, { status: 422 })
    const ticket = response.parsed_output
    if (!ticket) return json({ error: "No se pudo leer este ticket" }, { status: 502 })
    return json({ ticket, month: { scans: usage.scans, usd: Math.round(usageCost(usage) * 10000) / 10000, limits: LIMITS } })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "no-key", message: "La clave de Anthropic no es válida" }, { status: 503 })
    if (error instanceof Anthropic.RateLimitError) return json({ error: "Demasiadas lecturas seguidas; prueba en un minuto" }, { status: 429 })
    if (error instanceof Anthropic.APIError) return json({ error: `Error al leer el ticket (${error.status})` }, { status: 502 })
    return json({ error: "No se pudo conectar con el lector de tickets" }, { status: 502 })
  }
}
