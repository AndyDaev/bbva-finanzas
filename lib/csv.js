const XLSX = require("xlsx");
const { categorize } = require("./analyze");

function parseCsv(text, options = {}) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim());
  const separator = detectSeparator(lines[0]);
  const rows = lines.map((line) => splitRow(line, separator));
  return rowsToTransactions(rows, options);
}

function parseXlsx(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("El Excel no tiene ninguna hoja legible.");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  return rowsToTransactions(rows, options);
}

function parseExtract(input, options = {}) {
  const filename = String(options.filename || "").toLowerCase();
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (isZip(buffer) || /\.xlsx?$/i.test(filename)) return parseXlsx(buffer, options);
    return parseCsv(buffer.toString("utf8"), options);
  }
  return parseCsv(String(input || ""), options);
}

function rowsToTransactions(rows, options = {}) {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    throw new Error("El extracto necesita columnas de fecha e importe. Exporta los movimientos desde BBVA.");
  }

  const header = rows[headerIndex].map((cell) => normalizeHeader(String(cell ?? "")));
  const dateIndex = findColumn(header, ["fecha operacion", "fecha operación", "bookingdate", "fecha"]);
  const valueDateIndex = findColumn(header, ["f.valor", "f valor", "fecha valor", "valor"]);
  const conceptIndex = findColumn(header, ["concepto", "descripcion", "descripción"]);
  const movementIndex = findColumn(header, ["movimiento"]);
  const notesIndex = findColumn(header, ["observaciones"]);
  const amountIndex = findColumn(header, ["importe", "cantidad", "amount"]);
  const accountIndex = findColumn(header, ["cuenta", "iban", "alias"]);
  const balanceIndex = findColumn(header, ["disponible", "saldo"]);
  if (dateIndex < 0 || amountIndex < 0) {
    throw new Error("El extracto necesita columnas de fecha e importe. Exporta los movimientos desde BBVA.");
  }

  const fallbackAccount = String(options.account || "").trim() || "BBVA importado";
  const transactions = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index] || [];
    if (!cells.some((cell) => String(cell ?? "").trim())) continue;
    const date = parseDate(cells[dateIndex]) || (valueDateIndex >= 0 ? parseDate(cells[valueDateIndex]) : null);
    const amount = parseAmount(cells[amountIndex]);
    if (!date || Number.isNaN(amount)) continue;
    const text = buildText(cells, conceptIndex, movementIndex, notesIndex);
    const account =
      accountIndex >= 0 && String(cells[accountIndex] || "").trim()
        ? String(cells[accountIndex]).trim()
        : fallbackAccount;
    const entry = {
      id: `import-${date}-${amount}-${index}`,
      accountId: account,
      account,
      date,
      amount,
      currency: "EUR",
      text,
      category: categorize(text, amount),
    };
    if (balanceIndex >= 0) {
      const balance = parseAmount(cells[balanceIndex]);
      if (!Number.isNaN(balance)) entry.balanceAfter = balance;
    }
    transactions.push(entry);
  }
  if (!transactions.length) throw new Error("No encontré movimientos en ese archivo.");
  return transactions;
}

function buildText(cells, conceptIndex, movementIndex, notesIndex) {
  const parts = [];
  for (const index of [conceptIndex, movementIndex, notesIndex]) {
    if (index < 0) continue;
    const value = String(cells[index] ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) parts.push(value);
  }
  return parts.join(" · ") || "Movimiento";
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const header = (rows[index] || []).map((cell) => normalizeHeader(String(cell ?? "")));
    const hasDate = findColumn(header, ["fecha", "bookingdate"]) >= 0;
    const hasAmount = findColumn(header, ["importe", "cantidad", "amount"]) >= 0;
    if (hasDate && hasAmount) return index;
  }
  return -1;
}

function mergeTransactions(existing, incoming) {
  const map = new Map();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const key = transactionKey(item);
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function transactionKey(item) {
  return [
    item.date,
    Number(item.amount),
    String(item.text || "").toLowerCase(),
    String(item.account || "").toLowerCase(),
  ].join("|");
}

/** Replace all movements for the accounts present in `incoming`, keep the rest. */
function replaceAccountTransactions(existing, incoming) {
  const accounts = new Set(
    (incoming || []).map((item) => String(item.account || "").toLowerCase()).filter(Boolean)
  );
  if (!accounts.size) return mergeTransactions(existing, incoming);
  const kept = (existing || []).filter(
    (item) => !accounts.has(String(item.account || "").toLowerCase())
  );
  return mergeTransactions(kept, incoming);
}

function detectSeparator(line) {
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function splitRow(line, separator) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function findColumn(header, names) {
  const wanted = names.map((name) => normalizeHeader(name));
  return header.findIndex((column) => wanted.some((name) => column === name || column.includes(name)));
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return localIso(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!local) return null;
  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
}

function localIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let text = String(value || "").trim().replace(/\s/g, "").replace(/€/g, "");
  if (!text) return NaN;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(text);
  if (Number.isNaN(amount)) return NaN;
  return negative ? -Math.abs(amount) : amount;
}

function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

module.exports = {
  parseCsv,
  parseXlsx,
  parseExtract,
  mergeTransactions,
  replaceAccountTransactions,
};
