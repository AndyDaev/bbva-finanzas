const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const { URL } = require("url");

const ENVIRONMENTS = {
  sandbox: {
    api: "https://apis-i.redsys.es:20443/psd2/xs2a/api-entrada-xs2a/services/BBVA/v1.1",
    oauth: "https://apis-i.redsys.es:20443/psd2/xs2a/api-oauth-xs2a/services/rest/BBVA",
  },
  production: {
    api: "https://psd2.redsys.es/api-entrada-xs2a/services/BBVA/v1.1",
    oauth: "https://hubpsd2.redsys.es/api-oauth-xs2a/services/rest/BBVA",
  },
};

function loadConfig() {
  const environment = process.env.BBVA_ENV === "production" ? "production" : "sandbox";
  const bases = ENVIRONMENTS[environment];
  return {
    environment,
    clientId: (process.env.BBVA_CLIENT_ID || "").trim(),
    certPath: (process.env.BBVA_CERT_PATH || "").trim(),
    keyPath: (process.env.BBVA_KEY_PATH || "").trim(),
    insecure: process.env.BBVA_TLS_INSECURE === "true",
    apiBase: bases.api,
    oauthBase: bases.oauth,
  };
}

function isConfigured(config = loadConfig()) {
  return Boolean(config.clientId && config.certPath && config.keyPath);
}

function createAgent(config) {
  if (!config.certPath || !config.keyPath) return undefined;
  return new https.Agent({
    cert: fs.readFileSync(config.certPath),
    key: fs.readFileSync(config.keyPath),
    rejectUnauthorized: !config.insecure,
  });
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: crypto.randomBytes(16).toString("hex") };
}

