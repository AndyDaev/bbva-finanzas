import { describe, expect, it } from "vitest"
import { csvToRows, parseAmount, parseDate, rowsToTransactions } from "./importFile"
import {
  BIZUM_NET,
  accountsFromTransactions,
  analyze,
  buildBalanceSeries,
  buildView,
  categorize,
  detectRecurring,
  merchantKey,
  normalizeTransactions,
  previousRange,
  replaceAccountTransactions,
  suggestPattern,
  type Transaction,
  type UserRule,
} from "./money"

function tx(date: string, amount: number, text: string, extra: Partial<Transaction> = {}): Transaction {
  return { date, amount, text, category: categorize(text, amount), account: "Cuenta", ...extra }
}

describe("categorize", () => {
  it("handles common Spanish transactions", () => {
    expect(categorize("NÓMINA EMPRESA", 2500)).toBe("Nómina")
    expect(categorize("Abono de nómina · Energy plus", 1489)).toBe("Nómina")
    expect(categorize("Compra MERCADONA", -45)).toBe("Supermercado")
    expect(categorize("TRASPASO A AHORRO", -300)).toBe("Ahorro")
    expect(categorize("Traspaso desde cuenta · Ana", 50)).toBe("Traspaso interno")
    expect(categorize("UBER EATS PEDIDO", -22.5)).toBe("Comida a domicilio")
    expect(categorize("UBER TRIP", -8.4)).toBe("Transporte")
    expect(categorize("BIZUM DE ANA", 20)).toBe("Bizum recibido")
    expect(categorize("BIZUM A ANA", -20)).toBe("Bizum enviado")
    expect(categorize("ABONO COMISION", -3)).toBe("Comisiones")
    expect(categorize("Autoservicios familia · Pago con tarjeta", 10.15)).toBe("Devolución")
  })

  it("reaches the 'nómina inversa' rule before the generic payroll rule", () => {
    expect(categorize("NOMINA INVERSA ANTICIPO", 300)).toBe("Otros ingresos")
  })

  it("applies user rules before built-in rules, respecting direction", () => {
    const rules: UserRule[] = [
      { id: "r1", pattern: "mercadona", matchType: "contains", category: "Ocio", direction: "out" },
      { id: "r2", pattern: "^PAGO .*GYM", matchType: "regex", category: "Salud" },
    ]
    expect(categorize("Compra MERCADONA VALENCIA", -30, rules)).toBe("Ocio")
    expect(categorize("Devolución MERCADONA", 30, rules)).toBe("Devolución")
    expect(categorize("PAGO MENSUAL GYM", -40, rules)).toBe("Salud")
    // Whole-word matching: "dia" must not match inside "media".
    expect(categorize("MEDIAMARKT", -100, [{ id: "r3", pattern: "dia", matchType: "contains", category: "Supermercado" }])).toBe("Compras")
  })

  it("ignores invalid regex rules instead of throwing", () => {
    expect(categorize("ALGO", -5, [{ id: "bad", pattern: "(", matchType: "regex", category: "Ocio" }])).toBe("Otros gastos")
  })

  it("normalizeTransactions keeps locked categories", () => {
    const rules: UserRule[] = [{ id: "r1", pattern: "fnac", matchType: "contains", category: "Ocio" }]
    const [locked, free] = normalizeTransactions(
      [tx("2026-01-01", -10, "FNAC", { category: "Compras", categoryLocked: true }), tx("2026-01-02", -10, "FNAC")],
      rules,
    )
    expect(locked!.category).toBe("Compras")
    expect(free!.category).toBe("Ocio")
  })
})

describe("merchant keys and patterns", () => {
  it("groups variants of the same merchant", () => {
    expect(merchantKey("Fnac a coruña la coruna es · Pago con tarjeta")).toBe(merchantKey("FNAC A CORUÑA"))
    expect(merchantKey("NETFLIX 01/03/2026")).toBe("netflix")
  })

  it("suggests a pattern that actually appears in the text", () => {
    expect(suggestPattern("MERCADONA 1234 VALENCIA · Pago con tarjeta")).toBe("mercadona")
    expect(suggestPattern("Pago con tarjeta en Goiko Grill")).toBe("goiko grill")
  })
})

