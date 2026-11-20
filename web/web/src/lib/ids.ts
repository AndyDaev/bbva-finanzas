export type Transaction = {
  id?: string
  date: string
  amount: number
  text: string
  category: string
  categoryLocked?: boolean
  account: string
  balanceAfter?: number
}

export type Budget = {
  category: string
  monthlyLimit: number
}

/** Stable fingerprint for matching the same bank row across imports. */
export function transactionFingerprint(tx: { date: string, amount: number, text: string, account: string }) {
  const amount = Number(tx.amount)
  const normalizedAmount = Number.isFinite(amount) ? amount.toFixed(2) : "0.00"
  return `${tx.date}|${normalizedAmount}|${String(tx.text || "").trim().toLocaleLowerCase("es")}|${String(tx.account || "").trim().toLocaleLowerCase("es")}`
}

function hash32(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Assign deterministic IDs (occurrence-aware) so ticket links survive reimport. */
export function withStableIds(rows: Transaction[]): Transaction[] {
  const seen = new Map<string, number>()
  return rows.map((tx) => {
    const fp = transactionFingerprint(tx)
    const n = seen.get(fp) || 0
    seen.set(fp, n + 1)
    return { ...tx, id: `tx_${hash32(`${fp}#${n}`)}` }
  })
}

export function guessAccountName(filename: string, index = 0) {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{4}Y-\d{2}M-\d{2}D-\d{2}_\d{2}_\d{2}-/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  if (base && !/ultimos movimientos|últimos movimientos|movimientos/i.test(base)) return base.slice(0, 48)
  return index > 0 ? `BBVA cuenta ${index}` : "BBVA importado"
}

/**
 * Non-destructive merge: keeps history not present in the new file,
 * updates matched rows (preserving locked categories and existing ids).
 */
export function replaceAccountTransactions(existing: Transaction[], incoming: Transaction[]) {
  const incomingStable = withStableIds(incoming)
  const buckets = new Map<string, Transaction[]>()
  for (const item of existing) {
    const fp = transactionFingerprint(item)
    const list = buckets.get(fp) || []
    list.push(item)
    buckets.set(fp, list)
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
  }

  const matched = new Set<Transaction>()
  const mergedIncoming: Transaction[] = []
  for (const item of incomingStable) {
    const bucket = buckets.get(transactionFingerprint(item)) || []
    const match = bucket.find((row) => !matched.has(row))
    if (match) {
      matched.add(match)
      mergedIncoming.push({
        ...item,
        id: match.id || item.id,
        category: match.categoryLocked ? match.category : item.category,
        categoryLocked: Boolean(match.categoryLocked),
        balanceAfter: typeof item.balanceAfter === "number" ? item.balanceAfter : match.balanceAfter,
      })
    } else {
      mergedIncoming.push(item)
    }
  }

  const keptHistory = existing.filter((item) => !matched.has(item))
  const map = new Map<string, Transaction>()
  for (const item of [...keptHistory, ...mergedIncoming]) {
    const key = item.id || `${transactionFingerprint(item)}|${map.size}`
    map.set(key, item)
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * End-of-day balance among same-day rows: the row whose balance is not the
 * starting balance of another row that day. Works whatever order the rows come in.
 */
export function endOfDayBalance(rows: Transaction[]) {
  const withBalance = rows.filter((tx) => typeof tx.balanceAfter === "number")
  if (!withBalance.length) return null
  if (withBalance.length === 1) return withBalance[0]!.balanceAfter!
  const starts = withBalance.map((tx) => Math.round((tx.balanceAfter! - tx.amount) * 100))
  const last = withBalance.find((tx) => !starts.includes(Math.round(tx.balanceAfter! * 100)))
  return (last || withBalance[0]!).balanceAfter!
}

export function accountsFromTransactions(transactions: Transaction[]) {
  const byAccount = new Map<string, { lastDate: string, rows: Transaction[] }>()
  for (const tx of transactions) {
    const current = byAccount.get(tx.account) || { lastDate: "", rows: [] }
    if (typeof tx.balanceAfter === "number") {
      if (tx.date > current.lastDate) {
        current.lastDate = tx.date
        current.rows = [tx]
      } else if (tx.date === current.lastDate) {
        current.rows.push(tx)
      }
    }
    byAccount.set(tx.account, current)
  }
  return [...byAccount.entries()].map(([name, item]) => ({
    name,
    balance: endOfDayBalance(item.rows),
    balanceDate: item.lastDate || null,
  }))
}
