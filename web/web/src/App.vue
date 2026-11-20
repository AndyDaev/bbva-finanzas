<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { VisAxis, VisDonut, VisGroupedBar, VisSingleContainer, VisXYContainer } from "@unovis/vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { parseBankFile } from "@/lib/importFile"
import {
  accountsFromTransactions,
  CATEGORY_OPTIONS,
  chatgptBrief,
  euro,
  euroWhole,
  formatDay,
  guessAccountName,
  isoDate,
  recompute,
  replaceAccountTransactions,
  type Budget,
  type Transaction,
} from "@/lib/money"
import {
  checkSession,
  clearApiCaches,
  clearLocalData,
  deleteTicket,
  fetchData,
  importTransactions,
  loadCache,
  login,
  logout,
  migrateLocalIfNeeded,
  patchTransactionCategory,
  saveBudgets,
  saveCache,
  saveTicket,
  type StoredTicket,
} from "@/lib/store"
import { matchTransactions, parseTicketText, scanTicketImage, type TicketDraft } from "@/lib/tickets"

type Tab = "resumen" | "comercios" | "tickets" | "movimientos"

const authed = ref(false)
const authChecked = ref(false)
const password = ref("")
const showPassword = ref(false)
const loginBusy = ref(false)
const loginError = ref("")
const tab = ref<Tab>("resumen")
const transactions = ref<Transaction[]>([])
const tickets = ref<StoredTicket[]>([])
const budgets = ref<Budget[]>([])
const budgetDraft = ref<Record<string, string>>({})
const updatedAt = ref<string | null>(null)
const notice = ref("")
const menuOpen = ref(false)
const busy = ref(false)
const offline = ref(false)
const account = ref("all")
const category = ref("all")
const query = ref("")
const period = ref<"1m" | "3m" | "6m" | "1y" | "custom">("6m")
const today = new Date()
const from = ref(isoDate(new Date(today.getFullYear(), today.getMonth() - 5, 1)))
const to = ref(isoDate(today))
const fileInput = ref<HTMLInputElement | null>(null)
const updateAccount = ref("")
const ticketInput = ref<HTMLInputElement | null>(null)
const draft = ref<TicketDraft | null>(null)
const selectedTxId = ref("none")
const scanBusy = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const chartConfig = {
  income: { label: "Ingresos", color: "var(--chart-1)" },
  expense: { label: "Gastos", color: "var(--chart-2)" },
  savings: { label: "Ahorro", color: "var(--chart-3)" },
} satisfies ChartConfig

const budgetCategories = [
  "Supermercado",
  "Restauración",
  "Comida a domicilio",
  "Compras",
  "Ocio",
  "Viajes",
  "Transporte",
  "Salud",
  "Suscripciones",
]

const accounts = computed(() => accountsFromTransactions(transactions.value))
const categories = computed(() => [...new Set(transactions.value.map((tx) => tx.category))].sort())
const hasData = computed(() => transactions.value.length > 0 || tickets.value.length > 0)

/** KPIs/charts: date + account only (ignore category/search). */
const analysisTx = computed(() =>
  transactions.value.filter((tx) => {
    if (tx.date < from.value || tx.date > to.value) return false
    if (account.value !== "all" && tx.account !== account.value) return false
    return true
  }),
)

const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase("es")
  return analysisTx.value.filter((tx) => {
    if (category.value !== "all" && tx.category !== category.value) return false
    if (needle && !`${tx.text} ${tx.category}`.toLocaleLowerCase("es").includes(needle)) return false
    return true
  })
})

const view = computed(() => recompute(analysisTx.value, tickets.value, []))
/** Budgets always from full unfiltered dataset (current month logic inside recompute). */
const budgetStatuses = computed(() => recompute(transactions.value, tickets.value, budgets.value).budgets)
const shown = computed(() => filtered.value.slice(0, 200))
const matches = computed(() => (draft.value ? matchTransactions(draft.value, transactions.value) : []))
const updatedLabel = computed(() => {
  if (!updatedAt.value) return null
  const date = new Date(updatedAt.value)
  if (Number.isNaN(date.valueOf())) return null
  const sameDay = isoDate(date) === isoDate(new Date())
  const time = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  return sameDay ? `Actualizado hoy ${time}` : `Actualizado ${formatDay(isoDate(date))} ${time}`
})

