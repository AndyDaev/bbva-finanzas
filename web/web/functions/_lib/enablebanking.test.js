import { generateKeyPairSync, createVerify } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  backfillBalances,
  createJwt,
  mapBankTransaction,
  maskIban,
  matchExistingAccount,
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
