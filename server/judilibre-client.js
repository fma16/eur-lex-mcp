import {
  parseBoolean,
  parsePageSize,
  parseTimeoutMs,
  sanitizeString
} from "./validation.js";

export const JUDILIBRE_SANDBOX_TOKEN_URL =
  "https://sandbox-oauth.piste.gouv.fr/api/oauth/token";
export const JUDILIBRE_SANDBOX_API_URL =
  "https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0";
export const JUDILIBRE_MAX_PAGE_SIZE = 50;

const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const MAX_JUDILIBRE_PAGE = 9999;
const DATE_OR_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/;
const JUDILIBRE_SEARCH_LIST_FIELDS = [
  "field",
  "type",
  "theme",
  "chamber",
  "jurisdiction",
  "location",
  "publication",
  "solution"
];
const DECISION_TEXT_SCOPES = new Set([
  "metadata",
  "full_text",
  "zones",
  "introduction",
  "expose",
  "moyens",
  "motivations",
  "dispositif",
  "annexes"
]);

function toInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.trunc(parsed);
}

function parseZeroBasedPage(page) {
  const value = toInteger(page, 0);
  if (!Number.isFinite(value) || value < 0 || value > MAX_JUDILIBRE_PAGE) {
    throw new Error(`Invalid page: expected integer 0-${MAX_JUDILIBRE_PAGE}`);
  }
  return value;
}

function parseEnum(value, field, allowedValues, fallback) {
  const candidate = value === undefined || value === null || value === "" ? fallback : value;
  const parsed = sanitizeString(String(candidate), field, 32).toLowerCase();
  if (!allowedValues.includes(parsed)) {
    throw new Error(`Invalid ${field}: expected one of ${allowedValues.join(", ")}`);
  }
  return parsed;
}

function parseOptionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = sanitizeString(String(value), field, 64);
  if (!DATE_OR_DATETIME_REGEX.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`Invalid ${field}: expected ISO date or datetime`);
  }
  return parsed;
}

function parseStringList(value, field, maxItems = 20) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maxItems) {
    throw new Error(`Invalid ${field}: exceeds maximum item count of ${maxItems}`);
  }
  return values.map((item) => sanitizeString(String(item), field, 128));
}

function addParam(searchParams, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && item !== null && item !== "") {
        searchParams.append(key, String(item));
      }
    }
    return;
  }
  searchParams.set(key, String(value));
}

function parseOptionalString(value, field, maxLength = 2000) {
  if (value === undefined || value === null || value === "") return null;
  return sanitizeString(String(value), field, maxLength);
}

function parseJudilibreBoolean(value, fallback) {
  const parsed = parseBoolean(value, fallback);
  return parsed === true;
}

function truncateText(value, maxLength = 1200) {
  if (typeof value !== "string") return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => {
      if (entryValue === undefined || entryValue === null || entryValue === "") return false;
      if (Array.isArray(entryValue) && entryValue.length === 0) return false;
      return true;
    })
  );
}

function normalizeHighlights(highlights) {
  if (!highlights || typeof highlights !== "object") return {};
  const normalized = {};
  for (const [field, snippets] of Object.entries(highlights)) {
    const values = Array.isArray(snippets) ? snippets : [snippets];
    normalized[field] = values
      .filter((snippet) => typeof snippet === "string" && snippet.trim())
      .slice(0, 5)
      .map((snippet) => truncateText(snippet.trim(), 500));
  }
  return compactObject(normalized);
}

function normalizeDecisionSummary(decision) {
  if (!decision || typeof decision !== "object") return null;
  return compactObject({
    id: decision.id,
    jurisdiction: decision.jurisdiction,
    chamber: decision.chamber,
    formation: decision.formation,
    number: decision.number,
    numbers: decision.numbers,
    ecli: decision.ecli,
    type: decision.type,
    solution: decision.solution,
    publication: decision.publication,
    decision_date: decision.decision_date,
    update_date: decision.update_date,
    themes: decision.themes,
    summary: truncateText(decision.summary, 1200),
    score: decision.score,
    highlights: normalizeHighlights(decision.highlights)
  });
}

function extractZoneFragments(text, zones, zoneName) {
  const fragments = zones?.[zoneName];
  if (typeof text !== "string" || !Array.isArray(fragments)) return [];

  return fragments
    .filter((fragment) => Number.isInteger(fragment?.start) && Number.isInteger(fragment?.end))
    .sort((a, b) => a.start - b.start)
    .map((fragment) => ({
      zone: zoneName,
      start: fragment.start,
      end: fragment.end,
      text: text.slice(fragment.start, fragment.end).trim()
    }))
    .filter((fragment) => fragment.text);
}

