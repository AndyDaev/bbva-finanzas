<script setup lang="ts">
import { computed } from "vue"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { euro } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const { view, category, query, openMerchant } = useFinance()

const merchants = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase("es")
  return view.value.merchants.filter((item) => {
    if (category.value !== "all" && item.category !== category.value) return false
    return !needle || item.name.toLocaleLowerCase("es").includes(needle)
  })
})
</script>

<template>
  <div class="grid gap-3 md:grid-cols-2">
    <button v-for="item in merchants" :key="item.name" type="button" class="text-left" @click="openMerchant(item.name)">
      <Card class="h-full transition-colors hover:bg-muted/40">
        <CardHeader>
          <CardTitle class="text-lg">{{ item.name }}</CardTitle>
          <CardDescription>{{ item.kind }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2 text-sm">
          <div class="flex justify-between"><span>Gastado</span><strong class="tabular-nums">{{ euro.format(item.amount) }}</strong></div>
          <div class="flex justify-between">
            <span>Compras</span>
            <span class="tabular-nums">{{ item.count }} · {{ euro.format(item.amount / Math.max(item.count || 1, 1)) }} de media</span>
          </div>
          <div class="flex justify-between"><span>Del gasto total</span><span class="tabular-nums">{{ Math.round(item.share * 100) }} %</span></div>
          <div class="h-1.5 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-foreground" :style="{ width: `${Math.max(4, item.share * 100)}%` }" />
          </div>
          <Badge variant="outline">{{ item.category }}</Badge>
        </CardContent>
      </Card>
    </button>
  </div>
  <p v-if="!merchants.length" class="text-sm text-muted-foreground">No hay comercios que coincidan en este periodo.</p>
</template>
