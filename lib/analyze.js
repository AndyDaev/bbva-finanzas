// when: "in" = credit only, "out" = debit only, omit = either
const RULES = [
  [/traspaso a (cuenta|ahorro)|traspaso.*ahorro/i, "Ahorro", "out"],
  [/traspaso/i, "Traspaso interno"],
  [/\bbizum\b/i, "Bizum"],
  [/\bn[oó]mina\b|\bsalario\b|\bhaberes\b|\bpayroll\b/i, "Nómina", "in"],
  [/\bn[oó]mina inversa\b|\bdevoluci[oó]n\b|\breembolso\b|\babono\b/i, "Otros ingresos", "in"],
  [/\balquiler\b|\brenta piso\b|\barrendamiento\b/i, "Vivienda", "out"],
  [/\bhipoteca\b|\bpr[eé]stamo vivienda\b/i, "Vivienda", "out"],
  [/\bluz\b|\belectric|\biberdrola\b|\bendesa\b|\bnaturgy\b|\bgas natural\b|\bagua\b|\bcanal isabel/i, "Suministros", "out"],
  [/netflix|spotify|\bhbo\b|disney|prime video|\bdazn\b|\bfilmin\b|youtube premium|\bicloud\b|google one/i, "Suscripciones", "out"],
  [/movistar|vodafone|\borange\b|\bdigi\b|masmovil|m[aá]sm[oó]vil|pepephone|\bsimyo\b/i, "Telecomunicaciones", "out"],
  [/mercadona|carrefour|\blidl\b|\baldi\b|\beroski\b|\bconsum\b|\bdia\b|\balcampo\b|\bhipercor\b|ahorramas|ahorra m[aá]s|supermercado|autoservicio/i, "Supermercado", "out"],
  [/restaur|\bbar\b|cafeter|\bglovo\b|just eat|uber eats|mcdonald|burger|telepizza|\bgoiko\b/i, "Restauración", "out"],
  [/\brepsol\b|\bcepsa\b|\bgalp\b|\bbp\b|\bshell\b|gasolin|\bparking\b|\bemt\b|\brenfe\b|\bmetro\b|\bcabify\b|\buber\b|\bbolt\b/i, "Transporte", "out"],
  [/farmacia|\bhospital\b|\bsanitas\b|\badeslas\b|mapfre salud|\bdentista\b|cl[ií]nica/i, "Salud", "out"],
  [/\bzara\b|\bmango\b|\bprimark\b|el corte|\bamazon\b|mediamarkt|\bikea\b|\bdecathlon\b|pccomponentes|\bfnac\b/i, "Compras", "out"],
  [/gimnas|fitness|basic[- ]?fit|\bmcfit\b|entrenador|\bhotel\b|\bhostal\b/i, "Ocio", "out"],
  [/\bcine\b|\bteatro\b|\bsteam\b|playstation|\bnintendo\b|\bbooking\b|\bairbnb\b|\bryanair\b|\bvueling\b|\biberia\b/i, "Ocio", "out"],
  [/transferencia/i, "Transferencias"],
  [/comisi[oó]n|mantenimiento cuenta/i, "Comisiones", "out"],
];

function categorize(text, amount) {
  const source = String(text || "").normalize("NFKC");
  const direction = amount > 0 ? "in" : amount < 0 ? "out" : null;

  for (const [pattern, category, when] of RULES) {
    if (when && direction && when !== direction) continue;
    if (pattern.test(source)) return category;
  }
  if (amount > 0 && /pago con tarjeta|devoluci[oó]n|reembolso/i.test(source)) return "Devolución";
  if (amount > 0) return "Otros ingresos";
  return "Otros gastos";
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

const MERCHANT_STOP = new Set([
  "pago", "con", "tarjeta", "compra", "compras", "es", "la", "el", "los", "las",
  "de", "del", "en", "a", "y", "por", "desde", "cuenta", "abono", "tpv",
]);

function merchantKey(text) {
  const head = String(text || "").split("·")[0];
  const words = head
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d{2}[/-]\d{2}[/-]\d{2,4}/g, " ")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !MERCHANT_STOP.has(word));
  const unique = words.filter((word, index) => word !== words[index - 1]);
  return unique.slice(0, 3).join(" ").slice(0, 48);
}

