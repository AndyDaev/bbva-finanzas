<script setup lang="ts">
import { computed } from "vue"
import { VisAxis, VisCrosshair, VisGroupedBar, VisLine, VisScatter, VisStackedBar, VisTooltip, VisXYContainer } from "@unovis/vue"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { euro, euroWhole, type MonthPoint } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const { analysis, view, categoryColors, openCategory } = useFinance()

const months = computed(() => view.value.months)
const monthTick = (index: number) => months.value[index]?.label || ""
const x = (d: { index: number }) => d.index

// ── Income, spend and savings per month ──
const flowSeries = [
  { key: "income", label: "Ingresos", color: "var(--series-income)" },
  { key: "expense", label: "Gastos", color: "var(--series-expense)" },
  { key: "savings", label: "A ahorro", color: "var(--series-savings)" },
] as const
const flowY = flowSeries.map((s) => (d: MonthPoint) => Math.max(0, d[s.key]))
const flowTooltip = (d: MonthPoint) =>
  `<div class="viz-tip"><strong>${d.label}</strong>${flowSeries
    .map((s) => `<div><i style="background:${s.color}"></i>${s.label}<b>${euro.format(d[s.key])}</b></div>`)
    .join("")}</div>`

// ── Stacked spend by category: the stable top categories + "Resto" ──
const RESTO = "Resto"
const stackKeys = computed(() => {
  const present = new Set(months.value.flatMap((m) => Object.keys(m.categories)))
  const keys = categoryColors.value.top.filter((name) => present.has(name))
  const hasRest = [...present].some((name) => !keys.includes(name))
  return hasRest ? [...keys, RESTO] : keys
})
const stackValue = (m: MonthPoint, key: string) =>
  key === RESTO
    ? Object.entries(m.categories).filter(([name]) => !stackKeys.value.includes(name)).reduce((sum, [, v]) => sum + v, 0)
    : m.categories[key] || 0
const stackColor = (key: string) => (key === RESTO ? "var(--series-other)" : categoryColors.value.color(key))
const stackY = computed(() => stackKeys.value.map((key) => (m: MonthPoint) => stackValue(m, key)))
const stackTooltip = (m: MonthPoint) => {
  const rows = [...stackKeys.value]
    .reverse()
    .map((key) => ({ key, value: stackValue(m, key) }))
    .filter((row) => row.value > 0.5)
  return `<div class="viz-tip"><strong>${m.label} · ${euro.format(m.expense)}</strong>${rows
    .map((row) => `<div><i style="background:${stackColor(row.key)}"></i>${row.key}<b>${euro.format(row.value)}</b></div>`)
    .join("")}</div>`
}

// ── Savings rate per month ──
// A rate over a near-empty income month is meaningless (−80.000 %): skip those, and floor at −100 %.
const MIN_INCOME = 100
const rateData = computed(() => months.value.filter((m) => m.savingsRate != null && m.income >= MIN_INCOME))
const rateY = (m: MonthPoint) => Math.max(-100, (m.savingsRate ?? 0) * 100)
const rateTooltip = (m: MonthPoint) =>
  `<div class="viz-tip"><strong>${m.label}</strong><div>Tasa de ahorro<b>${Math.round((m.savingsRate ?? 0) * 100)} %</b></div><div>Ingresos<b>${euro.format(m.income)}</b></div><div>Gastos<b>${euro.format(m.expense)}</b></div></div>`
const avgRate = computed(() => {
  const list = rateData.value
  return list.length ? list.reduce((sum, m) => sum + Math.max(-1, m.savingsRate ?? 0), 0) / list.length : null
})

