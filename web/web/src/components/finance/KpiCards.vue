<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { euro, euroWhole } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"
import DeltaNote from "./DeltaNote.vue"

const { analysis } = useFinance()
</script>

<template>
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card>
      <CardHeader>
        <CardDescription>Ingresos</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ euroWhole.format(analysis.view.income) }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-1 text-xs text-muted-foreground">
        <p>{{ analysis.view.incomeSources[0]?.name || "Sin ingresos" }}</p>
        <p v-if="analysis.compare"><DeltaNote :delta="analysis.compare.income.delta" :pct="analysis.compare.income.pct" up-is-good /> vs anterior</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>Gastos</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ euroWhole.format(analysis.view.expense) }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-1 text-xs text-muted-foreground">
        <p>{{ analysis.view.purchaseCount }} compras · ticket medio {{ euro.format(analysis.view.avgTicket) }}</p>
        <p v-if="analysis.compare"><DeltaNote :delta="analysis.compare.expense.delta" :pct="analysis.compare.expense.pct" /> vs anterior</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>A ahorro</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ euroWhole.format(analysis.view.toSavings) }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-1 text-xs text-muted-foreground">
        <p>Traspasos a cuenta de ahorro</p>
        <p v-if="analysis.compare"><DeltaNote :delta="analysis.compare.toSavings.delta" :pct="analysis.compare.toSavings.pct" up-is-good /> vs anterior</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>Tasa de ahorro</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ Math.round(analysis.view.savingsRate * 100) }} %</CardTitle>
      </CardHeader>
      <CardContent class="space-y-1 text-xs text-muted-foreground">
        <p>Sin asignar {{ euroWhole.format(analysis.view.unassigned) }} (neto − ahorro)</p>
        <p v-if="analysis.compare"><DeltaNote :delta="analysis.compare.savingsRate.delta" points up-is-good /> vs anterior</p>
      </CardContent>
    </Card>
  </section>
  <p v-if="analysis.compare" class="-mt-2 text-xs text-muted-foreground">Periodo anterior: {{ analysis.compare.label }}</p>
</template>
