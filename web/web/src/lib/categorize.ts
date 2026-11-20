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
export const INTERNAL = "Traspaso interno"

export const FIXED_CATEGORIES = new Set([
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Recibos",
  "Impuestos y seguros",
  "Comisiones",
])

export const CATEGORY_OPTIONS = [
  "Nómina",
  "Otros ingresos",
  "Bizum recibido",
  "Bizum enviado",
  "Ahorro",
  INTERNAL,
  "Transferencias",
  "Vivienda",
  "Suministros",
  "Telecomunicaciones",
  "Suscripciones",
  "Recibos",
  "Impuestos y seguros",
  "Supermercado",
  "Restauración",
  "Comida a domicilio",
  "Transporte",
  "Viajes",
  "Salud",
  "Cuidado personal",
  "Ropa",
  "Hogar",
  "Tecnología",
  "Compras",
  "Ocio",
  "Efectivo",
  "Comisiones",
  "Devolución",
  "Otros gastos",
]

// ───────────── Reading BBVA texts ─────────────

/**
 * BBVA texts come in two shapes:
 *  - API:   "PAGO CON TARJETA EN SUPERMERCADOS // PAGO CON TARJETA // MERCADONA RONDA … ES · MERCADONA"
 *           (bank category // movement type // detail · counterparty)
 *  - Excel: "Mercadona ronda outeiro · Pago con tarjeta" (concept · movement)
 */
export function parseBankText(text: string) {
  // BBVA's feed mangles "Ñ" as "ã"/"AA" (CORUãA): restore it so names read and group well.
  const raw = String(text || "").replace(/ã/g, "ñ").replace(/Ã±/g, "ñ").replace(/\bCORUAA\b/g, "CORUÑA").replace(/\s+/g, " ").trim()
  const [head = "", ...tail] = raw.split(" · ")
  const counterparty = tail.join(" · ").trim()
  if (head.includes(" // ")) {
    const [bankCategory = "", kind = "", detail = ""] = head.split(" // ").map((part) => part.trim())
    return { bankCategory, kind, detail, counterparty }
  }
  return { bankCategory: "", kind: counterparty, detail: head, counterparty: "" }
}

const LOCATION_TOKENS = new Set([
  "es", "esp", "spain", "españa", "espana", "a", "la", "el", "de", "coruna", "coruña", "acoruna", "madrid", "barcelona",
  "oviedo", "santiago", "vigo", "ferrol", "lugo", "ourense", "pontevedra", "gijon", "valencia", "sevilla", "bilbao",
])

