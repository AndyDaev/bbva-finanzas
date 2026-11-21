<script setup lang="ts">
import { onMounted, ref } from "vue"

/**
 * Entrance curtain from andycorzo.com: a 10×11 grid of page-coloured blocks that fold
 * away with a random delay per block plus a delay per row, revealing the app underneath.
 */
const ROWS = 10
const COLS = 11
const visible = ref(true)

const blocks = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, () => Math.random() * 0.5 + (ROWS - row - 1) * 0.05),
)

onMounted(() => {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  setTimeout(() => (visible.value = false), reduced ? 0 : 1400)
})
</script>

<template>
  <div v-if="visible" class="curtain" aria-hidden="true">
    <div v-for="(row, r) in blocks" :key="r" class="curtain-row">
      <div v-for="(delay, c) in row" :key="c" class="curtain-block" :style="{ '--delay': `${Math.round(delay * 1000)}ms` }" />
    </div>
  </div>
</template>
