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

### `get_legal_text`
Retrieves legal text from a CELEX document with three scopes:
- `article` (default): returns one targeted article and excludes recitals.
- `recitals`: returns the preamble/recitals section.
- `full_text`: returns the full text.

Inputs:
- `celex` (required string, validated)
- `language` (optional 2-letter code, default `fr`)
- `scope` (optional enum: `article`, `recitals`, `full_text`; default `article`)
- `article` (required when `scope=article`, e.g. `8`, `article 8`, `premier`)
- `timeout_ms` (optional integer)

Important behavior:
- In `article` scope, recitals are intentionally excluded. Extraction starts from the article structure (`art_*`) in the enacting terms.
- To access recitals explicitly, call the same tool with `scope=recitals`.
- To access the complete text (including recitals and enacting terms), call with `scope=full_text`.

### `get_document_toc`
Retrieves a structured table of contents so the LLM can target later lookups.

Inputs:
- `celex` (required string, validated)
- `language` (optional 2-letter code, default `fr`)
- `timeout_ms` (optional integer)

Output includes numbered entries and titles for structural levels when present:
- parts/titles/chapters/sections/subsections/articles
- each entry carries its identifier, numbering label, and title

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