/** Known brands collapse every store/variant into one merchant. */
const BRANDS: Array<[RegExp, string]> = [
  [/mercadona/i, "Mercadona"],
  [/alimerka/i, "Alimerka"],
  [/masymas|mas y mas/i, "Masymas"],
  [/discord/i, "Discord Nitro"],
  [/real-?debrid/i, "Real-Debrid"],
  [/freepik/i, "Freepik"],
  [/milanote/i, "Milanote"],
  [/patreon/i, "Patreon"],
  [/twitch/i, "Twitch"],
  [/consorcio (de )?transportes/i, "Consorcio de Transportes"],
  [/eroski/i, "Eroski"],
  [/gadis/i, "Gadis"],
  [/froiz/i, "Froiz"],
  [/\blidl\b/i, "Lidl"],
  [/carrefour/i, "Carrefour"],
  [/\baldi\b/i, "Aldi"],
  [/\bdia\b|dia %/i, "Dia"],
  [/alcampo/i, "Alcampo"],
  [/el corte ingl/i, "El Corte Inglés"],
  [/amazon|amzn/i, "Amazon"],
  [/aliexpress/i, "AliExpress"],
  [/\bshein\b/i, "Shein"],
  [/google\s*\*?\s*google\s*\*?\s*one|google one/i, "Google One"],
  [/google\s*\*?\s*(google )?play/i, "Google Play"],
  [/youtube/i, "YouTube Premium"],
  [/openai|chatgpt/i, "ChatGPT (OpenAI)"],
  [/\bgrok\b|\bx\.?ai\b/i, "Grok (xAI)"],
  [/anthropic|claude\.ai/i, "Claude (Anthropic)"],
  [/spotify/i, "Spotify"],
  [/netflix/i, "Netflix"],
  [/disney/i, "Disney+"],
  [/\bhbo\b|\bmax\.com/i, "Max"],
  [/apple\.com|itunes/i, "Apple"],
  [/microsoft|xbox/i, "Microsoft"],
  [/\bsteam\b/i, "Steam"],
  [/riot\*?|riot games/i, "Riot Games"],
  [/playstation|\bpsn\b/i, "PlayStation"],
  [/nintendo/i, "Nintendo"],
  [/\bdigi\b/i, "Digi"],
  [/movistar/i, "Movistar"],
  [/vodafone/i, "Vodafone"],
  [/\borange\b/i, "Orange"],
  [/renfe/i, "Renfe"],
  [/\balsa\b/i, "Alsa"],
  [/\buber\s*eats/i, "Uber Eats"],
  [/\buber\b/i, "Uber"],
  [/cabify/i, "Cabify"],
  [/\bbolt\b/i, "Bolt"],
  [/glovo/i, "Glovo"],
  [/just ?eat/i, "Just Eat"],
  [/mcdonald/i, "McDonald's"],
  [/burger king/i, "Burger King"],
  [/telepizza/i, "Telepizza"],
  [/starbucks/i, "Starbucks"],
  [/primark/i, "Primark"],
  [/\bzara\b/i, "Zara"],
  [/\bikea\b/i, "Ikea"],
  [/decathlon/i, "Decathlon"],
  [/\bfnac\b/i, "Fnac"],
  [/mediamarkt|media markt/i, "MediaMarkt"],
  [/tiger stores|flying tiger/i, "Flying Tiger"],
  [/repsol/i, "Repsol"],
  [/\bcepsa\b|moeve/i, "Cepsa"],
  [/\bgalp\b/i, "Galp"],
  [/booking/i, "Booking"],
  [/airbnb/i, "Airbnb"],
  [/ryanair/i, "Ryanair"],
  [/vueling/i, "Vueling"],
  [/\biberia\b/i, "Iberia"],
  [/name-?cheap/i, "Namecheap"],
  [/github/i, "GitHub"],
  [/cursor/i, "Cursor"],
  [/notion/i, "Notion"],
  [/adobe/i, "Adobe"],
  [/canva/i, "Canva"],
]

function titleCase(text: string) {
  return text
    .toLocaleLowerCase("es")
    .replace(/(^|[\s\-/.(])([\p{L}])/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("es"))
}

/** Removes card-processor noise: "WWW.AMAZON* EM3SK82U5" → "AMAZON", "GOOGLE*GOOGLE PLAY APP" → "GOOGLE PLAY APP". */
function stripProcessorNoise(text: string) {
  let value = text.replace(/^(www\.|wl \*|sq \*|sumup \*|pp\*|paypal \*)/i, "")
  const parts = value.split("*").map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    const [first, ...rest] = parts
    const tail = rest.join(" ")
    const tailIsCode = /\d/.test(tail) && !/\s[a-z]{3,}/i.test(tail.replace(/^\S+/, ""))
    if (tailIsCode) value = first!
    else if (tail.toLocaleLowerCase("es").startsWith(first!.toLocaleLowerCase("es"))) value = tail
    else value = `${first} ${tail}`
  }
  return value.replace(/\.(com|es|net|io|ai)\b/gi, "").replace(/\s+/g, " ").trim()
}

function stripLocation(text: string) {
  const words = text.split(" ")
  while (words.length > 1) {
    const last = normalizeText(words[words.length - 1]!)
    if (!last || LOCATION_TOKENS.has(last) || /^\d+$/.test(last) || /^\(?la\)?\/?ces$/.test(last) || /^\(la\)/.test(last)) words.pop()
    else break
  }
  return words.join(" ")
}

/** Human merchant name for a movement ("Mercadona", "Hotel Santa Catalina", "Bizum: wifi"). */
export function cleanName(text: string) {
  const { bankCategory, kind, detail, counterparty } = parseBankText(text)
  const source = `${detail} ${counterparty}`
  if (/bizum/i.test(bankCategory) || /^bizum/i.test(detail)) {
    const concept = detail.replace(/^(enviado|recibido):\s*/i, "").trim()
    return concept && !/^sin concepto$/i.test(concept) ? `Bizum: ${concept}` : "Bizum"
  }
  if (/traspaso/i.test(`${bankCategory} ${kind}`)) return /programa tu cuenta/i.test(bankCategory) ? "Programa Tu Cuenta" : "Traspaso entre cuentas"
  if (/n[oó]mina/i.test(`${bankCategory} ${kind}`)) return titleCase(counterparty || detail || "Nómina")
  if (/efectivo/i.test(bankCategory) && /ret/i.test(bankCategory)) return "Retirada de efectivo"
  for (const [pattern, brand] of BRANDS) if (pattern.test(source)) return brand
  // Prefer the counterparty name (no location) unless it is masked.
  const base = counterparty && !/^\*+$/.test(counterparty) ? counterparty : detail
  const cleaned = stripLocation(stripProcessorNoise(base.replace(/^n \d{6,}\s+/i, "")))
  return titleCase(cleaned || detail || "Movimiento").slice(0, 48)
}

