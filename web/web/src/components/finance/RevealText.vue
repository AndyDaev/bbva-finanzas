<script setup lang="ts">
/**
 * Line-mask reveal from andycorzo.com (AnimatedH1): the text slides up from behind a mask.
 * `text` may contain "\n" to reveal several lines in sequence.
 */
const props = withDefaults(defineProps<{ text: string, delay?: number, stagger?: number }>(), { delay: 0, stagger: 90 })
const lines = () => props.text.split("\n")
</script>

<template>
  <span class="inline-flex flex-col">
    <span v-for="(line, i) in lines()" :key="`${i}-${line}`" class="line-mask">
      <span :style="{ '--delay': `${delay + i * stagger}ms` }">{{ line }}</span>
    </span>
  </span>
</template>
