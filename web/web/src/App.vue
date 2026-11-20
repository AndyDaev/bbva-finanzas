<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import AppHeader from "@/components/finance/AppHeader.vue"
import FiltersBar from "@/components/finance/FiltersBar.vue"
import KpiCards from "@/components/finance/KpiCards.vue"
import LoginScreen from "@/components/finance/LoginScreen.vue"
import MerchantsTab from "@/components/finance/MerchantsTab.vue"
import SummaryTab from "@/components/finance/SummaryTab.vue"
import TransactionsTab from "@/components/finance/TransactionsTab.vue"
import { useFinance, type Tab } from "@/lib/useFinance"

const TrendsTab = defineAsyncComponent(() => import("@/components/finance/TrendsTab.vue"))
const TicketsTab = defineAsyncComponent(() => import("@/components/finance/TicketsTab.vue"))
const RulesTab = defineAsyncComponent(() => import("@/components/finance/RulesTab.vue"))

const { authed, authChecked, tab, notice, hasData, busy, init } = useFinance()
const header = ref<InstanceType<typeof AppHeader> | null>(null)

const tabs: Array<[Tab, string]> = [
  ["resumen", "Resumen"],
  ["evolucion", "Evolución"],
  ["comercios", "Comercios"],
  ["movimientos", "Movimientos"],
  ["tickets", "Tickets"],
  ["reglas", "Reglas"],
]

onMounted(init)
</script>

<template>
  <main v-if="!authChecked" class="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center px-4">
    <p class="text-sm text-muted-foreground">Comprobando sesión…</p>
  </main>

  <LoginScreen v-else-if="!authed" />

  <main v-else class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 pb-24 md:pb-16">
    <AppHeader ref="header" />

    <div
      v-if="notice"
      class="fixed bottom-20 left-1/2 z-40 w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg md:bottom-6"
      role="status"
    >
      {{ notice }}
    </div>

    <nav class="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Secciones">
      <Button
        v-for="[key, label] in tabs"
        :key="key"
        size="sm"
        class="min-h-10 shrink-0"
        role="tab"
        :aria-selected="tab === key"
        :variant="tab === key ? 'default' : 'outline'"
        @click="tab = key"
      >
        {{ label }}
      </Button>
    </nav>

    <Card v-if="!hasData && tab !== 'tickets' && tab !== 'reglas'" class="border-dashed">
      <CardHeader>
        <CardTitle>Importa tu primer extracto</CardTitle>
        <CardDescription>Tres pasos desde la app BBVA</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3 text-sm">
        <ol class="list-decimal space-y-2 pl-4 text-muted-foreground">
          <li>Abre BBVA → tu cuenta → Movimientos.</li>
          <li>Exporta a Excel o CSV (cuantos más meses, mejor análisis).</li>
          <li>Pulsa «Importar extracto».</li>
        </ol>
        <Button class="min-h-11" :disabled="busy" @click="header?.openImport()">Importar extracto</Button>
      </CardContent>
    </Card>

    <template v-else>
      <FiltersBar v-if="tab !== 'tickets' && tab !== 'reglas'" />
      <KpiCards v-if="tab === 'resumen' || tab === 'evolucion'" />

      <SummaryTab v-if="tab === 'resumen'" @import-account="(name) => header?.openImport(name)" />
      <TrendsTab v-else-if="tab === 'evolucion'" />
      <MerchantsTab v-else-if="tab === 'comercios'" />
      <TransactionsTab v-else-if="tab === 'movimientos'" />
      <TicketsTab v-else-if="tab === 'tickets'" />
      <RulesTab v-else-if="tab === 'reglas'" />
    </template>
  </main>
</template>
