import {
  parseBoolean,
  parsePageSize,
  parseTimeoutMs,
  sanitizeString
} from "./validation.js";

export const LEGIFRANCE_SANDBOX_TOKEN_URL =
  "https://sandbox-oauth.piste.gouv.fr/api/oauth/token";
export const LEGIFRANCE_SANDBOX_API_URL =
  "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app";
export const LEGIFRANCE_MAX_PAGE_SIZE = 100;

const TOKEN_EXPIRY_SAFETY_MS = 60_000;
const MAX_LEGIFRANCE_PAGE = 9999;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const LEGIFRANCE_CASE_LAW_FONDS = {
  JURI: {
    fond: "JURI",
    family: "judicial",
    label: "Jurisprudence judiciaire",
    consultEndpoint: "/consult/juri",
    consultIdParam: "textId",
    searchFields: {
      all: "ALL",
      title: "TITLE",
      abstrats: "ABSTRATS",
      case_number: "NUM_AFFAIRE",
      text: "TEXTE",
      resumes: "RESUMES"
    },
    filters: {
      jurisdiction: "JURIDICTION_JUDICIAIRE",
      publication: "CASSATION_TYPE_PUBLICATION_BULLETIN",
      bulletin_number: "NUM_BULLETIN",
      bulletin_year: "ANNEE_BULLETIN",
      decision_type: "CASSATION_NATURE_DECISION",
      formation: "CASSATION_FORMATION",
      attacked_decision: "CASSATION_DECISION_ATTAQUEE",
      attacked_location: "LIEU_DECISION",
      attacked_date: "DATE_DECISION_ATTAQUEE",
      appeal_seat: "APPEL_SIEGE_APPEL",
      first_instance_type: "PREMIER_DEGRE_TYPE_JURIDICTION",
      first_instance_seat: "PREMIER_DEGRE_SIEGE",
      decision_date: "DATE_DECISION",
      case_number: "NUM_AFFAIRE",
      ecli: "ECLI"
    },
    sorts: ["PERTINENCE", "DATE_DESC", "DATE_ASC"]
  },
  CETAT: {
    fond: "CETAT",
    family: "administrative",
    label: "Jurisprudence administrative",
    consultEndpoint: "/consult/juri",
    consultIdParam: "textId",
    searchFields: {
      all: "ALL",
      title: "TITLE",
      case_number: "NUM_DEC",
      abstrats: "ABSTRATS",
      text: "TEXTE",
      resumes: "RESUMES"
    },
    filters: {
      jurisdiction: "JURIDICTION_NATURE",
      decision_date: "DATE_DECISION",
      ingestion_date: "DATE_VERSEMENT",
      publication: "PUBLICATION_RECUEIL",
      case_number: "NUMERO_DECISION",
      ecli: "ECLI"
    },
    sorts: ["PERTINENCE", "DATE_DESC", "DATE_ASC"]
  },
  CONSTIT: {
    fond: "CONSTIT",
    family: "constitutional",
    label: "Jurisprudence constitutionnelle",
    consultEndpoint: "/consult/juri",
    consultIdParam: "textId",
    searchFields: {
      all: "ALL",
      title: "TITLE",
      case_number: "NUM_DEC",
      text: "TEXTE"
    },
    filters: {
      norm_control_type: "NATURE_CONSTIT",
      other_norm_type: "NATURE_NORME_AUTRE",
      norm_solution: "SOLUTION_CONSTIT",
      referred_law_title: "TITRE_DEFEREE",
      referred_law_number: "NUM_LOI",
      referred_law_date: "DATE_LOI",
      electoral_decision_type: "TYPE_DECISION",
      electoral_solution: "SOLUTION_ELECT",
      other_decision_type: "NATURE_AUTRE",
      other_solution: "SOLUTION_AUTRE",
      decision_date: "DATE_DECISION",
      case_number: "NUMERO_DECISION",
      nor: "NOR"
    },
    sorts: ["PERTINENCE", "DATE_DESC", "DATE_ASC"]
  },
  JUFI: {
    fond: "JUFI",
    family: "financial",
    label: "Jurisprudence financiere",
    consultEndpoint: "/consult/juri",
    consultIdParam: "textId",
    searchFields: {
      all: "ALL",
      title: "TITLE",
      case_number: "NUM_DEC",
      abstrats: "ABSTRATS",
      text: "TEXTE"
    },
    filters: {
      publication: "PUBLICATION_RECUEIL",
      jurisdiction: "JURIDICTION_NATURE",
      decision_date: "DATE_DECISION",
      case_number: "NUMERO_DECISION"
    },
    sorts: ["PERTINENCE", "DATE_DESC", "DATE_ASC"]
  },
  CNIL: {
    fond: "CNIL",
    family: "cnil",
    label: "Decisions CNIL",
    consultEndpoint: "/consult/cnil",
    consultIdParam: "textId",
    searchFields: {
      all: "ALL",
      title: "TITLE",
      nor: "NOR",
      text: "TEXTE",
      case_number: "NUM_DELIB"
    },
    filters: {
      type: "TYPE",
      deliberation_type: "NATURE_DELIB",
      decision_date: "DATE_DELIB",
      case_number: "NUMERO_DELIB",
      nor: "NOR"
    },
    sorts: ["PERTINENCE", "DATE_DECISION_DESC", "DATE_DECISION_ASC"]
  }
};

