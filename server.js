const fs = require("fs");
const path = require("path");
const http = require("http");
const { analyze, categorize } = require("./lib/analyze");
const { buildDemo } = require("./lib/demo");
const { parseExtract, replaceAccountTransactions } = require("./lib/csv");
const bbva = require("./lib/bbva");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3780);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SESSION_FILE = path.join(DATA_DIR, "session.json");
const IMPORT_FILE = path.join(DATA_DIR, "import.json");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const DIST_DIR = path.join(ROOT, "web", "web", "dist");
const MAX_BODY_BYTES = 8_000_000;

let demoCache = null;
let demoCacheDate = null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, statusPayload());
    }
    if (req.method === "GET" && url.pathname === "/api/summary") {
      const dataset = currentDataset();
      const range = dateRange(url.searchParams.get("from"), url.searchParams.get("to"));
      const summary = analyze(dataset.accounts, dataset.transactions, {
        from: range.from,
        to: range.to,
      });
      const tickets = (readJson(TICKETS_FILE)?.tickets || []).filter((ticket) => {
        if (!ticket.date) return true;
        return ticket.date >= range.from && ticket.date <= range.to;
      });
      return json(res, 200, {
        source: dataset.source,
        updatedAt: dataset.updatedAt || null,
        tickets,
        ...summary,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      const buffer = await readBuffer(req);
      const filename = url.searchParams.get("filename") || "";
      const account = url.searchParams.get("account") || "";
      const wipeAll = url.searchParams.get("replace") === "all";
      const incoming = parseExtract(buffer, { filename, account });
      const previous = wipeAll ? [] : readJson(IMPORT_FILE)?.transactions || [];
      const transactions = wipeAll
        ? incoming
        : replaceAccountTransactions(previous, incoming);
      const session = readJson(SESSION_FILE);
      if (session?.dataset) {
        delete session.dataset;
        writeJson(SESSION_FILE, session);
      }
      writeJson(IMPORT_FILE, {
        source: "csv",
        updatedAt: new Date().toISOString(),
        accounts: accountsFromTransactions(transactions),
        transactions,
      });
      const touched = [...new Set(incoming.map((item) => item.account).filter(Boolean))];
      return json(res, 200, {
        ok: true,
        count: incoming.length,
        total: transactions.length,
        accounts: touched,
        replaced: !wipeAll && previous.length > 0,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/tickets") {
      return json(res, 200, { tickets: readJson(TICKETS_FILE)?.tickets || [] });
    }
    if (req.method === "POST" && url.pathname === "/api/tickets") {
      const body = JSON.parse((await readBuffer(req)).toString("utf8") || "{}");
      const store = readJson(TICKETS_FILE) || { tickets: [] };
      const ticket = {
        id: body.id || `ticket-${Date.now()}`,
        createdAt: body.createdAt || new Date().toISOString(),
        merchant: String(body.merchant || "").trim() || "Comercio",
        date: body.date || null,
        total: Number(body.total) || 0,
        currency: "EUR",
        items: Array.isArray(body.items)
          ? body.items
              .map((item) => ({
                name: String(item.name || "").trim() || "Artículo",
                amount: Number(item.amount) || 0,
              }))
              .filter((item) => item.amount !== 0 || item.name)
          : [],
        transactionId: body.transactionId || null,
        account: body.account || null,
        notes: body.notes || "",
      };
      const index = store.tickets.findIndex((item) => item.id === ticket.id);
      if (index >= 0) store.tickets[index] = ticket;
      else store.tickets.unshift(ticket);
      writeJson(TICKETS_FILE, store);
      return json(res, 200, { ok: true, ticket });
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/tickets/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/tickets/".length));
      const store = readJson(TICKETS_FILE) || { tickets: [] };
      store.tickets = store.tickets.filter((item) => item.id !== id);
      writeJson(TICKETS_FILE, store);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/demo") {
      if (fs.existsSync(IMPORT_FILE)) fs.unlinkSync(IMPORT_FILE);
      const session = readJson(SESSION_FILE);
      if (session?.dataset) {
        delete session.dataset;
        writeJson(SESSION_FILE, session);
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/bbva/connect") {
      const config = bbva.loadConfig();
      if (!bbva.isConfigured(config)) {
        return json(res, 400, {
          error:
            "Faltan BBVA_CLIENT_ID, BBVA_CERT_PATH y BBVA_KEY_PATH. La API de cuentas solo admite un proveedor de información autorizado, con certificado eIDAS.",
        });
      }
      const pkce = bbva.pkcePair();
      const session = readJson(SESSION_FILE) || {};
      session.pkce = pkce;
      session.redirectUri = `${baseUrl()}/api/bbva/callback`;
      session.lastError = null;
      writeJson(SESSION_FILE, session);
      return json(res, 200, { url: bbva.authorizeUrl(config, session.redirectUri, pkce) });
    }
    if (req.method === "GET" && url.pathname === "/api/bbva/callback") {
      const next = await handleOauthCallback(req, url);
      return redirect(res, next);
    }
    if (req.method === "GET" && url.pathname === "/api/bbva/return") {
      await pullBankData(req);
      return redirect(res, "/");
    }
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      return serveStatic(req, res, url.pathname);
    }
    json(res, 404, { error: "No encontrado" });
  } catch (error) {
    if (url.pathname.startsWith("/api/bbva/") && req.method === "GET") {
      rememberError(error.message);
      return redirect(res, "/?error=1");
    }
    json(res, error.status || 400, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard en http://localhost:${PORT}`);
});

async function handleOauthCallback(req, url) {
  const denied = url.searchParams.get("error");
  if (denied) throw new Error(`BBVA no autorizó el acceso (${denied}).`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = readJson(SESSION_FILE) || {};
  if (!code) throw new Error("BBVA no devolvió un código de autorización.");
  if (!session.pkce || state !== session.pkce.state) {
    throw new Error("La respuesta de BBVA no coincide con esta sesión.");
  }

  const config = bbva.loadConfig();
  session.token = await bbva.exchangeCode(config, {
    code,
    redirectUri: session.redirectUri,
    verifier: session.pkce.verifier,
  });
  const consent = await bbva.createConsent(
    config,
    session.token.access_token,
    `${baseUrl()}/api/bbva/return`,
    clientInfo(req)
  );
  session.consentId = consent.consentId;
  session.lastError = null;
  writeJson(SESSION_FILE, session);

  if (consent.redirect && consent.status !== "valid") return consent.redirect;
  await pullBankData(req);
  return "/";
}

async function pullBankData(req) {
  const config = bbva.loadConfig();
  const session = readJson(SESSION_FILE) || {};
  if (!session.token?.access_token || !session.consentId) {
    throw new Error("No hay un consentimiento activo con BBVA.");
  }

  let token = session.token.access_token;
  const load = async () => {
    const state = await bbva.consentStatus(config, token, session.consentId, clientInfo(req));
    if (state && state !== "valid") {
      throw new Error(`El consentimiento sigue en estado "${state}". Confírmalo en BBVA.`);
    }
    const from = monthsAgo(6);
    const accounts = await bbva.fetchAccounts(config, token, session.consentId, clientInfo(req));
    const accountTransactions = await Promise.all(
      accounts.map(async (account) => {
        const raw = await bbva.fetchTransactions(
        config,
        token,
        session.consentId,
        account.id,
        from,
        today(),
        clientInfo(req)
        );
        return raw.map((item) => {
        const amount = Number(item.transactionAmount?.amount);
        const text = [
          item.remittanceInformationUnstructured,
          ...(item.remittanceInformationUnstructuredArray || []),
          item.creditorName,
          item.debtorName,
          item.additionalInformation,
        ]
          .filter(Boolean)
          .join(" · ");
          return {
          id: item.transactionId || item.entryReference,
          accountId: account.id,
          account: account.name,
          iban: account.iban,
          date: item.bookingDate || item.valueDate,
          amount,
          currency: item.transactionAmount?.currency || account.currency,
          text: text || "Movimiento",
          category: categorize(text, amount),
          };
        });
      })
    );
    const transactions = accountTransactions.flat();
    return { accounts, transactions };
  };

  try {
    const data = await load();
    session.dataset = {
      source: "bbva",
      updatedAt: new Date().toISOString(),
      accounts: data.accounts,
      transactions: data.transactions.filter((item) => item.date && !Number.isNaN(item.amount)),
    };
    session.lastError = null;
    writeJson(SESSION_FILE, session);
  } catch (error) {
    if (error.status === 401 && session.token.refresh_token) {
      session.token = await bbva.refreshToken(config, session.token.refresh_token);
      token = session.token.access_token;
      writeJson(SESSION_FILE, session);
      const data = await load();
      session.dataset = {
        source: "bbva",
        updatedAt: new Date().toISOString(),
        accounts: data.accounts,
        transactions: data.transactions.filter((item) => item.date && !Number.isNaN(item.amount)),
      };
      session.lastError = null;
      writeJson(SESSION_FILE, session);
      return;
    }
    throw error;
  }
}

function statusPayload() {
  const config = bbva.loadConfig();
  const session = readJson(SESSION_FILE) || {};
  return {
    configured: bbva.isConfigured(config),
    environment: config.environment,
    connected: Boolean(session.token?.access_token && session.consentId && session.dataset?.source === "bbva"),
    source: currentDataset().source,
    lastError: session.lastError || null,
  };
}

function currentDataset() {
  const session = readJson(SESSION_FILE);
  if (session?.dataset?.transactions?.length) return session.dataset;
  if (fs.existsSync(IMPORT_FILE)) return readJson(IMPORT_FILE);
  const date = today();
  if (!demoCache || demoCacheDate !== date) {
    demoCache = buildDemo();
    demoCacheDate = date;
  }
  return demoCache;
}

function accountsFromTransactions(transactions) {
  const accounts = new Map();
  for (const item of transactions) {
    const current = accounts.get(item.account) || { total: 0, latest: null };
    current.total += item.amount;
    if (
      typeof item.balanceAfter === "number" &&
      (!current.latest || item.date > current.latest.date)
    ) {
      current.latest = item;
    }
    accounts.set(item.account, current);
  }
  return [...accounts.entries()].map(([name, values]) => {
    return {
      id: name,
      name,
      iban: "",
      currency: "EUR",
      product: "Importada",
      balance: values.latest ? values.latest.balanceAfter : values.total,
    };
  });
}

function clientInfo(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    ip: forwarded || req.socket.remoteAddress?.replace("::ffff:", "") || "127.0.0.1",
    userAgent: req.headers["user-agent"],
  };
}

function baseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
}

function today() {
  return localIso(new Date());
}

function defaultFrom() {
  const date = new Date();
  date.setMonth(date.getMonth() - 5, 1);
  return localIso(date);
}

function monthsAgo(count) {
  const date = new Date();
  date.setMonth(date.getMonth() - count);
  return localIso(date);
}

function localIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateRange(fromValue, toValue) {
  const from = fromValue || defaultFrom();
  const to = toValue || today();
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    const error = new Error("El intervalo de fechas no es válido.");
    error.status = 422;
    throw error;
  }
  return { from, to };
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function rememberError(message) {
  const session = readJson(SESSION_FILE) || {};
  session.lastError = message;
  writeJson(SESSION_FILE, session);
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("El archivo supera 5 MB.");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  setCommonHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function staticRoot() {
  return fs.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR;
}

function contentType(target) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  return types[path.extname(target).toLowerCase()] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  const root = path.resolve(staticRoot());
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  let target = path.resolve(root, relative);
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) return json(res, 403, { error: "No permitido" });
  if (!relative || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    target = path.join(root, "index.html");
  }
  if (!fs.existsSync(target)) return json(res, 404, { error: "No encontrado" });
  return file(req, res, target, contentType(target));
}

function file(req, res, target, type) {
  const stat = fs.statSync(target);
  const etag = `W/\"${stat.size}-${Math.trunc(stat.mtimeMs)}\"`;
  setCommonHeaders(res);
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
    ETag: etag,
  });
  fs.createReadStream(target).pipe(res);
}

function redirect(res, location) {
  setCommonHeaders(res);
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  return res.end();
}

function setCommonHeaders(res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function readJson(target) {
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJson(target, value) {
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function loadEnv(target) {
  if (!fs.existsSync(target)) return;
  for (const line of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}