// ── Balance per account (≤4 lines, otherwise total only) ──
type BalancePoint = (typeof analysis.value.balances.points)[number]
const balanceSeries = computed(() => {
  const { accounts } = analysis.value.balances
  if (accounts.length === 1 || accounts.length > 4) {
    return [{ name: accounts.length === 1 ? accounts[0]! : "Total", color: "var(--series-1)", y: (p: BalancePoint) => p.total }]
  }
  return accounts.map((name, i) => ({ name, color: `var(--series-${i + 1})`, y: (p: BalancePoint) => p.values[i] ?? 0 }))
})
const balanceTick = (index: number) => analysis.value.balances.points[index]?.label || ""
const balanceTooltip = (p: BalancePoint) =>
  `<div class="viz-tip"><strong>${p.label}</strong>${balanceSeries.value
    .map((s) => `<div><i style="background:${s.color}"></i>${s.name}<b>${euro.format(s.y(p))}</b></div>`)
    .join("")}${balanceSeries.value.length > 1 ? `<div>Total<b>${euro.format(p.total)}</b></div>` : ""}</div>`
const balanceDelta = computed(() => {
  const points = analysis.value.balances.points
  return points.length >= 2 ? points[points.length - 1]!.total - points[0]!.total : null
})

// ── Category × month table ──
const table = computed(() => {
  const names = view.value.categories.map((c) => c.name)
  return names.map((name) => {
    const values = months.value.map((m) => m.categories[name] || 0)
    const average = values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1)
    return { name, values, average, total: values.reduce((sum, v) => sum + v, 0) }
  })
})
function cellTone(value: number, average: number) {
  if (value <= 0 || average < 20 || months.value.length < 2) return ""
  if (value > average * 1.3) return "bg-bad/15 text-bad"
  if (value < average * 0.7) return "bg-good/15 text-good"
  return ""
}
</script>