export function buildJudilibreSearchArgs(args, { maxPageSize, defaultTimeoutMs }) {
  const query = parseOptionalString(args.query, "query", 1000);
  const operator = parseEnum(args.operator, "operator", ["or", "and", "exact"], "and");
  const sort = parseEnum(args.sort, "sort", ["score", "scorepub", "date"], "scorepub");
  const order = parseEnum(args.order, "order", ["asc", "desc"], "desc");
  const page = parseZeroBasedPage(args.page);
  const pageSize = parsePageSize(
    args.page_size,
    Math.min(maxPageSize, JUDILIBRE_MAX_PAGE_SIZE)
  );
  const timeoutMs = parseTimeoutMs(args.timeout_ms, defaultTimeoutMs);
  const resolveReferences = parseJudilibreBoolean(args.resolve_references, true);
  const particularInterest = parseJudilibreBoolean(args.particular_interest, false);
  const dateStart = parseOptionalDate(args.date_start, "date_start");
  const dateEnd = parseOptionalDate(args.date_end, "date_end");

  const params = compactObject({
    query,
    operator,
    sort,
    order,
    page,
    page_size: pageSize,
    resolve_references: resolveReferences ? "true" : "false",
    particularInterest: particularInterest ? "true" : "false",
    date_start: dateStart,
    date_end: dateEnd
  });

  for (const field of JUDILIBRE_SEARCH_LIST_FIELDS) {
    const values = parseStringList(args[field], field);
    if (values.length > 0) {
      params[field] = values;
    }
  }

  return {
    params,
    timeoutMs
  };
}

export function buildJudilibreDecisionArgs(args, { defaultTimeoutMs }) {
  const id = sanitizeString(args.id, "id", 128);
  const textScope = parseEnum(
    args.text_scope,
    "text_scope",
    [...DECISION_TEXT_SCOPES],
    "full_text"
  );
  const query = parseOptionalString(args.query, "query", 1000);
  const operator = parseEnum(args.operator, "operator", ["or", "and", "exact"], "and");
  const resolveReferences = parseJudilibreBoolean(args.resolve_references, true);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, defaultTimeoutMs);

  return {
    params: compactObject({
      id,
      resolve_references: resolveReferences ? "true" : "false",
      query,
      operator: query ? operator : null
    }),
    textScope,
    timeoutMs
  };
}

export function buildJudilibreTaxonomyArgs(args, { defaultTimeoutMs }) {
  const taxonomyId = parseOptionalString(args.taxonomy_id, "taxonomy_id", 64);
  const key = parseOptionalString(args.key, "key", 128);
  const value = parseOptionalString(args.value, "value", 256);
  const contextValue = parseOptionalString(args.context_value, "context_value", 128);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, defaultTimeoutMs);

  if (key && value) {
    throw new Error("Invalid taxonomy lookup: key and value are mutually exclusive");
  }
  if ((key || value) && !taxonomyId) {
    throw new Error("Invalid taxonomy lookup: taxonomy_id is required with key or value");
  }

  return {
    params: compactObject({
      id: taxonomyId,
      key,
      value,
      context_value: contextValue
    }),
    timeoutMs
  };
}