function authorizeUrl(config, redirectUri, pkce) {
  const url = new URL(`${config.oauthBase}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", "AIS");
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function request(config, method, target, { headers = {}, body, form } = {}) {
  const url = new URL(target);
  const payload = form
    ? new URLSearchParams(form).toString()
    : body
      ? JSON.stringify(body)
      : null;
  const agent = createAgent(config);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent,
        headers: {
          Accept: "application/json",
          "X-Request-ID": crypto.randomUUID(),
          ...(payload
            ? {
                "Content-Type": form
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            json,
            raw,
          });
        });
      }
    );
    req.setTimeout(20_000, () => {
      req.destroy(new Error("La conexión con BBVA ha superado el tiempo de espera."));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function exchangeCode(config, { code, redirectUri, verifier }) {
  const response = await request(config, "POST", `${config.oauthBase}/token`, {
    form: {
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  if (response.status >= 400 || !response.json?.access_token) {
    throw apiError("No se pudo canjear el código de BBVA", response);
  }
  return response.json;
}

async function refreshToken(config, refreshTokenValue) {
  const response = await request(config, "POST", `${config.oauthBase}/token`, {
    form: {
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshTokenValue,
    },
  });
  if (response.status >= 400 || !response.json?.access_token) {
    throw apiError("No se pudo renovar el acceso a BBVA", response);
  }
  return response.json;
}

function consentBody() {
  const until = new Date();
  until.setDate(until.getDate() + 90);
  return {
    access: { allPsd2: "allAccounts" },
    recurringIndicator: true,
    validUntil: until.toISOString().slice(0, 10),
    frequencyPerDay: 4,
  };
}

async function createConsent(config, token, redirectUri, psu = {}) {
  const response = await request(config, "POST", `${config.apiBase}/consents`, {
    headers: psuHeaders(token, psu, {
      "TPP-Redirect-Preferred": "true",
      "TPP-Redirect-URI": redirectUri,
      "TPP-Nok-Redirect-URI": redirectUri,
    }),
    body: consentBody(),
  });
  if (response.status >= 400) throw apiError("BBVA rechazó el consentimiento", response);
  return {
    consentId: response.json?.consentId || header(response, "location"),
    status: response.json?.consentStatus,
    redirect: response.json?._links?.scaRedirect?.href || null,
    raw: response.json,
  };
}

async function consentStatus(config, token, consentId, psu = {}) {
  const response = await request(
    config,
    "GET",
    `${config.apiBase}/consents/${encodeURIComponent(consentId)}/status`,
    { headers: psuHeaders(token, psu, { "Consent-ID": consentId }) }
  );
  if (response.status >= 400) throw apiError("No se pudo leer el estado del consentimiento", response);
  return response.json?.consentStatus;
}

async function fetchAccounts(config, token, consentId, psu = {}) {
  const response = await aisGet(config, token, consentId, "/accounts?withBalance=true", psu);
  const accounts = (response.accounts || []).map(normalizeAccount);
  return accounts;
}

async function fetchTransactions(config, token, consentId, accountId, from, to, psu = {}) {
  const query = new URLSearchParams({ dateFrom: from, bookingStatus: "both" });
  if (to) query.set("dateTo", to);
  let path = `/accounts/${encodeURIComponent(accountId)}/transactions?${query}`;
  const booked = [];
  for (let page = 0; page < 20 && path; page += 1) {
    let response;
    try {
      response = await aisGet(config, token, consentId, path, psu);
    } catch (error) {
      if (page === 0 && String(error.message).includes("400")) {
        query.delete("bookingStatus");
        path = `/accounts/${encodeURIComponent(accountId)}/transactions?${query}`;
        continue;
      }
      throw error;
    }
    const list = response.transactions?.booked || response.transactions?.pending || [];
    booked.push(...list);
    const next = response.transactions?._links?.next?.href || response._links?.next?.href;
    path = next ? nextUrl(config, next) : null;
  }
  return booked;
}

async function aisGet(config, token, consentId, pathOrUrl, psu) {
  const target = pathOrUrl.startsWith("http") ? pathOrUrl : `${config.apiBase}${pathOrUrl}`;
  const response = await request(config, "GET", target, {
    headers: psuHeaders(token, psu, { "Consent-ID": consentId }),
  });
  if (response.status >= 400) throw apiError("Error al leer datos de BBVA", response);
  return response.json || {};
}

function nextUrl(config, href) {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/v1")) {
    const root = config.apiBase.replace(/\/v1\.1$/, "");
    return `${root}${href}`;
  }
  return `${config.apiBase}${href.startsWith("/") ? "" : "/"}${href}`;
}

function normalizeAccount(account) {
  const balances = account.balances || [];
  const preferred =
    balances.find((item) => item.balanceType === "interimAvailable") ||
    balances.find((item) => item.balanceType === "closingBooked") ||
    balances[0];
  return {
    id: account.resourceId,
    name: account.name || account.product || account.displayName || "Cuenta BBVA",
    iban: account.iban,
    currency: account.currency || preferred?.balanceAmount?.currency || "EUR",
    product: account.product || "",
    balance: Number(preferred?.balanceAmount?.amount || 0),
  };
}

function psuHeaders(token, psu, extra) {
  return {
    Authorization: `Bearer ${token}`,
    "PSU-IP-Address": psu.ip || "127.0.0.1",
    "PSU-IP-Port": String(psu.port || 443),
    "PSU-Accept": "application/json",
    "PSU-Accept-Language": "es-ES",
    "PSU-Http-Method": "GET",
    ...(psu.userAgent ? { "PSU-User-Agent": psu.userAgent } : {}),
    ...extra,
  };
}

function header(response, name) {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function apiError(message, response) {
  const detail =
    response.json?.tppMessages?.[0]?.text ||
    response.json?.error_description ||
    response.json?.error ||
    response.raw?.slice(0, 280) ||
    `HTTP ${response.status}`;
  const error = new Error(`${message} (${response.status}): ${detail}`);
  error.status = response.status;
  return error;
}

module.exports = {
  loadConfig,
  isConfigured,
  pkcePair,
  authorizeUrl,
  exchangeCode,
  refreshToken,
  createConsent,
  consentStatus,
  fetchAccounts,
  fetchTransactions,
};
