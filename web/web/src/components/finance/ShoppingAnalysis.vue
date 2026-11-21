<script setup lang="ts">
import { computed, ref } from "vue"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { euro } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

/** Per-product analysis over every receipt read with AI: where the shopping money goes. */
const { shoppingAll } = useFinance()

const PAGE = 10
const selectedType = ref<string | null>(null)
const showAll = ref(false)

const products = computed(() => {
  const all = shoppingAll.value?.products || []
  return selectedType.value ? all.filter((item) => item.category === selectedType.value) : all
})
const shownProducts = computed(() => (showAll.value ? products.value : products.value.slice(0, PAGE)))
const maxProduct = computed(() => Math.max(...products.value.map((item) => item.amount), 1))
const priceChanges = computed(() => (shoppingAll.value?.repeated || []).filter((item) => item.change != null && Math.abs(item.change) >= 0.01))

function pickType(name: string) {
  selectedType.value = selectedType.value === name ? null : name
  showAll.value = false
}
</script>

<template>
  <section v-if="shoppingAll" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="mono-label">Análisis por artículo</p>
        <h2 class="text-xl font-semibold tracking-[-0.02em]">En qué se va tu compra</h2>
      </div>
      <p class="text-sm text-muted-foreground">
        {{ shoppingAll.tickets }} {{ shoppingAll.tickets === 1 ? "ticket" : "tickets" }} · {{ euro.format(shoppingAll.total) }} · ticket medio {{ euro.format(shoppingAll.average) }}
      </p>
    </div>

    <div class="grid gap-3 lg:grid-cols-5">
      <!-- By product type: tap one to see its products -->
      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle>Por tipo de producto</CardTitle>
          <CardDescription>Toca un tipo para ver sus artículos</CardDescription>
        </CardHeader>
        <CardContent>
          <ul class="space-y-1">
            <li v-for="item in shoppingAll.categories" :key="item.name">
              <button
                type="button"
                class="grid w-full grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/60"
                :class="selectedType === item.name ? 'bg-muted/60' : ''"
                :aria-pressed="selectedType === item.name"
                @click="pickType(item.name)"
              >
                <span class="truncate">{{ item.name }}</span>
                <span class="h-2 overflow-hidden rounded-full bg-muted">
                  <span class="bar-grow block h-full rounded-full bg-[var(--series-1)]" :style="{ width: `${Math.max(2, item.share * 100)}%` }" />
                </span>
                <span class="text-right tabular-nums">{{ euro.format(item.amount) }} <span class="text-xs text-muted-foreground">{{ Math.round(item.share * 100) }} %</span></span>
              </button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Products ranked by money -->
      <Card class="lg:col-span-3">
        <CardHeader>
          <CardTitle>{{ selectedType ? selectedType : "Artículos en los que más gastas" }}</CardTitle>
          <CardDescription>
            <template v-if="selectedType">
              {{ products.length }} artículos ·
              <button type="button" class="underline underline-offset-2" @click="selectedType = null">ver todos los tipos</button>
            </template>
            <template v-else>Ordenados por lo que suman en todos tus tickets</template>
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-1">
          <div v-for="item in shownProducts" :key="item.name" class="space-y-1 border-t border-dashed border-white/10 py-2 first:border-0">
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="min-w-0 truncate font-medium">{{ item.name }}</span>
              <strong class="shrink-0 tabular-nums">{{ euro.format(item.amount) }}</strong>
            </div>
            <div class="flex items-center gap-3">
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span class="block h-full rounded-full bg-white/40" :style="{ width: `${Math.max(2, (item.amount / maxProduct) * 100)}%` }" />
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ item.count }} {{ item.count === 1 ? "vez" : "veces" }} · {{ euro.format(item.avgPrice) }}<template v-if="!selectedType"> · {{ item.category }}</template>
              </span>
            </div>
          </div>
          <button v-if="products.length > PAGE" type="button" class="pt-2 text-sm text-muted-foreground underline underline-offset-2" @click="showAll = !showAll">
            {{ showAll ? "Ver menos" : `Ver los ${products.length} artículos` }}
          </button>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Dónde compras</CardTitle>
          <CardDescription>Lo que suman tus tickets en cada tienda</CardDescription>
        </CardHeader>
        <CardContent class="space-y-1">
          <div v-for="store in shoppingAll.stores" :key="store.name" class="flex items-center justify-between gap-3 border-t border-dashed border-white/10 py-2 text-sm first:border-0">
            <span class="min-w-0 truncate">{{ store.name }} <span class="text-xs text-muted-foreground">· {{ store.tickets }} {{ store.tickets === 1 ? "ticket" : "tickets" }} · media {{ euro.format(store.amount / store.tickets) }}</span></span>
            <strong class="shrink-0 tabular-nums">{{ euro.format(store.amount) }}</strong>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cambios de precio</CardTitle>
          <CardDescription>Artículos que has comprado más de una vez</CardDescription>
        </CardHeader>
        <CardContent class="space-y-1">
          <div v-for="item in priceChanges" :key="item.name" class="flex items-center justify-between gap-3 border-t border-dashed border-white/10 py-2 text-sm first:border-0">
            <span class="min-w-0 truncate">{{ item.name }}</span>
            <span class="shrink-0 text-right tabular-nums">
              {{ euro.format(item.firstPrice) }} → {{ euro.format(item.lastPrice) }}
              <span class="text-xs" :class="item.change! > 0 ? 'text-bad' : 'text-good'">{{ item.change! > 0 ? "▲" : "▼" }} {{ Math.round(Math.abs(item.change!) * 100) }} %</span>
            </span>
          </div>
          <p v-if="!priceChanges.length" class="text-sm text-muted-foreground">
            Aún no hay cambios: aparecerán cuando compres el mismo artículo en varios tickets.
          </p>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