function applyPeriod(next: typeof period.value) {
  period.value = next
  if (next === "custom") return
  const end = new Date()
  const start = new Date()
  if (next === "1m") start.setMonth(start.getMonth() - 1)
  else if (next === "3m") start.setMonth(start.getMonth() - 3)
  else if (next === "6m") start.setMonth(start.getMonth() - 6)
  else start.setFullYear(start.getFullYear() - 1)
  from.value = isoDate(new Date(start.getFullYear(), start.getMonth(), 1))
  to.value = isoDate(end)
}

function flash(message: string) {
  notice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ""
  }, 4200)
}

function persistLocal() {
  saveCache({
    transactions: transactions.value,
    tickets: tickets.value,
    budgets: budgets.value,
    updatedAt: new Date().toISOString(),
  })
  updatedAt.value = new Date().toISOString()
}

function applyData(data: { transactions: Transaction[], tickets: StoredTicket[], budgets: Budget[], updatedAt?: string | null }) {
  transactions.value = data.transactions
  tickets.value = data.tickets
  budgets.value = data.budgets
  updatedAt.value = data.updatedAt || null
  const draftMap: Record<string, string> = {}
  for (const name of budgetCategories) {
    const found = data.budgets.find((item) => item.category === name)
    draftMap[name] = found ? String(found.monthlyLimit) : ""
  }
  for (const item of data.budgets) {
    if (!(item.category in draftMap)) draftMap[item.category] = String(item.monthlyLimit)
  }
  budgetDraft.value = draftMap
}

function openMerchant(name: string) {
  query.value = name
  tab.value = "movimientos"
}

function linkedLabel(ticket: StoredTicket) {
  if (!ticket.transactionId) return "Sin movimiento asociado"
  const tx = transactions.value.find((item) => item.id === ticket.transactionId)
  if (!tx) return "Movimiento asociado"
  return `${formatDay(tx.date)} · ${euro.format(tx.amount)} · ${tx.text.slice(0, 36)}`
}

const x = (d: { index: number }) => d.index
const yIncome = (d: { income: number }) => d.income
const yExpense = (d: { expense: number }) => d.expense
const ySavings = (d: { savings: number }) => d.savings
const donutValue = (d: { amount: number }) => d.amount
function monthTick(index: number) {
  return view.value.months[index]?.label || ""
}
function sliceColor(_d: unknown, index: number) {
  return `var(--chart-${(index % 5) + 1})`
}

function handleUnauthorized() {
  authed.value = false
  flash("Sesión caducada. Vuelve a entrar.")
}

onMounted(async () => {
  const cache = loadCache()
  if (cache.transactions.length || cache.tickets.length) applyData(cache)

  const ok = await checkSession()
  authChecked.value = true
  if (!ok) {
    authed.value = false
    return
  }
  authed.value = true
  try {
    const migrated = await migrateLocalIfNeeded(cache)
    if (migrated) {
      applyData(migrated)
      flash("Datos sincronizados en la nube.")
    } else {
      applyData(await fetchData())
    }
    offline.value = false
  } catch (error) {
    offline.value = true
    flash(
      error instanceof Error && error.message === "UNAUTHORIZED"
        ? "Sesión caducada. Vuelve a entrar."
        : "Sin conexión: mostrando la última copia local.",
    )
  }
})

async function onLogin() {
  loginBusy.value = true
  loginError.value = ""
  notice.value = ""
  try {
    await login(password.value)
    password.value = ""
    authed.value = true
    const cache = loadCache()
    const migrated = await migrateLocalIfNeeded(cache)
    applyData(migrated || await fetchData())
    flash("Sesión iniciada.")
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : "No se pudo entrar."
  } finally {
    loginBusy.value = false
  }
}

