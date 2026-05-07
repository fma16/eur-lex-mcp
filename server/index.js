#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";

import { EurLexSoapClient } from "./eurlex-client.js";
import { createLogger } from "./logger.js";
import {
  extractArticleFromXhtml,
  extractFullTextFromXhtml,
  extractRecitalsFromXhtml,
  extractTocFromXhtml
} from "./legal-text.js";
import {
  parseBoolean,
  parseCelex,
  parsePage,
  parsePageSize,
  parseTimeoutMs,
  sanitizeString,
  parseLanguage
} from "./validation.js";
import { errorResponse, successResponse, toolTextPayload } from "./responses.js";
import { buildCaseLawExpertQuery, parseCaseLawCelex } from "./case-law.js";
import { JudilibreClient } from "./judilibre-client.js";
import { LegifranceClient } from "./legifrance-client.js";
import { FrenchCaseLawRouter } from "./french-case-law-router.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.DEFAULT_TIMEOUT_MS || 15000);
const MAX_PAGE_SIZE = Number(process.env.MAX_PAGE_SIZE || 50);

function parseArgs(argv) {
  const values = {
    logLevel: "info",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    maxPageSize: MAX_PAGE_SIZE
  };

  for (const arg of argv) {
    if (arg.startsWith("--log-level=")) {
      values.logLevel = arg.slice("--log-level=".length);
    } else if (arg.startsWith("--default-timeout-ms=")) {
      values.defaultTimeoutMs = Number(arg.slice("--default-timeout-ms=".length));
    } else if (arg.startsWith("--max-page-size=")) {
      values.maxPageSize = Number(arg.slice("--max-page-size=".length));
    }
  }

  return values;
}

const cli = parseArgs(process.argv.slice(2));
const logger = createLogger(cli.logLevel);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

let eurLexClient;
let judilibreClient;
let legifranceClient;
let frenchCaseLawRouter;
try {
  eurLexClient = new EurLexSoapClient({
    username: requiredEnv("EURLEX_USERNAME"),
    password: requiredEnv("EURLEX_PASSWORD"),
    allowInsecureHttp: parseBoolean(process.env.ALLOW_INSECURE_HTTP, false),
    logger
  });
  judilibreClient = new JudilibreClient({
    apiKey: optionalEnv("PISTE_SANDBOX_API_KEY"),
    clientId: optionalEnv("PISTE_SANDBOX_CLIENT_ID"),
    clientSecret: optionalEnv("PISTE_SANDBOX_CLIENT_SECRET"),
    logger
  });
  legifranceClient = new LegifranceClient({
    apiKey: optionalEnv("PISTE_SANDBOX_API_KEY"),
    clientId: optionalEnv("PISTE_SANDBOX_CLIENT_ID"),
    clientSecret: optionalEnv("PISTE_SANDBOX_CLIENT_SECRET"),
    logger
  });
  frenchCaseLawRouter = new FrenchCaseLawRouter({
    judilibreClient,
    legifranceClient,
    maxPageSize: cli.maxPageSize,
    defaultTimeoutMs: cli.defaultTimeoutMs
  });
} catch (error) {
  logger.error("Server configuration error", { message: error.message });
  process.exit(1);
}