const STOP = new Set(["pago", "con", "tarjeta", "compra", "compras", "es", "la", "el", "los", "las", "de", "del", "en", "a", "y", "por", "desde", "cuenta", "abono", "tpv", "sa", "sl", "slu", "cb", "the"])

/** Grouping key for merchants: brand, or the first two significant words of the clean name. */
export function merchantKey(text: string) {
  const words = normalizeText(cleanName(text))
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
  return words.slice(0, 2).join(" ")
}

// ───────────── Categorization ─────────────

/** Merchant-level rules: the most specific signal. */
const MERCHANT_RULES: Array<[RegExp, string, Direction?]> = [
  [/netflix|spotify|\bhbo\b|disney|prime video|\bdazn\b|filmin|youtube|google one|icloud|apple\.com|openai|chatgpt|\bgrok\b|\bx\.?ai\b|anthropic|claude|github|cursor|notion|adobe|canva|microsoft 365|discord|nitro|real-?debrid|freepik|milanote|patreon|twitch|midjourney/i, "Suscripciones", "out"],
  [/movistar|vodafone|\borange\b|\bdigi\b|masmovil|m[aá]sm[oó]vil|pepephone|\bsimyo\b|\blowi\b|\bo2\b/i, "Telecomunicaciones", "out"],
  [/\bluz\b|electric|iberdrola|endesa|naturgy|gas natural|\bagua\b|canal isabel|holaluz|repsol luz/i, "Suministros", "out"],
  [/alquiler|renta piso|arrendamiento|hipoteca|comunidad de propietarios/i, "Vivienda", "out"],
  [/mercadona|carrefour|\blidl\b|\baldi\b|eroski|\bconsum\b|\bdia\b|alcampo|hipercor|ahorramas|gadis|froiz|alimerka|masymas|supermercado|autoservicio|cool expres/i, "Supermercado", "out"],
  [/glovo|just ?eat|uber\s*eats|deliveroo/i, "Comida a domicilio", "out"],
  [/restaur|\bbar\b|cafeter|mcdonald|burger|telepizza|goiko|\bkfc\b|starbucks|domino|\bwok\b|pizzer|taberna|panader|panificadora/i, "Restauración", "out"],
  [/repsol|\bcepsa\b|moeve|\bgalp\b|\bbp\b|\bshell\b|gasolin|parking|\bemt\b|\bmetro\b|cabify|\buber\b|\bbolt\b|renfe|\balsa\b|monbus|autobus|taxi/i, "Transporte", "out"],
  [/ryanair|vueling|iberia|air europa|booking|airbnb|\bavlo\b|eurowings|\bhotel\b|hostal|hostel/i, "Viajes", "out"],
  [/farmacia|hospital|sanitas|adeslas|mapfre salud|dentista|cl[ií]nica|optica/i, "Salud", "out"],
  [/\bsteam\b|playstation|nintendo|riot|\bcine\b|teatro|gimnas|fitness|basic[- ]?fit|\bmcfit\b|loter/i, "Ocio", "out"],
  [/\bzara\b|\bmango\b|primark|pull ?& ?bear|bershka|stradivarius|\bh&m\b|shein/i, "Ropa", "out"],
  [/\bikea\b|leroy|bricomart|bauhaus|maisons du monde|tiger stores/i, "Hogar", "out"],
  [/mediamarkt|media markt|pccomponentes|\bfnac\b|apple store|name-?cheap|google play/i, "Tecnología", "out"],
  [/amazon|aliexpress|el corte|decathlon/i, "Compras", "out"],
  [/druger|perfumer|peluquer|barber|arenal|primor|sephora|\bdr wash\b/i, "Cuidado personal", "out"],
]

