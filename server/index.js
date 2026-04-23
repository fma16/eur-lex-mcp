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

let eurLexClient;
try {
  eurLexClient = new EurLexSoapClient({
    username: requiredEnv("EURLEX_USERNAME"),
    password: requiredEnv("EURLEX_PASSWORD"),
    allowInsecureHttp: parseBoolean(process.env.ALLOW_INSECURE_HTTP, false),
    logger
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