const server = new Server(
  {
    name: "eur-lex-search",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

const tools = [
  {
    name: "expert_search",
    description:
      "Run an EUR-Lex expert query (expert syntax only, e.g. DN = 32016R0679) and return normalized results",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description:
            "EUR-Lex expert query syntax (not natural language), e.g. DN = 32016R0679"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "en"
        },
        page: {
          type: "integer",
          minimum: 1,
          default: 1
        },
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 10
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_document_by_celex",
    description: "Retrieve one EUR-Lex document by CELEX identifier",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        celex: {
          type: "string",
          description: "CELEX identifier, e.g. 32016R0679"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "en"
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      },
      required: ["celex"]
    }
  },
  {
    name: "get_legal_text",
    description:
      "Get legal text for a CELEX document. By default, returns a specific article and excludes recitals. Can also return recitals-only or full text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        celex: {
          type: "string",
          description: "CELEX identifier, e.g. 32022R2065"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "fr"
        },
        scope: {
          type: "string",
          enum: ["article", "recitals", "full_text"],
          default: "article",
          description:
            "Text scope. 'article' excludes recitals and requires the 'article' field."
        },
        article: {
          type: "string",
          description:
            "Article identifier (required when scope='article'), e.g. 5, 8, article 8, premier"
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      },
      required: ["celex"]
    }
  },
  {
    name: "get_document_toc",
    description:
      "Get the structured table of contents (chapters, sections, articles) with numbering and titles for a CELEX document.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        celex: {
          type: "string",
          description: "CELEX identifier, e.g. 32022R2065"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "fr"
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      },
      required: ["celex"]
    }
  },
  {
    name: "search_eu_case_law",
    description:
      "Search EUR-Lex EU case-law only (CELEX sector 6). Supports simple text/title/year filters and optional expert query fragments.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "Optional full-text words or phrase to search within EU case-law"
        },
        title: {
          type: "string",
          description: "Optional title words or phrase to search within EU case-law"
        },
        year: {
          type: "integer",
          minimum: 1950,
          maximum: 9999,
          description: "Optional CELEX year filter, e.g. 2024"
        },
        celex: {
          type: "string",
          description:
            "Optional exact case-law CELEX identifier. If provided, other filters are ignored."
        },
        expert_query: {
          type: "string",
          description:
            "Optional EUR-Lex expert query fragment ANDed with the case-law sector filter, e.g. DD >= 01/01/2020"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "en"
        },
        page: {
          type: "integer",
          minimum: 1,
          default: 1
        },
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 10
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      }
    }
  },
  {
    name: "get_case_law_by_celex",
    description: "Retrieve one EUR-Lex EU case-law document by exact CELEX sector-6 identifier",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        celex: {
          type: "string",
          description: "EU case-law CELEX identifier, e.g. 62019CJ0311"
        },
        language: {
          type: "string",
          description: "Two-letter language code",
          default: "en"
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      },
      required: ["celex"]
    }
  },
  {
    name: "search_french_case_law",
    description:
      "Search French case law across Judilibre and Legifrance. In auto mode, judicial case law searches Judilibre first then falls back to Legifrance; administrative, constitutional, financial, and CNIL decisions use Legifrance directly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: {
          type: "string",
          enum: ["auto", "judilibre", "legifrance", "all"],
          default: "auto",
          description: "Source strategy. Use auto unless you need to force one source."
        },
        fallback: {
          type: "string",
          enum: ["when_empty", "when_no_exact_match", "never"],
          default: "when_no_exact_match",
          description:
            "Fallback policy from Judilibre to Legifrance for judicial searches."
        },
        case_law_family: {
          type: "string",
          enum: [
            "auto",
            "judicial",
            "administrative",
            "constitutional",
            "financial",
            "cnil"
          ],
          default: "auto",
          description:
            "Case-law family. administrative=CETAT, constitutional=CONSTIT, financial=JUFI."
        },
        fond: {
          type: "string",
          enum: ["auto", "JURI", "CETAT", "CONSTIT", "JUFI", "CNIL"],
          default: "auto",
          description: "Explicit Legifrance fund when source includes Legifrance."
        },
        query: {
          type: "string",
          description: "Optional text query."
        },
        case_number: {
          type: "string",
          description:
            "Optional case or decision number. Maps to NUM_AFFAIRE for JURI and NUM_DEC for CETAT/CONSTIT/JUFI."
        },
        ecli: {
          type: "string",
          description: "Optional ECLI exact filter where supported."
        },
        nor: {
          type: "string",
          description: "Optional NOR filter/search field for CONSTIT or CNIL."
        },
        operator: {
          type: "string",
          enum: ["or", "and", "exact"],
          default: "and",
          description: "Logical operator for query terms."
        },
        field: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional targeted content fields, e.g. expose, moyens, motivations, dispositif, annexes."
        },
        jurisdiction: {
          type: "array",
          items: { type: "string" },
          description: "Optional jurisdiction keys, e.g. cc, ca, tj, tcom."
        },
        chamber: {
          type: "array",
          items: { type: "string" },
          description: "Optional chamber keys, e.g. civ1, civ2, civ3, comm, soc, cr."
        },
        location: {
          type: "array",
          items: { type: "string" },
          description: "Optional court location keys from the location taxonomy."
        },
        theme: {
          type: "array",
          items: { type: "string" },
          description: "Optional theme keys from the theme taxonomy."
        },
        solution: {
          type: "array",
          items: { type: "string" },
          description: "Optional solution keys from the solution taxonomy."
        },
        type: {
          type: "array",
          items: { type: "string" },
          description: "Optional decision type keys from the type taxonomy."
        },
        publication: {
          type: "array",
          items: { type: "string" },
          description: "Optional publication level keys from the publication taxonomy."
        },
        date_start: {
          type: "string",
          description: "Optional ISO date or datetime lower bound, e.g. 2024-01-01."
        },
        date_end: {
          type: "string",
          description: "Optional ISO date or datetime upper bound, e.g. 2024-12-31."
        },
        sort: {
          type: "string",
          enum: [
            "score",
            "scorepub",
            "date",
            "PERTINENCE",
            "DATE_DESC",
            "DATE_ASC",
            "DATE_DECISION_DESC",
            "DATE_DECISION_ASC"
          ],
          default: "scorepub"
        },
        second_sort: {
          type: "string",
          enum: ["PERTINENCE", "DATE_DESC", "DATE_ASC", "DATE_DECISION_DESC", "DATE_DECISION_ASC"],
          description: "Optional Legifrance secondary sort."
        },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          default: "desc"
        },
        page: {
          type: "integer",
          minimum: 0,
          default: 0,
          description:
            "Zero-based page number exposed by this MCP. Converted to Legifrance's one-based pageNumber internally."
        },
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10
        },
        resolve_references: {
          type: "boolean",
          default: true,
          description: "Resolve taxonomy keys to labels when Judilibre supports it."
        },
        particular_interest: {
          type: "boolean",
          default: false,
          description: "Restrict results to decisions marked as having particular interest."
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      }
    }
  },
  {
    name: "get_french_case_law_decision",
    description:
      "Retrieve one French case-law decision from Judilibre or Legifrance, with selectable text scope. Can resolve Legifrance decisions by metadata when no id is known.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: {
          type: "string",
          enum: ["auto", "judilibre", "legifrance"],
          default: "auto"
        },
        fallback: {
          type: "string",
          enum: ["when_empty", "when_no_exact_match", "never"],
          default: "when_no_exact_match"
        },
        case_law_family: {
          type: "string",
          enum: [
            "auto",
            "judicial",
            "administrative",
            "constitutional",
            "financial",
            "cnil"
          ],
          default: "auto"
        },
        fond: {
          type: "string",
          enum: ["auto", "JURI", "CETAT", "CONSTIT", "JUFI", "CNIL"],
          default: "auto"
        },
        id: {
          type: "string",
          description:
            "Source decision id. Judilibre ids are 24-hex strings; Legifrance ids look like JURITEXT..., CETATEXT..., CONSTITEXT..., or CNILTEXT...."
        },
        case_number: {
          type: "string",
          description: "Optional case or decision number used to resolve a Legifrance decision if id is missing or Judilibre fails."
        },
        decision_date: {
          type: "string",
          description: "Optional ISO decision date YYYY-MM-DD used for exact fallback resolution."
        },
        ecli: {
          type: "string",
          description: "Optional ECLI used for exact fallback resolution."
        },
        nor: {
          type: "string",
          description: "Optional NOR used for CONSTIT/CNIL fallback resolution."
        },
        text_scope: {
          type: "string",
          enum: [
            "metadata",
            "full_text",
            "zones",
            "introduction",
            "expose",
            "moyens",
            "motivations",
            "dispositif",
            "annexes"
          ],
          default: "full_text",
          description:
            "Text to return. Use metadata for no text, zones for all structured sections, or one named zone."
        },
        resolve_references: {
          type: "boolean",
          default: true,
          description: "Resolve taxonomy keys to labels when Judilibre supports it."
        },
        query: {
          type: "string",
          description: "Optional query used by Judilibre to highlight matching terms."
        },
        operator: {
          type: "string",
          enum: ["or", "and", "exact"],
          default: "and",
          description: "Logical operator for optional query highlighting."
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      }
    }
  },
  {
    name: "get_french_case_law_taxonomy",
    description:
      "Retrieve unified French case-law taxonomy/schema metadata for Judilibre and Legifrance funds, including available Legifrance fields, filters, and sorts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: {
          type: "string",
          enum: ["auto", "judilibre", "legifrance", "all"],
          default: "auto"
        },
        case_law_family: {
          type: "string",
          enum: [
            "auto",
            "judicial",
            "administrative",
            "constitutional",
            "financial",
            "cnil"
          ],
          default: "auto"
        },
        fond: {
          type: "string",
          enum: ["auto", "JURI", "CETAT", "CONSTIT", "JUFI", "CNIL"],
          default: "auto"
        },
        taxonomy_id: {
          type: "string",
          description:
            "For Legifrance: fond, case_law_family, search_field, filter, sort. For Judilibre: jurisdiction, chamber, location, theme, solution, type, publication, field, zones, filetype."
        },
        key: {
          type: "string",
          description: "Optional Judilibre taxonomy key to resolve. Requires taxonomy_id."
        },
        value: {
          type: "string",
          description: "Optional Judilibre label to reverse-resolve. Requires taxonomy_id."
        },
        context_value: {
          type: "string",
          description:
            "Optional Judilibre context value for contextual taxonomies, e.g. cc for chamber or tj/ca for location."
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      }
    }
  },
  {
    name: "get_judilibre_taxonomy",
    description:
      "Deprecated alias for get_french_case_law_taxonomy with source='judilibre'. Retrieve Judilibre taxonomy values used by search filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taxonomy_id: {
          type: "string",
          description:
            "Optional taxonomy id, e.g. jurisdiction, chamber, location, theme, solution, type, publication, field, zones, filetype."
        },
        key: {
          type: "string",
          description: "Optional taxonomy key to resolve. Requires taxonomy_id."
        },
        value: {
          type: "string",
          description: "Optional label to reverse-resolve. Requires taxonomy_id."
        },
        context_value: {
          type: "string",
          description:
            "Optional context value for contextual taxonomies, e.g. cc for chamber or tj/ca for location."
        },
        timeout_ms: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description: "Optional timeout override"
        }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