async function onLogout() {
  try {
    await logout()
  } catch {
    // ignore
  }
  clearLocalData()
  await clearApiCaches()
  transactions.value = []
  tickets.value = []
  budgets.value = []
  updatedAt.value = null
  authed.value = false
  menuOpen.value = false
  flash("Sesión cerrada.")
}

async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  if (!files.length) return
  busy.value = true
  notice.value = ""
  try {
    let next = [...transactions.value]
    const incomingAll: Transaction[] = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!
      const guessed = updateAccount.value || guessAccountName(file.name, files.length > 1 ? index + 1 : 0)
      const name = window.prompt(`Nombre de la cuenta para «${file.name}»`, guessed)
      if (name === null) return
      const incoming = await parseBankFile(file, name.trim() || guessed)
      incomingAll.push(...incoming)
      next = replaceAccountTransactions(next, incoming)
    }
    if (!incomingAll.length) return
    try {
      const result = await importTransactions(incomingAll)
      applyData(result)
      offline.value = false
      const stats = result.importStats
      flash(
        stats
          ? `Importado: ${stats.inserted} nuevos, ${stats.updated} ya existentes · ${transactions.value.length} en total.`
          : `Extracto actualizado · ${transactions.value.length} movimientos en total.`,
      )
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        handleUnauthorized()
        return
      }
      transactions.value = next
      persistLocal()
      offline.value = true
      flash("Guardado en local (sin nube). Reintenta cuando haya conexión.")
    }
    updateAccount.value = ""
  } catch (error) {
    flash(error instanceof Error ? error.message : "No se pudo importar.")
  } finally {
    busy.value = false
    input.value = ""
  }
}

function startUpdate(accountName: string) {
  updateAccount.value = accountName
  fileInput.value?.click()
}

async function onTicketFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  scanBusy.value = true
  notice.value = ""
  try {
    draft.value = await scanTicketImage(file)
    selectedTxId.value = matchTransactions(draft.value, filtered.value)[0]?.id || "none"
    tab.value = "tickets"
  } catch (error) {
    flash(error instanceof Error ? error.message : "No se pudo leer el ticket.")
    draft.value = parseTicketText("")
  } finally {
    scanBusy.value = false
    input.value = ""
  }
}

function addDraftItem() {
  if (!draft.value) return
  draft.value.items.push({ name: "Artículo", amount: 0 })
}

async function saveTicketDraft() {
  if (!draft.value) return
  const ticket: StoredTicket = {
    ...draft.value,
    id: `ticket-${Date.now()}`,
    createdAt: new Date().toISOString(),
    transactionId: selectedTxId.value === "none" ? null : selectedTxId.value,
    account: filtered.value.find((tx) => tx.id === selectedTxId.value)?.account || null,
  }
  try {
    applyData(await saveTicket(ticket))
    draft.value = null
    selectedTxId.value = "none"
    flash("Ticket guardado en la nube.")
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return handleUnauthorized()
    tickets.value = [ticket, ...tickets.value]
    persistLocal()
    offline.value = true
    draft.value = null
    flash("Ticket guardado en local (sin nube).")
  }
}

async function removeTicket(id: string) {
  try {
    applyData(await deleteTicket(id))
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return handleUnauthorized()
    tickets.value = tickets.value.filter((item) => item.id !== id)
    persistLocal()
    offline.value = true
  }
}

async function persistBudgets() {
  const next: Budget[] = Object.entries(budgetDraft.value)
    .map(([categoryName, value]) => ({
      category: categoryName,
      monthlyLimit: Number(String(value).replace(",", ".")),
    }))
    .filter((item) => item.monthlyLimit > 0)
  try {
    applyData(await saveBudgets(next))
    flash("Presupuestos guardados.")
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return handleUnauthorized()
    budgets.value = next
    persistLocal()
    offline.value = true
    flash("Presupuestos en local (sin nube).")
  }
}

