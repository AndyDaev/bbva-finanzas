import { generateKeyPairSync, createVerify } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  backfillBalances,
  createJwt,
  mapBankTransaction,
  maskIban,
  matchExistingAccount,
  forwardEnd,
  pickBalances,
  planForwardBalances,
  pickBookedBalance,
  planBankUpsert,
} from "./enablebanking.js"

function decode(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
}

describe("createJwt", () => {
  for (const type of ["pkcs8", "pkcs1"]) {
    it(`signs a valid RS256 token with a ${type} key`, async () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type, format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      })
      const token = await createJwt("app-123", privateKey, 1_700_000_000)
      const [header, body, signature] = token.split(".")
      expect(decode(header)).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" })
      expect(decode(body)).toEqual({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: 1_700_000_000, exp: 1_700_003_600 })
      const ok = createVerify("RSA-SHA256").update(`${header}.${body}`).verify(publicKey, Buffer.from(signature, "base64url"))
      expect(ok).toBe(true)
    })
  }
})

describe("mapping", () => {
  it("signs amounts from the debit/credit indicator and builds a readable text", () => {
    const row = mapBankTransaction(
      {
        entry_reference: "ref-1",
        transaction_amount: { amount: "45.20", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        booking_date: "2026-11-03",
        remittance_information: ["COMPRA EN MERCADONA", "VALENCIA"],
        creditor: { name: "MERCADONA SA" },
        balance_after_transaction: { amount: "954.80", currency: "EUR" },
      },
      "Principal",
      "uid-1",
    )
    expect(row).toMatchObject({ date: "2026-11-03", amount: -45.2, text: "COMPRA EN MERCADONA VALENCIA · MERCADONA SA", account: "Principal", balanceAfter: 954.8 })
    expect(row.id).toMatch(/^eb_/)
    const credit = mapBankTransaction({ transaction_amount: { amount: "2000" }, credit_debit_indicator: "CRDT", value_date: "2026-11-01", debtor: { name: "EMPRESA SL" } }, "Principal", "uid-1")
    expect(credit).toMatchObject({ amount: 2000, text: "EMPRESA SL" })
    expect(mapBankTransaction({ transaction_amount: { amount: "x" } }, "P", "u")).toBeNull()
  })

  it("keeps the same id across syncs for the same bank reference", () => {
    const raw = { entry_reference: "abc", transaction_amount: { amount: "1" }, credit_debit_indicator: "DBIT", booking_date: "2026-01-01" }
    expect(mapBankTransaction(raw, "A", "uid").id).toBe(mapBankTransaction({ ...raw, remittance_information: ["changed"] }, "A", "uid").id)
  })

  it("prefers the booked balance", () => {
    expect(pickBookedBalance([
      { balance_type: "ITAV", balance_amount: { amount: "10" } },
      { balance_type: "CLBD", balance_amount: { amount: "12.5" }, reference_date: "2026-11-20" },
    ])).toEqual({ amount: 12.5, date: "2026-11-20", type: "CLBD" })
    expect(pickBookedBalance([])).toBeNull()
  })

  it("rebuilds balances backwards from the booked balance", () => {
    const rows = [
      { date: "2026-11-01", amount: 2000 },
      { date: "2026-11-05", amount: -50 },
      { date: "2026-11-10", amount: -100 },
    ]
    backfillBalances(rows, { amount: 1850, date: "2026-11-20" })
    expect(rows.map((r) => r.balanceAfter)).toEqual([2000, 1950, 1850])
  })

  it("masks IBANs", () => {
    expect(maskIban("ES91 2100 0418 4502 0005 1332")).toBe("ES91 •••• 1332")
  })
})

describe("matchExistingAccount", () => {
  const bank = [
    { date: "2026-11-02", amount: -10 },
    { date: "2026-11-03", amount: -20 },
    { date: "2026-11-04", amount: 1500 },
    { date: "2026-11-05", amount: -7.5 },
  ]
  it("adopts the Excel account that shares most movements", () => {
    const existing = [
      { id: "tx_1", account: "July - Nov", date: "2026-11-02", amount: -10 },
      { id: "tx_2", account: "July - Nov", date: "2026-11-03", amount: -20 },
      { id: "tx_3", account: "July - Nov", date: "2026-11-04", amount: 1500 },
      { id: "tx_4", account: "Otra", date: "2026-11-02", amount: -10 },
      { id: "tx_5", account: "Otra", date: "2026-11-09", amount: -99 },
      { id: "eb_x", account: "BBVA 1", date: "2026-11-03", amount: -20 },
    ]
    expect(matchExistingAccount(existing, bank)).toBe("July - Nov")
  })
  it("returns null when nothing matches well enough", () => {
    expect(matchExistingAccount([{ id: "tx_1", account: "A", date: "2026-11-02", amount: -10 }], bank)).toBeNull()
  })
})

describe("planBankUpsert", () => {
  it("skips movements already imported from Excel and updates known bank rows", () => {
    const existing = [
      { id: "tx_csv1", date: "2026-11-03", amount: -45.2 },
      { id: "eb_known", date: "2026-11-04", amount: -10 },
    ]
    const incoming = [
      { id: "eb_new1", date: "2026-11-03", amount: -45.2 },
      { id: "eb_new2", date: "2026-11-03", amount: -45.2 },
      { id: "eb_known", date: "2026-11-04", amount: -10 },
      { id: "eb_new3", date: "2026-11-06", amount: -7 },
    ]
    const plan = planBankUpsert(existing, incoming)
    expect(plan.skipped).toBe(1)
    expect(plan.inserts.map((r) => r.id)).toEqual(["eb_new2", "eb_new3"])
    expect(plan.updates.map((r) => r.id)).toEqual(["eb_known"])
  })
})

describe("planBankUpsert never duplicates", () => {
  const row = (id, date, amount, text) => ({ id, date, amount, text })

  it("updates the stored row when the same movement arrives under a new bank id", () => {
    const existing = [row("eb_old1", "2026-11-20", -7.3, "PAGO // WOK TWO"), row("eb_old2", "2026-11-20", -7.3, "PAGO // WOK TWO")]
    const incoming = [row("eb_new1", "2026-11-20", -7.3, "PAGO // WOK TWO"), row("eb_new2", "2026-11-20", -7.3, "PAGO // WOK TWO"), row("eb_new3", "2026-11-21", -1, "OTRO")]
    const plan = planBankUpsert(existing, incoming)
    expect(plan.updates.map((r) => r.id).sort()).toEqual(["eb_old1", "eb_old2"])
    expect(plan.inserts.map((r) => r.id)).toEqual(["eb_new3"])
  })

  it("matches an Excel purchase booked by the bank a few days later", () => {
    const existing = [row("tx_excel", "2026-11-13", -2.1, "Supermercados cool expres · Pago con tarjeta")]
    const plan = planBankUpsert(existing, [row("eb_a", "2026-11-16", -2.1, "PAGO // SUPERMERCADOS COOL EXPRES"), row("eb_b", "2026-11-16", -2.1, "PAGO // SUPERMERCADOS COOL EXPRES")])
    expect(plan.skipped).toBe(1)
    expect(plan.inserts.map((r) => r.id)).toEqual(["eb_b"])
  })

  it("does not match an Excel row booked after the bank date or too far away", () => {
    const existing = [row("tx_late", "2026-11-18", -5, "x"), row("tx_far", "2026-11-01", -5, "x")]
    const plan = planBankUpsert(existing, [row("eb_a", "2026-11-16", -5, "y")])
    expect(plan.inserts).toHaveLength(1)
  })
})

describe("sync keeps one row per movement", () => {
  const row = (id, date, amount, text, extra = {}) => ({ id, date, amount, text, ...extra })

  it("updates a row stored under the id an earlier version used", () => {
    const raw = { entry_reference: "ref-9", transaction_amount: { amount: "28.12" }, credit_debit_indicator: "DBIT", booking_date: "2026-11-16" }
    const mapped = mapBankTransaction(raw, "BBVA 4694", "ES00 •••• 0000", "uid-test")
    const legacy = mapBankTransaction(raw, "BBVA 4694", "uid-test")
    expect(mapped.aliasIds).toEqual([legacy.id])
    const plan = planBankUpsert([row(legacy.id, "2026-11-16", -28.12, "OLD")], [mapped])
    expect(plan.inserts).toHaveLength(0)
    expect(plan.updates[0].id).toBe(legacy.id)
  })

  it("matches the same movement when the bank appends the counterparty later", () => {
    const existing = [row("eb_old", "2026-11-16", -28.12, "PAGO CON TARJETA EN SUPERMERCADOS // PAGO CON TARJETA // MERCADONA RONDA OUTEIRO A CORUÑA ES")]
    const incoming = [row("eb_new", "2026-11-16", -28.12, "PAGO CON TARJETA EN SUPERMERCADOS // PAGO CON TARJETA // MERCADONA RONDA OUTEIRO A CORUãA ES · MERCADONA RONDA OUTEIRO")]
    const plan = planBankUpsert(existing, incoming)
    expect(plan.inserts).toHaveLength(0)
    expect(plan.updates[0].id).toBe("eb_old")
  })

  it("keeps two genuine identical purchases", () => {
    const text = "PAGO CON TARJETA // DR WASH LA CORUNA ES · DR WASH"
    const plan = planBankUpsert([], [row("eb_a", "2026-11-09", -1.5, text), row("eb_b", "2026-11-09", -1.5, text)])
    expect(plan.inserts).toHaveLength(2)
  })

  it("fills missing balances forward from the last real balance", () => {
    const rows = [
      row("a", "2026-11-20", -10, "", { balance_after: 1520 }),
      row("b", "2026-11-23", -15, "", { balance_after: null }),
      row("c", "2026-11-23", -20, "", { balance_after: null }),
    ]
    expect(planForwardBalances(rows, 1530)).toEqual([
      { id: "b", balance: 1505 },
      { id: "c", balance: 1485 },
    ])
  })

  it("recomputes every recent row in overwrite mode (same-day movements from different syncs)", () => {
    // Real case: 23/11 rows filled in two syncs ended with a wrong running balance (55,43 €).
    const rows = [
      row("a", "2026-11-23", 20, "", { balance_after: 55.26 }),
      row("b", "2026-11-23", -21.78, "", { balance_after: -18.67 }),
      row("c", "2026-11-23", 5, "", { balance_after: null }),
    ]
    const updates = planForwardBalances(rows, 8.8, { overwrite: true })
    expect(updates).toEqual([
      { id: "a", balance: 28.8 },
      { id: "b", balance: 7.02 },
      { id: "c", balance: 12.02 },
    ])
    expect(forwardEnd(rows, 8.8)).toBe(12.02)
  })

  it("splits the bank's booked and available balances", () => {
    expect(pickBalances([
      { balance_type: "ITAV", balance_amount: { amount: "1.21" } },
      { balance_type: "CLBD", balance_amount: { amount: "17.91" } },
    ])).toEqual({ booked: { amount: 17.91, date: null, type: "CLBD" }, available: 1.21 })
    expect(pickBalances([{ balance_type: "CLBD", balance_amount: { amount: "5" } }]).available).toBeNull()
  })
})
