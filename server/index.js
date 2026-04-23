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
  parseBoolean,
  parseCelex,
  parseLanguage,
  parsePage,
  parsePageSize,
  parseTimeoutMs,
  sanitizeString
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
    description: "Run an EUR-Lex expert query and return normalized results",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "EUR-Lex expert query syntax"
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
    query: `DN = '${celex}'`,
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