async function setCategory(tx: Transaction, nextCategory: string) {
  if (!tx.id || tx.category === nextCategory) return
  const previous = tx.category
  const locked = tx.categoryLocked
  tx.category = nextCategory
  tx.categoryLocked = true
  try {
    applyData(await patchTransactionCategory(tx.id, nextCategory))
    flash(`Categoría fijada: ${nextCategory}`)
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      tx.category = previous
      tx.categoryLocked = locked
      return handleUnauthorized()
    }
    persistLocal()
    offline.value = true
    flash("Categoría guardada en local (sin nube).")
  }
}

async function copyChatgpt() {
  const brief = { ...view.value, budgets: budgetStatuses.value }
  const text = chatgptBrief(brief)
  await navigator.clipboard.writeText(text)
  menuOpen.value = false
  flash("Resumen copiado. Pégalo en ChatGPT.")
}

function clearLocal() {
  if (!window.confirm("¿Borrar la copia local de este dispositivo? Los datos en la nube no se borran.")) return
  clearLocalData()
  flash("Copia local borrada.")
}
</script>

<template>
  <main v-if="!authChecked" class="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center px-4">
    <p class="text-sm text-muted-foreground">Comprobando sesión…</p>
  </main>

  <main v-else-if="!authed" class="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
    <div>
      <p class="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Finanzas personales</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">Compras e ingresos</h1>
      <p class="mt-2 text-sm text-muted-foreground">Introduce la contraseña compartida para ver y actualizar los datos.</p>
    </div>
    <form class="grid gap-3" @submit.prevent="onLogin">
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
      <p v-if="loginError" class="text-sm text-destructive" role="alert">{{ loginError }}</p>
      <Button type="submit" class="h-11" :disabled="loginBusy || !password">
        {{ loginBusy ? "Entrando…" : "Entrar" }}
      </Button>
    </form>
  </main>

  <main v-else class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 pb-24 md:pb-16">
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
        <div class="relative flex w-full flex-wrap gap-2 sm:w-auto">
          <Button class="min-h-11 flex-1 sm:flex-none" :disabled="busy" @click="fileInput?.click()">Importar extracto</Button>
          <input ref="fileInput" class="hidden" type="file" accept=".csv,.xlsx,.xls" multiple @change="importFiles">
          <Button class="min-h-11 flex-1 sm:flex-none" variant="outline" :disabled="scanBusy" @click="ticketInput?.click()">
            {{ scanBusy ? "Leyendo…" : "Ticket / cámara" }}
          </Button>
          <input ref="ticketInput" class="hidden" type="file" accept="image/*" capture="environment" @change="onTicketFile">
          <Button class="min-h-11" variant="ghost" @click="menuOpen = !menuOpen">Más</Button>
          <div
            v-if="menuOpen"
            class="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-xl border bg-card p-1 shadow-md"
          >
            <Button variant="ghost" class="w-full justify-start" @click="copyChatgpt">Copiar para ChatGPT</Button>
            <Button variant="ghost" class="w-full justify-start" @click="onLogout">Salir</Button>
          </div>
        </div>
      </div>
    </header>

    <div
      v-if="notice"
      class="fixed bottom-20 left-1/2 z-40 w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg md:bottom-6"
      role="status"
    >
      {{ notice }}
    </div>

    <nav
      class="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Secciones"
    >
      <Button
        v-for="item in ([
          ['resumen', 'Resumen'],
          ['comercios', 'Comercios'],
          ['tickets', 'Tickets'],
          ['movimientos', 'Movimientos'],
        ] as const)"
        :key="item[0]"
        size="sm"
        class="min-h-10 shrink-0"
        role="tab"
        :aria-selected="tab === item[0]"
        :variant="tab === item[0] ? 'default' : 'outline'"
        @click="tab = item[0]"
      >
        {{ item[1] }}
      </Button>
    </nav>

    <Card v-if="!hasData" class="border-dashed">
      <CardHeader>
        <CardTitle>Importa tu primer extracto</CardTitle>
        <CardDescription>Tres pasos desde la app BBVA</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3 text-sm">
        <ol class="list-decimal space-y-2 pl-4 text-muted-foreground">
          <li>Abre BBVA → tu cuenta → Movimientos.</li>
          <li>Exporta a Excel o CSV (últimos meses).</li>
          <li>Pulsa «Importar extracto» aquí arriba.</li>
        </ol>
        <Button class="min-h-11" :disabled="busy" @click="fileInput?.click()">Importar extracto</Button>
      </CardContent>
    </Card>

    <template v-if="hasData">
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="item in ([
            ['1m', 'Este mes'],
            ['3m', '3 meses'],
            ['6m', '6 meses'],
            ['1y', 'Año'],
            ['custom', 'Personalizado'],
          ] as const)"
          :key="item[0]"
          size="sm"
          class="min-h-10"
          :variant="period === item[0] ? 'default' : 'outline'"
          @click="applyPeriod(item[0])"
        >
          {{ item[1] }}
        </Button>
      </div>

      <section v-if="period === 'custom' || tab !== 'tickets'" class="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <label class="grid gap-1 text-xs text-muted-foreground">
          Desde
          <Input v-model="from" type="date" class="min-h-11" @change="period = 'custom'" />
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Hasta
          <Input v-model="to" type="date" class="min-h-11" @change="period = 'custom'" />
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Cuenta
          <Select v-model="account">
            <SelectTrigger class="min-h-11 w-full"><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem v-for="item in accounts" :key="item.name" :value="item.name">{{ item.name }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label v-if="tab !== 'tickets'" class="grid gap-1 text-xs text-muted-foreground">
          Categoría
          <Select v-model="category">
            <SelectTrigger class="min-h-11 w-full"><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem v-for="name in categories" :key="name" :value="name">{{ name }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </section>

      <label v-if="tab === 'movimientos' || tab === 'comercios'" class="grid gap-1 text-xs text-muted-foreground">
        Buscar
        <Input v-model="query" type="search" class="min-h-11" placeholder="Hotel Santa Catalina, nómina, Fnac…" />
      </label>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Ingresos</CardDescription>
            <CardTitle class="text-2xl text-emerald-700">{{ euroWhole.format(view.income) }}</CardTitle>
          </CardHeader>
          <CardContent class="text-xs text-muted-foreground">{{ view.incomeSources[0]?.name || "Sin ingresos" }}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Gastos</CardDescription>
            <CardTitle class="text-2xl text-rose-700">{{ euroWhole.format(view.expense) }}</CardTitle>
          </CardHeader>
          <CardContent class="text-xs text-muted-foreground">{{ view.purchaseCount }} compras · ticket {{ euro.format(view.avgTicket) }}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>A ahorro</CardDescription>
            <CardTitle class="text-2xl">{{ euroWhole.format(view.toSavings) }}</CardTitle>
          </CardHeader>
          <CardContent class="text-xs text-muted-foreground">Traspasos a cuenta</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sin asignar</CardDescription>
            <CardTitle class="text-2xl">{{ euroWhole.format(view.unassigned) }}</CardTitle>
          </CardHeader>
          <CardContent class="text-xs text-muted-foreground">Neto − ahorro · {{ Math.round(view.savingsRate * 100) }} %</CardContent>
        </Card>
      </section>
    </template>

    <template v-if="hasData && tab === 'resumen'">
      <div class="flex flex-wrap gap-2">
        <Badge v-for="item in view.insights" :key="item" variant="secondary">{{ item }}</Badge>
      </div>
      <div v-if="view.trendBadges.length" class="space-y-2">
        <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tendencias</p>
        <div class="flex flex-wrap gap-2">
          <Badge v-for="item in view.trendBadges" :key="item" variant="outline">{{ item }}</Badge>
        </div>
      </div>

      <section class="grid gap-3 lg:grid-cols-5">
        <Card class="lg:col-span-3">
          <CardHeader>
            <CardTitle>Ingresos frente a gastos</CardTitle>
            <CardDescription>El ahorro no cuenta como gasto de consumo</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer :config="chartConfig" class="h-[280px] w-full">
              <VisXYContainer :data="view.months" :height="260">
                <VisGroupedBar
                  :x="x"
                  :y="[yIncome, yExpense, ySavings]"
                  :color="[chartConfig.income.color, chartConfig.expense.color, chartConfig.savings.color]"
                  :rounded-corners="4"
                />
                <VisAxis type="x" :tick-format="monthTick" :tick-line="false" :domain-line="false" :grid-line="false" />
                <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" />
              </VisXYContainer>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle>Dónde se va</CardTitle>
            <CardDescription>Por categoría</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-3 sm:grid-cols-[150px_1fr] items-center">
            <ChartContainer :config="chartConfig" class="mx-auto h-[150px] w-[150px]">
              <VisSingleContainer :data="view.categories" :height="140">
                <VisDonut :value="donutValue" :color="sliceColor" :arc-width="16" :central-label="euro.format(view.expense)" central-sub-label="gastado" />
              </VisSingleContainer>
            </ChartContainer>
            <div class="space-y-2">
              <div v-for="item in view.categories.slice(0, 6)" :key="item.name" class="flex justify-between gap-2 text-sm">
                <span class="truncate">{{ item.name }}</span>
                <span class="tabular-nums">{{ euro.format(item.amount) }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Presupuestos</CardTitle>
            <CardDescription>Límites mensuales por categoría · avisos de ritmo</CardDescription>
          </div>
          <Button size="sm" class="min-h-10" @click="persistBudgets">Guardar límites</Button>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label v-for="name in budgetCategories" :key="name" class="grid gap-1 text-xs text-muted-foreground">
              {{ name }} (€/mes)
              <Input v-model="budgetDraft[name]" type="number" min="0" step="10" class="min-h-11" placeholder="Sin tope" />
            </label>
          </div>
          <div v-if="budgetStatuses.length" class="space-y-3">
            <div v-for="item in budgetStatuses" :key="item.category" class="space-y-1.5 border-t pt-3 first:border-0 first:pt-0">
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="font-medium">{{ item.category }}</span>
                <span class="tabular-nums">{{ euro.format(item.spent) }} / {{ euro.format(item.limit) }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all"
                  :class="item.state === 'over' ? 'bg-destructive' : item.state === 'warn' ? 'bg-amber-500' : 'bg-foreground'"
                  :style="{ width: `${Math.min(100, Math.max(4, item.ratio * 100))}%` }"
                />
              </div>
              <p v-if="item.paceNote" class="text-xs text-amber-700 dark:text-amber-400">{{ item.paceNote }}</p>
              <p v-else-if="item.state === 'over'" class="text-xs text-destructive">Te pasas {{ euro.format(Math.abs(item.remaining)) }}</p>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">Define un tope (p. ej. Restauración 200) y guárdalo.</p>
        </CardContent>
      </Card>

      <section class="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Qué mejorar</CardTitle>
            <CardDescription>Consejo local a partir de tus totales</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <p v-for="item in view.advice.summary" :key="item" class="text-sm text-muted-foreground">{{ item }}</p>
            <ol class="list-decimal space-y-2 pl-4 text-sm">
              <li v-for="item in view.advice.actions" :key="item">{{ item }}</li>
            </ol>
            <Button variant="outline" class="min-h-10" @click="copyChatgpt">Copiar briefing para ChatGPT</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cargos fijos / recurrentes</CardTitle>
            <CardDescription>Importes estables en ≥3 meses</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div
              v-for="item in view.recurring"
              :key="item.name"
              class="flex items-start justify-between gap-3 border-t pt-3 first:border-0 first:pt-0"
            >
              <div>
                <p class="font-medium">{{ item.name }}</p>
                <p class="text-xs text-muted-foreground">{{ item.category }} · {{ item.months }} meses</p>
              </div>
              <strong class="tabular-nums">~{{ euro.format(item.amount) }}</strong>
            </div>
            <p v-if="!view.recurring.length" class="text-sm text-muted-foreground">Con más historial aparecerán suscripciones y recibos estables.</p>
            <div class="border-t pt-3">
              <p class="text-xs text-muted-foreground mb-2">Cuentas</p>
              <div v-for="item in accounts" :key="item.name" class="flex items-center justify-between gap-3 py-2">
                <div>
                  <p class="font-medium">{{ item.name }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ item.balance == null ? "Sin saldo en extracto" : `Saldo ${euro.format(item.balance)}` }}
                  </p>
                </div>
                <Button size="sm" class="min-h-10" variant="outline" @click="startUpdate(item.name)">Actualizar</Button>
              </div>
              <p v-if="!accounts.length" class="text-sm text-muted-foreground">Importa un extracto de BBVA para empezar.</p>
              <Button v-if="accounts.length" variant="ghost" size="sm" class="mt-2" @click="clearLocal">Borrar copia local</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Compras grandes</CardTitle>
            <CardDescription>Los importes más altos del periodo</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <button
              v-for="item in view.biggest"
              :key="`${item.date}-${item.name}-${item.amount}`"
              type="button"
              class="flex min-h-12 w-full items-start justify-between gap-3 border-t pt-3 text-left first:border-0 first:pt-0"
              @click="openMerchant(item.name)"
            >
              <div>
                <p class="font-medium">{{ item.name }}</p>
                <p class="text-xs text-muted-foreground">{{ item.date ? formatDay(item.date) : "" }} · {{ item.category }}</p>
              </div>
              <strong class="tabular-nums">{{ euro.format(item.amount) }}</strong>
            </button>
            <p v-if="!view.biggest.length" class="text-sm text-muted-foreground">Aún no hay compras en este periodo.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Artículos de tickets</CardTitle>
            <CardDescription>Lo que el OCR y tus correcciones suman</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div
              v-for="item in view.ticketItems"
              :key="item.name"
              class="flex items-center justify-between gap-3 border-t pt-3 first:border-0 first:pt-0 text-sm"
            >
              <div>
                <p class="font-medium">{{ item.name }}</p>
                <p class="text-xs text-muted-foreground">{{ item.count }} veces</p>
              </div>
              <span class="tabular-nums">{{ euro.format(item.amount) }}</span>
            </div>
            <p v-if="!view.ticketItems.length" class="text-sm text-muted-foreground">Escanea tickets para ver artículos concretos.</p>
          </CardContent>
        </Card>
      </section>
    </template>

    <template v-else-if="hasData && tab === 'comercios'">
      <div class="grid gap-3 md:grid-cols-2">
        <button
          v-for="item in view.merchants"
          :key="item.name"
          type="button"
          class="text-left"
          @click="openMerchant(item.name)"
        >
          <Card class="h-full transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle class="text-lg">{{ item.name }}</CardTitle>
              <CardDescription>{{ item.kind }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2 text-sm">
              <div class="flex justify-between"><span>Gastado</span><strong>{{ euro.format(item.amount) }}</strong></div>
              <div class="flex justify-between"><span>Visitas</span><span>{{ item.count }}</span></div>
              <div class="flex justify-between"><span>Del gasto total</span><span>{{ Math.round(item.share * 100) }} %</span></div>
              <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full bg-foreground" :style="{ width: `${Math.max(6, item.share * 100)}%` }" />
              </div>
              <Badge variant="outline">{{ item.category }}</Badge>
            </CardContent>
          </Card>
        </button>
      </div>
      <p v-if="!view.merchants.length" class="text-sm text-muted-foreground">Todavía no hay comercios en este periodo.</p>
    </template>

    <template v-else-if="tab === 'tickets'">
      <!-- tickets usable even with only OCR drafts -->
      <Card v-if="draft">
        <CardHeader>
          <CardTitle>Revisar ticket</CardTitle>
          <CardDescription>Corrige el OCR y asócialo a un movimiento</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="grid gap-3 md:grid-cols-3">
            <label class="grid gap-1 text-xs text-muted-foreground">Comercio<Input v-model="draft.merchant" class="min-h-11" /></label>
            <label class="grid gap-1 text-xs text-muted-foreground">
              Fecha
              <Input
                class="min-h-11"
                :model-value="draft.date || ''"
                type="date"
                @update:model-value="draft.date = String($event || '') || null"
              />
            </label>
            <label class="grid gap-1 text-xs text-muted-foreground">Total<Input v-model.number="draft.total" type="number" step="0.01" class="min-h-11" /></label>
          </div>
          <div class="space-y-2">
            <div v-for="(item, index) in draft.items" :key="index" class="grid grid-cols-[1fr_100px_auto] gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input v-model="item.name" placeholder="Artículo" class="min-h-11" />
              <Input v-model.number="item.amount" type="number" step="0.01" class="min-h-11" />
              <Button variant="ghost" class="min-h-11" @click="draft.items.splice(index, 1)">Quitar</Button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" class="min-h-11" @click="addDraftItem">Añadir artículo</Button>
            <Select v-model="selectedTxId">
              <SelectTrigger class="min-h-11 min-w-[240px]"><SelectValue placeholder="Asociar a compra" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asociar</SelectItem>
                <SelectItem v-for="tx in matches" :key="tx.id || tx.text" :value="tx.id || `${tx.date}-${tx.amount}`">
                  {{ formatDay(tx.date) }} · {{ euro.format(tx.amount) }} · {{ tx.text.slice(0, 40) }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button class="min-h-11" @click="saveTicketDraft">Guardar ticket</Button>
            <Button variant="ghost" class="min-h-11" @click="draft = null">Cancelar</Button>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-3 md:grid-cols-2">
        <Card v-for="ticket in tickets" :key="ticket.id">
          <CardHeader>
            <CardTitle class="text-lg">{{ ticket.merchant }}</CardTitle>
            <CardDescription>
              {{ ticket.date ? formatDay(ticket.date) : "Sin fecha" }} · {{ euro.format(ticket.total) }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-2 text-sm">
            <div v-for="(item, index) in ticket.items" :key="index" class="flex justify-between gap-2">
              <span class="truncate">{{ item.name }}</span>
              <span class="tabular-nums">{{ euro.format(item.amount) }}</span>
            </div>
            <p class="text-xs text-muted-foreground">{{ linkedLabel(ticket) }}</p>
            <Button size="sm" variant="ghost" class="min-h-10" @click="removeTicket(ticket.id)">Eliminar</Button>
          </CardContent>
        </Card>
      </div>
      <p v-if="!tickets.length && !draft" class="text-sm text-muted-foreground">Escanea un ticket con la cámara o sube una foto.</p>
    </template>

    <template v-else-if="hasData && tab === 'movimientos'">
      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
          <CardDescription>{{ shown.length }} de {{ filtered.length }} · cambia la categoría para fijarla</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead class="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="tx in shown" :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`">
                  <TableCell>{{ formatDay(tx.date) }}</TableCell>
                  <TableCell class="max-w-[280px] truncate">{{ tx.text }}</TableCell>
                  <TableCell>
                    <Select :model-value="tx.category" @update:model-value="setCategory(tx, String($event))">
                      <SelectTrigger class="min-h-10 w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{{ tx.account }}</TableCell>
                  <TableCell class="text-right tabular-nums">{{ euro.format(tx.amount) }}</TableCell>
                </TableRow>
                <TableRow v-if="!shown.length">
                  <TableCell colspan="5" class="text-muted-foreground">Importa un extracto para ver movimientos.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div class="grid gap-3 md:hidden">
            <div
              v-for="tx in shown"
              :key="tx.id || `${tx.date}-${tx.text}-${tx.amount}-${tx.account}`"
              class="space-y-2 border-t pt-3 first:border-0 first:pt-0"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ tx.text }}</p>
                  <p class="text-xs text-muted-foreground">{{ formatDay(tx.date) }} · {{ tx.account }}</p>
                </div>
                <strong class="shrink-0 tabular-nums">{{ euro.format(tx.amount) }}</strong>
              </div>
              <Select :model-value="tx.category" @update:model-value="setCategory(tx, String($event))">
                <SelectTrigger class="min-h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p v-if="!shown.length" class="text-sm text-muted-foreground">Importa un extracto para ver movimientos.</p>
          </div>
        </CardContent>
      </Card>
    </template>
  </main>
</template>