<template>
  <p v-if="months.length < 2" class="text-sm text-muted-foreground">Elige un periodo de al menos dos meses (p. ej. «6 meses») para ver la evolución.</p>

  <Card>
    <CardHeader>
      <CardTitle>Ingresos, gastos y ahorro por mes</CardTitle>
      <CardDescription>Los traspasos entre tus cuentas no cuentan como gasto; el ahorro es lo que acaba en tu cuenta de ahorro</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <ul class="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <li v-for="s in flowSeries" :key="s.key" class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-sm" :style="{ background: s.color }" />{{ s.label }}
        </li>
      </ul>
      <div class="h-[260px] w-full">
        <VisXYContainer :data="months" :height="260" :padding="{ top: 8 }">
          <VisGroupedBar :x="x" :y="flowY" :color="flowSeries.map((s) => s.color)" :rounded-corners="4" :group-padding="0.2" :bar-padding="0.15" />
          <VisAxis type="x" :tick-format="monthTick" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="months.length" />
          <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => euroWhole.format(v)" />
          <VisCrosshair :template="flowTooltip" color="transparent" />
          <VisTooltip />
        </VisXYContainer>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Gasto por categoría y mes</CardTitle>
      <CardDescription>Las {{ stackKeys.filter((k) => k !== "Resto").length }} categorías principales; el resto en gris</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li v-for="key in stackKeys" :key="key" class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-sm" :style="{ background: stackColor(key) }" />{{ key }}
        </li>
      </ul>
      <div class="h-[280px] w-full">
        <VisXYContainer :data="months" :height="280" :padding="{ top: 8 }">
          <VisStackedBar :x="x" :y="stackY" :color="stackKeys.map(stackColor)" :rounded-corners="4" :bar-padding="0.25" />
          <VisAxis type="x" :tick-format="monthTick" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="months.length" />
          <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => euroWhole.format(v)" />
          <VisCrosshair :template="stackTooltip" color="transparent" />
          <VisTooltip />
        </VisXYContainer>
      </div>
    </CardContent>
  </Card>

  <section class="grid gap-3 lg:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle>Tasa de ahorro mensual</CardTitle>
        <CardDescription>
          (Ingresos − gastos) ÷ ingresos
          <template v-if="avgRate != null"> · media {{ Math.round(avgRate * 100) }} %</template>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="rateData.length >= 2" class="h-[220px] w-full">
          <VisXYContainer :data="rateData" :height="220" :padding="{ top: 12, bottom: 4 }">
            <VisLine :x="x" :y="rateY" color="var(--series-savings)" :line-width="2" />
            <VisScatter :x="x" :y="rateY" color="var(--series-savings)" :size="8" stroke-color="var(--card)" :stroke-width="2" />
            <VisAxis type="x" :tick-format="monthTick" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="rateData.length" />
            <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => `${Math.round(v)} %`" />
            <VisCrosshair :template="rateTooltip" color="var(--series-savings)" />
            <VisTooltip />
          </VisXYContainer>
        </div>
        <p v-else class="text-sm text-muted-foreground">Hacen falta al menos dos meses con ingresos.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Saldo a fin de mes</CardTitle>
        <CardDescription>
          <template v-if="balanceDelta != null">
            {{ balanceDelta >= 0 ? "▲ +" : "▼ −" }}{{ euroWhole.format(Math.abs(balanceDelta)) }} en el periodo
          </template>
          <template v-else>Según el saldo que trae cada extracto</template>
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <ul v-if="balanceSeries.length > 1" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li v-for="s in balanceSeries" :key="s.name" class="flex items-center gap-1.5">
            <span class="h-0.5 w-3 rounded" :style="{ background: s.color }" />{{ s.name }}
          </li>
        </ul>
        <div v-if="analysis.balances.points.length >= 2" class="h-[220px] w-full">
          <VisXYContainer :data="analysis.balances.points" :height="220" :padding="{ top: 12, bottom: 4 }">
            <VisLine :x="x" :y="balanceSeries.map((s) => s.y)" :color="balanceSeries.map((s) => s.color)" :line-width="2" />
            <VisAxis type="x" :tick-format="balanceTick" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="analysis.balances.points.length" />
            <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => euroWhole.format(v)" />
            <VisCrosshair :template="balanceTooltip" :color="balanceSeries.map((s) => s.color)" />
            <VisTooltip />
          </VisXYContainer>
        </div>
        <p v-else class="text-sm text-muted-foreground">Los extractos con columna de saldo («Disponible») permiten ver esta evolución.</p>
      </CardContent>
    </Card>
  </section>

  <Card v-if="table.length && months.length">
    <CardHeader>
      <CardTitle>Categorías mes a mes</CardTitle>
      <CardDescription>
        <span class="rounded bg-bad/15 px-1 text-bad">▲ +30 % sobre su media</span>
        ·
        <span class="rounded bg-good/15 px-1 text-good">▼ −30 %</span>
        · toca una categoría para ver sus movimientos
      </CardDescription>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <table class="w-full min-w-[560px] text-sm">
        <thead>
          <tr class="border-b text-xs text-muted-foreground">
            <th class="py-2 pr-3 text-left font-medium">Categoría</th>
            <th v-for="m in months" :key="m.month" class="px-2 py-2 text-right font-medium">{{ m.label }}</th>
            <th class="py-2 pl-3 text-right font-medium">Media</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in table" :key="row.name" class="border-b border-dashed border-white/10 last:border-0 transition-colors hover:bg-white/[0.025]">
            <td class="py-1.5 pr-3">
              <button type="button" class="flex items-center gap-2 text-left hover:underline" @click="openCategory(row.name)">
                <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: categoryColors.color(row.name) }" />
                {{ row.name }}
              </button>
            </td>
            <td v-for="(value, i) in row.values" :key="i" class="px-2 py-1.5 text-right tabular-nums" :class="cellTone(value, row.average)">
              <span v-if="cellTone(value, row.average)" class="sr-only">{{ value > row.average ? "por encima de la media" : "por debajo de la media" }}</span>
              {{ value ? euroWhole.format(value) : "—" }}
            </td>
            <td class="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">{{ euroWhole.format(row.average) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t font-medium">
            <td class="py-2 pr-3">Total</td>
            <td v-for="m in months" :key="m.month" class="px-2 py-2 text-right tabular-nums">{{ euroWhole.format(m.expense) }}</td>
            <td class="py-2 pl-3 text-right tabular-nums">{{ euroWhole.format(view.expense / Math.max(months.length, 1)) }}</td>
          </tr>
        </tfoot>
      </table>
    </CardContent>
  </Card>
</template>
