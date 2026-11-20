<script setup lang="ts">
import { computed } from "vue"
import { VisAxis, VisCrosshair, VisDonut, VisGroupedBar, VisSingleContainer, VisTooltip, VisXYContainer } from "@unovis/vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { euro, euroWhole, formatDay, type MonthPoint, type NamedAmount } from "@/lib/money"
import { BUDGET_CATEGORIES, useFinance } from "@/lib/useFinance"

const emit = defineEmits<{ "import-account": [name: string] }>()
const {
  analysis, view, accounts, budgetDraft, categoryColors,
  persistBudgets, copyChatgpt, clearLocal, openMerchant, openCategory,
} = useFinance()

const flowSeries = [
  { key: "income", label: "Ingresos", color: "var(--series-income)" },
  { key: "expense", label: "Gastos", color: "var(--series-expense)" },
  { key: "savings", label: "A ahorro", color: "var(--series-savings)" },
] as const

const x = (d: MonthPoint) => d.index
const flowY = flowSeries.map((s) => (d: MonthPoint) => d[s.key])
const monthTick = (index: number) => view.value.months[index]?.label || ""
const flowTooltip = (d: MonthPoint) =>
  `<div class="viz-tip"><strong>${d.label}</strong>${flowSeries
    .map((s) => `<div><i style="background:${s.color}"></i>${s.label}<b>${euro.format(d[s.key])}</b></div>`)
    .join("")}</div>`

const donutValue = (d: NamedAmount) => d.amount
const donutColor = (d: NamedAmount) => categoryColors.value.color(d.name)

