<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue"
import { ChartLineIcon, EllipsisIcon, HouseIcon, ListIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import AppHeader from "@/components/finance/AppHeader.vue"
import BankCard from "@/components/finance/BankCard.vue"
import BlockCurtain from "@/components/finance/BlockCurtain.vue"
import FiltersBar from "@/components/finance/FiltersBar.vue"
import KpiCards from "@/components/finance/KpiCards.vue"
import LoginScreen from "@/components/finance/LoginScreen.vue"
import MerchantsTab from "@/components/finance/MerchantsTab.vue"
import MonthStrip from "@/components/finance/MonthStrip.vue"
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

// Mobile: the four most used places in a bottom bar, the rest under "Más".
const bottomTabs = [
  { key: "resumen" as Tab, label: "Resumen", icon: HouseIcon },
  { key: "movimientos" as Tab, label: "Movimientos", icon: ListIcon },
  { key: "evolucion" as Tab, label: "Evolución", icon: ChartLineIcon },
]
const moreTabs = tabs.filter(([key]) => !bottomTabs.some((item) => item.key === key))
const moreOpen = ref(false)
const inMore = computed(() => moreTabs.some(([key]) => key === tab.value))
function go(next: Tab) {
  tab.value = next
  moreOpen.value = false
  window.scrollTo({ top: 0, behavior: "smooth" })
}

onMounted(init)
</script>

<template>
  <BlockCurtain />

  <main v-if="!authChecked" class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8" aria-busy="true">
    <span class="sr-only">Comprobando sesión…</span>
    <div class="skeleton h-14 w-64" />
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 4" :key="i" class="skeleton h-32" />
    </div>
    <div class="skeleton h-72" />
  </main>

  <LoginScreen v-else-if="!authed" />

  <main v-else class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-4 pb-24 md:px-6 md:pb-16">
    <AppHeader ref="header" />

    <Transition name="toast">
      <div
        v-if="notice"
        class="glass fixed bottom-24 left-1/2 z-40 w-[min(92vw,30rem)] -translate-x-1/2 rounded-2xl border border-white/10 px-4 py-3 text-sm shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] md:bottom-8"
        role="status"
      >
        <span class="mr-2 inline-block size-1.5 -translate-y-px rounded-full bg-brand align-middle" aria-hidden="true" />{{ notice }}
      </div>
    </Transition>

    <nav class="-mx-4 hidden gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex md:px-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Secciones">
      <button
        v-for="[key, label] in tabs"
        :key="key"
        type="button"
        class="pill min-h-10 shrink-0 px-4 text-[0.82rem] font-medium"
        role="tab"
        :aria-selected="tab === key"
        @click="tab = key"
      >
        {{ label }}
      </button>
    </nav>

    <Transition name="tab" mode="out-in">
      <div :key="hasData ? tab : 'empty'" class="stagger flex flex-col gap-6">
        <template v-if="!hasData && tab !== 'tickets' && tab !== 'reglas'">
          <Card class="border-dashed">
            <CardHeader>
              <p class="mono-label">Paso 1</p>
              <CardTitle class="text-xl">Trae tus movimientos</CardTitle>
              <CardDescription>Conecta BBVA abajo, o importa un Excel exportado desde la app del banco.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button class="min-h-11" :disabled="busy" @click="header?.openImport()">Importar extracto</Button>
            </CardContent>
          </Card>
          <BankCard />
        </template>

        <template v-else>
          <MonthStrip v-if="tab !== 'tickets' && tab !== 'reglas'" />
          <FiltersBar v-if="tab !== 'tickets' && tab !== 'reglas'" />
          <KpiCards v-if="tab === 'resumen' || tab === 'evolucion'" />

          <SummaryTab v-if="tab === 'resumen'" @import-account="(name) => header?.openImport(name)" />
          <TrendsTab v-else-if="tab === 'evolucion'" />
          <MerchantsTab v-else-if="tab === 'comercios'" />
          <TransactionsTab v-else-if="tab === 'movimientos'" />
          <TicketsTab v-else-if="tab === 'tickets'" />
          <RulesTab v-else-if="tab === 'reglas'" />
        </template>
      </div>
    </Transition>

    <!-- Mobile bottom bar (thumb reach) -->
    <nav class="glass fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Secciones">
      <Transition name="tab">
        <div v-if="moreOpen" class="absolute right-3 bottom-full mb-2 min-w-[200px] rounded-2xl border border-white/10 bg-[#0b0b0b] p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]">
          <button
            v-for="[key, label] in moreTabs"
            :key="key"
            type="button"
            class="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm hover:bg-white/[0.06]"
            :class="tab === key ? 'text-brand' : ''"
            @click="go(key)"
          >
            {{ label }}
          </button>
        </div>
      </Transition>
      <div class="grid grid-cols-4">
        <button
          v-for="item in bottomTabs"
          :key="item.key"
          type="button"
          class="flex min-h-15 flex-col items-center justify-center gap-1 text-[0.68rem] font-medium transition-colors"
          :class="tab === item.key ? 'text-foreground' : 'text-muted-foreground'"
          :aria-current="tab === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          <component :is="item.icon" class="size-5" :class="tab === item.key ? 'text-brand' : ''" aria-hidden="true" />
          {{ item.label }}
        </button>
        <button
          type="button"
          class="flex min-h-15 flex-col items-center justify-center gap-1 text-[0.68rem] font-medium"
          :class="inMore || moreOpen ? 'text-foreground' : 'text-muted-foreground'"
          :aria-expanded="moreOpen"
          @click="moreOpen = !moreOpen"
        >
          <EllipsisIcon class="size-5" :class="inMore ? 'text-brand' : ''" aria-hidden="true" />
          {{ inMore ? moreTabs.find(([key]) => key === tab)?.[1] : "Más" }}
        </button>
      </div>
    </nav>
  </main>
</template>
