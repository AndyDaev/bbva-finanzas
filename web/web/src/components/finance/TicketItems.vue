<script setup lang="ts">
import { euro } from "@/lib/money"
import type { StoredTicket } from "@/lib/store"

/** The products of one receipt, shown under its bank movement. */
defineProps<{ ticket: StoredTicket }>()
</script>

<template>
  <div class="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-3">
    <p class="mono-label mb-2">Ticket · {{ ticket.merchant }} · {{ ticket.items.length }} productos</p>
    <ul class="space-y-1 text-sm">
      <li v-for="(item, index) in ticket.items" :key="index" class="flex items-baseline justify-between gap-3">
        <span class="min-w-0 truncate">
          <span v-if="item.quantity && item.quantity > 1" class="text-muted-foreground">{{ item.quantity }}× </span>{{ item.name }}
          <span v-if="item.category" class="text-xs text-muted-foreground"> · {{ item.category }}</span>
        </span>
        <span class="shrink-0 tabular-nums">{{ euro.format(item.amount) }}</span>
      </li>
    </ul>
    <p class="mt-2 flex justify-between border-t border-dashed border-white/10 pt-2 text-sm font-medium">
      <span>Total</span><span class="tabular-nums">{{ euro.format(ticket.total) }}</span>
    </p>
  </div>
</template>
