<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CATEGORY_OPTIONS, euro, formatDay } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const PAGE = 100
const { filtered, suggestion, setCategory, unlockCategory, acceptSuggestion } = useFinance()
const limit = ref(PAGE)
const shown = computed(() => filtered.value.slice(0, limit.value))
const totals = computed(() => {
  let income = 0
  let expense = 0
  for (const tx of filtered.value) {
    if (tx.amount >= 0) income += tx.amount
    else expense -= tx.amount
  }
  return { income, expense }
})
watch(filtered, () => {
  limit.value = PAGE
})

const patternDraft = ref("")
watch(suggestion, (value) => {
  patternDraft.value = value?.pattern || ""
})

function onCategory(tx: (typeof filtered.value)[number], event: Event) {
  setCategory(tx, (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <Card v-if="suggestion" class="border-foreground/30">
    <CardContent class="flex flex-wrap items-end gap-3 pt-6 text-sm">
      <div class="min-w-[220px] flex-1 space-y-2">
        <p>
          Hay <strong>{{ suggestion.count }}</strong> movimientos más parecidos a «{{ suggestion.sample }}».
          ¿Crear una regla para que vayan siempre a <strong>{{ suggestion.category }}</strong>?
        </p>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Si el concepto contiene
          <Input v-model="patternDraft" class="min-h-10" />
        </label>
      </div>
      <Button class="min-h-10" :disabled="!patternDraft.trim()" @click="acceptSuggestion(patternDraft.trim())">Crear regla</Button>
      <Button class="min-h-10" variant="ghost" @click="suggestion = null">Solo este</Button>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Movimientos</CardTitle>
      <CardDescription>
        {{ filtered.length }} movimientos · entradas {{ euro.format(totals.income) }} · salidas {{ euro.format(totals.expense) }}
        · cambia la categoría para fijarla
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div class="hidden md:block">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-left text-xs text-muted-foreground">
              <th class="py-2 pr-3 font-medium">Fecha</th>
              <th class="py-2 pr-3 font-medium">Concepto</th>
              <th class="py-2 pr-3 font-medium">Categoría</th>
              <th class="py-2 pr-3 font-medium">Cuenta</th>
              <th class="py-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in shown" :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`" class="border-b last:border-0">
              <td class="whitespace-nowrap py-1.5 pr-3 tabular-nums">{{ formatDay(tx.date) }}</td>
              <td class="max-w-[320px] truncate py-1.5 pr-3" :title="tx.text">{{ tx.text }}</td>
              <td class="py-1.5 pr-3">
                <div class="flex items-center gap-1">
                  <select
                    class="h-9 w-[180px] rounded-md border bg-background px-2 text-sm"
                    :value="tx.category"
                    :aria-label="`Categoría de ${tx.text}`"
                    @change="onCategory(tx, $event)"
                  >
                    <option v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</option>
                    <option v-if="!CATEGORY_OPTIONS.includes(tx.category)" :value="tx.category">{{ tx.category }}</option>
                  </select>
                  <button
                    v-if="tx.categoryLocked"
                    type="button"
                    class="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                    title="Fijada a mano. Pulsa para volver a la categoría automática."
                    @click="unlockCategory(tx)"
                  >
                    ✎ manual
                  </button>
                </div>
              </td>
              <td class="max-w-[140px] truncate py-1.5 pr-3 text-muted-foreground">{{ tx.account }}</td>
              <td class="whitespace-nowrap py-1.5 text-right tabular-nums" :class="tx.amount > 0 ? 'text-emerald-700' : ''">{{ euro.format(tx.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 md:hidden">
        <div v-for="tx in shown" :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`" class="space-y-2 border-t pt-3 first:border-0 first:pt-0">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ tx.text }}</p>
              <p class="text-xs text-muted-foreground">{{ formatDay(tx.date) }} · {{ tx.account }}</p>
            </div>
            <strong class="shrink-0 tabular-nums" :class="tx.amount > 0 ? 'text-emerald-700' : ''">{{ euro.format(tx.amount) }}</strong>
          </div>
          <div class="flex items-center gap-2">
            <select class="h-11 flex-1 rounded-md border bg-background px-2 text-sm" :value="tx.category" :aria-label="`Categoría de ${tx.text}`" @change="onCategory(tx, $event)">
              <option v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</option>
              <option v-if="!CATEGORY_OPTIONS.includes(tx.category)" :value="tx.category">{{ tx.category }}</option>
            </select>
            <button v-if="tx.categoryLocked" type="button" class="min-h-11 rounded px-2 text-xs text-muted-foreground" @click="unlockCategory(tx)">✎ manual</button>
          </div>
        </div>
      </div>

      <p v-if="!shown.length" class="py-4 text-sm text-muted-foreground">No hay movimientos con estos filtros.</p>
      <div v-if="filtered.length > shown.length" class="pt-4 text-center">
        <Button variant="outline" class="min-h-10" @click="limit += PAGE">Cargar más ({{ filtered.length - shown.length }} restantes)</Button>
      </div>
    </CardContent>
  </Card>
</template>
