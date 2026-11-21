<script setup lang="ts">
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CATEGORY_OPTIONS, isValidRegex, ruleMatches, type UserRule } from "@/lib/money"
import { useFinance } from "@/lib/useFinance"

const { sortedRules, ruleCounts, transactions, upsertRule, removeRule } = useFinance()

type Draft = { id?: string, pattern: string, matchType: "contains" | "regex", category: string, direction: "" | "in" | "out" }
const blank = (): Draft => ({ pattern: "", matchType: "contains", category: "Supermercado", direction: "out" })
const form = ref<Draft>(blank())

const regexError = computed(() => form.value.matchType === "regex" && form.value.pattern && !isValidRegex(form.value.pattern))
const preview = computed(() => {
  if (!form.value.pattern.trim() || regexError.value) return []
  const probe: UserRule = { id: "probe", pattern: form.value.pattern.trim(), matchType: form.value.matchType, category: form.value.category, direction: form.value.direction || null }
  return transactions.value.filter((tx) => !tx.categoryLocked && ruleMatches(probe, tx.text, tx.amount))
})

function edit(rule: UserRule) {
  form.value = { id: rule.id, pattern: rule.pattern, matchType: rule.matchType, category: rule.category, direction: rule.direction || "" }
}

async function submit() {
  const existing = form.value.id ? sortedRules.value.find((r) => r.id === form.value.id) : undefined
  await upsertRule({
    id: form.value.id,
    pattern: form.value.pattern.trim(),
    matchType: form.value.matchType,
    category: form.value.category,
    direction: form.value.direction || null,
    priority: existing?.priority,
  })
  form.value = blank()
}

const directionLabel = (d?: string | null) => (d === "out" ? "gastos" : d === "in" ? "ingresos" : "todo")
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ form.id ? "Editar regla" : "Nueva regla de categoría" }}</CardTitle>
      <CardDescription>
        Se aplican a todo el historial antes que las reglas automáticas. Las categorías fijadas a mano no se tocan.
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      <div class="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <label class="grid gap-1 text-xs text-muted-foreground">
          {{ form.matchType === "regex" ? "Expresión regular" : "Si el concepto contiene" }}
          <Input v-model="form.pattern" class="min-h-11" :placeholder="form.matchType === 'regex' ? '^PAGO .*GYM' : 'mercadona'" />
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Tipo
          <select v-model="form.matchType" class="min-h-11 rounded-md border bg-background px-2 text-sm">
            <option value="contains">Contiene (palabras)</option>
            <option value="regex">Regex</option>
          </select>
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Aplica a
          <select v-model="form.direction" class="min-h-11 rounded-md border bg-background px-2 text-sm">
            <option value="out">Gastos</option>
            <option value="in">Ingresos</option>
            <option value="">Todo</option>
          </select>
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">
          Categoría
          <select v-model="form.category" class="min-h-11 rounded-md border bg-background px-2 text-sm">
            <option v-for="name in CATEGORY_OPTIONS" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </div>
      <p v-if="regexError" class="text-sm text-destructive" role="alert">La expresión regular no es válida.</p>
      <p v-else-if="form.pattern.trim()" class="text-sm text-muted-foreground">
        Coincide con {{ preview.length }} movimientos<template v-if="preview.length">, p. ej. «{{ preview[0]!.text.replace(/\b\d{4}\d{6,11}(\d{4})\b/g, "•••• $1").slice(0, 60) }}»</template>.
      </p>
      <div class="flex gap-2">
        <Button class="min-h-10" :disabled="!form.pattern.trim() || Boolean(regexError)" @click="submit">{{ form.id ? "Guardar cambios" : "Crear regla" }}</Button>
        <Button v-if="form.id" variant="ghost" class="min-h-10" @click="form = blank()">Cancelar</Button>
      </div>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Tus reglas</CardTitle>
      <CardDescription>Las de arriba ganan si dos coinciden. También puedes crearlas al cambiar la categoría de un movimiento.</CardDescription>
    </CardHeader>
    <CardContent>
      <div v-for="rule in sortedRules" :key="rule.id" class="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-0">
        <div class="min-w-0 text-sm">
          <p class="font-medium">
            <code class="rounded bg-muted px-1.5 py-0.5">{{ rule.pattern }}</code>
            → {{ rule.category }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ rule.matchType === "regex" ? "regex" : "contiene" }} · {{ directionLabel(rule.direction) }} · {{ ruleCounts.get(rule.id) || 0 }} movimientos
          </p>
        </div>
        <div class="flex gap-1">
          <Button size="sm" variant="outline" class="min-h-9" @click="edit(rule)">Editar</Button>
          <Button size="sm" variant="ghost" class="min-h-9" @click="removeRule(rule.id)">Eliminar</Button>
        </div>
      </div>
      <p v-if="!sortedRules.length" class="text-sm text-muted-foreground">Aún no tienes reglas. Empieza por lo que cae en «Otros gastos».</p>
    </CardContent>
  </Card>
</template>
