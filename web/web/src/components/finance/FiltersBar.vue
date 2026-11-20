<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFinance, type Period } from "@/lib/useFinance"

const { tab, period, from, to, account, category, query, accounts, categories, applyPeriod } = useFinance()

const periods: Array<[Period, string]> = [
  ["1m", "Este mes"],
  ["3m", "3 meses"],
  ["6m", "6 meses"],
  ["1y", "12 meses"],
  ["custom", "Personalizado"],
]
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2" role="group" aria-label="Periodo">
      <Button
        v-for="[key, label] in periods"
        :key="key"
        size="sm"
        class="min-h-10"
        :variant="period === key ? 'default' : 'outline'"
        :aria-pressed="period === key"
        @click="applyPeriod(key)"
      >
        {{ label }}
      </Button>
    </div>

    <section class="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
      <label class="grid gap-1 text-xs text-muted-foreground">
        Desde
        <Input v-model="from" type="date" class="min-h-11" @change="period = 'custom'" />
      </label>
      <label class="grid gap-1 text-xs text-muted-foreground">
        Hasta
        <Input v-model="to" type="date" class="min-h-11" @change="period = 'custom'" />
      </label>
      <label class="grid gap-1 text-xs text-muted-foreground">
        Cuenta
        <Select v-model="account">
          <SelectTrigger class="min-h-11 w-full"><SelectValue placeholder="Todas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem v-for="item in accounts" :key="item.name" :value="item.name">{{ item.name }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label v-if="tab === 'movimientos' || tab === 'comercios'" class="grid gap-1 text-xs text-muted-foreground">
        Categoría
        <Select v-model="category">
          <SelectTrigger class="min-h-11 w-full"><SelectValue placeholder="Todas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem v-for="name in categories" :key="name" :value="name">{{ name }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </section>

    <label v-if="tab === 'movimientos' || tab === 'comercios'" class="grid gap-1 text-xs text-muted-foreground">
      Buscar
      <Input v-model="query" type="search" class="min-h-11" placeholder="Mercadona, nómina, Fnac…" />
    </label>
  </div>
</template>
