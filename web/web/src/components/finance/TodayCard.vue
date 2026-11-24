<script setup lang="ts">
import { computed } from "vue"
import { Card, CardContent } from "@/components/ui/card"
import { daysBetween, euro, euroWhole, formatDay, isoDate } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"
import CountUp from "./CountUp.vue"

/**
 * "Hoy": what matters every day in one block. Money per day until payday, the cycle's spend
 * against a normal month, and a timeline of the bills still to come before the payroll.
 */
const { analysis, openMerchant } = useFinance()

const payday = computed(() => analysis.value.payday)
const today = isoDate(new Date())
const tight = computed(() => (payday.value?.perDay ?? 0) < 10)

// ── Spend so far vs a normal month ──
const spend = computed(() => {
  const forecast = analysis.value.forecast
  const pace = analysis.value.pace
  if (!forecast) return null
  const point = pace ? pace.points[pace.today - 1] : null
  const expectedToday = point?.average ?? null
  const scale = Math.max(forecast.average ?? 0, forecast.projected, forecast.spent, 1)
  return {
    spent: forecast.spent,
    average: forecast.average,
    projected: forecast.projected,
    gap: expectedToday != null ? forecast.spent - expectedToday : null,
    spentPct: Math.min(100, (forecast.spent / scale) * 100),
    projectedPct: Math.min(100, (forecast.projected / scale) * 100),
    expectedPct: expectedToday != null ? Math.min(100, (expectedToday / scale) * 100) : null,
  }
})

// ── Timeline until payday ──
const timeline = computed(() => {
  const value = payday.value
  if (!value) return null
  const span = Math.max(1, daysBetween(today, value.nextPayday))
  const at = (date: string) => Math.min(100, Math.max(0, (daysBetween(today, date) / span) * 100))
  return {
    items: value.pendingItems.map((item) => ({ ...item, left: at(item.date) })),
    weekTicks: Array.from({ length: Math.floor(span / 7) }, (_, index) => ((index + 1) * 7 * 100) / span).filter((left) => left < 98),
  }
})
const short = (iso: string) => formatDay(iso).slice(0, 5)
</script>

<template>
  <Card v-if="payday" class="overflow-hidden">
    <CardContent class="grid gap-7 pt-6 lg:grid-cols-[1.1fr_1fr]">
      <!-- Per day until payday -->
      <div class="space-y-3">
        <p class="mono-label">Hoy · hasta tu nómina</p>
        <p class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-[clamp(2.6rem,9vw,3.6rem)] leading-none font-semibold tracking-[-0.045em]" :class="tight ? 'text-warn' : ''">
            <CountUp :value="payday.perDay" :format="(v: number) => euro.format(v)" />
          </span>
          <span class="text-sm text-muted-foreground">al día</span>
        </p>
        <dl class="grid max-w-sm grid-cols-3 gap-3 pt-1">
          <div>
            <dt class="mono-label">Disponible</dt>
            <dd class="tabular-nums">{{ euroWhole.format(payday.available) }}</dd>
          </div>
          <div>
            <dt class="mono-label">Recibos</dt>
            <dd class="tabular-nums">{{ euroWhole.format(payday.pendingBills) }}</dd>
          </div>
          <div>
            <dt class="mono-label">Cobras</dt>
            <dd class="tabular-nums">{{ payday.estimated ? "~" : "" }}{{ short(payday.nextPayday) }} · {{ payday.daysLeft }} d</dd>
          </div>
        </dl>
        <p v-if="payday.held > 0" class="text-sm text-muted-foreground">
          Disponible según BBVA: ya descuenta {{ euro.format(payday.held) }} de compras con tarjeta que aún no aparecen en tus movimientos.
        </p>
        <p v-if="tight" class="text-sm text-warn">⚠ Vas justo hasta el cobro.</p>
      </div>

      <!-- Spend this cycle vs a normal month -->
      <div v-if="spend" class="space-y-3">
        <p class="mono-label">Gasto de este mes</p>
        <p class="text-sm">
          Llevas <strong class="tabular-nums">{{ euroWhole.format(spend.spent) }}</strong>
          <template v-if="spend.average"> de una media de <span class="tabular-nums">{{ euroWhole.format(spend.average) }}</span></template>
          <template v-if="spend.gap != null">
            ·
            <span :class="spend.gap > 0 ? 'text-bad' : 'text-good'">
              {{ euroWhole.format(Math.abs(spend.gap)) }} {{ spend.gap > 0 ? "por encima" : "por debajo" }} de lo normal a estas alturas
            </span>
          </template>
        </p>
        <div class="relative h-3 rounded-full bg-muted" role="img" :aria-label="`Gastado ${euroWhole.format(spend.spent)}, previsión ${euroWhole.format(spend.projected)}`">
          <span class="absolute inset-y-0 left-0 rounded-full bg-white/15" :style="{ width: `${spend.projectedPct}%` }" />
          <span class="bar-grow absolute inset-y-0 left-0 rounded-full" :style="{ width: `${Math.max(2, spend.spentPct)}%`, background: 'var(--series-expense)' }" />
          <span v-if="spend.expectedPct != null" class="absolute -inset-y-1 w-0.5 rounded bg-foreground" :style="{ left: `${spend.expectedPct}%` }" title="Lo normal a estas alturas" />
        </div>
        <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li class="flex items-center gap-1.5"><span class="size-2 rounded-full" style="background: var(--series-expense)" />Gastado</li>
          <li class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-white/25" />Previsión ~{{ euroWhole.format(spend.projected) }}</li>
          <li v-if="spend.expectedPct != null" class="flex items-center gap-1.5"><span class="h-2.5 w-0.5 rounded bg-foreground" />Lo normal hoy</li>
        </ul>
      </div>

      <!-- Timeline: today → payday, with the bills still to come -->
      <div v-if="timeline" class="space-y-3 lg:col-span-2">
        <p class="mono-label">Hasta el cobro</p>
        <div class="relative mx-1.5 h-6" aria-hidden="true">
          <span class="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-white/15" />
          <span v-for="left in timeline.weekTicks" :key="left" class="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/20" :style="{ left: `${left}%` }" />
          <span class="absolute top-1/2 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
          <span v-for="item in timeline.items" :key="item.name + item.date" class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-warn" :style="{ left: `${item.left}%` }" />
          <span class="absolute top-1/2 right-0 size-3.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_4px_rgba(255,68,0,0.18)]" />
        </div>
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>Hoy</span>
          <span>Nómina {{ payday.estimated ? "~" : "" }}{{ short(payday.nextPayday) }}</span>
        </div>
        <ul v-if="timeline.items.length" class="divide-y divide-dashed divide-white/10 text-sm">
          <li v-for="item in timeline.items" :key="item.name + item.date">
            <button type="button" class="flex min-h-10 w-full items-center justify-between gap-3 text-left hover:bg-muted/40" @click="openMerchant(item.name)">
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-2 shrink-0 rounded-full bg-warn" />
                <span class="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{{ short(item.date) }}</span>
                <span class="truncate">{{ item.name }}</span>
                <span class="hidden text-xs text-muted-foreground sm:inline">· {{ item.kind === "bill" ? "recibo" : "suscripción" }}</span>
              </span>
              <span class="shrink-0 tabular-nums">{{ euro.format(item.amount) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">No quedan recibos ni suscripciones antes del cobro.</p>
      </div>
    </CardContent>
  </Card>
</template>
