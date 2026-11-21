<script setup lang="ts">
import { computed, ref } from "vue"
import { VisAxis, VisCrosshair, VisLine, VisTooltip, VisXYContainer } from "@unovis/vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { euro, euroWhole, formatDay, splitRecurring, type DailyPace } from "@/lib/money"
import { BUDGET_CATEGORIES, useFinance } from "@/lib/useFinance"
import BankCard from "./BankCard.vue"
import SavingsCard from "./SavingsCard.vue"
import DeltaNote from "./DeltaNote.vue"
import FoldSection from "./FoldSection.vue"
import TodayCard from "./TodayCard.vue"

const emit = defineEmits<{ "import-account": [name: string] }>()
const {
  analysis, view, accounts, budgetDraft, categoryColors, savingsAccounts, selectedMonth, currentMonth,
  persistBudgets, copyChatgpt, clearLocal, openMerchant, openCategory,
} = useFinance()

const editingBudgets = ref(false)
/** Pace and forecast describe the month in progress: hide them when looking at a past month. */
const viewingPastMonth = computed(() => selectedMonth.value != null && selectedMonth.value < currentMonth.value)

// ── Month pace (cumulative spend vs average month) ──
type PacePoint = DailyPace["points"][number]
const pace = computed(() => analysis.value.pace)
const paceToday = computed(() => (pace.value ? pace.value.points[pace.value.today - 1] : null))
const paceGap = computed(() => {
  const point = paceToday.value
  return point?.current != null && point.average != null ? point.current - point.average : null
})
const paceX = (d: PacePoint) => d.day
const paceAverage = (d: PacePoint) => d.average ?? undefined
const paceCurrent = (d: PacePoint) => d.current ?? undefined
const paceTooltip = (d: PacePoint) =>
  `<div class="viz-tip"><strong>Día ${d.day}</strong>${
    d.current != null ? `<div><i style="background:var(--series-expense)"></i>Este mes<b>${euro.format(d.current)}</b></div>` : ""
  }${d.average != null ? `<div><i style="background:var(--series-other)"></i>Mes medio<b>${euro.format(d.average)}</b></div>` : ""}</div>`

// ── Categories with change vs previous period ──
const categoryRows = computed(() => {
  const previous = analysis.value.compare?.previousByCategory || {}
  const max = Math.max(...view.value.categories.map((c) => c.amount), 1)
  return view.value.categories.slice(0, 10).map((item) => {
    const before = previous[item.name] || 0
    return { ...item, width: (item.amount / max) * 100, delta: item.amount - before, pct: before > 0 ? (item.amount - before) / before : null, hasPrevious: Boolean(analysis.value.compare) }
  })
})

// Subscriptions (services you choose) and bills (rent, utilities, phone…) are counted apart.
const recurringGroups = computed(() => {
  const { subscriptions, bills } = splitRecurring(analysis.value.recurring)
  const total = (items: typeof subscriptions) => items.reduce((sum, item) => sum + item.monthly, 0)
  return [
    { key: "subscriptions", title: "Suscripciones", hint: "Servicios que eliges y puedes cancelar", items: subscriptions, monthly: total(subscriptions), empty: "No hay suscripciones activas detectadas." },
    { key: "bills", title: "Recibos", hint: "Alquiler, suministros, teléfono, seguros", items: bills, monthly: total(bills), empty: "No hay recibos detectados." },
  ]
})
const topInsights = computed(() => analysis.value.insights.slice(0, 6))