function analyze(accounts, transactions, range) {
  const from = range?.from || "0000-01-01";
  const to = range?.to || "9999-12-31";
  const inRange = transactions
    .filter((tx) => tx.date >= from && tx.date <= to)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  let income = 0;
  let expense = 0;
  let toSavings = 0;
  let purchaseCount = 0;
  const byMonth = new Map();
  const byCategory = new Map();
  const byIncome = new Map();
  const byMerchant = new Map();
  const biggest = [];
  const refunds = [];
  const normalized = inRange.map((tx) => ({
    ...tx,
    category: categorize(tx.text, tx.amount),
  }));

  for (const tx of normalized) {
    if (tx.category === "Traspaso interno") continue;
    const month = monthKey(tx.date);
    if (!byMonth.has(month)) byMonth.set(month, { month, income: 0, expense: 0, savings: 0 });
    const bucket = byMonth.get(month);
    if (tx.amount > 0 && tx.category === "Devolución") {
      refunds.push(tx);
      continue;
    }
    if (tx.amount >= 0) {
      income += tx.amount;
      bucket.income += tx.amount;
      byIncome.set(tx.category, (byIncome.get(tx.category) || 0) + tx.amount);
      continue;
    }

    const spent = Math.abs(tx.amount);
    if (tx.category === "Ahorro") {
      toSavings += spent;
      bucket.savings += spent;
      continue;
    }

    expense += spent;
    purchaseCount += 1;
    bucket.expense += spent;
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + spent);
    biggest.push(tx);

    const key = merchantKey(tx.text);
    if (!key) continue;
    if (!byMerchant.has(key)) {
      byMerchant.set(key, {
        name: cleanMerchantName(tx.text),
        category: tx.category,
        amount: 0,
        count: 0,
        amounts: [],
        months: new Set(),
      });
    }
    const merchant = byMerchant.get(key);
    merchant.amount += spent;
    merchant.count += 1;
    merchant.amounts.push(tx.amount);
    merchant.months.add(month);
  }

  for (const tx of refunds) {
    const refund = tx.amount;
    const category = categorize(tx.text, -refund);
    expense = Math.max(0, expense - refund);
    if (byCategory.has(category)) {
      byCategory.set(category, Math.max(0, byCategory.get(category) - refund));
    }
    const key = merchantKey(tx.text);
    const merchant = key && byMerchant.get(key);
    if (merchant) merchant.amount = Math.max(0, merchant.amount - refund);
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const categories = [...byCategory.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      share: expense > 0 ? amount / expense : 0,
    }))
    .filter((item) => item.amount > 0.009)
    .sort((a, b) => b.amount - a.amount);

  const incomeSources = [...byIncome.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      share: income > 0 ? amount / income : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const merchants = [...byMerchant.values()]
    .map((merchant) => ({
      name: merchant.name,
      category: merchant.category,
      amount: merchant.amount,
      count: merchant.count,
      share: expense > 0 ? merchant.amount / expense : 0,
      kind: describeMerchant(merchant.name, merchant.category),
    }))
    .filter((merchant) => merchant.amount > 0.009)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);

  const recurring = [];
  for (const merchant of byMerchant.values()) {
    if (merchant.months.size < 3) continue;
    if (merchant.amounts.length < 3) continue;
    const avg = merchant.amounts.reduce((sum, value) => sum + value, 0) / merchant.amounts.length;
    const stable = merchant.amounts.every((value) => Math.abs(value - avg) / Math.abs(avg) < 0.18);
    if (!stable) continue;
    recurring.push({
      name: merchant.name,
      category: merchant.category,
      amount: Math.abs(avg),
      months: merchant.months.size,
    });
  }
  recurring.sort((a, b) => b.amount - a.amount);

  const biggestExpenses = biggest
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 8)
    .map((tx) => ({
      date: tx.date,
      text: tx.text,
      category: tx.category,
      account: tx.account,
      amount: Math.abs(tx.amount),
    }));

  const balance = accounts.reduce((sum, account) => sum + (Number(account.balance) || 0), 0);
  const net = income - expense;
  const savingsRate = income > 0 ? net / income : 0;
  const monthCount = Math.max(months.length, 1);
  const avgExpense = expense / monthCount;
  const avgTicket = purchaseCount > 0 ? expense / purchaseCount : 0;

  const insights = [];
  if (incomeSources[0]) {
    insights.push(
      `Tu ingreso principal es ${incomeSources[0].name}: ${formatEuro(incomeSources[0].amount)} (${Math.round(incomeSources[0].share * 100)} %).`
    );
  }
  if (toSavings > 0) {
    insights.push(
      `Has movido ${formatEuro(toSavings)} a ahorro (traspasos a cuenta/ahorro).`
    );
  }
  if (categories[0]) {
    insights.push(
      `La mayor partida de gasto es ${categories[0].name}: ${formatEuro(categories[0].amount)} (${Math.round(categories[0].share * 100)} %).`
    );
  }
  if (merchants[0]) {
    insights.push(
      `Donde más gastas es ${shortLabel(merchants[0].name)}: ${formatEuro(merchants[0].amount)} en ${merchants[0].count} compras.`
    );
  }
  if (recurring.length) {
    const recurringTotal = recurring.reduce((sum, item) => sum + item.amount, 0);
    insights.push(
      `Hay ${recurring.length} cargos recurrentes, unos ${formatEuro(recurringTotal)} al mes.`
    );
  }
  if (months.length >= 2) {
    const last = months[months.length - 1];
    const previous = months.slice(0, -1).reduce((sum, item) => sum + item.expense, 0) / (months.length - 1);
    if (previous > 0) {
      const delta = (last.expense - previous) / previous;
      const monthLabel = labelMonth(last.month);
      if (delta > 0.08) {
        insights.push(
          `En ${monthLabel} el gasto va un ${Math.round(delta * 100)} % por encima de la media anterior.`
        );
      } else if (delta < -0.08) {
        insights.push(
          `En ${monthLabel} el gasto va un ${Math.round(Math.abs(delta) * 100)} % por debajo de la media anterior.`
        );
      } else {
        insights.push(`El gasto de ${monthLabel} está en línea con los meses anteriores.`);
      }
    }
  }
  if (income > 0) {
    insights.push(`La tasa de ahorro del periodo es del ${Math.round(savingsRate * 100)} %.`);
  }

  const advice = buildAdvice({
    income,
    expense,
    toSavings,
    savingsRate,
    avgTicket,
    categories,
    merchants,
    months,
  });

  return {
    balance,
    income,
    expense,
    toSavings,
    net,
    savingsRate,
    avgExpense,
    avgTicket,
    purchaseCount,
    accounts,
    months,
    categories,
    incomeSources,
    merchants,
    biggestExpenses,
    recurring: recurring.slice(0, 8),
    transactions: normalized,
    insights,
    advice,
  };
}

