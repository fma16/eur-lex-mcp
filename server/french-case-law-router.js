import { errorResponse, successResponse } from "./responses.js";
import {
  buildJudilibreDecisionArgs,
  buildJudilibreSearchArgs,
  buildJudilibreTaxonomyArgs,
  normalizeJudilibreDecision,
  normalizeJudilibreSearchResponse
} from "./judilibre-client.js";
import {
  CASE_LAW_FAMILY_TO_FOND,
  LEGIFRANCE_CASE_LAW_FONDS,
  buildLegifranceDecisionArgs,
  buildLegifranceSearchArgs,
  getLegifranceCaseLawTaxonomy,
  normalizeLegifranceDecision,
  normalizeLegifranceSearchResponse,
  resolveLegifranceFond
} from "./legifrance-client.js";

const HEX_OBJECT_ID_REGEX = /^[0-9a-f]{24}$/i;
const LEGIFRANCE_TEXT_ID_REGEX = /^[A-Z]+TEXT[0-9A-Z]+$/;

function normalizeSource(source) {
  const value = String(source || "auto").toLowerCase();
  if (!["auto", "judilibre", "legifrance", "all"].includes(value)) {
    throw new Error("Invalid source: expected one of auto, judilibre, legifrance, all");
  }
  return value;
}

function normalizeFallback(fallback) {
  const value = String(fallback || "when_no_exact_match").toLowerCase();
  if (!["when_empty", "when_no_exact_match", "never"].includes(value)) {
    throw new Error(
      "Invalid fallback: expected one of when_empty, when_no_exact_match, never"
    );
  }
  return value;
}

function normalizeFamily(caseLawFamily) {
  const value = String(caseLawFamily || "auto").toLowerCase();
  if (value === "auto") return "auto";
  if (!Object.prototype.hasOwnProperty.call(CASE_LAW_FAMILY_TO_FOND, value)) {
    throw new Error(
      "Invalid case_law_family: expected one of auto, judicial, administrative, constitutional, financial, cnil"
    );
  }
  return value;
}

function normalizeFond(fond) {
  if (!fond || String(fond).toLowerCase() === "auto") return "auto";
  const value = String(fond).toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(LEGIFRANCE_CASE_LAW_FONDS, value)) {
    throw new Error("Invalid fond: expected one of auto, JURI, CETAT, CONSTIT, JUFI, CNIL");
  }
  return value;
}

function inferFamilyFromText(args) {
  const haystack = [
    args.query,
    args.jurisdiction,
    args.chamber,
    args.location,
    args.title
  ]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(conseil constitutionnel|constitutionnel|qpc)/i.test(haystack)) {
    return "constitutional";
  }
  if (/(cour des comptes|chambre regionale des comptes|chambre régionale des comptes|cdbf|discipline budgetaire|discipline budgétaire)/i.test(haystack)) {
    return "financial";
  }
  if (/(conseil d'etat|conseil d’état|tribunal administratif|cour administrative d'appel|caa\b|cetat)/i.test(haystack)) {
    return "administrative";
  }
  if (/(cnil|deliberation|délibération)/i.test(haystack)) {
    return "cnil";
  }
  return "judicial";
}

function resolveRouting(args) {
  const source = normalizeSource(args.source);
  const fallback = normalizeFallback(args.fallback);
  const fond = normalizeFond(args.fond);
  const explicitFamily = normalizeFamily(args.case_law_family);
  const family = explicitFamily !== "auto"
    ? explicitFamily
    : fond !== "auto"
      ? LEGIFRANCE_CASE_LAW_FONDS[fond].family
      : inferFamilyFromText(args);
  const resolvedFond = fond !== "auto"
    ? fond
    : CASE_LAW_FAMILY_TO_FOND[family] || resolveLegifranceFond({ case_law_family: family });

  return {
    source,
    fallback,
    case_law_family: family,
    fond: resolvedFond
  };
}

