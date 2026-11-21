<script setup lang="ts">
import { computed } from "vue"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { euro, formatDay } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const { analysis } = useFinance()
const ledger = computed(() => analysis.value.savingsLedger)
const maxFlow = computed(() => Math.max(1, ...(ledger.value?.byMonth || []).flatMap((m) => [m.added, m.withdrawn])))
const shortMonth = (label: string) => label.replace(/ de \d{4}$/, "")
</script>

<template>
  <Card v-if="ledger">
    <CardHeader>
      <p class="mono-label">Cuenta de ahorro · {{ ledger.accounts.join(", ") }}</p>
      <CardTitle class="text-xl">Así llega tu ahorro a {{ ledger.closing != null ? euro.format(ledger.closing) : "su saldo" }}</CardTitle>
      <CardDescription>Con las fechas reales del banco, para que cuadre con tu cuenta</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <!-- Reconciliation: opening + in − out = closing -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p class="mono-label">Saldo {{ formatDay(ledger.from) }}</p>
          <p class="mt-1 text-lg font-semibold tabular-nums">{{ ledger.opening != null ? euro.format(ledger.opening) : "—" }}</p>
        </div>
        <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p class="mono-label">+ Metiste</p>
          <p class="mt-1 text-lg font-semibold tabular-nums text-good">+{{ euro.format(ledger.added) }}</p>
        </div>
        <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p class="mono-label">− Sacaste</p>
          <p class="mt-1 text-lg font-semibold tabular-nums text-bad">−{{ euro.format(ledger.withdrawn) }}</p>
        </div>
        <div class="rounded-xl border border-white/15 bg-white/[0.06] p-3">
          <p class="mono-label !text-foreground">= Saldo {{ formatDay(ledger.to) }}</p>
          <p class="mt-1 text-lg font-semibold tabular-nums">{{ ledger.closing != null ? euro.format(ledger.closing) : "—" }}</p>
        </div>
      </div>
      <p v-if="ledger.mismatch != null" class="text-sm text-warn" role="alert">
        ⚠ Los movimientos no explican {{ euro.format(Math.abs(ledger.mismatch)) }} de diferencia: falta historial de esta cuenta.
      </p>

      <!-- Month by month -->
      <div class="overflow-x-auto">
        <table class="w-full min-w-[480px] text-sm">
          <thead>
            <tr class="text-left">
              <th class="mono-label pb-2 font-semibold">Mes</th>
              <th class="mono-label pb-2 font-semibold">Movimiento</th>
              <th class="mono-label pb-2 text-right font-semibold">Neto</th>
              <th class="mono-label pb-2 text-right font-semibold">Saldo final</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-dashed divide-white/10">
            <tr v-for="row in ledger.byMonth" :key="row.month">
              <td class="py-2 pr-3 capitalize">{{ shortMonth(row.label) }}</td>
              <td class="py-2 pr-3">
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <span class="h-1.5 rounded-full bg-good/80 bar-grow" :style="{ width: `${Math.max(2, (row.added / maxFlow) * 100)}%`, maxWidth: '10rem' }" />
                    <span class="text-xs tabular-nums text-muted-foreground">+{{ euro.format(row.added) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="h-1.5 rounded-full bg-bad/80 bar-grow" :style="{ width: `${Math.max(2, (row.withdrawn / maxFlow) * 100)}%`, maxWidth: '10rem' }" />
                    <span class="text-xs tabular-nums text-muted-foreground">−{{ euro.format(row.withdrawn) }}</span>
                  </div>
                </div>
              </td>
              <td class="py-2 text-right tabular-nums" :class="row.net >= 0 ? 'text-good' : 'text-bad'">
                {{ row.net >= 0 ? "▲ +" : "▼ −" }}{{ euro.format(Math.abs(row.net)) }}
              </td>
              <td class="py-2 text-right font-medium tabular-nums">{{ row.closing != null ? euro.format(row.closing) : "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</template>
