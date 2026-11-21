import { describe, expect, it } from "vitest"
import { csvToRows, parseAmount, parseDate, rowsToTransactions } from "./importFile"
import {
  BIZUM_NET,
  buildDailyPace,
  payrollAccrual,
  cleanName,
  detectSavingsAccounts,
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
    expect(categorize("TRASPASO A AHORRO", -300)).toBe("Traspaso interno")
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
    expect(categorize("MEDIAMARKT", -100, [{ id: "r3", pattern: "dia", matchType: "contains", category: "Supermercado" }])).toBe("Tecnología")
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
    // No savings account in view: everything moved to own accounts counts as set aside.
    expect(view.toSavings).toBe(1100)
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
      ["01", "02", "03", "04"].map((m) => tx(`2026-${m}-03`, -15.99, `NETFLIX ${m}/2026`)),
      "2026-04-20",
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: "Netflix", cadence: "monthly", months: 4, amount: 15.99, status: "stable", nextDate: "2026-05-03", chargedThisMonth: true })
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
      ...[3, 6, 9, 12, 14].map((d) => tx(`2026-11-${String(d).padStart(2, "0")}`, -60, "MERCADONA")),
      tx("2026-11-15", -300, "Recibo alquiler piso", { balanceAfter: 4000 }),
    ]
    const result = analyze({ transactions: data, from: "2026-11-01", to: "2026-11-30", today: "2026-11-15" })
    expect(result.compare?.expense.previous).toBeCloseTo(400)
    expect(result.compare?.expense.delta).toBeCloseTo(200)
    expect(result.compare?.expense.pct).toBeCloseTo(0.5)
    expect(result.forecast?.spent).toBeCloseTo(600)
    // Rent (300) counts once; only the 300 of everyday spend is projected: 300 + 300 × 30/15.
    expect(result.forecast?.projected).toBeCloseTo(900)
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

describe("BBVA API texts", () => {
  const api = (category: string, kind: string, detail: string, counterparty = "") =>
    `${category} // ${kind} // ${detail}${counterparty ? ` · ${counterparty}` : ""}`

  it("extracts clean merchant names and groups brands", () => {
    expect(cleanName(api("PAGO CON TARJETA EN SUPERMERCADOS", "PAGO CON TARJETA", "MERCADONA RONDA OUTEIRO A CORUÑA ES"))).toBe("Mercadona")
    expect(cleanName(api("PAGO CON TARJETA EN RESTAURANTES Y CAFETERIAS", "PAGO CON TARJETA", "WOK TWO LA CORUNA ES"))).toBe("Wok Two")
    expect(cleanName(api("PAGO CON TARJETA EN HOTELES Y ALOJAMIENTOS", "PAGO CON TARJETA", "HOTEL SANTA CATALINA A CORUNA ES", "HOTEL SANTA CATALINA"))).toBe("Hotel Santa Catalina")
    expect(cleanName(api("PAGO CON TARJETA DE COMPRAS A DISTANCIA Y SUSCRIPCIONES", "PAGO CON TARJETA", "GOOGLE*GOOGLE PLAY APP", "GOOGLE*GOOGLE PLAY APP"))).toBe("Google Play")
    expect(cleanName(api("PAGO CON TARJETA DE SERVICIOS VARIOS", "PAGO CON TARJETA", "SG CORUãA RIAZOR MALAGA ES", "SG CORUãA R"))).toBe("Sg Coruña R")
    expect(cleanName(api("BIZUM", "OTROS", "RECIBIDO: wifi", "*****"))).toBe("Bizum: wifi")
    expect(cleanName(api("TRASPASO", "TRASPASO A CUENTA", "ANDRES", "ANDRES"))).toBe("Traspaso entre cuentas")
    expect(merchantKey(api("PAGO CON TARJETA EN SUPERMERCADOS", "PAGO CON TARJETA", "MERCADONA AV. PORTUGAL"))).toBe(
      merchantKey(api("PAGO CON TARJETA EN SUPERMERCADOS", "PAGO CON TARJETA", "MERCADONA RONDA OUTEIRO")),
    )
  })

  it("uses the merchant first and BBVA's category as fallback", () => {
    expect(categorize(api("PAGO CON TARJETA EN RESTAURANTES Y CAFETERIAS", "PAGO CON TARJETA", "WWW.AMAZON* EM3SK82U5"), -10.99)).toBe("Compras")
    expect(categorize(api("PAGO CON TARJETA EN MEDICINA,FARMACIA Y SANIDAD", "PAGO CON TARJETA", "JOSE MARIA OBESO"), -8)).toBe("Salud")
    expect(categorize(api("COMPRA EN COMERCIO EXTRANJERO-COMISIÓN 3 % INCLUÍDA", "PAGO CON TARJETA", "PICTHING"), -5.61)).toBe("Compras")
    expect(categorize(api("PAGO CON TARJETA DE COMPRAS A DISTANCIA Y SUSCRIPCIONES", "PAGO CON TARJETA", "OPENAI *CHATGPT SUBSCR"), -23)).toBe("Suscripciones")
    expect(categorize(api("ADEUDO A SU CARGO", "PAGO DE ADEUDO DIRECTO SEPA", "N 2026302000627631 DIGI SPAIN TELECOM SA", "DIGI SPAIN"), -15)).toBe("Telecomunicaciones")
    expect(categorize(api("INGRESO POR NÓMINA O PENSIÓN", "INGRESO POR NÓMINA O PENSIÓN", "EMPRESA SL"), 1500)).toBe("Nómina")
    expect(categorize(api("TRASPASO PROGRAMA TU CUENTA", "TRASPASO A CUENTA", "TRP AHORRO NOMINA"), -36.65)).toBe("Traspaso interno")
    expect(categorize(api("RET. EFECTIVO A DEBITO CON TARJ. EN CAJERO. AUT.", "OTROS", "CAJERO"), -50)).toBe("Efectivo")
  })
})

