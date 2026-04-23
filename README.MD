# EUR-Lex MCPB Bundle

Production-oriented MCP Bundle (MCPB) for EUR-Lex expert search using a local Node.js MCP server (`@modelcontextprotocol/sdk`) over stdio.

## What this includes

- MCPB-compliant `manifest.json` (manifest v0.3)
- Node MCP server at `server/index.js`
- Defensive input validation and bounded limits
- Timeout management with request abortion
- Structured, consistent JSON tool payloads
- Logging with configurable log levels
- Validation/test scripts for quick host-readiness checks

## Tools

### `expert_search`
Runs an EUR-Lex expert query and returns normalized results.

Inputs:
- `query` (required string)
- `language` (optional 2-letter code, default `en`)
- `page` (optional integer, default `1`)
- `page_size` (optional integer, default `10`, bounded by config)
- `timeout_ms` (optional integer)

### `get_document_by_celex`
Retrieves one document by exact CELEX identifier.

Inputs:
- `celex` (required string, validated)
- `language` (optional 2-letter code, default `en`)
- `timeout_ms` (optional integer)

## Quick start

```bash
npm install
cp .env.example .env
# Set EURLEX_USERNAME / EURLEX_PASSWORD in your environment
npm run check
```

Run server manually (stdio):

```bash
EURLEX_USERNAME="..." EURLEX_PASSWORD="..." node server/index.js
```

## MCPB packaging

```bash
npm install -g @anthropic-ai/mcpb
mcpb pack .
```

See full setup and verification guide in `docs/MCPB_SETUP.md`.

## Security and reliability notes

- Credentials are configured via MCPB `user_config` as sensitive fields.
- No credentials are logged.
- Input schemas and runtime validators reject malformed values.
- Requests use explicit per-call timeout with `AbortController`.
- Responses are normalized into a stable `{ ok, data, error }` contract.
