const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseCsv, parseExtract, mergeTransactions, replaceAccountTransactions } = require("../lib/csv");

test("parses BBVA-style semicolon CSV with European amounts", () => {
  const csv = [
    "Fecha;Concepto;Importe;Saldo;Cuenta",
    '14/11/2026;"Compra, MERCADONA";-45,90 €;1.234,10 €;Principal',
  ].join("\n");
  const [transaction] = parseCsv(csv);

  assert.equal(transaction.date, "2026-11-14");
  assert.equal(transaction.text, "Compra, MERCADONA");
  assert.equal(transaction.amount, -45.9);
  assert.equal(transaction.balanceAfter, 1234.1);
  assert.equal(transaction.category, "Supermercado");
});

test("rejects CSV files without usable transactions", () => {
  assert.throws(
    () => parseCsv("Fecha;Importe\nno-es-fecha;no-es-importe"),
    /No encontré movimientos/
  );
});

test("parses BBVA Excel extract with titled header rows", () => {
  const sample = path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    "2026Y-11M-14D-01_51_39-Últimos movimientos.xlsx"
  );
  if (!fs.existsSync(sample)) {
    assert.ok(true, "sample xlsx not present; skipped");
    return;
  }

  const transactions = parseExtract(fs.readFileSync(sample), {
    filename: "movimientos.xlsx",
    account: "Cuenta prueba",
  });

  assert.ok(transactions.length >= 10);
  assert.equal(transactions[0].account, "Cuenta prueba");
  assert.ok(transactions.every((item) => item.date && !Number.isNaN(item.amount)));
  assert.ok(transactions.some((item) => /supermercado|fnac|cool expres/i.test(item.text)));
  assert.ok(transactions.some((item) => item.category === "Supermercado"));
  assert.ok(transactions.some((item) => item.category === "Compras"));
});

test("merges imports from different accounts without duplicates", () => {
  const first = parseCsv(
    ["Fecha;Concepto;Importe;Cuenta", "01/11/2026;MERCADONA;-10;Nómina"].join("\n")
  );
  const second = parseCsv(
    ["Fecha;Concepto;Importe;Cuenta", "02/11/2026;NETFLIX;-16;Ahorro"].join("\n")
  );
  const merged = mergeTransactions(first, [...second, ...first]);
  assert.equal(merged.length, 2);
});

test("updating an account extract replaces only that account", () => {
  const first = parseCsv(
    ["Fecha;Concepto;Importe;Cuenta", "01/11/2026;MERCADONA;-10;Nómina", "02/11/2026;NETFLIX;-16;Ahorro"].join("\n")
  );
  const update = parseCsv(
    ["Fecha;Concepto;Importe;Cuenta", "03/11/2026;LIDL;-22;Nómina"].join("\n")
  );
  const result = replaceAccountTransactions(first, update);
  assert.equal(result.length, 2);
  assert.ok(result.some((item) => item.account === "Ahorro" && item.text === "NETFLIX"));
  assert.ok(result.some((item) => item.account === "Nómina" && item.text === "LIDL"));
  assert.ok(!result.some((item) => item.text === "MERCADONA"));
});
