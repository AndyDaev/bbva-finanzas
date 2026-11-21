<script setup lang="ts">
import { computed } from "vue"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFinance, type Period } from "@/lib/useFinance"

const {
  tab, period, from, to, account, category, query, accounts, categories, applyPeriod,
} = useFinance()

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