export function buildJudilibreUrl(baseUrl, endpoint, params = {}) {
  const url = new URL(`${baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    addParam(url.searchParams, key, value);
  }
  return url;
}

export function normalizeJudilibreSearchResponse(response) {
  const results = Array.isArray(response?.results)
    ? response.results.map(normalizeDecisionSummary).filter(Boolean)
    : [];

  return compactObject({
    total: response?.total,
    page: response?.page,
    page_size: response?.page_size,
    took: response?.took,
    next_page: response?.next_page,
    previous_page: response?.previous_page,
    relaxed: response?.relaxed,
    query: response?.query,
    results
  });
}

export function normalizeJudilibreDecision(decision, { textScope }) {
  const summary = normalizeDecisionSummary(decision) || {};
  const text = typeof decision?.text === "string" ? decision.text : "";
  const zones = decision?.zones && typeof decision.zones === "object" ? decision.zones : {};

  const normalized = compactObject({
    ...summary,
    nac: decision?.nac,
    portalis: decision?.portalis,
    publication_number: decision?.publication_number,
    jurisdiction_name: decision?.jurisdiction_name,
    chamber_name: decision?.chamber_name,
    formation_name: decision?.formation_name,
    solution_name: decision?.solution_name,
    type_name: decision?.type_name,
    titles: decision?.titles,
    sommaire: decision?.sommaire,
    files: decision?.files,
    contested: decision?.contested,
    rapprochements: decision?.rapprochements,
    visa: decision?.visa,
    texts: decision?.texts,
    available_zones: Object.keys(zones),
    text_scope: textScope
  });

  if (textScope === "metadata") {
    return normalized;
  }

  if (textScope === "full_text") {
    return {
      ...normalized,
      text,
      zones
    };
  }

  if (textScope === "zones") {
    const sections = Object.keys(zones)
      .flatMap((zoneName) => extractZoneFragments(text, zones, zoneName))
      .sort((a, b) => a.start - b.start);
    return {
      ...normalized,
      sections
    };
  }

  return {
    ...normalized,
    zone: textScope,
    fragments: extractZoneFragments(text, zones, textScope)
  };
}

export class JudilibreClient {
  constructor({
    apiKey,
    clientId,
    clientSecret,
    apiUrl = JUDILIBRE_SANDBOX_API_URL,
    tokenUrl = JUDILIBRE_SANDBOX_TOKEN_URL,
    fetchImpl = fetch,
    logger
  }) {
    this.apiKey = apiKey;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.apiUrl = apiUrl;
    this.tokenUrl = tokenUrl;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.accessToken = null;
    this.tokenExpiresAt = 0;

    if (!this.apiKey && (!this.clientId || !this.clientSecret)) {
      throw new Error(
        "Missing Judilibre authentication: provide PISTE_SANDBOX_API_KEY or both PISTE_SANDBOX_CLIENT_ID and PISTE_SANDBOX_CLIENT_SECRET"
      );
    }
  }

  async getAccessToken(timeoutMs) {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const tokenData = await this.requestToken(timeoutMs);
    this.accessToken = sanitizeString(tokenData.access_token, "access_token", 8000);
    const expiresInSeconds = Number(tokenData.expires_in || 3600);
    const expiresInMs = Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 3600_000;
    this.tokenExpiresAt = Date.now() + Math.max(0, expiresInMs - TOKEN_EXPIRY_SAFETY_MS);
    return this.accessToken;
  }

  async requestToken(timeoutMs) {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("scope", "openid");

    this.logger?.debug("Requesting Judilibre sandbox OAuth token", {
      tokenUrl: this.tokenUrl
    });

    const response = await fetchJsonWithTimeout(
      this.fetchImpl,
      this.tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      },
      timeoutMs,
      "Judilibre token request"
    );

    if (!response.access_token) {
      throw new Error("Judilibre token response did not include access_token");
    }
    return response;
  }

  async get(endpoint, { params, timeoutMs, retryOnUnauthorized = true }) {
    const headers = await this.getAuthHeaders(timeoutMs);
    const url = buildJudilibreUrl(this.apiUrl, endpoint, params);

    this.logger?.debug("Dispatching Judilibre API request", {
      endpoint,
      page: params?.page,
      pageSize: params?.page_size
    });

    try {
      return await fetchJsonWithTimeout(
        this.fetchImpl,
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...headers
          }
        },
        timeoutMs,
        "Judilibre API request"
      );
    } catch (error) {
      if (retryOnUnauthorized && /HTTP 401/.test(error?.message || "")) {
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        return this.get(endpoint, { params, timeoutMs, retryOnUnauthorized: false });
      }
      throw error;
    }
  }

  async search({ params, timeoutMs }) {
    return this.get("/search", { params, timeoutMs });
  }

  async decision({ params, timeoutMs }) {
    return this.get("/decision", { params, timeoutMs });
  }

  async taxonomy({ params, timeoutMs }) {
    return this.get("/taxonomy", { params, timeoutMs });
  }

  async getAuthHeaders(timeoutMs) {
    if (this.apiKey) {
      return {
        KeyId: this.apiKey
      };
    }

    const token = await this.getAccessToken(timeoutMs);
    return {
      Authorization: `Bearer ${token}`
    };
  }
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(formatJudilibreHttpError(response.status, text, label));
    }

    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`${label} returned invalid JSON`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatJudilibreHttpError(status, body, label) {
  const details = parseJudilibreErrorBody(body);
  return `${label} failed with HTTP ${status}${details ? `: ${details}` : ""}`;
}

function parseJudilibreErrorBody(body) {
  if (!body || !body.trim()) return "";
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed?.errors)) {
      return parsed.errors
        .map((error) => error?.msg || error?.message)
        .filter(Boolean)
        .join("; ");
    }
    return parsed.error_description || parsed.error || parsed.message || "";
  } catch {
    return truncateText(body.trim(), 500);
  }
}