describe("buildView", () => {
  const today = "2026-12-15"

  it("keeps payroll as income, savings out of spending and nets refunds", () => {
    const view = buildView(
      [
        tx("2026-11-02", 1489.04, "Abono de nómina · Energy plus"),
        tx("2026-11-12", -20, "Autoservicios familia · Pago con tarjeta"),
        tx("2026-11-13", 10.15, "Autoservicios familia · Pago con tarjeta"),
        tx("2026-11-02", -800, "Traspaso a cuenta · Ahorro"),
        tx("2026-11-03", -300, "Traspaso interno"),
      ],
      [],
      { today },
    )
    expect(view.income).toBeCloseTo(1489.04)
    expect(view.incomeSources[0]!.name).toBe("Nómina")
    expect(view.expense).toBeCloseTo(9.85)
    expect(view.toSavings).toBe(800)
  })

  it("subtracts refunds from the month and category, not only the total", () => {
    const view = buildView(
      [tx("2026-10-05", -100, "AMAZON MARKETPLACE"), tx("2026-10-20", 40, "Devolución AMAZON MARKETPLACE")],
      [],
      { today },
    )
    expect(view.months[0]!.expense).toBeCloseTo(60)
    expect(view.months[0]!.categories.Compras).toBeCloseTo(60)
    expect(view.categories[0]).toMatchObject({ name: "Compras" })
    expect(view.categories[0]!.amount).toBeCloseTo(60)
  })

  it("nets Bizum per month instead of inflating income", () => {
    const view = buildView(
      [
        tx("2026-10-01", 2000, "NÓMINA"),
        tx("2026-10-10", -60, "BIZUM A ANA cena"),
        tx("2026-10-11", 20, "BIZUM DE LUIS cena"),
        tx("2026-10-12", 20, "BIZUM DE EVA cena"),
      ],
      [],
      { today },
    )
    expect(view.income).toBe(2000)
    expect(view.expense).toBeCloseTo(20)
    expect(view.categories[0]!.name).toBe(BIZUM_NET)
    expect(view.bizumNet).toBeCloseTo(-20)
  })

  it("counts positive Bizum net as income", () => {
    const view = buildView([tx("2026-10-10", -10, "BIZUM A ANA"), tx("2026-10-11", 50, "BIZUM DE LUIS")], [], { today })
    expect(view.expense).toBe(0)
    expect(view.income).toBeCloseTo(40)
  })

  it("averages only complete months", () => {
    const view = buildView(
      [tx("2026-10-05", -300, "MERCADONA"), tx("2026-11-05", -500, "MERCADONA"), tx("2026-12-02", -10, "MERCADONA")],
      [],
      { today },
    )
    expect(view.avgExpense).toBeCloseTo(400)
  })

  it("compares the last two complete months using the given today", () => {
    const view = buildView(
      [tx("2026-10-05", -100, "MERCADONA"), tx("2026-11-05", -200, "MERCADONA"), tx("2026-12-02", -999, "MERCADONA")],
      [],
      { today },
    )
    expect(view.monthCompare?.previousMonth).toBe("2026-10")
    expect(view.monthCompare?.currentMonth).toBe("2026-11")
    expect(view.monthCompare?.totalDelta).toBeCloseTo(100)
  })
})

describe("previousRange", () => {
  it("shifts month-aligned ranges by whole months", () => {
    expect(previousRange("2026-11-01", "2026-11-20")).toEqual({ from: "2026-10-01", to: "2026-10-20" })
    expect(previousRange("2026-06-01", "2026-11-20")).toEqual({ from: "2025-12-01", to: "2026-05-20" })
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })

  it("shifts arbitrary ranges by their length", () => {
    expect(previousRange("2026-11-10", "2026-11-19")).toEqual({ from: "2026-10-31", to: "2026-11-09" })
  })
})

describe("detectRecurring", () => {
  it("detects stable monthly charges", () => {
    const result = detectRecurring(
      [tx("2026-01-03", -15.99, "NETFLIX 01/2026"), tx("2026-02-03", -15.99, "NETFLIX 02/2026"), tx("2026-03-03", -15.99, "NETFLIX 03/2026")],
      "2026-03-20",
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ months: 3, amount: 15.99, status: "stable", nextDate: "2026-04-03", chargedThisMonth: true })
    expect(result[0]!.annual).toBeCloseTo(191.88)
  })

  it("flags price increases", () => {
    const result = detectRecurring(
      [tx("2026-01-03", -12.99, "SPOTIFY"), tx("2026-02-03", -12.99, "SPOTIFY"), tx("2026-03-03", -12.99, "SPOTIFY"), tx("2026-04-03", -14.99, "SPOTIFY")],
      "2026-04-10",
    )
    expect(result[0]).toMatchObject({ status: "increase", previousAmount: 12.99, amount: 14.99 })
  })

  it("flags possible new subscriptions after two equal consecutive charges", () => {
    const result = detectRecurring([tx("2026-03-05", -9.99, "DISNEY PLUS"), tx("2026-04-05", -9.99, "DISNEY PLUS")], "2026-04-10")
    expect(result[0]).toMatchObject({ status: "new" })
  })

  it("ignores frequent shops and charges no longer seen", () => {
    const shop = ["01", "02", "03"].flatMap((m) => [tx(`2026-${m}-02`, -30, "MERCADONA"), tx(`2026-${m}-15`, -31, "MERCADONA")])
    const old = [tx("2025-01-03", -5, "ICLOUD"), tx("2025-02-03", -5, "ICLOUD"), tx("2025-03-03", -5, "ICLOUD")]
    expect(detectRecurring([...shop, ...old], "2026-03-20")).toHaveLength(0)
  })
})

