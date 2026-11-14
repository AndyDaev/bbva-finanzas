const { categorize } = require("./analyze");

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function buildDemo(today = new Date()) {
  const rand = mulberry32(20261112);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 7, 1));

  const payroll = {
    id: "demo-nomina",
    name: "Cuenta Nómina",
    iban: "ES2101820000123456784421",
    currency: "EUR",
    product: "Cuenta online",
  };
  const savings = {
    id: "demo-ahorro",
    name: "Cuenta Ahorro",
    iban: "ES7901820000987654321104",
    currency: "EUR",
    product: "Cuenta de ahorro",
  };

  const transactions = [];
  let payrollBalance = 7200;
  let savingsBalance = 9800;
  let seq = 1;

  const push = (account, date, amount, text, balanceAfter) => {
    transactions.push({
      id: `demo-${seq++}`,
      accountId: account.id,
      account: account.name,
      iban: account.iban,
      date: iso(date),
      amount: Math.round(amount * 100) / 100,
      currency: "EUR",
      text,
      category: categorize(text, amount),
      balanceAfter: Math.round(balanceAfter * 100) / 100,
    });
  };

  const groceries = ["MERCADONA", "CARREFOUR", "LIDL", "CONSUM", "ALCAMPO"];
  const food = ["RESTAURANTE LA BARRA", "GLOVO", "CAFETERIA NORD", "JUST EAT", "BAR CENTRAL"];
  const transport = ["REPSOL", "EMT VALENCIA", "RENFE CERCANIAS", "CABIFY", "PARKING CENTRO"];
  const shopping = ["AMAZON", "ZARA", "EL CORTE INGLES", "DECATHLON", "IKEA"];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDate();
    const month = cursor.getUTCMonth();
    const date = new Date(cursor);

    if (day === 28 && date <= end) {
      payrollBalance += 2480;
      push(payroll, date, 2480, "NOMINA EMPRESA ACME SL", payrollBalance);
    }
    if (day === 1) {
      payrollBalance -= 890;
      push(payroll, date, -890, "ALQUILER PISO", payrollBalance);
      payrollBalance -= 300;
      push(payroll, date, -300, "TRASPASO A CUENTA AHORRO", payrollBalance);
      savingsBalance += 300;
      push(savings, date, 300, "TRASPASO DESDE NOMINA", savingsBalance);
    }
    if (day === 3) {
      payrollBalance -= 15.99;
      push(payroll, date, -15.99, "NETFLIX", payrollBalance);
    }
    if (day === 5) {
      payrollBalance -= 10.99;
      push(payroll, date, -10.99, "SPOTIFY", payrollBalance);
    }
    if (day === 7) {
      payrollBalance -= 36.9;
      push(payroll, date, -36.9, "GIMNASIO BASIC FIT", payrollBalance);
      payrollBalance -= 29;
      push(payroll, date, -29, "MOVISTAR FIBRA", payrollBalance);
    }
    if (day === 12) {
      const bill = 54 + Math.round(rand() * 38);
      payrollBalance -= bill;
      push(payroll, date, -bill, "IBERDROLA LUZ", payrollBalance);
    }
    if (day === 18 && month % 2 === 0) {
      payrollBalance -= 42;
      push(payroll, date, -42, "SANITAS SEGURO", payrollBalance);
    }

    if (rand() < 0.55) {
      const amount = -(18 + rand() * 62);
      payrollBalance += amount;
      push(payroll, date, amount, pick(groceries), payrollBalance);
    }
    if (rand() < 0.28) {
      const amount = -(8 + rand() * 34);
      payrollBalance += amount;
      push(payroll, date, amount, pick(food), payrollBalance);
    }
    if (rand() < 0.22) {
      const amount = -(6 + rand() * 48);
      payrollBalance += amount;
      push(payroll, date, amount, pick(transport), payrollBalance);
    }
    if (rand() < 0.08) {
      const amount = -(15 + rand() * 90);
      payrollBalance += amount;
      push(payroll, date, amount, pick(shopping), payrollBalance);
    }
    if (rand() < 0.06) {
      const incoming = rand() < 0.5;
      const amount = (incoming ? 1 : -1) * (10 + Math.round(rand() * 40));
      payrollBalance += amount;
      push(payroll, date, amount, incoming ? "BIZUM DE LAURA" : "BIZUM A MARCOS", payrollBalance);
    }
  }

  payroll.balance = Math.round(payrollBalance * 100) / 100;
  savings.balance = Math.round(savingsBalance * 100) / 100;

  return {
    source: "demo",
    accounts: [payroll, savings],
    transactions,
  };
}

module.exports = { buildDemo };