describe("savings accounts", () => {
  const main = (date: string, amount: number, text: string) => tx(date, amount, text, { account: "Principal" })
  const pot = (date: string, amount: number) => tx(date, amount, amount > 0 ? "TRASPASO // TRASPASO DESDE CUENTA // YO" : "TRASPASO // TRASPASO A CUENTA // YO", { account: "Hucha" })

  it("detects a pot and counts only the net that ends up in it", () => {
    const data = [
      main("2026-10-01", 2000, "NÓMINA"),
      main("2026-10-02", -300, "TRASPASO // TRASPASO A CUENTA // YO"),
      pot("2026-10-02", 300),
      pot("2026-10-20", -50),
      main("2026-10-20", 50, "TRASPASO // TRASPASO DESDE CUENTA // YO"),
      ...[1, 2, 3].map((d) => pot(`2026-09-0${d}`, 10)),
    ]
    expect(detectSavingsAccounts(data)).toEqual(["Hucha"])
    const both = buildView(data.filter((t) => t.date >= "2026-10-01"), [], { today: "2026-12-01", savingsAccounts: ["Hucha"] })
    expect(both.toSavings).toBe(250)
    expect(both.income).toBe(2000)
    const onlyMain = buildView(data.filter((t) => t.account === "Principal"), [], { today: "2026-12-01", savingsAccounts: ["Hucha"] })
    expect(onlyMain.toSavings).toBe(250)
  })
})

describe("recurring by price point and cadence", () => {
  it("separates two plans billed by the same merchant", () => {
    const charges = ["06", "07", "08", "09", "10", "11"].flatMap((m) => [
      tx(`2026-${m}-05`, -1.99, "PAGO CON TARJETA // PAGO CON TARJETA // GOOGLE*GOOGLE*ONE 14M"),
      tx(`2026-${m}-16`, -2.99, "PAGO CON TARJETA // PAGO CON TARJETA // GOOGLE*GOOGLE*ONE 14M"),
    ])
    const result = detectRecurring(charges, "2026-11-20")
    expect(result.map((r) => r.amount).sort()).toEqual([1.99, 2.99])
  })

  it("detects yearly charges and spreads them per month", () => {
    const result = detectRecurring([tx("2024-03-10", -120, "SEGURO HOGAR ANUAL"), tx("2025-03-11", -120, "SEGURO HOGAR ANUAL")], "2025-11-01")
    expect(result[0]).toMatchObject({ cadence: "yearly", amount: 120, nextDate: "2026-03-11" })
    expect(result[0]!.monthly).toBeCloseTo(10)
  })

  it("ignores irregular shopping at the same merchant", () => {
    const shop = ["2026-08-02", "2026-08-19", "2026-09-07", "2026-09-30", "2026-10-03", "2026-11-12"].map((d, i) => tx(d, -(5 + i * 7), "AMAZON MARKETPLACE"))
    expect(detectRecurring(shop, "2026-11-20")).toHaveLength(0)
  })
})

describe("daily pace", () => {
  it("compares cumulative spend with the average of previous months", () => {
    const data = [
      tx("2026-08-05", -100, "MERCADONA"),
      tx("2026-09-05", -200, "MERCADONA"),
      tx("2026-10-05", -300, "MERCADONA"),
      tx("2026-11-03", -50, "MERCADONA"),
      tx("2026-11-04", 20, "BIZUM DE LUIS"),
    ]
    const pace = buildDailyPace(data, "2026-11-10")!
    expect(pace.today).toBe(10)
    expect(pace.points[9]).toEqual({ day: 10, current: 30, average: 200 })
    expect(pace.points[10]!.current).toBeNull()
  })
})

describe("payroll month", () => {
  const pay = (date: string, amount = 1489.04) => tx(date, amount, "ABONO DE NOMINA POR TRANSFERENCIA // INGRESO POR NÓMINA O PENSIÓN // EMPRESA SL")

  it("counts a month-end payroll pushed to the 2nd in the month it pays for", () => {
    const data = [pay("2026-08-31"), pay("2026-09-30"), pay("2026-11-02"), tx("2026-10-13", 558, "TRANSFERENCIA RECIBIDA VICTOR")]
    const { transactions, shifts } = payrollAccrual(data)
    expect(shifts).toEqual([{ paidOn: "2026-11-02", accruedOn: "2026-10-31", amount: 1489.04 }])
    expect(transactions[2]!.date).toBe("2026-10-31")
    expect(data[2]!.date).toBe("2026-11-02")

    const october = analyze({ transactions: data, from: "2026-10-01", to: "2026-10-31", today: "2026-11-20" })
    expect(october.view.income).toBeCloseTo(1489.04 + 558)
    expect(october.payrollShifts).toHaveLength(1)
    const november = analyze({ transactions: data, from: "2026-11-01", to: "2026-11-20", today: "2026-11-20" })
    expect(november.view.income).toBe(0)
    expect(november.payrollShifts).toHaveLength(1)
  })

  it("leaves start-of-month payers alone", () => {
    const data = [pay("2026-08-01"), pay("2026-09-02"), pay("2026-10-01")]
    expect(payrollAccrual(data).shifts).toHaveLength(0)
  })

  it("keeps real dates for balances", () => {
    const data = [pay("2026-08-31"), pay("2026-09-30"), { ...pay("2026-11-02"), balanceAfter: 3000 }]
    const result = analyze({ transactions: data, from: "2026-11-01", to: "2026-11-30", today: "2026-11-20" })
    expect(result.balances.points.at(-1)).toMatchObject({ month: "2026-11", total: 3000 })
  })
})