describe("analyze", () => {
  it("returns period deltas, forecast and cushion", () => {
    const data = [
      tx("2026-10-01", 2000, "NÓMINA", { balanceAfter: 3000 }),
      tx("2026-10-10", -400, "MERCADONA", { balanceAfter: 2600 }),
      tx("2026-11-01", 2000, "NÓMINA", { balanceAfter: 4600 }),
      tx("2026-11-10", -600, "MERCADONA", { balanceAfter: 4000 }),
    ]
    const result = analyze({ transactions: data, from: "2026-11-01", to: "2026-11-30", today: "2026-11-15" })
    expect(result.compare?.expense.previous).toBeCloseTo(400)
    expect(result.compare?.expense.delta).toBeCloseTo(200)
    expect(result.compare?.expense.pct).toBeCloseTo(0.5)
    expect(result.forecast?.spent).toBeCloseTo(600)
    expect(result.forecast?.projected).toBeCloseTo(1200)
    expect(result.cushion?.months).toBeCloseTo(10)
  })
})

describe("balances", () => {
  it("finds the end-of-day balance regardless of row order", () => {
    const rows = [
      tx("2026-05-02", -10, "A", { balanceAfter: 90 }),
      tx("2026-05-02", -20, "B", { balanceAfter: 70 }),
      tx("2026-05-02", 5, "C", { balanceAfter: 75 }),
    ]
    expect(accountsFromTransactions([...rows].reverse())[0]!.balance).toBe(75)
    expect(accountsFromTransactions(rows)[0]!.balance).toBe(75)
  })

  it("builds a month-end series carrying balances forward", () => {
    const series = buildBalanceSeries(
      [tx("2026-01-10", -10, "A", { balanceAfter: 100 }), tx("2026-03-10", -10, "B", { balanceAfter: 50 })],
      "2026-01-01",
      "2026-03-31",
    )
    expect(series.points.map((p) => p.total)).toEqual([100, 100, 50])
  })
})

describe("import parsing", () => {
  it("parses Spanish amounts", () => {
    expect(parseAmount("1.234,56")).toBeCloseTo(1234.56)
    expect(parseAmount("-12,30 €")).toBeCloseTo(-12.3)
    expect(parseAmount("(5,00)")).toBeCloseTo(-5)
    expect(parseAmount("1,234.56")).toBeCloseTo(1234.56)
    expect(parseAmount("")).toBeNaN()
  })

  it("parses dates in several formats", () => {
    expect(parseDate("03/02/2026")).toBe("2026-02-03")
    expect(parseDate("3-2-26")).toBe("2026-02-03")
    expect(parseDate("2026-02-03")).toBe("2026-02-03")
    expect(parseDate(46056)).toBe("2026-02-03")
  })

  it("reads a BBVA-like CSV with quoted fields and balance", () => {
    const csv = [
      "Últimos movimientos",
      "F.Valor;Fecha;Concepto;Movimiento;Importe;Divisa;Disponible",
      '01/02/2026;01/02/2026;"MERCADONA; VALENCIA";Pago con tarjeta;-45,20;EUR;1.000,00',
      "02/02/2026;02/02/2026;Nómina;Abono;2.000,00;EUR;3.000,00",
    ].join("\n")
    const rows = rowsToTransactions(csvToRows(csv), "Principal")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: "2026-02-01", amount: -45.2, category: "Supermercado", balanceAfter: 1000, account: "Principal" })
    expect(rows[1]!.category).toBe("Nómina")
    expect(rows[0]!.id).toMatch(/^tx_/)
  })
})

describe("replaceAccountTransactions", () => {
  it("keeps history, preserves ids and locked categories", () => {
    const existing = [
      { ...tx("2026-01-01", -10, "FNAC"), id: "tx_old", category: "Ocio", categoryLocked: true },
      { ...tx("2025-12-01", -5, "VIEJO"), id: "tx_hist" },
    ]
    const merged = replaceAccountTransactions(existing, [tx("2026-01-01", -10, "FNAC"), tx("2026-01-02", -7, "NUEVO")])
    expect(merged).toHaveLength(3)
    const fnac = merged.find((item) => item.text === "FNAC")!
    expect(fnac).toMatchObject({ id: "tx_old", category: "Ocio", categoryLocked: true })
    expect(merged.some((item) => item.id === "tx_hist")).toBe(true)
  })
})
