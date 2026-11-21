<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue"

/** Animates a number towards its value (ease-out-expo), then formats it. */
const props = withDefaults(defineProps<{ value: number, format?: (value: number) => string, duration?: number }>(), {
  format: (value: number) => String(Math.round(value)),
  duration: 900,
})

const shown = ref(0)
let frame = 0
const hasRaf = typeof window !== "undefined" && typeof requestAnimationFrame !== "undefined"
const stop = () => { if (hasRaf) cancelAnimationFrame(frame) }

function animate(from: number, to: number) {
  stop()
  const reduced = hasRaf && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  if (reduced || !hasRaf) {
    shown.value = to
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / props.duration)
    const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t)
    shown.value = from + (to - from) * eased
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

watch(() => props.value, (to, from) => animate(from ?? 0, to), { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <span class="tabular-nums">{{ format(shown) }}</span>
</template>