async function runExpertSearch(args) {
  const query = sanitizeString(args.query, "query", 4000);
  const language = parseLanguage(args.language);
  const page = parsePage(args.page);
  const pageSize = parsePageSize(args.page_size, cli.maxPageSize);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);

  const data = await eurLexClient.search({
    query,
    language,
    page,
    pageSize,
    timeoutMs
  });

  return successResponse({
    query,
    language,
    total: data.total,
    page: data.page,
    page_size: data.page_size,
    results: data.results
  });
}

async function runGetDocumentByCelex(args) {
  const celex = parseCelex(args.celex);
  const language = parseLanguage(args.language);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);

  const data = await eurLexClient.search({
    query: `DN = ${celex}`,
    language,
    page: 1,
    pageSize: 1,
    timeoutMs
  });

  const document = data.results[0] || null;
  if (!document) {
    return errorResponse("Document not found", {
      code: "DOCUMENT_NOT_FOUND",
      celex
    });
  }

  return successResponse({
    celex,
    language,
    document
  });
}

async function runGetLegalText(args) {
  const celex = parseCelex(args.celex);
  const language = parseLanguage(args.language ?? "fr");
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);
  const scope = sanitizeString(args.scope ?? "article", "scope", 32).toLowerCase();
  const allowedScopes = new Set(["article", "recitals", "full_text"]);
  if (!allowedScopes.has(scope)) {
    throw new Error("Invalid scope: expected one of article, recitals, full_text");
  }

  if (scope === "article" && (args.article === undefined || args.article === null || args.article === "")) {
    throw new Error("Missing required field: article (when scope='article')");
  }

  const resolved = await eurLexClient.getDocumentStreamByCelex({
    celex,
    language,
    timeoutMs,
    preferredMimeTypes: ["application/xhtml+xml", "application/xml", "application/pdf"]
  });

  const contentType = resolved.stream.content_type || "";
  const body = resolved.stream.body || "";
  const isXhtml = contentType.includes("application/xhtml+xml") || body.includes('class="eli-subdivision"');
  if (!isXhtml) {
    return errorResponse("Unsupported content stream for text extraction", {
      code: "UNSUPPORTED_CONTENT_STREAM",
      celex,
      selected_manifestation: resolved.selected_manifestation,
      content_type: contentType
    });
  }

  if (scope === "article") {
    const article = sanitizeString(String(args.article), "article", 32);
    const extracted = extractArticleFromXhtml(body, article);
    if (!extracted) {
      return errorResponse("Article not found", {
        code: "ARTICLE_NOT_FOUND",
        celex,
        article
      });
    }

    return successResponse({
      celex,
      language,
      scope: "article",
      note: "Recitals are excluded for article-level extraction.",
      article: {
        requested: article,
        id: extracted.article_id,
        heading: extracted.heading,
        title: extracted.title,
        text: extracted.text
      },
      source: {
        eurlex_url: resolved.source_url,
        doc_url: resolved.stream.url,
        selected_manifestation: resolved.selected_manifestation
      }
    });
  }

  if (scope === "recitals") {
    const recitals = extractRecitalsFromXhtml(body);
    if (!recitals) {
      return errorResponse("Recitals section not found", {
        code: "RECITALS_NOT_FOUND",
        celex
      });
    }

    return successResponse({
      celex,
      language,
      scope: "recitals",
      recitals
    });
  }

  return successResponse({
    celex,
    language,
    scope: "full_text",
    text: extractFullTextFromXhtml(body)
  });
}

