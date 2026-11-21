import { describe, expect, it, vi } from "vitest"
import { createSSRApp, defineComponent, h } from "vue"
import { renderToString } from "vue/server-renderer"
import { categorize, isoDate, withStableIds, type Transaction } from "@/lib/money"
import { useFinance, type Tab } from "@/lib/useFinance"

// Charts need a DOM: replace every Unovis component with an inert stub.
vi.mock("@unovis/vue", () => {
  const stub = defineComponent({ setup: (_, { slots }) => () => h("div", { "data-chart": "" }, slots.default?.()) })
  const names = ["VisAxis", "VisCrosshair", "VisDonut", "VisGroupedBar", "VisLine", "VisScatter", "VisSingleContainer", "VisStackedBar", "VisTooltip", "VisXYContainer"]
  return Object.fromEntries(names.map((name) => [name, stub]))
})

function sampleData(): Transaction[] {
  const rows: Transaction[] = []
  const today = new Date()
  let balance = 1500
  for (let back = 5; back >= 0; back -= 1) {
    const month = new Date(today.getFullYear(), today.getMonth() - back, 1)
    const day = (d: number) => isoDate(new Date(month.getFullYear(), month.getMonth(), Math.min(d, back === 0 ? today.getDate() : 28)))
    const add = (d: number, amount: number, text: string) => {
      balance += amount
      rows.push({ date: day(d), amount, text, category: categorize(text, amount), account: "Principal", balanceAfter: Math.round(balance * 100) / 100 })
    }
    add(1, 2100, "Abono de nómina · Empresa")
    add(2, -750, "Recibo alquiler piso")
    add(3, -12.99, "NETFLIX.COM")
    add(5, -64.3 - back, "MERCADONA VALENCIA · Pago con tarjeta")
    add(9, -38.5, "Restaurante Goiko · Pago con tarjeta")
    add(12, -30, "BIZUM A ANA cena")
    add(13, 15, "BIZUM DE LUIS cena")
    add(15, -300, "Traspaso a cuenta ahorro")
  }
  return withStableIds(rows)
}

async function renderTab(tab: Tab) {
  const finance = useFinance()
  finance.transactions.value = sampleData()
  finance.rules.value = [{ id: "r1", pattern: "goiko", matchType: "contains", category: "Ocio", direction: "out", priority: 1 }]
  finance.budgets.value = [{ category: "Supermercado", monthlyLimit: 50 }]
  finance.authed.value = true
  finance.authChecked.value = true
  finance.applyPeriod("6m")
  finance.tab.value = tab
  const { default: App } = await import("@/App.vue")
  return renderToString(createSSRApp(App))
}

describe("App renders every tab with data", () => {
  for (const tab of ["resumen", "comercios", "movimientos"] as Tab[]) {
    it(tab, async () => {
      const html = await renderTab(tab)
      expect(html).toContain("Andy Corzo")
      expect(html).toContain("finanzas")
      expect(html).not.toContain("Importa tu primer extracto")
    })
  }

  it("summary shows forecast, recurring and cushion", async () => {
    const html = await renderTab("resumen")
    expect(html).toContain("Suscripciones y recibos")
    expect(html).toContain("Netflix")
    expect(html).toContain("Ritmo de gasto")
    expect(html).toContain("En qué gastas")
    expect(html).toContain("colchón")
  })

  it("trends, tickets and rules tabs render on their own", async () => {
    const { useFinance: use } = await import("@/lib/useFinance")
    const finance = use()
    finance.transactions.value = sampleData()
    finance.applyPeriod("6m")
    for (const [path, text] of [
      ["./TrendsTab.vue", "Gasto por categoría y mes"],
      ["./RulesTab.vue", "Tus reglas"],
      ["./TicketsTab.vue", "Escanea un ticket"],
    ] as const) {
      const { default: Component } = await import(/* @vite-ignore */ path)
      const html = await renderToString(createSSRApp(Component))
      expect(html).toContain(text)
    }
  })
})