function normalizedNumber(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasExactMatch(results, args) {
  const ecli = String(args.ecli || "").toLowerCase();
  const caseNumber = normalizedNumber(args.case_number ?? args.caseNumber ?? args.celex);
  const decisionDate = String(args.decision_date || args.date || args.date_start || "");

  if (!ecli && !caseNumber && !decisionDate) {
    return results.length > 0;
  }

  return results.some((result) => {
    const resultNumbers = [
      result.number,
      ...asArray(result.numbers)
    ].map(normalizedNumber);
    const numberMatches = caseNumber ? resultNumbers.includes(caseNumber) : true;
    const ecliMatches = ecli ? String(result.ecli || "").toLowerCase() === ecli : true;
    const dateMatches = decisionDate ? String(result.decision_date || "").startsWith(decisionDate) : true;
    return numberMatches && ecliMatches && dateMatches;
  });
}

function shouldFallback(attempt, args, fallback) {
  if (fallback === "never") return false;
  if (fallback === "when_empty") return attempt.results.length === 0;
  return attempt.results.length === 0 || !hasExactMatch(attempt.results, args);
}

function convertJudilibreResult(result) {
  return {
    ...result,
    source: "judilibre",
    source_id: result.id,
    case_law_family: "judicial"
  };
}

function withLegifranceSortDefaults(args) {
  const copy = { ...args };
  if (String(copy.sort || "").toLowerCase() === "date") {
    copy.sort = String(copy.order || "").toLowerCase() === "asc" ? "DATE_ASC" : "DATE_DESC";
  }
  if (copy.sort && !String(copy.sort).toUpperCase().startsWith("DATE") && !["PERTINENCE", "DATE_DESC", "DATE_ASC"].includes(String(copy.sort).toUpperCase())) {
    delete copy.sort;
  }
  if (copy.second_sort && !["PERTINENCE", "DATE_DESC", "DATE_ASC", "DATE_DECISION_DESC", "DATE_DECISION_ASC"].includes(String(copy.second_sort).toUpperCase())) {
    delete copy.second_sort;
  }
  return copy;
}

export class FrenchCaseLawRouter {
  constructor({ judilibreClient, legifranceClient, maxPageSize, defaultTimeoutMs }) {
    this.judilibreClient = judilibreClient;
    this.legifranceClient = legifranceClient;
    this.maxPageSize = maxPageSize;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async search(args) {
    const routing = resolveRouting(args);
    const attempts = [];
    let results = [];

    if (routing.source === "judilibre") {
      const attempt = await this.searchJudilibre(args);
      attempts.push(attempt.summary);
      results = attempt.results;
    } else if (routing.source === "legifrance") {
      const attempt = await this.searchLegifrance({ ...args, fond: routing.fond });
      attempts.push(attempt.summary);
      results = attempt.results;
    } else if (routing.source === "all") {
      const judilibreAttempt = await this.searchJudilibre(args);
      const legifranceAttempt = await this.searchLegifrance({ ...args, fond: routing.fond });
      attempts.push(judilibreAttempt.summary, legifranceAttempt.summary);
      results = dedupeResults([...judilibreAttempt.results, ...legifranceAttempt.results]);
    } else if (routing.case_law_family === "judicial") {
      const judilibreAttempt = await this.searchJudilibre(args);
      attempts.push(judilibreAttempt.summary);
      results = judilibreAttempt.results;

      if (shouldFallback(judilibreAttempt, args, routing.fallback)) {
        const legifranceAttempt = await this.searchLegifrance({ ...args, fond: routing.fond });
        attempts.push(legifranceAttempt.summary);
        results = dedupeResults([...results, ...legifranceAttempt.results]);
      }
    } else {
      const legifranceAttempt = await this.searchLegifrance({ ...args, fond: routing.fond });
      attempts.push(legifranceAttempt.summary);
      results = legifranceAttempt.results;
    }

    return successResponse({
      strategy: describeStrategy(routing),
      routing,
      sources_attempted: attempts,
      total: results.length,
      results
    });
  }

  async getDecision(args) {
    const routing = resolveRouting(args);
    const source = resolveDecisionSource(args, routing);
    const attempts = [];

    if (source === "judilibre") {
      try {
        const decision = await this.getJudilibreDecision(args);
        attempts.push({ source: "judilibre", status: "retrieved" });
        return successResponse({
          strategy: "judilibre_decision",
          routing,
          sources_attempted: attempts,
          decision
        });
      } catch (error) {
        attempts.push({
          source: "judilibre",
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
        if (routing.fallback === "never" || !hasDecisionLookupMetadata(args)) {
          throw error;
        }
      }
    }

    const legifranceTarget = await this.resolveLegifranceDecisionTarget(args, routing);
    attempts.push(...legifranceTarget.attempts);
    if (!legifranceTarget.id) {
      return errorResponse("Unable to resolve Legifrance decision id", {
        code: "DECISION_NOT_FOUND",
        sources_attempted: attempts
      });
    }

    const decision = await this.getLegifranceDecision({
      ...args,
      id: legifranceTarget.id,
      fond: legifranceTarget.fond
    });
    attempts.push({
      source: "legifrance",
      fond: legifranceTarget.fond,
      status: "retrieved"
    });

    return successResponse({
      strategy: "legifrance_decision",
      routing: {
        ...routing,
        fond: legifranceTarget.fond,
        case_law_family: LEGIFRANCE_CASE_LAW_FONDS[legifranceTarget.fond].family
      },
      sources_attempted: attempts,
      decision
    });
  }

  async taxonomy(args) {
    const source = normalizeSource(args.source);
    const routing = resolveRouting(args);

    if (source === "judilibre") {
      return successResponse(await this.getJudilibreTaxonomy(args));
    }

    if (source === "all") {
      return successResponse({
        judilibre: await this.getJudilibreTaxonomy(args),
        legifrance: getLegifranceCaseLawTaxonomy({
          fond: routing.fond,
          case_law_family: routing.case_law_family,
          taxonomy_id: args.taxonomy_id
        })
      });
    }

    if (source === "auto" && routing.case_law_family === "judicial" && isJudilibreTaxonomy(args.taxonomy_id)) {
      return successResponse(await this.getJudilibreTaxonomy(args));
    }

    return successResponse({
      source: "legifrance",
      fond: routing.fond,
      case_law_family: routing.case_law_family,
      taxonomy: getLegifranceCaseLawTaxonomy({
        fond: routing.fond,
        case_law_family: routing.case_law_family,
        taxonomy_id: args.taxonomy_id
      })
    });
  }

  async searchJudilibre(args) {
    const judilibreArgs = {
      ...args,
      query: args.query || args.case_number || args.caseNumber || args.ecli
    };
    const { params, timeoutMs } = buildJudilibreSearchArgs(judilibreArgs, {
      maxPageSize: this.maxPageSize,
      defaultTimeoutMs: this.defaultTimeoutMs
    });
    const data = await this.judilibreClient.search({ params, timeoutMs });
    const normalized = normalizeJudilibreSearchResponse(data);
    const results = (normalized.results || []).map(convertJudilibreResult);

    return {
      summary: {
        source: "judilibre",
        status: "searched",
        total: Number(normalized.total || results.length)
      },
      results
    };
  }

  async searchLegifrance(args) {
    const { fond, family, body, timeoutMs } = buildLegifranceSearchArgs(
      withLegifranceSortDefaults(args),
      {
        maxPageSize: this.maxPageSize,
        defaultTimeoutMs: this.defaultTimeoutMs
      }
    );
    const data = await this.legifranceClient.search({ body, timeoutMs });
    const normalized = normalizeLegifranceSearchResponse(data, { fond });

    return {
      summary: {
        source: "legifrance",
        fond,
        case_law_family: family,
        status: "searched",
        total: Number(normalized.total || normalized.results?.length || 0)
      },
      results: normalized.results || []
    };
  }

  async getJudilibreDecision(args) {
    const { params, textScope, timeoutMs } = buildJudilibreDecisionArgs(args, {
      defaultTimeoutMs: this.defaultTimeoutMs
    });
    const data = await this.judilibreClient.decision({ params, timeoutMs });
    const decision = data?.result ?? data;
    return {
      ...normalizeJudilibreDecision(decision, { textScope }),
      source: "judilibre",
      source_id: decision?.id || params.id,
      case_law_family: "judicial"
    };
  }

  async getLegifranceDecision(args) {
    const { fond, endpoint, body, timeoutMs } = buildLegifranceDecisionArgs(args, {
      defaultTimeoutMs: this.defaultTimeoutMs
    });
    const data = await this.legifranceClient.consult({ endpoint, body, timeoutMs });
    return normalizeLegifranceDecision(data, {
      fond,
      textScope: args.text_scope || "full_text"
    });
  }

  async resolveLegifranceDecisionTarget(args, routing) {
    if (args.id && LEGIFRANCE_TEXT_ID_REGEX.test(String(args.id))) {
      return {
        id: args.id,
        fond: routing.fond,
        attempts: []
      };
    }

    if (!hasDecisionLookupMetadata(args)) {
      return {
        id: args.id && LEGIFRANCE_TEXT_ID_REGEX.test(String(args.id)) ? args.id : null,
        fond: routing.fond,
        attempts: []
      };
    }

    const searchArgs = {
      ...args,
      source: "legifrance",
      fond: routing.fond,
      date_start: args.decision_date || args.date_start,
      date_end: args.decision_date || args.date_end,
      page: 0,
      page_size: 5
    };
    const attempt = await this.searchLegifrance(searchArgs);
    const exact = attempt.results.find((result) => hasExactMatch([result], searchArgs));
    return {
      id: (exact || attempt.results[0])?.source_id || null,
      fond: (exact || attempt.results[0])?.fond || routing.fond,
      attempts: [attempt.summary]
    };
  }

  async getJudilibreTaxonomy(args) {
    const { params, timeoutMs } = buildJudilibreTaxonomyArgs(args, {
      defaultTimeoutMs: this.defaultTimeoutMs
    });
    const data = await this.judilibreClient.taxonomy({ params, timeoutMs });
    return {
      source: "judilibre",
      taxonomy_params: params,
      taxonomy: data?.result ?? data
    };
  }
}

function resolveDecisionSource(args, routing) {
  const explicit = normalizeSource(args.source);
  if (explicit === "judilibre" || explicit === "legifrance") return explicit;
  if (args.id && HEX_OBJECT_ID_REGEX.test(String(args.id))) return "judilibre";
  if (args.id && LEGIFRANCE_TEXT_ID_REGEX.test(String(args.id))) return "legifrance";
  if (routing.case_law_family !== "judicial") return "legifrance";
  if (routing.source === "legifrance") return "legifrance";
  return "judilibre";
}

function hasDecisionLookupMetadata(args) {
  return Boolean(args.case_number || args.caseNumber || args.decision_date || args.date || args.ecli || args.nor);
}

function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results) {
    const key = result.ecli || `${result.source}:${result.source_id}` || `${result.fond}:${result.number}:${result.decision_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function describeStrategy(routing) {
  if (routing.source === "all") return "all_sources";
  if (routing.source === "judilibre") return "judilibre_only";
  if (routing.source === "legifrance") return "legifrance_only";
  if (routing.case_law_family === "judicial") return "judilibre_first_fallback_legifrance";
  return `legifrance_${routing.fond.toLowerCase()}`;
}

function isJudilibreTaxonomy(taxonomyId) {
  return [
    undefined,
    null,
    "",
    "jurisdiction",
    "chamber",
    "location",
    "theme",
    "solution",
    "type",
    "publication",
    "field",
    "zones",
    "filetype"
  ].includes(taxonomyId);
}