async function runGetDocumentToc(args) {
  const celex = parseCelex(args.celex);
  const language = parseLanguage(args.language ?? "fr");
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);

  const resolved = await eurLexClient.getDocumentStreamByCelex({
    celex,
    language,
    timeoutMs,
    preferredMimeTypes: ["application/xhtml+xml", "application/xml", "application/pdf"]
  });

  const contentType = resolved.stream.content_type || "";
  const body = resolved.stream.body || "";
  const isXhtml = contentType.includes("application/xhtml+xml") || body.includes('class="eli-subdivision"');
  if (!isXhtml) {
    return errorResponse("Unsupported content stream for TOC extraction", {
      code: "UNSUPPORTED_CONTENT_STREAM",
      celex,
      selected_manifestation: resolved.selected_manifestation,
      content_type: contentType
    });
  }

  const toc = extractTocFromXhtml(body);
  return successResponse({
    celex,
    language,
    toc
  });
}

async function runSearchEuCaseLaw(args) {
  const query = buildCaseLawExpertQuery(args);
  const language = parseLanguage(args.language);
  const page = parsePage(args.page);
  const pageSize = parsePageSize(args.page_size, cli.maxPageSize);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);

  const data = await eurLexClient.search({
    query,
    language,
    page,
    pageSize,
    timeoutMs
  });

  return successResponse({
    query,
    language,
    total: data.total,
    page: data.page,
    page_size: data.page_size,
    results: data.results
  });
}

