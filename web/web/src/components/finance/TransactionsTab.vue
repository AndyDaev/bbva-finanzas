<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CATEGORY_OPTIONS, cleanName, euro, formatDay, parseBankText } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const PAGE = 100
const { filtered, suggestion, setCategory, unlockCategory, acceptSuggestion } = useFinance()
const limit = ref(PAGE)
const hideInternal = ref(true)
const visible = computed(() => (hideInternal.value ? filtered.value.filter((tx) => tx.category !== "Traspaso interno") : filtered.value))
const internalCount = computed(() => filtered.value.length - visible.value.length)
const shown = computed(() => visible.value.slice(0, limit.value))
const totals = computed(() => {
  let income = 0
  let expense = 0
  for (const tx of visible.value) {
    if (tx.amount >= 0) income += tx.amount
    else expense -= tx.amount
  }
  return { income, expense }
})
watch(visible, () => {
  limit.value = PAGE
})

const patternDraft = ref("")
watch(suggestion, (value) => {
  patternDraft.value = value?.pattern || ""
})

/** Clean merchant name plus BBVA's own description (category or movement type). */
const maskCard = (value: string) => value.replace(/d{4}d{6,11}(d{4})/g, "•••• $1")

function describe(text: string) {
  const parts = parseBankText(text)
  const detail = maskCard(parts.bankCategory || parts.kind)
  return { name: cleanName(text), detail: detail ? detail.charAt(0) + detail.slice(1).toLocaleLowerCase("es") : "" }
}

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
        {{ visible.length }} movimientos · entradas {{ euro.format(totals.income) }} · salidas {{ euro.format(totals.expense) }}
        · cambia la categoría para fijarla
      </CardDescription>
      <label v-if="internalCount || !hideInternal" class="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input v-model="hideInternal" type="checkbox" class="size-4 accent-[var(--brand)]">
        Ocultar traspasos entre mis cuentas<template v-if="hideInternal && internalCount"> ({{ internalCount }})</template>
      </label>
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
            <tr v-for="tx in shown" :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`" class="border-b border-dashed border-white/10 last:border-0 transition-colors hover:bg-white/[0.025]">
              <td class="whitespace-nowrap py-1.5 pr-3 tabular-nums">{{ formatDay(tx.date) }}</td>
              <td class="max-w-[320px] py-1.5 pr-3" :title="maskCard(tx.text)">
                <span class="block truncate">{{ describe(tx.text).name }}</span>
                <span v-if="describe(tx.text).detail" class="block truncate text-xs text-muted-foreground">{{ describe(tx.text).detail }}</span>
              </td>
              <td class="py-1.5 pr-3">
                <div class="flex items-center gap-1">
                  <select
                    class="h-9 w-[180px] rounded-md border bg-background px-2 text-sm"
                    :value="tx.category"
                    :aria-label="`Categoría de ${describe(tx.text).name}`"
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
              <td class="whitespace-nowrap py-1.5 text-right tabular-nums" :class="tx.amount > 0 ? 'text-good' : ''">{{ euro.format(tx.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 md:hidden">
        <div v-for="tx in shown" :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`" class="space-y-2 border-t border-dashed border-white/10 pt-3 first:border-0 first:pt-0">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium" :title="maskCard(tx.text)">{{ describe(tx.text).name }}</p>
              <p v-if="describe(tx.text).detail" class="truncate text-xs text-muted-foreground">{{ describe(tx.text).detail }}</p>
              <p class="text-xs text-muted-foreground">{{ formatDay(tx.date) }} · {{ tx.account }}</p>
            </div>
            <strong class="shrink-0 tabular-nums" :class="tx.amount > 0 ? 'text-good' : ''">{{ euro.format(tx.amount) }}</strong>
          </div>
          <div class="flex items-center gap-2">
            <select class="h-11 flex-1 rounded-md border bg-background px-2 text-sm" :value="tx.category" :aria-label="`Categoría de ${describe(tx.text).name}`" @change="onCategory(tx, $event)">
              <option v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</option>
              <option v-if="!CATEGORY_OPTIONS.includes(tx.category)" :value="tx.category">{{ tx.category }}</option>
            </select>
            <button v-if="tx.categoryLocked" type="button" class="min-h-11 rounded px-2 text-xs text-muted-foreground" @click="unlockCategory(tx)">✎ manual</button>
          </div>
        </div>
      </div>

      <p v-if="!shown.length" class="py-4 text-sm text-muted-foreground">No hay movimientos con estos filtros.</p>
      <div v-if="visible.length > shown.length" class="pt-4 text-center">
        <Button variant="outline" class="min-h-10" @click="limit += PAGE">Cargar más ({{ visible.length - shown.length }} restantes)</Button>
      </div>
    </CardContent>
  </Card>
</template>