// One-line summaries shown on folded sections.
const recurringSummary = computed(() =>
  recurringGroups.value.map((group) => `${group.items.length} ${group.title.toLowerCase()} · ${euroWhole.format(group.monthly)}/mes`).join(" · "),
)
const accountsSummary = computed(() => {
  const total = accounts.value.reduce((sum, item) => sum + (item.balance ?? 0), 0)
  return `${accounts.value.length} ${accounts.value.length === 1 ? "cuenta" : "cuentas"} · ${euroWhole.format(total)}`
})
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <Badge v-for="item in topInsights" :key="item" variant="secondary" class="whitespace-normal text-left">{{ item }}</Badge>
  </div>

  <TodayCard v-if="!viewingPastMonth" />

  <!-- Month pace -->
  <FoldSection v-if="pace && analysis.forecast && !viewingPastMonth" id="ritmo" title="Ritmo y previsión" :summary="`previsión ~${euroWhole.format(analysis.forecast.projected)}`">
  <section class="grid gap-3 lg:grid-cols-5">
    <Card class="lg:col-span-3">
      <CardHeader>
        <CardTitle>Ritmo de gasto en {{ pace.label }}</CardTitle>
        <CardDescription>
          Acumulado día a día frente a tu mes medio (últimos 3 meses)
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <ul class="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <li class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background: var(--series-expense)" />Este mes</li>
          <li class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background: var(--series-other)" />Mes medio</li>
        </ul>
        <div class="h-[220px] w-full">
          <VisXYContainer :data="pace.points" :height="220" :padding="{ top: 8, right: 8 }">
            <VisLine :x="paceX" :y="paceAverage" color="var(--series-other)" :line-width="2" />
            <VisLine :x="paceX" :y="paceCurrent" color="var(--series-expense)" :line-width="2" />
            <VisAxis type="x" :num-ticks="6" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="(d: number) => `día ${d}`" />
            <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" :tick-format="(v: number) => euroWhole.format(v)" />
            <VisCrosshair :template="paceTooltip" :color="['var(--series-other)', 'var(--series-expense)']" />
            <VisTooltip />
          </VisXYContainer>
        </div>
      </CardContent>
    </Card>

    <Card class="lg:col-span-2">
      <CardHeader>
        <CardDescription>Previsión de cierre · día {{ analysis.forecast.daysElapsed }} de {{ analysis.forecast.daysInMonth }}</CardDescription>
        <CardTitle class="text-3xl tabular-nums">~{{ euroWhole.format(analysis.forecast.projected) }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3 text-sm">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
          <dt class="text-muted-foreground">Llevas</dt>
          <dd class="text-right tabular-nums">{{ euroWhole.format(analysis.forecast.spent) }}</dd>
          <template v-if="paceGap != null">
            <dt class="text-muted-foreground">Vs mes medio a hoy</dt>
            <dd class="text-right"><DeltaNote :delta="paceGap" /></dd>
          </template>
          <template v-if="analysis.forecast.average">
            <dt class="text-muted-foreground">Tu media mensual</dt>
            <dd class="text-right tabular-nums">{{ euroWhole.format(analysis.forecast.average) }}</dd>
          </template>
          <template v-if="analysis.forecast.pending > 0">
            <dt class="text-muted-foreground">Recibos por cobrar</dt>
            <dd class="text-right tabular-nums">{{ euroWhole.format(analysis.forecast.pending) }}</dd>
          </template>
          <dt class="text-muted-foreground">Compras &lt; {{ view.smallPurchases.threshold }} € (periodo)</dt>
          <dd class="text-right tabular-nums">{{ view.smallPurchases.count }} · {{ euroWhole.format(view.smallPurchases.total) }}</dd>
          <template v-if="Math.abs(view.bizumNet) >= 1">
            <dt class="text-muted-foreground">Bizum neto (periodo)</dt>
            <dd class="text-right tabular-nums">{{ view.bizumNet >= 0 ? "+" : "−" }}{{ euroWhole.format(Math.abs(view.bizumNet)) }}</dd>
          </template>
        </dl>
        <p class="text-xs text-muted-foreground">
          La previsión proyecta solo el gasto del día a día; recibos, transferencias y compras de más de 100 € cuentan una vez.
        </p>
      </CardContent>
    </Card>
  </section>
  </FoldSection>

  <!-- Categories and merchants -->
  <FoldSection id="gasto" title="En qué gastas" :summary="euroWhole.format(view.expense)" default-open>
  <section class="grid gap-3 lg:grid-cols-5">
    <Card class="lg:col-span-3">
      <CardHeader>
        <CardTitle>En qué gastas</CardTitle>
        <CardDescription>
          {{ euroWhole.format(view.expense) }} en el periodo<template v-if="analysis.compare"> · cambio frente al periodo anterior</template> · toca una categoría para ver sus movimientos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="space-y-1">
          <li v-for="item in categoryRows" :key="item.name">
            <button type="button" class="grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/60 sm:grid-cols-[minmax(0,11rem)_1fr_auto_10rem]" @click="openCategory(item.name)">
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: categoryColors.color(item.name) }" />
                <span class="truncate">{{ item.name }}</span>
              </span>
              <span class="h-2 overflow-hidden rounded-full bg-muted">
                <span class="bar-grow block h-full rounded-full" :style="{ width: `${Math.max(2, item.width)}%`, background: categoryColors.color(item.name) }" />
              </span>
              <span class="text-right tabular-nums">{{ euroWhole.format(item.amount) }} <span class="text-xs text-muted-foreground">{{ Math.round(item.share * 100) }} %</span></span>
              <span class="hidden whitespace-nowrap text-right text-xs sm:block">
                <DeltaNote v-if="item.hasPrevious" :delta="item.delta" :pct="item.pct" />
              </span>
            </button>
          </li>
        </ul>
        <p v-if="!categoryRows.length" class="text-sm text-muted-foreground">Sin gastos en este periodo.</p>
      </CardContent>
    </Card>

    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>Dónde más gastas</CardTitle>
        <CardDescription>Comercios y destinatarios del periodo</CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="divide-y divide-dashed divide-white/10">
          <li v-for="item in view.merchants.slice(0, 8)" :key="item.name">
            <button type="button" class="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:bg-muted/40" @click="openMerchant(item.name)">
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ item.name }}</span>
                <span class="text-xs text-muted-foreground">{{ item.category }} · {{ item.count }} {{ item.count === 1 ? "pago" : "pagos" }} · media {{ euro.format(item.amount / Math.max(item.count || 1, 1)) }}</span>
              </span>
              <strong class="shrink-0 tabular-nums">{{ euroWhole.format(item.amount) }}</strong>
            </button>
          </li>
        </ul>
      </CardContent>
    </Card>
  </section>
  </FoldSection>

  <!-- What you buy: products from receipts read with AI -->
  <FoldSection v-if="analysis.shopping" id="compras" title="Qué compras" :summary="`${analysis.shopping.tickets} tickets · ${euroWhole.format(analysis.shopping.total)}`">
    <section class="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription>Por tipo de producto · {{ analysis.shopping.tickets }} tickets escaneados en el periodo</CardDescription>
        </CardHeader>
        <CardContent>
          <ul class="space-y-2">
            <li v-for="item in analysis.shopping.categories" :key="item.name" class="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
              <span class="truncate">{{ item.name }}</span>
              <span class="h-2 overflow-hidden rounded-full bg-muted">
                <span class="bar-grow block h-full rounded-full bg-[var(--series-1)]" :style="{ width: `${Math.max(2, item.share * 100)}%` }" />
              </span>
              <span class="text-right tabular-nums">{{ euroWhole.format(item.amount) }} <span class="text-xs text-muted-foreground">{{ Math.round(item.share * 100) }} %</span></span>
            </li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Lo que más repites y cómo cambia su precio</CardDescription>
        </CardHeader>
        <CardContent class="space-y-1">
          <div v-for="item in analysis.shopping.repeated" :key="item.name" class="flex items-start justify-between gap-3 border-t border-dashed border-white/10 py-2 text-sm first:border-0">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ item.name }}</p>
              <p class="text-xs text-muted-foreground">{{ item.count }} veces · {{ euro.format(item.amount) }} en total</p>
            </div>
            <div class="shrink-0 text-right">
              <p class="tabular-nums">{{ euro.format(item.lastPrice) }}</p>
              <p v-if="item.change != null && Math.abs(item.change) >= 0.01" class="text-xs tabular-nums" :class="item.change > 0 ? 'text-bad' : 'text-good'">
                {{ item.change > 0 ? "▲" : "▼" }} {{ Math.round(Math.abs(item.change) * 100) }} % desde {{ euro.format(item.firstPrice) }}
              </p>
            </div>
          </div>
          <p v-if="!analysis.shopping.repeated.length" class="text-sm text-muted-foreground">Cuando escanees el mismo producto más de una vez verás aquí cómo cambia su precio.</p>
        </CardContent>
      </Card>
    </section>
  </FoldSection>

  <!-- Subscriptions and bills, counted apart -->
  <FoldSection id="fijos" title="Fijos" :summary="recurringSummary">
  <section class="grid gap-3 lg:grid-cols-2">
    <Card v-for="group in recurringGroups" :key="group.key">
      <CardHeader>
        <p class="mono-label">{{ group.hint }}</p>
        <CardTitle class="text-xl">{{ group.title }}</CardTitle>
        <CardDescription>
          <template v-if="group.items.length">{{ group.items.length }} activos · ~{{ euro.format(group.monthly) }}/mes · {{ euroWhole.format(group.monthly * 12) }}/año</template>
          <template v-else>Se detectan por su ritmo de cobro (mensual o anual)</template>
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-1">
        <button v-for="item in group.items" :key="item.key" type="button" class="flex w-full items-start justify-between gap-3 border-t border-dashed border-white/10 py-2 text-left first:border-0 hover:bg-muted/40" @click="openMerchant(item.name)">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              <span class="truncate">{{ item.name }}</span>
              <Badge v-if="item.status === 'increase'" variant="outline" class="border-bad/40 text-bad">▲ Sube {{ euro.format(item.amount - item.previousAmount) }}</Badge>
              <Badge v-else-if="item.status === 'new'" variant="outline">Nueva</Badge>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ item.category }} · {{ item.cadence === "yearly" ? "anual" : "mensual" }} · {{ item.count }} cobros ·
              {{ item.chargedThisMonth ? `cobrado el ${formatDay(item.lastDate)}` : `próximo ~${formatDay(item.nextDate)}` }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <strong class="tabular-nums">{{ euro.format(item.amount) }}</strong><span class="text-xs text-muted-foreground">/{{ item.cadence === "yearly" ? "año" : "mes" }}</span>
            <p class="text-xs text-muted-foreground tabular-nums">{{ euroWhole.format(item.annual) }}/año</p>
          </div>
        </button>
        <p v-if="!group.items.length" class="text-sm text-muted-foreground">{{ group.empty }}</p>
      </CardContent>
    </Card>
  </section>
  </FoldSection>

  <!-- Advice -->
  <FoldSection id="mejorar" title="Qué mejorar" :summary="`${analysis.advice.actions.length} ideas`">
    <Card>
      <CardContent class="space-y-3 pt-6">
        <ol class="list-decimal space-y-2 pl-4 text-sm">
          <li v-for="item in analysis.advice.actions" :key="item">{{ item }}</li>
        </ol>
        <div class="space-y-1 border-t pt-3">
          <p v-for="item in analysis.advice.summary" :key="item" class="text-sm text-muted-foreground">{{ item }}</p>
        </div>
        <Button variant="outline" class="min-h-10" @click="copyChatgpt">Copiar resumen para ChatGPT</Button>
      </CardContent>
    </Card>
  </FoldSection>

  <!-- Budgets -->
  <FoldSection id="presupuestos" title="Presupuestos" :summary="analysis.budgets.length ? `${analysis.budgets.length} límites${analysis.budgets.some((item) => item.state !== 'ok') ? ' · ⚠ revisar' : ''}` : 'sin límites'">
  <Card>
    <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardDescription>Límites por categoría con aviso si vas a pasarte</CardDescription>
      </div>
      <div class="flex gap-2">
        <Button v-if="editingBudgets" size="sm" class="min-h-10" @click="persistBudgets(); editingBudgets = false">Guardar</Button>
        <Button size="sm" variant="outline" class="min-h-10" @click="editingBudgets = !editingBudgets">{{ editingBudgets ? "Cerrar" : "Editar límites" }}</Button>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <div v-if="editingBudgets" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label v-for="name in BUDGET_CATEGORIES" :key="name" class="grid gap-1 text-xs text-muted-foreground">
          {{ name }} (€/mes)
          <Input v-model="budgetDraft[name]" type="number" min="0" step="10" class="min-h-11" placeholder="Sin tope" />
        </label>
      </div>
      <div v-if="analysis.budgets.length" class="grid gap-x-6 gap-y-3 md:grid-cols-2">
        <div v-for="item in analysis.budgets" :key="item.category" class="space-y-1.5">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="font-medium">{{ item.category }}</span>
            <span class="tabular-nums">{{ euroWhole.format(item.spent) }} / {{ euroWhole.format(item.limit) }}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full transition-all"
              :class="item.state === 'over' ? 'bg-destructive' : item.state === 'warn' ? 'bg-warn' : 'bg-foreground'"
              :style="{ width: `${Math.min(100, Math.max(4, item.ratio * 100))}%` }"
            />
          </div>
          <p v-if="item.state === 'over'" class="text-xs text-destructive">⚠ Te pasas {{ euro.format(Math.abs(item.remaining)) }}</p>
          <p v-else-if="item.paceNote" class="text-xs text-warn">⚠ {{ item.paceNote }}</p>
        </div>
      </div>
      <p v-else-if="!editingBudgets" class="text-sm text-muted-foreground">Sin límites. Pulsa «Editar límites» y pon, por ejemplo, Restauración 150 €.</p>
    </CardContent>
  </Card>
  </FoldSection>

  <FoldSection id="ahorro" title="Ahorro" :summary="analysis.savingsLedger?.closing != null ? `saldo ${euroWhole.format(analysis.savingsLedger.closing)}` : ''">
    <SavingsCard />
  </FoldSection>

  <FoldSection id="cuentas" title="Cuentas y banco" :summary="accountsSummary">
  <BankCard />
  <Card>
      <CardHeader>
        <CardTitle>Cuentas</CardTitle>
        <CardDescription>
          <template v-if="analysis.cushion">
            Colchón: tus {{ euroWhole.format(analysis.cushion.balance) }} ahorrados cubren
            <strong :class="analysis.cushion.months < 3 ? 'text-warn' : ''">{{ analysis.cushion.months.toFixed(1) }} meses</strong>
            de tu gasto actual ({{ euroWhole.format(analysis.cushion.avgExpense) }}/mes, media de los últimos 3 meses)
          </template>
          <template v-else>Saldo según el último movimiento</template>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-for="item in accounts" :key="item.name" class="flex items-center justify-between gap-3 border-t border-dashed border-white/10 py-2 first:border-0">
          <div class="min-w-0">
            <p class="flex items-center gap-2 truncate font-medium">
              {{ item.name }}
              <Badge v-if="savingsAccounts.includes(item.name)" variant="outline">Ahorro</Badge>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ item.balance == null ? "Sin saldo" : `Saldo ${euro.format(item.balance)} · ${formatDay(item.balanceDate!)}` }}
            </p>
          </div>
          <Button size="sm" class="min-h-10" variant="ghost" @click="emit('import-account', item.name)">Importar Excel</Button>
        </div>
        <Button v-if="accounts.length" variant="ghost" size="sm" class="mt-2" @click="clearLocal">Borrar copia local</Button>
      </CardContent>
    </Card>
  </FoldSection>

  <FoldSection id="grandes" title="Compras grandes" :summary="view.biggest.length ? `la mayor ${euroWhole.format(Math.max(...view.biggest.map((item) => Math.abs(item.amount))))}` : ''">
  <section class="grid gap-3 lg:grid-cols-2">
    <Card>
      <CardHeader>
        <CardDescription>Los importes más altos del periodo</CardDescription>
      </CardHeader>
      <CardContent class="space-y-1">
        <button
          v-for="item in view.biggest"
          :key="`${item.date}-${item.name}-${item.amount}`"
          type="button"
          class="flex min-h-11 w-full items-start justify-between gap-3 border-t border-dashed border-white/10 pt-2 text-left first:border-0 first:pt-0"
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
  </section>
  </FoldSection>
</template>