const recurringTotal = computed(() => analysis.value.recurring.reduce((sum, item) => sum + item.amount, 0))
const forecastRatio = computed(() => {
  const f = analysis.value.forecast
  return f?.average ? f.projected / f.average : null
})
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <Badge v-for="item in analysis.insights" :key="item" variant="secondary" class="whitespace-normal text-left">{{ item }}</Badge>
  </div>
  <div v-if="analysis.trendBadges.length" class="space-y-2">
    <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Último mes completo</p>
    <div class="flex flex-wrap gap-2">
      <Badge v-for="item in analysis.trendBadges" :key="item" variant="outline" class="whitespace-normal text-left">{{ item }}</Badge>
    </div>
  </div>

  <Card v-if="analysis.forecast && analysis.forecast.daysElapsed < analysis.forecast.daysInMonth">
    <CardHeader>
      <CardDescription>Previsión de {{ analysis.forecast.label }} · día {{ analysis.forecast.daysElapsed }} de {{ analysis.forecast.daysInMonth }}</CardDescription>
      <CardTitle class="text-2xl tabular-nums">~{{ euroWhole.format(analysis.forecast.projected) }}</CardTitle>
    </CardHeader>
    <CardContent class="space-y-2 text-sm">
      <div class="h-2 overflow-hidden rounded-full bg-muted" role="img" :aria-label="`Gastado ${euroWhole.format(analysis.forecast.spent)} de ${euroWhole.format(analysis.forecast.projected)} previstos`">
        <div class="h-full rounded-full bg-foreground" :style="{ width: `${Math.min(100, (analysis.forecast.spent / Math.max(analysis.forecast.projected, 1)) * 100)}%` }" />
      </div>
      <p class="text-muted-foreground">
        Llevas {{ euroWhole.format(analysis.forecast.spent) }}.
        <template v-if="analysis.forecast.pending > 0">Quedan ~{{ euroWhole.format(analysis.forecast.pending) }} en recibos fijos por cobrar.</template>
        <template v-if="analysis.forecast.average && forecastRatio">
          Tu media es {{ euroWhole.format(analysis.forecast.average) }}:
          <strong :class="forecastRatio > 1.05 ? 'text-rose-700' : forecastRatio < 0.95 ? 'text-emerald-700' : ''">
            {{ forecastRatio > 1.05 ? `${Math.round((forecastRatio - 1) * 100)} % por encima` : forecastRatio < 0.95 ? `${Math.round((1 - forecastRatio) * 100)} % por debajo` : "en línea" }}
          </strong>.
        </template>
      </p>
    </CardContent>
  </Card>

  <section class="grid gap-3 lg:grid-cols-5">
    <Card class="lg:col-span-3">
      <CardHeader>
        <CardTitle>Ingresos frente a gastos</CardTitle>
        <CardDescription>Por mes · el ahorro no cuenta como gasto</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <ul class="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <li v-for="s in flowSeries" :key="s.key" class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ background: s.color }" />{{ s.label }}
          </li>
        </ul>
        <div class="h-[260px] w-full">
          <VisXYContainer :data="view.months" :height="260" :padding="{ top: 8 }">
            <VisGroupedBar :x="x" :y="flowY" :color="flowSeries.map((s) => s.color)" :rounded-corners="4" :group-padding="0.2" :bar-padding="0.15" />
            <VisAxis type="x" :tick-format="monthTick" :tick-line="false" :domain-line="false" :grid-line="false" :num-ticks="view.months.length" />
            <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => euroWhole.format(v)" />
            <VisCrosshair :template="flowTooltip" color="transparent" />
            <VisTooltip />
          </VisXYContainer>
        </div>
      </CardContent>
    </Card>
    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>Dónde se va</CardTitle>
        <CardDescription>Por categoría · toca para ver movimientos</CardDescription>
      </CardHeader>
      <CardContent class="grid items-center gap-3 sm:grid-cols-[150px_1fr]">
        <div class="mx-auto h-[150px] w-[150px]">
          <VisSingleContainer :data="view.categories" :height="150">
            <VisDonut :value="donutValue" :color="donutColor" :arc-width="16" :pad-angle="0.02" :central-label="euroWhole.format(view.expense)" central-sub-label="gastado" />
          </VisSingleContainer>
        </div>
        <ul class="space-y-1">
          <li v-for="item in view.categories.slice(0, 8)" :key="item.name">
            <button type="button" class="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm hover:bg-muted/60" @click="openCategory(item.name)">
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: categoryColors.color(item.name) }" />
                <span class="truncate">{{ item.name }}</span>
              </span>
              <span class="tabular-nums text-muted-foreground">{{ Math.round(item.share * 100) }} % · {{ euroWhole.format(item.amount) }}</span>
            </button>
          </li>
        </ul>
      </CardContent>
    </Card>
  </section>

  <Card>
    <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle>Presupuestos</CardTitle>
        <CardDescription>Límites mensuales por categoría · avisos de ritmo</CardDescription>
      </div>
      <Button size="sm" class="min-h-10" @click="persistBudgets">Guardar límites</Button>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label v-for="name in BUDGET_CATEGORIES" :key="name" class="grid gap-1 text-xs text-muted-foreground">
          {{ name }} (€/mes)
          <Input v-model="budgetDraft[name]" type="number" min="0" step="10" class="min-h-11" placeholder="Sin tope" />
        </label>
      </div>
      <div v-if="analysis.budgets.length" class="space-y-3">
        <div v-for="item in analysis.budgets" :key="item.category" class="space-y-1.5 border-t pt-3 first:border-0 first:pt-0">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="font-medium">{{ item.category }}</span>
            <span class="tabular-nums">{{ euro.format(item.spent) }} / {{ euro.format(item.limit) }}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full transition-all"
              :class="item.state === 'over' ? 'bg-destructive' : item.state === 'warn' ? 'bg-amber-500' : 'bg-foreground'"
              :style="{ width: `${Math.min(100, Math.max(4, item.ratio * 100))}%` }"
            />
          </div>
          <p v-if="item.state === 'over'" class="text-xs text-destructive">⚠ Te pasas {{ euro.format(Math.abs(item.remaining)) }}</p>
          <p v-else-if="item.paceNote" class="text-xs text-amber-700">⚠ {{ item.paceNote }}</p>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">Define un tope (p. ej. Restauración 200) y guárdalo.</p>
    </CardContent>
  </Card>

  <section class="grid gap-3 lg:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle>Qué mejorar</CardTitle>
        <CardDescription>Consejo calculado a partir de tus datos</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <p v-for="item in analysis.advice.summary" :key="item" class="text-sm text-muted-foreground">{{ item }}</p>
        <ol class="list-decimal space-y-2 pl-4 text-sm">
          <li v-for="item in analysis.advice.actions" :key="item">{{ item }}</li>
        </ol>
        <Button variant="outline" class="min-h-10" @click="copyChatgpt">Copiar briefing para ChatGPT</Button>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>Suscripciones y recibos fijos</CardTitle>
        <CardDescription>
          <template v-if="analysis.recurring.length">~{{ euro.format(recurringTotal) }}/mes · {{ euroWhole.format(recurringTotal * 12) }}/año</template>
          <template v-else>Cargos que se repiten cada mes</template>
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div v-for="item in analysis.recurring" :key="item.key" class="flex items-start justify-between gap-3 border-t pt-3 first:border-0 first:pt-0">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              <span class="truncate">{{ item.name }}</span>
              <Badge v-if="item.status === 'increase'" variant="outline" class="border-rose-300 text-rose-700">▲ Sube {{ euro.format(item.amount - item.previousAmount) }}</Badge>
              <Badge v-else-if="item.status === 'new'" variant="outline">Nueva</Badge>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ item.category }} · {{ item.months }} meses ·
              {{ item.chargedThisMonth ? `cobrado ${formatDay(item.lastDate)}` : `próximo ~${formatDay(item.nextDate)}` }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <strong class="tabular-nums">{{ euro.format(item.amount) }}</strong>
            <p class="text-xs text-muted-foreground tabular-nums">{{ euroWhole.format(item.annual) }}/año</p>
          </div>
        </div>
        <p v-if="!analysis.recurring.length" class="text-sm text-muted-foreground">Con 2–3 meses de historial aparecerán suscripciones y recibos estables.</p>
      </CardContent>
    </Card>
  </section>

  <section class="grid gap-3 lg:grid-cols-2">
    <Card>
      <CardHeader>
        <CardTitle>Cuentas</CardTitle>
        <CardDescription>
          <template v-if="analysis.cushion">
            {{ euroWhole.format(analysis.cushion.balance) }} en total · colchón de
            <strong :class="analysis.cushion.months < 3 ? 'text-amber-700' : ''">{{ analysis.cushion.months.toFixed(1) }} meses</strong>
            de gasto ({{ euroWhole.format(analysis.cushion.avgExpense) }}/mes)
          </template>
          <template v-else>Saldo según el último extracto</template>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-for="item in accounts" :key="item.name" class="flex items-center justify-between gap-3 border-t py-2 first:border-0">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ item.name }}</p>
            <p class="text-xs text-muted-foreground">
              {{ item.balance == null ? "Sin saldo en extracto" : `Saldo ${euro.format(item.balance)} · ${formatDay(item.balanceDate!)}` }}
            </p>
          </div>
          <Button size="sm" class="min-h-10" variant="outline" @click="emit('import-account', item.name)">Actualizar</Button>
        </div>
        <Button v-if="accounts.length" variant="ghost" size="sm" class="mt-2" @click="clearLocal">Borrar copia local</Button>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>Compras grandes</CardTitle>
        <CardDescription>Los importes más altos del periodo</CardDescription>
      </CardHeader>
      <CardContent class="space-y-1">
        <button
          v-for="item in view.biggest"
          :key="`${item.date}-${item.name}-${item.amount}`"
          type="button"
          class="flex min-h-12 w-full items-start justify-between gap-3 border-t pt-2 text-left first:border-0 first:pt-0"
          @click="openMerchant(item.name)"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ item.name }}</p>
            <p class="text-xs text-muted-foreground">{{ item.date ? formatDay(item.date) : "" }} · {{ item.category }}</p>
          </div>
          <strong class="shrink-0 tabular-nums">{{ euro.format(item.amount) }}</strong>
        </button>
        <p v-if="!view.biggest.length" class="text-sm text-muted-foreground">Aún no hay compras en este periodo.</p>
      </CardContent>
    </Card>
  </section>

  <Card v-if="view.ticketItems.length">
    <CardHeader>
      <CardTitle>Artículos de tickets</CardTitle>
      <CardDescription>Lo que suman tus tickets escaneados en el periodo</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      <div v-for="item in view.ticketItems" :key="item.name" class="flex items-center justify-between gap-3 text-sm">
        <span class="truncate">{{ item.name }} <span class="text-xs text-muted-foreground">×{{ item.count }}</span></span>
        <span class="tabular-nums">{{ euro.format(item.amount) }}</span>
      </div>
    </CardContent>
  </Card>
</template>
