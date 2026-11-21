<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFinance, type Period } from "@/lib/useFinance"

const {
  tab, period, from, to, account, category, query, accounts, categories, applyPeriod,
  selectedMonth, availableMonths, currentMonth, applyMonth, stepMonth,
} = useFinance()

// ── Month selector: oldest → newest, scrolled to the latest ──
const monthStrip = ref<HTMLElement | null>(null)
const months = computed(() => [...availableMonths.value].reverse())
const thisYear = new Date().getFullYear()
const monthFormat = new Intl.DateTimeFormat("es-ES", { month: "short" })
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number)
  const name = monthFormat.format(new Date(y!, m! - 1, 1)).replace(".", "")
  return y === thisYear ? name : `${name} ${String(y).slice(2)}`
}
const activeMonth = computed(() => selectedMonth.value ?? (period.value === "1m" ? currentMonth.value : null))
const canGoBack = computed(() => (activeMonth.value ?? currentMonth.value) > (months.value[0] ?? ""))
const canGoForward = computed(() => activeMonth.value != null && activeMonth.value < currentMonth.value)

function scrollToActive() {
  const strip = monthStrip.value
  if (!strip) return
  const active = strip.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
  else strip.scrollLeft = strip.scrollWidth
}
onMounted(() => nextTick(scrollToActive))
watch(activeMonth, () => nextTick(scrollToActive))

const periods: Array<[Period, string]> = [
  ["1m", "Este mes"],
  ["3m", "3 meses"],
  ["6m", "6 meses"],
  ["1y", "12 meses"],
  ["custom", "Fechas"],
]

const showCategory = computed(() => tab.value === "movimientos" || tab.value === "comercios")
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Periodo">
        <button
          v-for="[key, label] in periods"
          :key="key"
          type="button"
          class="pill min-h-9 px-3.5 text-[0.8rem] font-medium"
          :aria-pressed="period === key"
          @click="applyPeriod(key)"
        >
          {{ label }}
        </button>
      </div>
      <Select v-if="accounts.length > 1" v-model="account">
        <SelectTrigger class="pill min-h-9 w-auto min-w-[10rem] rounded-full border-white/[0.06] px-3.5" aria-label="Cuenta">
          <SelectValue placeholder="Todas las cuentas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las cuentas</SelectItem>
          <SelectItem v-for="item in accounts" :key="item.name" :value="item.name">{{ item.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="flex items-center gap-1.5" role="group" aria-label="Mes">
      <button type="button" class="pill grid size-9 shrink-0 place-items-center text-base disabled:opacity-30" :disabled="!canGoBack" aria-label="Mes anterior" @click="stepMonth(-1)">‹</button>
      <div ref="monthStrip" class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          v-for="month in months"
          :key="month"
          type="button"
          class="pill min-h-9 shrink-0 px-3.5 text-[0.8rem] font-medium capitalize"
          :aria-pressed="activeMonth === month"
          @click="applyMonth(month)"
        >
          {{ monthLabel(month) }}<span v-if="month === currentMonth" class="ml-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-brand align-middle" aria-label="en curso" />
        </button>
      </div>
      <button type="button" class="pill grid size-9 shrink-0 place-items-center text-base disabled:opacity-30" :disabled="!canGoForward" aria-label="Mes siguiente" @click="stepMonth(1)">›</button>
    </div>

    <Transition name="tab">
      <section v-if="period === 'custom'" class="grid gap-3 sm:grid-cols-2 md:max-w-md">
        <label class="grid gap-1.5">
          <span class="mono-label">Desde</span>
          <Input v-model="from" type="date" class="min-h-10 rounded-xl" />
        </label>
        <label class="grid gap-1.5">
          <span class="mono-label">Hasta</span>
          <Input v-model="to" type="date" class="min-h-10 rounded-xl" />
        </label>
      </section>
    </Transition>

    <section v-if="showCategory" class="grid gap-3 sm:grid-cols-[1fr_16rem]">
      <label class="grid gap-1.5">
        <span class="mono-label">Buscar</span>
        <Input v-model="query" type="search" class="min-h-10 rounded-xl" placeholder="Mercadona, nómina, Amazon…" />
      </label>
      <label class="grid gap-1.5">
        <span class="mono-label">Categoría</span>
        <Select v-model="category">
          <SelectTrigger class="min-h-10 w-full rounded-xl"><SelectValue placeholder="Todas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem v-for="name in categories" :key="name" :value="name">{{ name }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </section>
  </div>
</template>
