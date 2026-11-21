<script setup lang="ts">
import { computed } from "vue"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { euro, euroWhole, formatDay, labelMonth } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"
import CountUp from "./CountUp.vue"
import DeltaNote from "./DeltaNote.vue"

const { analysis } = useFinance()
const money = (value: number) => euroWhole.format(value)
const percent = (value: number) => `${Math.round(value)} %`

/** When months are pay cycles, say which real dates the current one covers. */
const cycleNote = computed(() => {
  const { cycle } = analysis.value
  const last = cycle.active ? cycle.periods[cycle.periods.length - 1] : null
  if (!last) return null
  const month = labelMonth(last.label).replace(/ de \d{4}$/, "")
  return `Meses por ciclo de nómina · ${month}: ${formatDay(last.from)} – ${formatDay(last.to)}`
})

type Delta = { delta: number, pct: number | null, upIsGood: boolean, points?: boolean }
type Split = { value: number, caption: string, delta: Delta | null }
type Kpi = { label: string, value: number, format: (value: number) => string, note: string, delta: Delta | null, split?: Split[] }

const cards = computed<Kpi[]>(() => {
  const { view, compare } = analysis.value
  // Savings reconcile with the savings account: same figures as the "Cuenta de ahorro" card.
  const ledger = analysis.value.savingsLedger
  const saved = ledger ? ledger.added - ledger.withdrawn : view.toSavings
  const rate = (part: number, whole: number) => (whole > 0 ? part / whole : 0)
  // Two different questions: how much of this month's income went to savings, and how much
  // of it was simply not spent. They differ when savings come from earlier months' leftovers.
  const savedRate = rate(saved, view.income)
  const previousSavedRate = compare ? rate(compare.toSavings.previous, compare.income.previous) : 0
  return [
    {
      label: "Ingresos",
      value: view.income,
      format: money,
      note: view.incomeSources[0]?.name || "Sin ingresos",
      delta: compare ? { delta: compare.income.delta, pct: compare.income.pct, upIsGood: true } : null,
    },
    {
      label: "Gastos",
      value: view.expense,
      format: money,
      note: `${view.purchaseCount} compras · ticket medio ${euro.format(view.avgTicket)}`,
      delta: compare ? { delta: compare.expense.delta, pct: compare.expense.pct, upIsGood: false } : null,
    },
    {
      label: "A ahorro",
      value: ledger ? ledger.added - ledger.withdrawn : view.toSavings,
      format: money,
      note: ledger?.closing != null
        ? `Saldo ${money(ledger.closing)} · metiste ${money(ledger.added)} · sacaste ${money(ledger.withdrawn)}`
        : view.savingsIn || view.savingsOut
          ? `Metiste ${money(view.savingsIn)} · sacaste ${money(view.savingsOut)}`
          : "Neto que acaba en tu cuenta de ahorro",
      delta: compare ? { delta: compare.toSavings.delta, pct: compare.toSavings.pct, upIsGood: true } : null,
    },
    {
      label: "Tasa de ahorro",
      value: savedRate * 100,
      format: percent,
      note: `Te sobran ${money(view.income - view.expense)} de lo que entró`,
      delta: null,
      split: [
        {
          value: savedRate * 100,
          caption: "de tus ingresos fue al ahorro",
          delta: compare ? { delta: savedRate - previousSavedRate, pct: null, upIsGood: true, points: true } : null,
        },
        {
          value: view.savingsRate * 100,
          caption: "de tus ingresos sin gastar",
          delta: compare ? { delta: compare.savingsRate.delta, pct: null, upIsGood: true, points: true } : null,
        },
      ],
    },
  ]
})
</script>

<template>
  <section class="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card v-for="card in cards" :key="card.label" class="card-hover gap-2">
      <CardHeader class="gap-3">
        <p class="mono-label">{{ card.label }}</p>
        <!-- Split card: two related figures side by side, each with its own comparison. -->
        <div v-if="card.split" class="grid grid-cols-2 gap-3">
          <div v-for="part in card.split" :key="part.caption" class="min-w-0 space-y-1">
            <p class="text-[2.1rem] leading-none font-semibold tracking-[-0.04em]">
              <CountUp :value="part.value" :format="card.format" />
            </p>
            <p class="text-xs leading-snug text-muted-foreground">{{ part.caption }}</p>
            <p v-if="part.delta" class="text-xs">
              <DeltaNote :delta="part.delta.delta" :pct="part.delta.pct" :up-is-good="part.delta.upIsGood" :points="part.delta.points" />
            </p>
          </div>
        </div>
        <p v-else class="text-[2.1rem] leading-none font-semibold tracking-[-0.04em]">
          <CountUp :value="card.value" :format="card.format" />
        </p>
      </CardHeader>
      <CardContent class="space-y-1 text-xs text-muted-foreground">
        <p class="truncate">{{ card.note }}</p>
        <p v-if="card.delta">
          <DeltaNote :delta="card.delta.delta" :pct="card.delta.pct" :up-is-good="card.delta.upIsGood" :points="card.delta.points" />
          <span class="ml-1">vs anterior</span>
        </p>
      </CardContent>
    </Card>
  </section>
  <p v-if="analysis.compare || cycleNote" class="mono-label -mt-3 leading-relaxed">
    <template v-if="cycleNote">{{ cycleNote }}</template>
    <template v-if="cycleNote && analysis.compare"> · </template>
    <template v-if="analysis.compare">comparado con {{ analysis.compare.label }}</template>
  </p>
</template>
