<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { Button } from "@/components/ui/button"
import { useFinance } from "@/lib/useFinance"
import RevealText from "./RevealText.vue"

const { busy, scanBusy, offline, updatedLabel, importFiles, scanTicket, copyChatgpt, doLogout, activeBankSession, bankBusy, syncBank } = useFinance()
const fileInput = ref<HTMLInputElement | null>(null)
const ticketInput = ref<HTMLInputElement | null>(null)
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const targetAccount = ref("")

/** Lets other components (e.g. "Actualizar" on an account) open the import dialog. */
function openImport(account = "") {
  targetAccount.value = account
  fileInput.value?.click()
}
defineExpose({ openImport })

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  await importFiles([...(input.files || [])], targetAccount.value)
  targetAccount.value = ""
  input.value = ""
}

async function onTicket(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await scanTicket(file)
  input.value = ""
}

function closeOnOutside(event: MouseEvent) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(event.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener("click", closeOnOutside))
onBeforeUnmount(() => document.removeEventListener("click", closeOnOutside))
</script>

<template>
  <header class="space-y-8">
    <!-- Top bar: glass, like the site's nav -->
    <div class="glass sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 md:-mx-6 md:px-6">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="live-dot shrink-0" :class="offline ? 'opacity-40 [animation:none]' : ''" aria-hidden="true" />
        <span class="mono-label truncate !text-foreground">Andy Corzo</span>
        <span class="mono-label hidden truncate sm:inline">/ Finanzas</span>
      </div>
      <div ref="menuRoot" class="relative flex items-center gap-2">
        <Button v-if="activeBankSession" size="sm" class="min-h-9" :disabled="bankBusy" @click="syncBank()">
          {{ bankBusy ? "Sincronizando…" : "Sincronizar" }}
        </Button>
        <!-- With BBVA connected the bank is the source of truth: Excel import moves to "Más". -->
        <Button v-if="!activeBankSession" size="sm" class="min-h-9" :disabled="busy" @click="openImport()">
          {{ busy ? "Importando…" : "Importar" }}
        </Button>
        <input ref="fileInput" class="hidden" type="file" accept=".csv,.xlsx,.xls" multiple @change="onFiles">
        <input ref="ticketInput" class="hidden" type="file" accept="image/*" capture="environment" @change="onTicket">
        <Button size="sm" class="min-h-9" variant="outline" :aria-expanded="menuOpen" aria-label="Más opciones" @click="menuOpen = !menuOpen">Más</Button>
        <Transition name="tab">
          <div v-if="menuOpen" class="glass absolute right-0 top-full z-30 mt-2 min-w-[220px] rounded-2xl border border-white/10 p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]">
            <Button v-if="activeBankSession" variant="ghost" class="w-full justify-start" :disabled="busy" @click="openImport(); menuOpen = false">Importar Excel</Button>
            <Button variant="ghost" class="w-full justify-start" :disabled="scanBusy" @click="ticketInput?.click(); menuOpen = false">{{ scanBusy ? "Leyendo ticket…" : "Escanear ticket" }}</Button>
            <Button variant="ghost" class="w-full justify-start" @click="copyChatgpt(); menuOpen = false">Copiar para ChatGPT</Button>
            <Button variant="ghost" class="w-full justify-start" @click="doLogout(); menuOpen = false">Salir</Button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Hero: uppercase display title revealed line by line -->
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h1 class="display text-gradient text-[clamp(2.75rem,9vw,6rem)]">
        <RevealText :text="'Tus\nfinanzas'" :delay="350" />
      </h1>
      <p class="mono-label pb-2 text-right leading-relaxed">
        <span :class="offline ? 'text-warn' : ''">{{ offline ? "Sin conexión · copia local" : "Sincronizado en la nube" }}</span>
        <br v-if="updatedLabel">
        <span v-if="updatedLabel">{{ updatedLabel }}</span>
      </p>
    </div>
  </header>
</template>
