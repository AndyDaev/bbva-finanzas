import { normalizeText } from "./format"

export type Direction = "in" | "out"

export type UserRule = {
  id: string
  pattern: string
  matchType: "contains" | "regex"
  category: string
  direction?: Direction | null
  priority?: number
}

export const BIZUM_NET = "Bizum (neto)"

export const FIXED_CATEGORIES = new Set([
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Comisiones",
])

export const CATEGORY_OPTIONS = [
  "Nómina",
  "Otros ingresos",
  "Bizum recibido",
  "Bizum enviado",
  "Ahorro",
  "Traspaso interno",
  "Transferencias",
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Supermercado",
  "Restauración",
  "Comida a domicilio",
  "Transporte",
  "Salud",
  "Compras",
  "Ocio",
  "Viajes",
  "Comisiones",
  "Devolución",
  "Otros gastos",
]

const RULES: Array<[RegExp, string, Direction?]> = [
  [/traspaso a (cuenta|ahorro)|traspaso.*ahorro/i, "Ahorro", "out"],
  [/traspaso/i, "Traspaso interno"],
  [/\bbizum\b/i, "Bizum"],
  // "nómina inversa" must be checked before the generic payroll rule.
  [/\bn[oó]mina inversa\b/i, "Otros ingresos", "in"],
  [/\bn[oó]mina\b|\bsalario\b|\bhaberes\b|\bpayroll\b/i, "Nómina", "in"],
  [/\bdevoluci[oó]n\b|\breembolso\b/i, "Devolución", "in"],
  [/\balquiler\b|\brenta piso\b|\barrendamiento\b/i, "Vivienda", "out"],
  [/\bhipoteca\b|\bpr[eé]stamo vivienda\b/i, "Vivienda", "out"],
  [/\bluz\b|\belectric|\biberdrola\b|\bendesa\b|\bnaturgy\b|\bgas natural\b|\bagua\b|\bcanal isabel/i, "Suministros", "out"],
  [/netflix|spotify|\bhbo\b|disney|prime video|\bdazn\b|\bfilmin\b|youtube premium|\bicloud\b|google one/i, "Suscripciones", "out"],
  [/movistar|vodafone|\borange\b|\bdigi\b|masmovil|m[aá]sm[oó]vil|pepephone|\bsimyo\b/i, "Telecomunicaciones", "out"],
  [/mercadona|carrefour|\blidl\b|\baldi\b|\beroski\b|\bconsum\b|\bdia\b|\balcampo\b|\bhipercor\b|ahorramas|ahorra m[aá]s|supermercado|autoservicio/i, "Supermercado", "out"],
  [/\bglovo\b|just eat|uber\s*eats/i, "Comida a domicilio", "out"],
  [/restaur|\bbar\b|cafeter|mcdonald|burger|telepizza|\bgoiko\b|\bkfc\b|starbucks|domino/i, "Restauración", "out"],
  [/\brepsol\b|\bcepsa\b|\bgalp\b|\bbp\b|\bshell\b|gasolin|\bparking\b|\bemt\b|\bmetro\b|\bcabify\b|\buber\b|\bbolt\b/i, "Transporte", "out"],
  [/\bryanair\b|\bvueling\b|\biberia\b|\bair europa\b|\bbooking\b|\bairbnb\b|\brenfe\b|\bavlo\b|\beurowings\b|\bhotel\b|\bhostal\b/i, "Viajes", "out"],
  [/farmacia|\bhospital\b|\bsanitas\b|\badeslas\b|mapfre salud|\bdentista\b|cl[ií]nica/i, "Salud", "out"],
  [/\bzara\b|\bmango\b|\bprimark\b|el corte|\bamazon\b|mediamarkt|\bikea\b|\bdecathlon\b|pccomponentes|\bfnac\b/i, "Compras", "out"],
  [/gimnas|fitness|basic[- ]?fit|\bmcfit\b|entrenador|\bcine\b|\bteatro\b|\bsteam\b|playstation|\bnintendo\b/i, "Ocio", "out"],
  [/transferencia/i, "Transferencias"],
  [/comisi[oó]n|mantenimiento cuenta/i, "Comisiones", "out"],
]

