<script setup lang="ts">
import { computed, ref } from "vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatDay } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const { bank, bankBusy, activeBankSession, accounts, connectBank, syncBank, renameBankAccount, disconnectBank } = useFinance()

const editing = ref<{ sessionId: string, uid: string, name: string } | null>(null)
const existingNames = computed(() => accounts.value.map((item) => item.name))

const daysLeft = computed(() => {
  const session = activeBankSession.value
  if (!session) return null
  return Math.max(0, Math.ceil((Date.parse(session.validUntil) - Date.now()) / 86_400_000))
})

function lastSync(iso: string | null) {
  if (!iso) return "nunca"
  const date = new Date(iso)
  return `${formatDay(iso.slice(0, 10))} ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
}

async function saveName() {
  if (!editing.value?.name.trim()) return
  await renameBankAccount(editing.value.sessionId, editing.value.uid, editing.value.name.trim())
  editing.value = null
}
</script>

<template>
  <Card v-if="bank.loaded">
    <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle>Conexión con BBVA</CardTitle>
        <CardDescription>
          <template v-if="!bank.configured">Sincronización automática de solo lectura vía Enable Banking (sin configurar).</template>
          <template v-else-if="activeBankSession">
            Solo lectura · el permiso caduca en {{ daysLeft }} días · última sincronización {{ lastSync(activeBankSession.lastSyncAt) }}
          </template>
          <template v-else>Trae tus movimientos y saldos sin exportar el Excel. Solo lectura: no se puede mover dinero.</template>
        </CardDescription>
      </div>
      <div v-if="bank.configured" class="flex flex-wrap gap-2">
        <Button v-if="activeBankSession" class="min-h-10" :disabled="bankBusy" @click="syncBank()">{{ bankBusy ? "Sincronizando…" : "Sincronizar" }}</Button>
        <Button class="min-h-10" :variant="activeBankSession ? 'outline' : 'default'" :disabled="bankBusy" @click="connectBank">
          {{ activeBankSession ? "Renovar permiso" : "Conectar BBVA" }}
        </Button>
      </div>
    </CardHeader>

    <CardContent v-if="!bank.configured" class="text-sm text-muted-foreground">
      Para activarlo: crea una aplicación en el panel de Enable Banking, vincula tu cuenta BBVA y añade en Cloudflare los secretos
      <code>EB_APP_ID</code> y <code>EB_PRIVATE_KEY</code>. Mientras tanto puedes seguir importando el Excel.
    </CardContent>

    <CardContent v-else-if="activeBankSession" class="space-y-3 text-sm">
      <p v-if="daysLeft != null && daysLeft <= 7" class="text-warn">⚠ El permiso caduca pronto: pulsa «Renovar permiso» para seguir sincronizando.</p>
      <div v-for="account in activeBankSession.accounts" :key="account.uid" class="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-white/10 pt-3 first:border-0 first:pt-0">
        <div class="min-w-0">
          <p class="font-medium">{{ account.name || "Cuenta BBVA" }} <span class="text-muted-foreground">{{ account.label }}</span></p>
          <p v-if="editing?.uid !== account.uid" class="text-xs text-muted-foreground">
            Se guarda como <Badge variant="outline">{{ account.accountName }}</Badge>
          </p>
          <form v-else class="mt-1 flex flex-wrap gap-2" @submit.prevent="saveName">
            <Input v-model="editing.name" class="h-9 w-48" list="bank-account-names" aria-label="Nombre de la cuenta en la app" />
            <datalist id="bank-account-names">
              <option v-for="name in existingNames" :key="name" :value="name" />
            </datalist>
            <Button size="sm" type="submit">Guardar</Button>
            <Button size="sm" variant="ghost" type="button" @click="editing = null">Cancelar</Button>
          </form>
        </div>
        <Button
          v-if="editing?.uid !== account.uid"
          size="sm"
          variant="ghost"
          class="min-h-9"
          title="Usa el mismo nombre que tu cuenta importada del Excel para no duplicar movimientos"
          @click="editing = { sessionId: activeBankSession.id, uid: account.uid, name: account.accountName }"
        >
          Cambiar nombre
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        Los movimientos que ya importaste del Excel (misma cuenta, fecha e importe) no se duplican.
      </p>
      <Button variant="ghost" size="sm" @click="disconnectBank(activeBankSession.id)">Desconectar banco</Button>
    </CardContent>
  </Card>
</template>
