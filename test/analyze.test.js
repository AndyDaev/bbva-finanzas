const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, categorize, merchantKey } = require("../lib/analyze");

test("categorizes common Spanish transactions", () => {
  assert.equal(categorize("NÓMINA EMPRESA", 2500), "Nómina");
  assert.equal(categorize("Compra MERCADONA", -45), "Supermercado");
  assert.equal(categorize("TRASPASO A AHORRO", -300), "Ahorro");
  assert.equal(categorize("Traspaso a cuenta · Andres lopez corzo", -50), "Ahorro");
  assert.equal(categorize("Traspaso desde cuenta · Andres lopez corzo", 50), "Traspaso interno");
  assert.equal(categorize("UBER EATS PEDIDO", -22.5), "Restauración");
  assert.equal(categorize("UBER TRIP", -8.4), "Transporte");
  assert.equal(categorize("BIZUM DE ANA", 20), "Bizum");
  assert.equal(categorize("DEVOLUCION AMAZON", 34.99), "Otros ingresos");
  assert.equal(categorize("COMPRA MEDIANTE TPV", -12), "Otros gastos");
  assert.equal(categorize("ABONO COMISION", -3), "Comisiones");
  assert.equal(categorize("Autoservicios familia · Pago con tarjeta", 10.15), "Devolución");
  assert.equal(
    merchantKey("Fnac a coruña la coruna es · Pago con tarjeta"),
    merchantKey("FNAC A CORUÑA")
  );
});

test("keeps payroll as income and card refunds out of spending", () => {
  const result = analyze([], [
    tx("2026-11-02", 1489.04, "Abono de nómina · Energy plus", "Otros ingresos"),
    tx("2026-11-12", -20, "Autoservicios familia · Pago con tarjeta", "Supermercado"),
    tx("2026-11-12", 10.15, "Autoservicios familia · Pago con tarjeta", "Otros ingresos"),
    tx("2026-11-02", -800, "Traspaso a cuenta · Andres lopez corzo", "Traspaso interno"),
  ], { from: "2026-11-01", to: "2026-11-30" });

  assert.equal(result.income, 1489.04);
  assert.equal(result.incomeSources[0].name, "Nómina");
  assert.ok(Math.abs(result.expense - 9.85) < 0.02);
  assert.equal(result.toSavings, 800);
});

test("analyzes totals while excluding internal transfers", () => {
  const transactions = [
    tx("2026-01-01", 2000, "NÓMINA", "Nómina"),
    tx("2026-01-02", -500, "ALQUILER", "Vivienda"),
    tx("2026-01-03", -300, "TRASPASO", "Traspaso interno"),
  ];
  const result = analyze([{ balance: 1200 }], transactions, {
    from: "2026-01-01",
    to: "2026-01-31",
  });

  assert.equal(result.income, 2000);
  assert.equal(result.expense, 500);
  assert.equal(result.net, 1500);
  assert.equal(result.balance, 1200);
});

test("counts traspaso a cuenta as savings not spending", () => {
  const transactions = [
    tx("2026-01-01", 2000, "NÓMINA", "Nómina"),
    tx("2026-01-02", -400, "MERCADONA", "Supermercado"),
    tx("2026-01-03", -250, "Traspaso a cuenta · Andres lopez corzo", "Traspaso interno"),
  ];
  const result = analyze([{ balance: 1000 }], transactions, {
    from: "2026-01-01",
    to: "2026-01-31",
  });

  assert.equal(result.expense, 400);
  assert.equal(result.toSavings, 250);
  assert.equal(result.net, 1600);
  assert.equal(result.transactions.find((item) => item.amount === -250).category, "Ahorro");
});

test("detects stable recurring charges across three months", () => {
  const transactions = [
    tx("2026-01-03", -15.99, "NETFLIX 01/2026", "Suscripciones"),
    tx("2026-02-03", -15.99, "NETFLIX 02/2026", "Suscripciones"),
    tx("2026-03-03", -15.99, "NETFLIX 03/2026", "Suscripciones"),
  ];
  const result = analyze([], transactions, { from: "2026-01-01", to: "2026-03-31" });

  assert.equal(result.recurring.length, 1);
  assert.equal(result.recurring[0].months, 3);
  assert.equal(result.recurring[0].amount, 15.99);
  assert.equal(merchantKey("NETFLIX 01/03/2026"), "netflix");
});

function tx(date, amount, text, category) {
  return { date, amount, text, category, account: "Cuenta" };
}
