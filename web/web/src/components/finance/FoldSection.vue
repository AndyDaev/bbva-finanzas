<script setup lang="ts">
import { ref, useId } from "vue"
import { ChevronDownIcon } from "@lucide/vue"

/** A Summary section that can be folded; whether it is open is remembered on this device. */
const props = withDefaults(defineProps<{ id: string, title: string, summary?: string, defaultOpen?: boolean }>(), {
  summary: "",
  defaultOpen: false,
})

const storageKey = `finanzas:fold:${props.id}`
function initial() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === "1" || saved === "0") return saved === "1"
  } catch {
    // storage blocked
  }
  return props.defaultOpen
}
const open = ref(initial())
const panelId = useId()

function toggle() {
  open.value = !open.value
  try {
    localStorage.setItem(storageKey, open.value ? "1" : "0")
  } catch {
    // ignore
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <button
      type="button"
      class="group flex min-h-11 w-full items-center justify-between gap-3 border-b border-dashed border-white/10 pb-2 text-left"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggle"
    >
      <span class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span class="text-lg font-semibold tracking-[-0.02em]">{{ title }}</span>
        <span v-if="summary && !open" class="mono-label truncate">{{ summary }}</span>
      </span>
      <ChevronDownIcon class="size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:text-foreground" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
    </button>
    <Transition name="tab">
      <div v-if="open" :id="panelId" class="flex flex-col gap-3">
        <slot />
      </div>
    </Transition>
  </section>
</template>
