<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { Button } from "@/components/ui/button"
import { useFinance } from "@/lib/useFinance"

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
  <header class="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Finanzas personales</p>
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Compras e ingresos</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          <span :class="offline ? 'text-amber-700' : ''">{{ offline ? "Sin conexión (copia local)" : "Datos en la nube" }}</span>
          <span v-if="updatedLabel"> · {{ updatedLabel }}</span>
        </p>
      </div>
      <div ref="menuRoot" class="relative flex w-full flex-wrap gap-2 sm:w-auto">
        <Button class="min-h-11 flex-1 sm:flex-none" :disabled="busy" @click="openImport()">
          {{ busy ? "Importando…" : "Importar extracto" }}
        </Button>
        <input ref="fileInput" class="hidden" type="file" accept=".csv,.xlsx,.xls" multiple @change="onFiles">
        <Button class="min-h-11 flex-1 sm:flex-none" variant="outline" :disabled="scanBusy" @click="ticketInput?.click()">
          {{ scanBusy ? "Leyendo…" : "Ticket / cámara" }}
        </Button>
        <input ref="ticketInput" class="hidden" type="file" accept="image/*" capture="environment" @change="onTicket">
        <Button class="min-h-11" variant="ghost" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">Más</Button>
        <div v-if="menuOpen" class="absolute right-0 top-full z-30 mt-1 min-w-[200px] rounded-xl border bg-card p-1 shadow-md">
          <Button v-if="activeBankSession" variant="ghost" class="w-full justify-start" :disabled="bankBusy" @click="syncBank(); menuOpen = false">Sincronizar banco</Button>
          <Button variant="ghost" class="w-full justify-start" @click="copyChatgpt(); menuOpen = false">Copiar para ChatGPT</Button>
          <Button variant="ghost" class="w-full justify-start" @click="doLogout(); menuOpen = false">Salir</Button>
        </div>
      </div>
    </div>
  </header>
</template>
