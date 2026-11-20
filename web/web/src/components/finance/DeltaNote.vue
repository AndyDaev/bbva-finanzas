<script setup lang="ts">
import { computed } from "vue"
import { euroWhole } from "@/lib/money"

const props = defineProps<{
  delta: number
  pct?: number | null
  /** true when an increase is good news (income, savings). */
  upIsGood?: boolean
  /** Show the delta as percentage points instead of euros. */
  points?: boolean
}>()

const tone = computed(() => {
  if (Math.abs(props.delta) < (props.points ? 0.005 : 1)) return "neutral"
  const up = props.delta > 0
  return up === Boolean(props.upIsGood) ? "good" : "bad"
})

const text = computed(() => {
  const sign = props.delta > 0 ? "+" : props.delta < 0 ? "−" : "±"
  if (props.points) return `${sign}${Math.abs(Math.round(props.delta * 100))} pts`
  const pct = props.pct != null ? ` (${sign}${Math.abs(Math.round(props.pct * 100))} %)` : ""
  return `${sign}${euroWhole.format(Math.abs(props.delta))}${pct}`
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 tabular-nums"
    :class="tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-muted-foreground'"
  >
    <span aria-hidden="true">{{ delta > 0 ? "▲" : delta < 0 ? "▼" : "•" }}</span>
    {{ text }}
    <span class="sr-only">{{ tone === "good" ? "(mejor)" : tone === "bad" ? "(peor)" : "" }}</span>
  </span>
</template>
