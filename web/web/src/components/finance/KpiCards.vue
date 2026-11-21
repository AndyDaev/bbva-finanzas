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

/** Explains payrolls counted in the month they pay for rather than the booking day. */
/** When months are pay cycles, say which real dates the current one covers. */
const cycleNote = computed(() => {
  const { cycle } = analysis.value
  const last = cycle.active ? cycle.periods[cycle.periods.length - 1] : null
  if (!last) return null
  const month = labelMonth(last.label).replace(/ de \d{4}$/, "")
  return `Meses por ciclo de nómina · ${month}: ${formatDay(last.from)} – ${formatDay(last.to)}`
})

const cards = computed(() => {
  const { view, compare } = analysis.value
  // Savings reconcile with the savings account: same figures as the "Cuenta de ahorro" card.
  const ledger = analysis.value.savingsLedger
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
      value: view.savingsRate * 100,
      format: percent,
      note: `Sin asignar ${money(view.unassigned)}`,
      delta: compare ? { delta: compare.savingsRate.delta, pct: null, upIsGood: true, points: true } : null,
    },
  ]
})
</script>

<template>
  <section class="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card v-for="card in cards" :key="card.label" class="card-hover gap-2">
      <CardHeader class="gap-3">
        <p class="mono-label">{{ card.label }}</p>
        <p class="text-[2.1rem] leading-none font-semibold tracking-[-0.04em]">
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