/** BBVA's own merchant category (first segment of API texts). */
const BANK_CATEGORY_RULES: Array<[RegExp, string]> = [
  // "COMPRA EN COMERCIO EXTRANJERO-COMISIÓN 3 % INCLUÍDA" is a purchase abroad, not a bank fee.
  [/comercio extranjero/i, "Compras"],
  [/supermercado/i, "Supermercado"],
  [/restaurante|cafeter/i, "Restauración"],
  [/transporte|alquiler de veh|gasolin|combustible|autopista|peaje/i, "Transporte"],
  [/hotel|alojamiento|viaje|agencia/i, "Viajes"],
  [/medicina|farmacia|sanidad/i, "Salud"],
  [/drogueria|perfumeria|peluquer|estetica/i, "Cuidado personal"],
  [/moda|calzado|complementos/i, "Ropa"],
  [/hogar|muebles|decoracion|electr/i, "Hogar"],
  [/discos|libros|fotos|pc'?s|informatica/i, "Tecnología"],
  [/deportes y juguetes|espectaculos|museos|loterias/i, "Ocio"],
  [/tasa|seguro|impuesto/i, "Impuestos y seguros"],
  [/grandes superficies|compras a distancia/i, "Compras"],
  [/ret\.? efectivo|cajero/i, "Efectivo"],
  [/adeudo/i, "Recibos"],
  [/comisi|penalizaci/i, "Comisiones"],
  [/transferencia/i, "Transferencias"],
  [/servicios varios/i, "Otros gastos"],
]

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

function firstMatch(rules: Array<[RegExp, string, Direction?]>, text: string, direction: Direction | null) {
  for (const [pattern, category, when] of rules) {
    if (when && direction && when !== direction) continue
    if (pattern.test(text)) return category
  }
  return null
}

/** User rules > transfers/Bizum/payroll > merchant rules > BBVA category > fallback. */
export function categorize(text: string, amount: number, userRules: UserRule[] = []) {
  const source = String(text || "").normalize("NFKC")
  for (const rule of userRules) {
    if (ruleMatches(rule, source, amount)) return rule.category
  }
  const direction: Direction | null = amount > 0 ? "in" : amount < 0 ? "out" : null
  const { bankCategory, kind, detail, counterparty } = parseBankText(source)

  if (/\btraspaso\b/i.test(`${bankCategory} ${kind} ${detail}`)) return INTERNAL
  if (/\bbizum\b/i.test(source)) return amount >= 0 ? "Bizum recibido" : "Bizum enviado"
  if (direction === "in") {
    if (/n[oó]mina inversa/i.test(source)) return "Otros ingresos"
    if (/n[oó]mina|salario|haberes|payroll|pensi[oó]n/i.test(source)) return "Nómina"
    if (/devoluci[oó]n|reembolso|anulaci[oó]n/i.test(source)) return "Devolución"
    // A card "payment" with a positive amount is a refund from that merchant.
    if (/pago con tarjeta|compra|cargo por compra/i.test(`${bankCategory} ${kind}`)) return "Devolución"
    return "Otros ingresos"
  }

  const merchant = firstMatch(MERCHANT_RULES, `${detail} ${counterparty}`, direction)
  if (merchant) return merchant
  for (const [pattern, category] of BANK_CATEGORY_RULES) if (pattern.test(bankCategory)) return category
  const loose = firstMatch(MERCHANT_RULES, source, direction)
  if (loose) return loose
  if (/transferencia/i.test(source)) return "Transferencias"
  if (/comisi[oó]n|mantenimiento cuenta/i.test(source)) return "Comisiones"
  return "Otros gastos"
}

export function isFixedCategory(category: string) {
  return FIXED_CATEGORIES.has(category)
}

/** Longest leading run of merchant words that literally appears in the text: a safe "contains" pattern. */
export function suggestPattern(text: string) {
  const haystack = ` ${normalizeText(text)} `
  const words = normalizeText(cleanName(text)).split(" ").filter((word) => word.length > 1 && !STOP.has(word))
  let best = ""
  for (let n = 1; n <= Math.min(words.length, 3); n += 1) {
    const candidate = words.slice(0, n).join(" ")
    if (haystack.includes(` ${candidate} `)) best = candidate
    else break
  }
  return best || words[0] || ""
}

export function describeMerchant(_name: string, category: string) {
  return category
}