const STOP = new Set(["pago", "con", "tarjeta", "compra", "compras", "es", "la", "el", "los", "las", "de", "del", "en", "a", "y", "por", "desde", "cuenta", "abono", "tpv"])

const regexCache = new Map<string, RegExp | null>()

function compile(pattern: string) {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, "i"))
    } catch {
      regexCache.set(pattern, null)
    }
  }
  return regexCache.get(pattern) ?? null
}

export function isValidRegex(pattern: string) {
  return compile(pattern) !== null
}

export function ruleMatches(rule: UserRule, text: string, amount: number) {
  const direction = amount > 0 ? "in" : amount < 0 ? "out" : null
  if (rule.direction && direction && rule.direction !== direction) return false
  if (rule.matchType === "regex") return compile(rule.pattern)?.test(text) ?? false
  const needle = normalizeText(rule.pattern)
  return Boolean(needle) && ` ${normalizeText(text)} `.includes(` ${needle} `)
}

export function sortRules(rules: UserRule[]) {
  return [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id))
}

/** Category from user rules (already sorted) first, then the built-in rules. */
export function categorize(text: string, amount: number, userRules: UserRule[] = []) {
  const source = String(text || "").normalize("NFKC")
  for (const rule of userRules) {
    if (ruleMatches(rule, source, amount)) return rule.category
  }
  const direction = amount > 0 ? "in" : amount < 0 ? "out" : null
  for (const [pattern, category, when] of RULES) {
    if (when && direction && when !== direction) continue
    if (!pattern.test(source)) continue
    if (category === "Bizum") return amount >= 0 ? "Bizum recibido" : "Bizum enviado"
    return category
  }
  if (amount > 0 && /pago con tarjeta|abono/i.test(source)) return "Devolución"
  if (amount > 0) return "Otros ingresos"
  return "Otros gastos"
}

export function isFixedCategory(category: string) {
  return FIXED_CATEGORIES.has(category)
}

export function cleanName(text: string) {
  return String(text || "").split(" · ")[0]?.replace(/\s+/g, " ").trim() || "Movimiento"
}

export function merchantKey(text: string) {
  const words = normalizeText(cleanName(text))
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
  const unique = words.filter((word, index) => word !== words[index - 1])
  return unique.slice(0, 3).join(" ")
}

/** Longest leading run of merchant words that literally appears in the text: a safe "contains" pattern. */
export function suggestPattern(text: string) {
  const haystack = ` ${normalizeText(text)} `
  const words = merchantKey(text).split(" ").filter(Boolean)
  let best = ""
  for (let n = 1; n <= words.length; n += 1) {
    const candidate = words.slice(0, n).join(" ")
    if (haystack.includes(` ${candidate} `)) best = candidate
    else break
  }
  return best || words[0] || normalizeText(cleanName(text)).split(" ")[0] || ""
}

export function describeMerchant(name: string, category: string) {
  const text = String(name || "").toLowerCase()
  if (/hotel|hostal|hostel|airbnb|ryanair|vueling|booking/.test(text)) return "Viajes / alojamiento."
  if (/farmacia|clinica|clínica|hospital|dentista/.test(text)) return "Salud: farmacia o clínica."
  if (/supermercado|mercadona|lidl|carrefour|aldi|consum|autoservicio|familia/.test(text)) return "Alimentación / supermercado."
  if (/glovo|just eat|uber eats/.test(text)) return "Comida a domicilio."
  if (/restaur|bar |cafeter|mcdonald|burger/.test(text)) return "Comida fuera / restauración."
  if (/fnac|zara|mango|amazon|ikea|decathlon|primark|corte/.test(text)) return "Compras de retail."
  if (/repsol|cepsa|galp|parking|metro|uber|cabify|emt/.test(text)) return "Transporte o combustible."
  if (/netflix|spotify|disney|prime|icloud/.test(text)) return "Suscripción digital."
  return `Gasto clasificado como ${category}.`
}
