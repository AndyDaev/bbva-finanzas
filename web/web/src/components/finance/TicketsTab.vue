<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { euro, formatDay } from "@/lib/money"
import type { StoredTicket } from "@/lib/store"
import { useFinance } from "@/lib/useFinance"

const { draft, tickets, transactions, ticketMatches, selectedTxId, saveTicketDraft, removeTicket } = useFinance()

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
        <div v-for="(item, index) in draft.items" :key="index" class="grid grid-cols-[1fr_100px_auto] gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input v-model="item.name" placeholder="Artículo" class="min-h-11" aria-label="Artículo" />
          <Input v-model.number="item.amount" type="number" step="0.01" class="min-h-11" aria-label="Importe" />
          <Button variant="ghost" class="min-h-11" @click="draft.items.splice(index, 1)">Quitar</Button>
        </div>
      </div>
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
  <p v-if="!tickets.length && !draft" class="text-sm text-muted-foreground">Escanea un ticket con la cámara o sube una foto.</p>
</template>