async function runGetCaseLawByCelex(args) {
  const celex = parseCaseLawCelex(args.celex);
  const language = parseLanguage(args.language);
  const timeoutMs = parseTimeoutMs(args.timeout_ms, cli.defaultTimeoutMs);

  const data = await eurLexClient.search({
    query: `DN = ${celex}`,
    language,
    page: 1,
    pageSize: 1,
    timeoutMs
  });

  const document = data.results[0] || null;
  if (!document) {
    return errorResponse("Case-law document not found", {
      code: "CASE_LAW_DOCUMENT_NOT_FOUND",
      celex
    });
  }

  return successResponse({
    celex,
    language,
    document
  });
}

async function runSearchFrenchCaseLaw(args) {
  return frenchCaseLawRouter.search(args);
}

async function runGetFrenchCaseLawDecision(args) {
  return frenchCaseLawRouter.getDecision(args);
}

async function runGetFrenchCaseLawTaxonomy(args) {
  return frenchCaseLawRouter.taxonomy(args);
}

async function runGetJudilibreTaxonomy(args) {
  return frenchCaseLawRouter.taxonomy({
    ...args,
    source: "judilibre"
  });
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};

  try {
    logger.debug("Tool invocation", { toolName });

    if (toolName === "expert_search") {
      return toolTextPayload(await runExpertSearch(args));
    }

    if (toolName === "get_document_by_celex") {
      return toolTextPayload(await runGetDocumentByCelex(args));
    }

    if (toolName === "get_legal_text") {
      return toolTextPayload(await runGetLegalText(args));
    }

    if (toolName === "get_document_toc") {
      return toolTextPayload(await runGetDocumentToc(args));
    }

    if (toolName === "search_eu_case_law") {
      return toolTextPayload(await runSearchEuCaseLaw(args));
    }

    if (toolName === "get_case_law_by_celex") {
      return toolTextPayload(await runGetCaseLawByCelex(args));
    }

    if (toolName === "search_french_case_law") {
      return toolTextPayload(await runSearchFrenchCaseLaw(args));
    }

    if (toolName === "get_french_case_law_decision") {
      return toolTextPayload(await runGetFrenchCaseLawDecision(args));
    }

    if (toolName === "get_french_case_law_taxonomy") {
      return toolTextPayload(await runGetFrenchCaseLawTaxonomy(args));
    }

    if (toolName === "get_judilibre_taxonomy") {
      return toolTextPayload(await runGetJudilibreTaxonomy(args));
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unexpected server error";
    logger.error("Tool call failed", { toolName, message });

    return toolTextPayload(
      errorResponse(message, {
        code: "TOOL_EXECUTION_ERROR",
        tool: toolName
      })
    );
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("EUR-Lex MCP server started", {
    transport: "stdio",
    logLevel: logger.level
  });
}

main().catch((error) => {
  logger.error("Fatal startup error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