export const CASE_LAW_FAMILY_TO_FOND = {
  judicial: "JURI",
  administrative: "CETAT",
  constitutional: "CONSTIT",
  financial: "JUFI",
  cnil: "CNIL"
};

function toInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.trunc(parsed);
}

function parseEnum(value, field, allowedValues, fallback) {
  const candidate = value === undefined || value === null || value === "" ? fallback : value;
  const parsed = sanitizeString(String(candidate), field, 64);
  const normalized = parsed.toUpperCase();
  const match = allowedValues.find((allowed) => allowed.toUpperCase() === normalized);
  if (!match) {
    throw new Error(`Invalid ${field}: expected one of ${allowedValues.join(", ")}`);
  }
  return match;
}

function parseLowerEnum(value, field, allowedValues, fallback) {
  const candidate = value === undefined || value === null || value === "" ? fallback : value;
  const parsed = sanitizeString(String(candidate), field, 64).toLowerCase();
  if (!allowedValues.includes(parsed)) {
    throw new Error(`Invalid ${field}: expected one of ${allowedValues.join(", ")}`);
  }
  return parsed;
}

function parseLegifranceSort(value, allowedValues, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toUpperCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function parseLegifrancePage(page) {
  const value = toInteger(page, 0);
  if (!Number.isFinite(value) || value < 0 || value > MAX_LEGIFRANCE_PAGE) {
    throw new Error(`Invalid page: expected integer 0-${MAX_LEGIFRANCE_PAGE}`);
  }
  return value;
}

function parseOptionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = sanitizeString(String(value), field, 32);
  if (!DATE_REGEX.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`Invalid ${field}: expected ISO date YYYY-MM-DD`);
  }
  return parsed;
}

function parseOptionalString(value, field, maxLength = 2000) {
  if (value === undefined || value === null || value === "") return null;
  return sanitizeString(String(value), field, maxLength);
}

function parseStringList(value, field, maxItems = 20) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maxItems) {
    throw new Error(`Invalid ${field}: exceeds maximum item count of ${maxItems}`);
  }
  return values.map((item) => sanitizeString(String(item), field, 256));
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

function stripHtml(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value, maxLength = 1200) {
  if (typeof value !== "string") return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstFromPath(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeLegifranceDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const parsed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return parsed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(parsed)) {
    const [day, month, year] = parsed.split("/");
    return `${year}-${month}-${day}`;
  }
  return parsed;
}

function titleFromResult(result) {
  const direct = firstValue(
    result.title,
    result.titre,
    result.libelle,
    result.name,
    result.nom
  );
  if (direct) return stripHtml(String(direct));

  const titles = result.titles || result.titres;
  if (Array.isArray(titles)) {
    const title = titles.find((item) => item?.title || item?.titre || item?.value || item);
    if (title) {
      return stripHtml(String(title.title || title.titre || title.value || title));
    }
  }

  return null;
}

function extractLegifranceSectionValue(result, fieldNames) {
  const sections = Array.isArray(result?.sections) ? result.sections : [];
  const normalizedFieldNames = fieldNames.map((name) => name.toLowerCase());
  for (const section of sections) {
    const extracts = Array.isArray(section?.extracts) ? section.extracts : [];
    for (const extract of extracts) {
      const searchFieldName = String(extract?.searchFieldName || "").toLowerCase();
      if (!normalizedFieldNames.some((fieldName) => searchFieldName.includes(fieldName))) continue;
      const values = Array.isArray(extract?.values) ? extract.values : [];
      const value = values.find((item) => item !== undefined && item !== null && item !== "");
      if (value) return stripHtml(String(value));
    }
  }
  return null;
}

