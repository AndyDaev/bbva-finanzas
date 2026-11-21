<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useFinance } from "@/lib/useFinance"

/** Month (pay cycle) selector. Stays pinned to the top while scrolling. */
const { period, selectedMonth, availableMonths, currentMonth, applyMonth, stepMonth } = useFinance()

// ── Month selector: oldest → newest, scrolled to the latest ──
const monthStrip = ref<HTMLElement | null>(null)
const months = computed(() => [...availableMonths.value].reverse())
const thisYear = new Date().getFullYear()
const monthFormat = new Intl.DateTimeFormat("es-ES", { month: "short" })
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number)
  const name = monthFormat.format(new Date(y!, m! - 1, 1)).replace(".", "")
  return y === thisYear ? name : `${name} ${String(y).slice(2)}`
}
const activeMonth = computed(() => selectedMonth.value ?? (period.value === "1m" ? currentMonth.value : null))
const canGoBack = computed(() => (activeMonth.value ?? currentMonth.value) > (months.value[0] ?? ""))
const canGoForward = computed(() => activeMonth.value != null && activeMonth.value < currentMonth.value)

function scrollToActive() {
  const strip = monthStrip.value
  if (!strip) return
  const active = strip.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (active) active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
  else strip.scrollLeft = strip.scrollWidth
}
onMounted(() => nextTick(scrollToActive))
watch(activeMonth, () => nextTick(scrollToActive))
</script>

<template>
  <div class="sticky top-0 z-20 bg-[#020202] -mx-4 border-b border-white/[0.06] px-4 py-2 md:-mx-6 md:px-6">
      <div class="flex items-center gap-1.5" role="group" aria-label="Mes">
        <button type="button" class="pill grid size-9 shrink-0 place-items-center text-base disabled:opacity-30" :disabled="!canGoBack" aria-label="Mes anterior" @click="stepMonth(-1)">‹</button>
        <div ref="monthStrip" class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            v-for="month in months"
            :key="month"
            type="button"
            class="pill min-h-9 shrink-0 px-3.5 text-[0.8rem] font-medium capitalize"
            :aria-pressed="activeMonth === month"
            @click="applyMonth(month)"
          >
            {{ monthLabel(month) }}<span v-if="month === currentMonth" class="ml-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-brand align-middle" aria-label="en curso" />
          </button>
        </div>
        <button type="button" class="pill grid size-9 shrink-0 place-items-center text-base disabled:opacity-30" :disabled="!canGoForward" aria-label="Mes siguiente" @click="stepMonth(1)">›</button>
      </div>
  </div>
</template>
