<script setup lang="ts">
import { ref } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFinance } from "@/lib/useFinance"
import RevealText from "./RevealText.vue"

const { doLogin } = useFinance()
const password = ref("")
const showPassword = ref(false)
const busy = ref(false)
const error = ref("")

async function submit() {
  busy.value = true
  error.value = ""
  try {
    await doLogin(password.value)
    password.value = ""
  } catch (err) {
    error.value = err instanceof Error ? err.message : "No se pudo entrar."
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center gap-10 px-5 py-10">
    <div class="space-y-5">
      <div class="flex items-center gap-2.5">
        <span class="live-dot" aria-hidden="true" />
        <span class="mono-label !text-foreground">Andy Corzo</span>
        <span class="mono-label">/ Finanzas</span>
      </div>
      <h1 class="display text-gradient text-[clamp(3rem,16vw,5rem)]">
        <RevealText :text="'Tus\nfinanzas'" :delay="500" />
      </h1>
      <p class="rise-in text-sm text-muted-foreground [animation-delay:700ms]">Gastos, suscripciones y ahorro, sincronizados con BBVA.</p>
    </div>
    <form class="rise-in glass grid gap-4 rounded-2xl border border-white/[0.08] p-5 [animation-delay:800ms]" @submit.prevent="submit">
      <label class="grid gap-2">
        <span class="mono-label">Contraseña</span>
        <div class="flex gap-2">
          <Input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            class="h-11 flex-1 rounded-xl text-base"
          />
          <Button type="button" variant="outline" class="h-11 shrink-0" @click="showPassword = !showPassword">
            {{ showPassword ? "Ocultar" : "Ver" }}
          </Button>
        </div>
      </label>
      <p v-if="error" class="text-sm text-bad" role="alert">⚠ {{ error }}</p>
      <Button type="submit" class="h-11" :disabled="busy || !password">{{ busy ? "Entrando…" : "Entrar" }}</Button>
    </form>
  </main>
</template>