function extractLegifranceResults(response) {
  return (
    response?.results ||
    response?.resultats ||
    response?.items ||
    response?.documents ||
    response?.data?.results ||
    []
  );
}

export function resolveLegifranceFond({ fond, case_law_family: caseLawFamily, court_order: courtOrder } = {}) {
  if (fond && String(fond).toLowerCase() !== "auto") {
    return parseEnum(fond, "fond", Object.keys(LEGIFRANCE_CASE_LAW_FONDS), "JURI");
  }

  const family = caseLawFamily && String(caseLawFamily).toLowerCase() !== "auto"
    ? parseLowerEnum(
        caseLawFamily,
        "case_law_family",
        Object.keys(CASE_LAW_FAMILY_TO_FOND),
        "judicial"
      )
    : null;
  if (family) return CASE_LAW_FAMILY_TO_FOND[family];

  if (courtOrder && String(courtOrder).toLowerCase() === "administrative") {
    return "CETAT";
  }

  return "JURI";
}

function buildSearchCriterion(typeChamp, value, typeRecherche = "UN_DES_MOTS") {
  return {
    typeChamp,
    criteres: [
      {
        typeRecherche,
        valeur: value,
        operateur: "ET",
        proximite: 2
      }
    ],
    operateur: "ET"
  };
}

function buildValueFilter(facette, values) {
  return {
    facette,
    valeurs: values
  };
}

function buildDateFilter(facette, start, end) {
  return {
    facette,
    dates: compactObject({
      start,
      end
    })
  };
}

export function buildLegifranceSearchArgs(args, { maxPageSize, defaultTimeoutMs }) {
  const fond = resolveLegifranceFond(args);
  const config = LEGIFRANCE_CASE_LAW_FONDS[fond];
  const query = parseOptionalString(args.query, "query", 1000);
  const caseNumber = parseOptionalString(args.case_number ?? args.caseNumber, "case_number", 128);
  const ecli = parseOptionalString(args.ecli, "ecli", 128);
  const nor = parseOptionalString(args.nor, "nor", 128);
  const page = parseLegifrancePage(args.page);
  const pageSize = parsePageSize(
    args.page_size,
    Math.min(maxPageSize, LEGIFRANCE_MAX_PAGE_SIZE)
  );
  const timeoutMs = parseTimeoutMs(args.timeout_ms, defaultTimeoutMs);
  const dateStart = parseOptionalDate(args.date_start, "date_start");
  const dateEnd = parseOptionalDate(args.date_end, "date_end");
  const sort = parseLegifranceSort(args.sort, config.sorts, config.sorts[0]);
  const secondSort = parseLegifranceSort(
    args.second_sort,
    config.sorts,
    config.sorts.includes("DATE_DESC") ? "DATE_DESC" : config.sorts[0]
  );

  const champs = [];
  if (caseNumber) {
    champs.push(buildSearchCriterion(config.searchFields.case_number, caseNumber, "EXACTE"));
  }
  if (nor && config.searchFields.nor) {
    champs.push(buildSearchCriterion(config.searchFields.nor, nor, "EXACTE"));
  }
  if (query) {
    champs.push(buildSearchCriterion(config.searchFields.all, query, args.operator === "exact" ? "EXACTE" : "UN_DES_MOTS"));
  }
  if (champs.length === 0) {
    champs.push(buildSearchCriterion(config.searchFields.all, "*", "UN_DES_MOTS"));
  }

  const filtres = [];
  if (dateStart || dateEnd) {
    filtres.push(buildDateFilter(config.filters.decision_date, dateStart, dateEnd));
  }
  if (ecli && config.filters.ecli) {
    filtres.push(buildValueFilter(config.filters.ecli, [ecli]));
  }
  if (nor && config.filters.nor) {
    filtres.push(buildValueFilter(config.filters.nor, [nor]));
  }
  for (const [inputName, filterName] of [
    ["jurisdiction", "jurisdiction"],
    ["publication", "publication"],
    ["solution", "solution"],
    ["type", "type"]
  ]) {
    const values = parseStringList(args[inputName], inputName);
    const facette = config.filters[filterName];
    if (values.length > 0 && facette) {
      filtres.push(buildValueFilter(facette, values));
    }
  }

  return {
    fond,
    family: config.family,
    body: {
      fond,
      recherche: compactObject({
        champs,
        filtres,
        fromAdvancedRecherche: parseBoolean(args.from_advanced_search, false),
        pageNumber: page + 1,
        pageSize,
        operateur: "ET",
        typePagination: "DEFAUT",
        sort,
        secondSort
      })
    },
    timeoutMs
  };
}

