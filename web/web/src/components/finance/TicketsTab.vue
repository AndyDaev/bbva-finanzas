<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { computed, ref } from "vue"
import { CameraIcon } from "@lucide/vue"
import { euro, formatDay } from "@/lib/money"
import { PRODUCT_CATEGORIES } from "@/lib/tickets"
import type { StoredTicket } from "@/lib/store"
import { useFinance } from "@/lib/useFinance"
import ShoppingAnalysis from "./ShoppingAnalysis.vue"

const { draft, tickets, transactions, ticketMatches, selectedTxId, saveTicketDraft, removeTicket, scanTicket, scanBusy } = useFinance()
const photoInput = ref<HTMLInputElement | null>(null)

async function onPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await scanTicket(file)
  input.value = ""
}

/** Sum of the products vs the ticket total: a big gap means something was misread. */
const itemsGap = computed(() => {
  if (!draft.value || !draft.value.total) return 0
  const sum = draft.value.items.reduce((total, item) => total + (Number(item.amount) || 0), 0)
  return Math.round((draft.value.total - sum) * 100) / 100
})

function linkedLabel(ticket: StoredTicket) {
  if (!ticket.transactionId) return "Sin movimiento asociado"
  const tx = transactions.value.find((item) => item.id === ticket.transactionId)
  if (!tx) return "Movimiento asociado"
  return `${formatDay(tx.date)} · ${euro.format(tx.amount)} · ${tx.text.slice(0, 36)}`
}

function addItem() {
  draft.value?.items.push({ name: "Artículo", amount: 0 })
}
</script>

<template>
  <input ref="photoInput" class="hidden" type="file" accept="image/*" capture="environment" @change="onPhoto">
  <Card v-if="!draft" class="border-dashed">
    <CardContent class="flex flex-wrap items-center justify-between gap-4 pt-6">
      <div class="space-y-1">
        <p class="font-medium">Escanea un ticket</p>
        <p class="text-sm text-muted-foreground">Se lee cada producto y su tipo, y se une solo al cobro del banco.</p>
      </div>
      <Button class="min-h-12 gap-2 px-5 text-base" :disabled="scanBusy" @click="photoInput?.click()">
        <CameraIcon class="size-5" aria-hidden="true" />{{ scanBusy ? "Leyendo ticket…" : "Hacer foto del ticket" }}
      </Button>
    </CardContent>
  </Card>

  <Card v-if="draft">
    <CardHeader>
      <CardTitle>Revisar ticket</CardTitle>
      <CardDescription>Corrige lo leído y asócialo a un movimiento</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="grid gap-3 md:grid-cols-3">
        <label class="grid gap-1 text-xs text-muted-foreground">Comercio<Input v-model="draft.merchant" class="min-h-11" /></label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Fecha
          <Input class="min-h-11" :model-value="draft.date || ''" type="date" @update:model-value="draft.date = String($event || '') || null" />
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">Total<Input v-model.number="draft.total" type="number" step="0.01" class="min-h-11" /></label>
      </div>
      <div class="space-y-2">
        <div v-for="(item, index) in draft.items" :key="index" class="grid grid-cols-[1fr_100px_auto] gap-2 sm:grid-cols-[1fr_10rem_120px_auto]">
          <Input v-model="item.name" placeholder="Artículo" class="col-span-3 min-h-11 sm:col-span-1" aria-label="Artículo" />
          <select v-model="item.category" class="min-h-11 rounded-md border bg-background px-2 text-sm" aria-label="Tipo de producto">
            <option :value="undefined">Sin tipo</option>
            <option v-for="name in PRODUCT_CATEGORIES" :key="name" :value="name">{{ name }}</option>
          </select>
          <Input v-model.number="item.amount" type="number" step="0.01" class="min-h-11" aria-label="Importe" />
          <Button variant="ghost" class="min-h-11" @click="draft.items.splice(index, 1)">Quitar</Button>
        </div>
      </div>
      <p v-if="Math.abs(itemsGap) >= 0.05" class="text-sm text-warn">
        ⚠ Los productos suman {{ euro.format(draft.total - itemsGap) }} y el total es {{ euro.format(draft.total) }}: revisa si falta o sobra algo.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" class="min-h-11" @click="addItem">Añadir artículo</Button>
        <select v-model="selectedTxId" class="min-h-11 min-w-[240px] rounded-md border bg-background px-3 text-sm" aria-label="Asociar a compra">
          <option value="none">Sin asociar</option>
          <option v-for="tx in ticketMatches" :key="tx.id" :value="tx.id">
            {{ formatDay(tx.date) }} · {{ euro.format(tx.amount) }} · {{ tx.text.slice(0, 40) }}
          </option>
        </select>
        <Button class="min-h-11" @click="saveTicketDraft">Guardar ticket</Button>
        <Button variant="ghost" class="min-h-11" @click="draft = null">Cancelar</Button>
      </div>
    </CardContent>
  </Card>

  <ShoppingAnalysis v-if="!draft" />

  <div v-if="tickets.length" class="flex items-end justify-between gap-3">
    <h2 class="text-xl font-semibold tracking-[-0.02em]">Tus tickets</h2>
    <p class="text-sm text-muted-foreground">{{ tickets.length }}</p>
  </div>
  <div class="grid gap-3 md:grid-cols-2">
    <Card v-for="ticket in tickets" :key="ticket.id">
      <CardHeader>
        <CardTitle class="text-lg">{{ ticket.merchant }}</CardTitle>
        <CardDescription>{{ ticket.date ? formatDay(ticket.date) : "Sin fecha" }} · {{ euro.format(ticket.total) }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-2 text-sm">
        <div v-for="(item, index) in ticket.items" :key="index" class="flex justify-between gap-2">
          <span class="truncate">{{ item.name }}</span>
          <span class="tabular-nums">{{ euro.format(item.amount) }}</span>
        </div>
        <p class="text-xs text-muted-foreground">{{ linkedLabel(ticket) }}</p>
        <Button size="sm" variant="ghost" class="min-h-10" @click="removeTicket(ticket.id)">Eliminar</Button>
      </CardContent>
    </Card>
  </div>
</template>
