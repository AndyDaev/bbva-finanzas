<script setup lang="ts">
import { ref } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFinance } from "@/lib/useFinance"

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
  <main class="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
    <div>
      <p class="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Finanzas personales</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">Compras e ingresos</h1>
      <p class="mt-2 text-sm text-muted-foreground">Introduce la contraseña para ver y actualizar los datos.</p>
    </div>
    <form class="grid gap-3" @submit.prevent="submit">
      <label class="grid gap-1 text-xs text-muted-foreground">
        Contraseña
        <div class="flex gap-2">
          <Input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            class="h-11 flex-1 text-base"
          />
          <Button type="button" variant="outline" class="h-11 shrink-0" @click="showPassword = !showPassword">
            {{ showPassword ? "Ocultar" : "Ver" }}
          </Button>
        </div>
      </label>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <Button type="submit" class="h-11" :disabled="busy || !password">{{ busy ? "Entrando…" : "Entrar" }}</Button>
    </form>
  </main>
</template>