export function buildLegifranceDecisionArgs(args, { defaultTimeoutMs }) {
  const fond = resolveLegifranceFond(args);
  const config = LEGIFRANCE_CASE_LAW_FONDS[fond];
  const id = sanitizeString(args.id, "id", 128);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, defaultTimeoutMs);
  const searchedString = parseOptionalString(args.query ?? args.searched_string, "searched_string", 1000);

  return {
    fond,
    family: config.family,
    endpoint: config.consultEndpoint,
    body: compactObject({
      [config.consultIdParam]: id,
      searchedString
    }),
    timeoutMs
  };
}

export function normalizeLegifranceSearchResponse(response, { fond }) {
  const config = LEGIFRANCE_CASE_LAW_FONDS[fond] || LEGIFRANCE_CASE_LAW_FONDS.JURI;
  const rawResults = extractLegifranceResults(response);
  const results = Array.isArray(rawResults)
    ? rawResults.map((item) => normalizeLegifranceSearchResult(item, { fond })).filter(Boolean)
    : [];

  return compactObject({
    total: firstValue(response?.total, response?.totalResultNumber, response?.totalResults, results.length),
    page: firstValue(response?.pageNumber, response?.page, null),
    page_size: firstValue(response?.pageSize, response?.page_size, null),
    fond,
    case_law_family: config.family,
    results
  });
}

export function normalizeLegifranceSearchResult(result, { fond }) {
  if (!result || typeof result !== "object") return null;
  const config = LEGIFRANCE_CASE_LAW_FONDS[fond] || LEGIFRANCE_CASE_LAW_FONDS.JURI;
  const sourceId = firstValue(
    result.id,
    result.textId,
    result.cid,
    result.textCid,
    result.juriTextId,
    firstFromPath(result, [
      "titles.0.id",
      "titles.0.cid",
      "titres.0.id",
      "titres.0.cid",
      "text.id",
      "texte.id",
      "document.id"
    ])
  );
  if (!sourceId && !titleFromResult(result)) return null;

  return compactObject({
    source: "legifrance",
    source_id: sourceId,
    id: sourceId,
    fond,
    case_law_family: config.family,
    title: titleFromResult(result),
    jurisdiction: firstValue(result.jurisdiction, result.juridiction, result.juridictionNature),
    chamber: firstValue(result.chamber, result.formation, result.formationCass),
    decision_date: normalizeLegifranceDate(firstValue(result.dateDecision, result.decision_date, result.date, result.dateTexte)),
    number: firstValue(
      result.numDecision,
      result.numeroDecision,
      result.numAffaire,
      result.numero,
      result.number,
      extractLegifranceSectionValue(result, ["numero decision", "numéro décision", "numero d", "numéro d"])
    ),
    ecli: result.ecli,
    nor: result.nor,
    publication: firstValue(result.publication, result.publiRecueil, result.publicationRecueil),
    summary: truncateText(stripHtml(firstValue(result.resume, result.summary, result.sommaire, result.text)), 1200),
    url: sourceId ? `https://www.legifrance.gouv.fr/juri/id/${sourceId}/` : null
  });
}

export function normalizeLegifranceDecision(response, { fond, textScope = "full_text" }) {
  const config = LEGIFRANCE_CASE_LAW_FONDS[fond] || LEGIFRANCE_CASE_LAW_FONDS.JURI;
  const decision = response?.result || response?.text || response?.texte || response;
  const sourceId = firstValue(
    decision?.id,
    decision?.textId,
    decision?.cid,
    decision?.textCid,
    firstFromPath(decision, ["texte.id", "text.id"])
  );
  const rawText = firstValue(
    decision?.text,
    decision?.texte,
    decision?.content,
    decision?.contenu,
    decision?.html,
    decision?.texteHtml,
    firstFromPath(decision, ["body.text", "body.html"])
  );
  const text = stripHtml(resolveTextValue(rawText));

  const metadata = compactObject({
    source: "legifrance",
    source_id: sourceId,
    id: sourceId,
    fond,
    case_law_family: config.family,
    title: titleFromResult(decision),
    jurisdiction: firstValue(decision?.jurisdiction, decision?.juridiction, decision?.juridictionNature),
    chamber: firstValue(decision?.chamber, decision?.formation, decision?.formationCass),
    decision_date: normalizeLegifranceDate(firstValue(decision?.dateDecision, decision?.decision_date, decision?.date, decision?.dateTexte)),
    number: firstValue(decision?.numDecision, decision?.numeroDecision, decision?.numAffaire, decision?.numero, decision?.number),
    ecli: decision?.ecli,
    nor: decision?.nor,
    publication: firstValue(decision?.publication, decision?.publiRecueil, decision?.publicationRecueil),
    text_scope: textScope,
    url: sourceId ? `https://www.legifrance.gouv.fr/juri/id/${sourceId}/` : null
  });

  if (textScope === "metadata") {
    return metadata;
  }

  return {
    ...metadata,
    text
  };
}

function resolveTextValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return firstValue(value.text, value.texte, value.content, value.contenu, value.html) || "";
}

export function getLegifranceCaseLawTaxonomy({ fond, case_law_family: caseLawFamily, taxonomy_id: taxonomyId } = {}) {
  const resolvedFond = resolveLegifranceFond({ fond, case_law_family: caseLawFamily });
  const config = LEGIFRANCE_CASE_LAW_FONDS[resolvedFond];
  const taxonomy = {
    fond: Object.values(LEGIFRANCE_CASE_LAW_FONDS).map((item) => ({
      key: item.fond,
      value: item.label,
      case_law_family: item.family
    })),
    case_law_family: Object.entries(CASE_LAW_FAMILY_TO_FOND).map(([family, familyFond]) => ({
      key: family,
      value: LEGIFRANCE_CASE_LAW_FONDS[familyFond].label,
      fond: familyFond
    })),
    search_field: Object.entries(config.searchFields).map(([key, value]) => ({ key, value })),
    filter: Object.entries(config.filters).map(([key, value]) => ({ key, value })),
    sort: config.sorts.map((sort) => ({ key: sort, value: sort }))
  };

  if (taxonomyId && taxonomy[taxonomyId]) {
    return taxonomy[taxonomyId];
  }

  return taxonomy;
}

export class LegifranceClient {
  constructor({
    apiKey,
    clientId,
    clientSecret,
    apiUrl = LEGIFRANCE_SANDBOX_API_URL,
    tokenUrl = LEGIFRANCE_SANDBOX_TOKEN_URL,
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
        "Missing Legifrance authentication: provide PISTE_SANDBOX_API_KEY or both PISTE_SANDBOX_CLIENT_ID and PISTE_SANDBOX_CLIENT_SECRET"
      );
    }
  }

  async search({ body, timeoutMs }) {
    return this.post("/search", { body, timeoutMs });
  }

  async consult({ endpoint, body, timeoutMs }) {
    return this.post(endpoint, { body, timeoutMs });
  }

  async post(endpoint, { body, timeoutMs, retryOnUnauthorized = true }) {
    const headers = await this.getAuthHeaders(timeoutMs);
    const url = new URL(`${this.apiUrl}${endpoint}`);

    this.logger?.debug("Dispatching Legifrance API request", {
      endpoint,
      fond: body?.fond
    });

    try {
      return await fetchJsonWithTimeout(
        this.fetchImpl,
        url,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...headers
          },
          body: JSON.stringify(body)
        },
        timeoutMs,
        "Legifrance API request"
      );
    } catch (error) {
      if (retryOnUnauthorized && /HTTP 401/.test(error?.message || "")) {
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        return this.post(endpoint, { body, timeoutMs, retryOnUnauthorized: false });
      }
      throw error;
    }
  }

  async getAuthHeaders(timeoutMs) {
    if (this.clientId && this.clientSecret) {
      const token = await this.getAccessToken(timeoutMs);
      return {
        Authorization: `Bearer ${token}`
      };
    }

    return {
      KeyId: this.apiKey
    };
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
      "Legifrance token request"
    );

    if (!response.access_token) {
      throw new Error("Legifrance token response did not include access_token");
    }
    return response;
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
      throw new Error(
        formatLegifranceHttpError(response.status, text, label, response.headers.get("www-authenticate"))
      );
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

function formatLegifranceHttpError(status, body, label, authenticateHeader) {
  const details = parseLegifranceErrorBody(body) || parseLegifranceAuthenticateHeader(authenticateHeader);
  return `${label} failed with HTTP ${status}${details ? `: ${details}` : ""}`;
}

function parseLegifranceErrorBody(body) {
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

function parseLegifranceAuthenticateHeader(header) {
  if (!header) return "";
  const descriptionMatch = /error_description="([^"]+)"/.exec(header);
  if (descriptionMatch?.[1]) return descriptionMatch[1];
  const errorMatch = /error="([^"]+)"/.exec(header);
  if (errorMatch?.[1]) return errorMatch[1];
  return truncateText(header, 500);
}