function describeMerchant(name, category) {
  const text = String(name || "").toLowerCase();
  if (/hotel|hostal|hostel|airbnb/.test(text)) {
    return "Hostelería / alojamiento. Entra en ocio o viajes, no en supermercado.";
  }
  if (/farmacia|clinica|clínica|hospital|dentista/.test(text)) {
    return "Salud: farmacia o clínica.";
  }
  if (/supermercado|mercadona|lidl|carrefour|aldi|consum|autoservicio|familia/.test(text)) {
    return "Alimentación / supermercado.";
  }
  if (/restaur|bar |cafeter|mcdonald|burger|glovo|just eat|uber eats/.test(text)) {
    return "Comida fuera / restauración.";
  }
  if (/fnac|zara|mango|amazon|ikea|decathlon|primark|corte/.test(text)) {
    return "Compras de retail (ropa, electrónica, casa).";
  }
  if (/repsol|cepsa|galp|parking|renfe|metro|uber|cabify|emt/.test(text)) {
    return "Transporte o combustible.";
  }
  if (/netflix|spotify|disney|prime|icloud/.test(text)) {
    return "Suscripción digital recurrente.";
  }
  if (category === "Ocio") return "Ocio o entretenimiento.";
  if (category === "Compras") return "Compra puntual en comercio.";
  if (category === "Supermercado") return "Alimentación / supermercado.";
  return `Gasto clasificado como ${category}.`;
}

function buildAdvice({ income, expense, toSavings, savingsRate, avgTicket, categories, merchants, months }) {
  const actions = [];
  const summary = [];
  if (categories[0]) {
    summary.push(
      `La categoría que más te pesa es ${categories[0].name} (${formatEuro(categories[0].amount)}, ${Math.round(categories[0].share * 100)} %).`
    );
    if (categories[0].share >= 0.28) {
      actions.push(
        `Recorta un 10–15 % en ${categories[0].name}: son unos ${formatEuro(categories[0].amount * 0.12)} en este periodo.`
      );
    }
  }
  if (merchants[0] && merchants[0].count >= 2) {
    summary.push(
      `${shortLabel(merchants[0].name)} concentra ${formatEuro(merchants[0].amount)} en ${merchants[0].count} visitas.`
    );
    actions.push(
      `Limita las visitas a ${shortLabel(merchants[0].name)} o fija un tope semanal; ahí está tu mayor fuga.`
    );
  }
  if (avgTicket > 0 && avgTicket < 12 && expense > 80) {
    actions.push(
      `Tu ticket medio es bajo (${formatEuro(avgTicket)}): son muchas compras pequeñas. Agrupa recados en 1–2 salidas.`
    );
  }
  if (toSavings > 0) {
    summary.push(`Ya estás moviendo ${formatEuro(toSavings)} a ahorro; mantén ese hábito.`);
  } else if (income > 0 && savingsRate < 0.1) {
    actions.push(
      `Tu tasa de ahorro es del ${Math.round(savingsRate * 100)} %. Traspasa un fijo el día de nómina (aunque sean 50 €).`
    );
  }
  if (months.length >= 2) {
    const last = months[months.length - 1];
    const previous =
      months.slice(0, -1).reduce((sum, item) => sum + item.expense, 0) / (months.length - 1);
    if (previous > 0 && last.expense > previous * 1.12) {
      actions.push(
        `El último mes gastaste un ${Math.round(((last.expense - previous) / previous) * 100)} % más que la media: revisa restaurantes y compras.`
      );
    }
  }
  while (actions.length < 3) {
    actions.push(
      actions.length === 0
        ? "Importa más meses o escanea tickets para afinar el consejo."
        : actions.length === 1
          ? "Revisa la ficha de cada comercio para ver si es necesidad o impulso."
          : "Copia el resumen a ChatGPT si quieres un plan semanal más detallado."
    );
  }
  return {
    summary,
    actions: actions.slice(0, 3),
  };
}

function cleanMerchantName(text) {
  return String(text || "")
    .split(" · ")[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "Comercio";
}

function shortLabel(text) {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function formatEuro(value) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function labelMonth(key) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(date);
}

module.exports = { categorize, analyze, merchantKey };
