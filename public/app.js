const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const monthLabel = new Intl.DateTimeFormat("es-ES", { month: "short" });
const dateTimeLabel = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });

const state = {
  summary: null,
  status: null,
  account: "",
  query: "",
  loadController: null,
  renderFrame: null,
  currentView: null,
};

const els = {
  badge: document.querySelector("#source-badge"),
  notice: document.querySelector("#notice"),
  kpis: document.querySelector("#kpis"),
  categories: document.querySelector("#categories"),
  merchants: document.querySelector("#merchants"),
  incomes: document.querySelector("#incomes"),
  biggest: document.querySelector("#biggest"),
  insights: document.querySelector("#insights"),
  donut: document.querySelector("#donut"),
  rows: document.querySelector("#rows"),
  count: document.querySelector("#tx-count"),
  account: document.querySelector("#account"),
  from: document.querySelector("#from"),
  to: document.querySelector("#to"),
  query: document.querySelector("#query"),
  canvas: document.querySelector("#months"),
  setup: document.querySelector("#setup"),
  connectAnyway: document.querySelector("#connect-anyway"),
  connect: document.querySelector("#connect"),
  demo: document.querySelector("#demo"),
  csv: document.querySelector("#csv"),
};

els.connect.addEventListener("click", openConnect);
els.connectAnyway.addEventListener("click", connect);
els.demo.addEventListener("click", () => {
  runAction(async () => {
    await requestJson("/api/demo", { method: "POST" });
    await refresh();
  });
});
els.csv.addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  if (files.some((file) => file.size > 5_000_000)) {
    showError("Algún archivo supera 5 MB.");
    event.target.value = "";
    return;
  }
  await runAction(async () => {
    let total = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const guessed = guessAccountName(file.name, files.length > 1 ? index + 1 : 0);
      const account = window.prompt(
        `Nombre para la cuenta de «${file.name}»`,
        guessed
      );
      if (account === null) {
        event.target.value = "";
        return;
      }
      const query = new URLSearchParams({
        filename: file.name,
        account: account.trim() || guessed,
        // First file of a fresh import replaces demo data; extra files merge.
        replace: index === 0 && state.status?.source !== "csv" ? "1" : "0",
      });
      const result = await requestJson(`/api/import?${query}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      total = result.total || result.count || total;
    }
    event.target.value = "";
    state.status = await requestJson("/api/status");
    await refresh();
    if (files.length > 1) {
      clearError();
      els.notice.textContent = `Importadas ${files.length} cuentas · ${total} movimientos en total.`;
      els.notice.classList.remove("hidden");
    }
  });
});

function guessAccountName(filename, index = 0) {
  const base = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{4}Y-\d{2}M-\d{2}D-\d{2}_\d{2}_\d{2}-/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (base && !/ultimos movimientos|últimos movimientos|movimientos/i.test(base)) {
    return base.slice(0, 48);
  }
  return index > 0 ? `BBVA cuenta ${index}` : "BBVA importado";
}
els.from.addEventListener("change", load);
els.to.addEventListener("change", load);
els.account.addEventListener("change", () => {
  state.account = els.account.value;
  scheduleRender();
});
els.query.addEventListener("input", () => {
  state.query = els.query.value.trim().toLocaleLowerCase("es");
  scheduleRender();
});

if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(() => {
    if (state.currentView) {
      requestAnimationFrame(() => {
        drawMonths(state.currentView.months);
        drawDonut(state.currentView.categories, state.currentView.expense);
      });
    }
  });
  resizeObserver.observe(els.canvas.parentElement);
}

boot();

async function boot() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  els.from.value ||= iso(from);
  els.to.value ||= iso(today);
  setBusy(true);
  try {
    await refresh();
    const returnedWithError = new URLSearchParams(location.search).has("error");
    if (returnedWithError && state.status.lastError) {
      showError(state.status.lastError);
      history.replaceState({}, "", "/");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function refresh() {
  if (!validRange()) return;
  state.loadController?.abort();
  state.loadController = null;
  const params = new URLSearchParams({ from: els.from.value, to: els.to.value });
  const [status, summary] = await Promise.all([
    requestJson("/api/status"),
    requestJson(`/api/summary?${params}`),
  ]);
  state.status = status;
  applySummary(summary);
  if (!status.lastError || status.source === "bbva") clearError();
}

async function load() {
  if (!validRange()) return;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const params = new URLSearchParams({ from: els.from.value, to: els.to.value });
  setBusy(true);
  try {
    const summary = await requestJson(`/api/summary?${params}`, { signal: controller.signal });
    if (state.loadController !== controller) return;
    applySummary(summary);
    clearError();
  } catch (error) {
    if (error.name !== "AbortError") showError(error.message);
  } finally {
    if (state.loadController === controller) setBusy(false);
  }
}

function applySummary(summary) {
  state.summary = summary;
  const previous = state.account;
  const names = [...new Set(summary.accounts.map((account) => account.name))];
  els.account.innerHTML = `<option value="">Todas</option>${names
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("")}`;
  els.account.value = names.includes(previous) ? previous : "";
  state.account = els.account.value;
  render();
}

function scheduleRender() {
  if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = null;
    render();
  });
}

function render() {
  if (!state.summary || !state.status) return;
  const summary = state.summary;
  const source = summary.source || state.status.source;
  els.badge.textContent =
    source === "bbva" ? "BBVA en vivo" : source === "csv" ? "CSV importado" : "Datos de ejemplo";
  els.badge.className = `badge ${source === "bbva" ? "live" : source}`;
  els.badge.title = summary.updatedAt
    ? `Actualizado ${dateTimeLabel.format(new Date(summary.updatedAt))}`
    : "Datos generados localmente";

  const filtered = summary.transactions.filter((tx) => {
    if (state.account && tx.account !== state.account) return false;
    if (state.query && !`${tx.text} ${tx.category}`.toLocaleLowerCase("es").includes(state.query)) return false;
    return true;
  });
  const view = state.account || state.query ? recompute(filtered, summary.accounts) : summary;
  state.currentView = view;

  const ticket = view.purchaseCount ? view.expense / view.purchaseCount : view.avgTicket || 0;
  els.kpis.innerHTML = [
    kpi("Ingresos", euro.format(view.income), incomeNote(view), "good"),
    kpi("Gastos", euro.format(view.expense), `${view.purchaseCount || countPurchases(filtered)} compras · media ${euro.format(view.avgExpense)} / mes`, "bad"),
    kpi("A ahorro", euro.format(view.toSavings || 0), "Traspasos a cuenta o ahorro", "good"),
    kpi(
      "Te queda",
      euro.format(view.net),
      view.income ? `${Math.round(view.savingsRate * 100)} % de lo que entra · ticket ${euro.format(ticket)}` : "Sin ingresos en el periodo",
      view.net >= 0 ? "good" : "bad"
    ),
  ].join("");

  drawMonths(view.months);
  drawDonut(view.categories, view.expense);
  drawCategories(view.categories);
  drawRanks(els.merchants, view.merchants || [], {
    empty: "Todavía no hay compras agrupadas.",
    tone: "bad",
    meta: (item) => `${item.count} compras · ${Math.round(item.share * 100)} %`,
  });
  drawRanks(els.incomes, view.incomeSources || [], {
    empty: "No hay ingresos en este periodo.",
    tone: "good",
    signed: false,
    meta: (item) => `${Math.round(item.share * 100)} % de lo que entra`,
  });
  drawRanks(els.biggest, view.biggestExpenses || [], {
    empty: "No hay cargos en este periodo.",
    tone: "bad",
    meta: (item) => `${formatDate(item.date)} · ${item.category}`,
  });
  els.insights.innerHTML = (view.insights.length ? view.insights : ["Aún no hay suficiente movimiento en este periodo."])
    .map((item) => `<p class="insight">${escapeHtml(item)}</p>`)
    .join("");

  const shown = Math.min(filtered.length, 200);
  els.count.textContent = filtered.length > shown
    ? `Mostrando ${shown} de ${filtered.length} movimientos`
    : `${filtered.length} movimientos`;
  els.rows.innerHTML = filtered.length
    ? filtered.slice(0, 200).map(transactionRow).join("")
    : `<tr><td colspan="5" class="empty">No hay movimientos para estos filtros.</td></tr>`;
}

function transactionRow(tx) {
  return `<tr>
    <td>${formatDate(tx.date)}</td>
    <td class="concept" title="${escapeHtml(tx.text)}">${escapeHtml(tx.text)}</td>
    <td><span class="pill">${escapeHtml(tx.category)}</span></td>
    <td>${escapeHtml(tx.account)}</td>
    <td class="num ${tx.amount >= 0 ? "good" : "bad"}">${euro.format(tx.amount)}</td>
  </tr>`;
}

function recompute(transactions, accounts) {
  let income = 0;
  let expense = 0;
  let toSavings = 0;
  let purchaseCount = 0;
  const byMonth = new Map();
  const byCategory = new Map();
  const byIncome = new Map();
  const byMerchant = new Map();
  const biggest = [];
  for (const tx of transactions) {
    if (tx.category === "Traspaso interno" || tx.category === "Devolución") continue;
    const month = tx.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { month, income: 0, expense: 0, savings: 0 });
    if (tx.amount >= 0) {
      income += tx.amount;
      byMonth.get(month).income += tx.amount;
      byIncome.set(tx.category, (byIncome.get(tx.category) || 0) + tx.amount);
      continue;
    }
    const spent = Math.abs(tx.amount);
    if (tx.category === "Ahorro") {
      toSavings += spent;
      byMonth.get(month).savings += spent;
      continue;
    }
    expense += spent;
    purchaseCount += 1;
    byMonth.get(month).expense += spent;
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + spent);
    biggest.push(tx);
    const key = merchantKey(tx.text);
    if (!key) continue;
    if (!byMerchant.has(key)) {
      byMerchant.set(key, { name: cleanName(tx.text), category: tx.category, amount: 0, count: 0, amounts: [], months: new Set() });
    }
    const merchant = byMerchant.get(key);
    merchant.amount += spent;
    merchant.count += 1;
    merchant.amounts.push(tx.amount);
    merchant.months.add(month);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const categories = [...byCategory.entries()]
    .map(([name, amount]) => ({ name, amount, share: expense > 0 ? amount / expense : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const incomeSources = [...byIncome.entries()]
    .map(([name, amount]) => ({ name, amount, share: income > 0 ? amount / income : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const merchants = [...byMerchant.values()]
    .map((merchant) => ({
      name: merchant.name,
      category: merchant.category,
      amount: merchant.amount,
      count: merchant.count,
      share: expense > 0 ? merchant.amount / expense : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const biggestExpenses = biggest
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 6)
    .map((tx) => ({
      date: tx.date,
      name: cleanName(tx.text),
      category: tx.category,
      amount: Math.abs(tx.amount),
    }));
  const recurring = [...byMerchant.values()]
    .filter((merchant) => merchant.months.size >= 3 && stableAmounts(merchant.amounts))
    .map((merchant) => ({
      name: merchant.name,
      category: merchant.category,
      amount: Math.abs(average(merchant.amounts)),
      months: merchant.months.size,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const net = income - expense;
  const savingsRate = income > 0 ? net / income : 0;
  return {
    income,
    expense,
    toSavings,
    net,
    savingsRate,
    avgExpense: expense / Math.max(months.length, 1),
    avgTicket: purchaseCount ? expense / purchaseCount : 0,
    purchaseCount,
    months,
    categories,
    incomeSources,
    merchants,
    biggestExpenses,
    recurring,
    insights: buildInsights(categories, incomeSources, recurring, months, income, savingsRate, toSavings),
    accounts,
  };
}

function buildInsights(categories, incomeSources, recurring, months, income, savingsRate, toSavings = 0) {
  const insights = [];
  if (incomeSources[0]) {
    insights.push(`Tu ingreso principal es ${incomeSources[0].name}: ${euro.format(incomeSources[0].amount)}.`);
  }
  if (toSavings > 0) {
    insights.push(`Has movido ${euro.format(toSavings)} a ahorro (traspasos a cuenta/ahorro).`);
  }
  if (categories[0]) {
    insights.push(`La mayor partida de gasto es ${categories[0].name}: ${euro.format(categories[0].amount)}.`);
  }
  if (recurring.length) {
    const total = recurring.reduce((sum, item) => sum + item.amount, 0);
    insights.push(`Hay ${recurring.length} cargos recurrentes, unos ${euro.format(total)} al mes.`);
  }
  if (months.length >= 2) {
    const last = months.at(-1);
    const previous = average(months.slice(0, -1).map((item) => item.expense));
    if (previous > 0) {
      const delta = (last.expense - previous) / previous;
      insights.push(`El último mes está un ${Math.round(Math.abs(delta) * 100)} % ${delta >= 0 ? "por encima" : "por debajo"} de la media anterior.`);
    }
  }
  if (income > 0) insights.push(`La tasa de ahorro del periodo es del ${Math.round(savingsRate * 100)} %.`);
  return insights;
}

const MERCHANT_STOP = new Set(["pago", "con", "tarjeta", "compra", "compras", "es", "la", "el", "los", "las", "de", "del", "en", "a", "y", "por", "desde", "cuenta", "abono", "tpv"]);

function merchantKey(text) {
  const words = cleanName(text)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !MERCHANT_STOP.has(word));
  return words.slice(0, 3).join(" ").slice(0, 48);
}

function cleanName(text) {
  return String(text || "").split(" · ")[0].replace(/\s+/g, " ").trim() || "Movimiento";
}

function incomeNote(view) {
  const top = view.incomeSources?.[0];
  return top ? `Sobre todo ${top.name}` : "En el periodo";
}

function countPurchases(transactions) {
  return transactions.filter((tx) => tx.amount < 0 && tx.category !== "Traspaso interno" && tx.category !== "Ahorro").length;
}

const CATEGORY_COLORS = {
  Supermercado: "#3dcc9a",
  Restauración: "#ffb020",
  Transporte: "#59c3ff",
  Compras: "#8b93ff",
  Ocio: "#f472b6",
  Salud: "#2dd4bf",
  Vivienda: "#60a5fa",
  Suministros: "#f5c16c",
  Suscripciones: "#c084fc",
  Telecomunicaciones: "#22d3ee",
  Nómina: "#3dcc9a",
  Bizum: "#38bdf8",
  Transferencias: "#818cf8",
  "Otros ingresos": "#86efac",
  "Otros gastos": "#94a3b8",
  Comisiones: "#fb7185",
};

function colorFor(name, index) {
  return CATEGORY_COLORS[name] || ["#7ec8ff", "#f5c16c", "#ff8fab", "#86efac", "#c4b5fd"][index % 5];
}

function stableAmounts(amounts) {
  if (amounts.length < 3) return false;
  const avg = average(amounts);
  return amounts.every((value) => Math.abs(value - avg) / Math.abs(avg) < 0.18);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function accountBalance(summary) {
  const accounts = state.account
    ? summary.accounts.filter((account) => account.name === state.account)
    : summary.accounts;
  return accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
}

function kpi(label, value, note, tone) {
  return `<article class="kpi"><span>${label}</span><strong class="${tone || ""}">${value}</strong><em>${note}</em></article>`;
}

function drawMonths(months) {
  const canvas = els.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(canvas.clientWidth || 720, 280);
  const height = 280;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  canvas.setAttribute(
    "aria-label",
    months.length
      ? `Ingresos y gastos de ${months.length} meses. Último mes: ${euro.format(months.at(-1).income)} de ingresos y ${euro.format(months.at(-1).expense)} de gastos.`
      : "Sin datos mensuales para el periodo seleccionado."
  );
  if (!months.length) return;

  const pad = { l: 52, r: 8, t: 12, b: 34 };
  const max = Math.max(...months.flatMap((item) => [item.income, item.expense, item.savings || 0]), 1);
  const group = (width - pad.l - pad.r) / months.length;
  const plotH = height - pad.t - pad.b;
  ctx.font = "12px Segoe UI";
  ctx.textBaseline = "middle";
  for (let step = 0; step <= 3; step += 1) {
    const y = pad.t + (plotH * step) / 3;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = "#93a4bd";
    ctx.textAlign = "left";
    ctx.fillText(compact(max * (1 - step / 3)), 0, y);
  }
  months.forEach((item, index) => {
    const barW = Math.min(18, Math.max(group * 0.18, 6));
    const gap = 4;
    const cluster = barW * 3 + gap * 2;
    const x = pad.l + index * group + (group - cluster) / 2;
    const base = height - pad.b;
    roundBar(ctx, x, base, barW, (plotH * item.income) / max, "#3dcc9a");
    roundBar(ctx, x + barW + gap, base, barW, (plotH * item.expense) / max, "#ff6b7a");
    roundBar(ctx, x + (barW + gap) * 2, base, barW, (plotH * (item.savings || 0)) / max, "#f5c16c");
    ctx.fillStyle = "#93a4bd";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(monthLabel.format(new Date(`${item.month}-01T00:00:00`)), x + cluster / 2, height - 12);
  });
}

function roundBar(ctx, x, base, width, height, color) {
  const h = Math.max(height, 0);
  if (h < 1) return;
  const radius = Math.min(6, width / 2, h / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, base - h + radius);
  ctx.quadraticCurveTo(x, base - h, x + radius, base - h);
  ctx.lineTo(x + width - radius, base - h);
  ctx.quadraticCurveTo(x + width, base - h, x + width, base - h + radius);
  ctx.lineTo(x + width, base);
  ctx.closePath();
  ctx.fill();
}

function drawDonut(categories, expense) {
  const canvas = els.donut;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = 220;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;
  ctx.lineWidth = 24;
  if (!categories.length) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    let start = -Math.PI / 2;
    categories.forEach((item, index) => {
      const slice = Math.max(item.share, 0) * Math.PI * 2;
      ctx.strokeStyle = colorFor(item.name, index);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + slice - 0.03);
      ctx.stroke();
      start += slice;
    });
  }
  ctx.fillStyle = "#e7eef8";
  ctx.font = "700 16px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(compactEuro(expense || 0), cx, cy - 6);
  ctx.fillStyle = "#93a4bd";
  ctx.font = "12px Segoe UI";
  ctx.fillText("gastado", cx, cy + 14);
  canvas.setAttribute("aria-label", categories.length
    ? `El mayor gasto es ${categories[0].name}, ${euro.format(categories[0].amount)}.`
    : "Sin gastos en este periodo.");
}

function drawCategories(categories) {
  if (!categories.length) {
    els.categories.innerHTML = `<p class="empty">Sin gastos en este periodo.</p>`;
    return;
  }
  els.categories.innerHTML = categories.slice(0, 7).map((item, index) => `<div class="bar-row">
    <i class="dot" style="background:${colorFor(item.name, index)}"></i>
    <span class="name">${escapeHtml(item.name)} <small>${Math.round(item.share * 100)} %</small></span>
    <strong>${euro.format(item.amount)}</strong>
  </div>`).join("");
}

function drawRanks(target, items, options) {
  if (!items.length) {
    target.innerHTML = `<p class="empty">${escapeHtml(options.empty)}</p>`;
    return;
  }
  const max = items[0].amount || 1;
  target.innerHTML = items.map((item, index) => {
    const label = item.name || item.text || "Movimiento";
    const color = colorFor(item.category || item.name, index);
    return `<div class="rank">
      <span class="rank-n">${index + 1}</span>
      <div>
        <div class="rank-top">
          <strong title="${escapeHtml(label)}">${escapeHtml(short(label, 34))}</strong>
          <b class="${options.tone}">${euro.format(options.tone === "bad" ? -item.amount : item.amount)}</b>
        </div>
        <div class="track"><span style="width:${Math.max(6, (item.amount / max) * 100)}%;background:${color}"></span></div>
        <div class="muted">${escapeHtml(options.meta(item))}</div>
      </div>
    </div>`;
  }).join("");
}

async function openConnect() {
  await runAction(async () => {
    state.status = await requestJson("/api/status");
    els.connectAnyway.hidden = !state.status.configured;
    els.setup.showModal();
  });
}

async function connect() {
  await runAction(async () => {
    const payload = await requestJson("/api/bbva/connect", { method: "POST" });
    location.href = payload.url;
  });
}

async function runAction(action) {
  setBusy(true);
  try {
    clearError();
    await action();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status below still provides a useful error if the response is not JSON.
  }
  if (!response.ok) throw new Error(payload?.error || `La solicitud ha fallado (${response.status}).`);
  return payload;
}

function validRange() {
  if (!els.from.value || !els.to.value || els.from.value > els.to.value) {
    showError("La fecha inicial debe ser anterior a la fecha final.");
    return false;
  }
  return true;
}

function setBusy(busy) {
  document.body.classList.toggle("is-loading", busy);
  els.kpis.setAttribute("aria-busy", String(busy));
  els.connect.disabled = busy;
  els.demo.disabled = busy;
  els.connectAnyway.disabled = busy;
  els.csv.disabled = busy;
}

function showError(message) {
  els.notice.textContent = message || "Ha ocurrido un error inesperado.";
  els.notice.classList.remove("hidden");
}

function clearError() {
  els.notice.textContent = "";
  els.notice.classList.add("hidden");
}

function compact(value) {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

function compactEuro(value) {
  if (value >= 1000) return `${compact(value)} €`;
  return euro.format(value);
}

function maskIban(iban) {
  if (!iban) return "";
  const clean = iban.replace(/\s/g, "");
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)} ···· ${clean.slice(-4)}`;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function iso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function short(text, size = 32) {
  return text.length > size ? `${text.slice(0, size)}…` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
