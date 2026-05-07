# EUR-Lex MCPB Bundle

Production-oriented MCP Bundle (MCPB) for EUR-Lex expert search and French case-law lookup using a local Node.js MCP server (`@modelcontextprotocol/sdk`) over stdio.

## What this includes

- MCPB-compliant `manifest.json` (manifest v0.3)
- Node MCP server at `server/index.js`
- Defensive input validation and bounded limits
- Timeout management with request abortion
- Automatic retry/backoff for transient EUR-Lex failures such as idle-interval throttling
- Judilibre and Legifrance sandbox access through PISTE credentials
- Search, decision retrieval, and taxonomy/schema lookup for French judicial, administrative, constitutional, financial, and CNIL case law
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

### `search_eu_case_law`
Searches EUR-Lex EU case-law only by forcing the CELEX sector-6 filter.

Inputs:
- `text` (optional string): full-text words or phrase
- `title` (optional string): title words or phrase
- `year` (optional integer): CELEX year filter, e.g. `2024`
- `celex` (optional string): exact sector-6 CELEX identifier; if provided, other filters are ignored
- `expert_query` (optional string): EUR-Lex expert query fragment ANDed with the case-law filter
- `language` (optional 2-letter code, default `en`)
- `page` (optional integer, default `1`)
- `page_size` (optional integer, default `10`, bounded by config)
- `timeout_ms` (optional integer)

Important behavior:
- The generated query always scopes broad searches to `DN = 6*` or `DN = 6YYYY*`.
- `expert_query` is for advanced EUR-Lex expert syntax, for example `DD >= 01/01/2020`.
- Use `expert_search` directly when you need complete control over the EUR-Lex query.

Examples:
- Find the Mousse case by title: `title="Mousse"`
- Find case-law from a CELEX year: `year=2023`
- Find a known case-law document: `celex="62023CJ0394"`

### `get_case_law_by_celex`
Retrieves one EU case-law document by exact CELEX identifier and rejects non-sector-6 CELEX values.

Inputs:
- `celex` (required string, validated as sector 6, e.g. `62019CJ0311`)
- `language` (optional 2-letter code, default `en`)
- `timeout_ms` (optional integer)

Example:
- `celex="62023CJ0394"` retrieves the Court judgment in case C-394/23, Mousse / CNIL and SNCF Connect.

### `search_french_case_law`
Searches French case law across Judilibre and Legifrance.

Routing:
- `judicial`: Judilibre first, then Legifrance `JURI` when fallback is needed.
- `administrative`: Legifrance `CETAT`.
- `constitutional`: Legifrance `CONSTIT`.
- `financial`: Legifrance `JUFI`.
- `cnil`: Legifrance `CNIL`.

Inputs:
- `source` (optional enum: `auto`, `judilibre`, `legifrance`, `all`; default `auto`)
- `fallback` (optional enum: `when_empty`, `when_no_exact_match`, `never`; default `when_no_exact_match`)
- `case_law_family` (optional enum: `auto`, `judicial`, `administrative`, `constitutional`, `financial`, `cnil`; default `auto`)
- `fond` (optional enum: `auto`, `JURI`, `CETAT`, `CONSTIT`, `JUFI`, `CNIL`; default `auto`)
- `query` (optional string): text query
- `case_number` (optional string): case or decision number
- `ecli` (optional string): exact ECLI filter where supported
- `nor` (optional string): NOR search/filter for `CONSTIT` or `CNIL`
- `operator` (optional enum: `or`, `and`, `exact`; default `and`)
- `field` (optional string array): targeted content fields, e.g. `motivations`, `dispositif`
- `jurisdiction` (optional string array): e.g. `cc`, `ca`, `tj`, `tcom`
- `chamber` (optional string array): e.g. `civ1`, `comm`, `soc`, `cr`
- `location`, `theme`, `solution`, `type`, `publication` (optional string arrays): taxonomy keys
- `date_start`, `date_end` (optional ISO date strings for Legifrance; Judilibre also accepts datetimes)
- `sort` (optional enum: Judilibre `score`, `scorepub`, `date`; Legifrance `PERTINENCE`, `DATE_DESC`, `DATE_ASC`)
- `second_sort` (optional Legifrance secondary sort)
- `order` (optional enum: `asc`, `desc`; default `desc`)
- `page` (optional integer, default `0`; exposed as zero-based and converted for Legifrance internally)
- `page_size` (optional integer, default `10`, max `50`)
- `resolve_references` (optional boolean, default `true`)
- `particular_interest` (optional boolean, default `false`)
- `timeout_ms` (optional integer)

Output is compact and source-aware. Each result includes `source`, `source_id`, `case_law_family`, and, for Legifrance results, `fond`.

### `get_french_case_law_decision`
Retrieves one French case-law decision from Judilibre or Legifrance.

Inputs:
- `id` (optional string): Judilibre 24-hex id or Legifrance text id such as `JURITEXT...`, `CETATEXT...`, `CONSTITEXT...`, `CNILTEXT...`
- `source` (optional enum: `auto`, `judilibre`, `legifrance`; default `auto`)
- `fallback` (optional enum: `when_empty`, `when_no_exact_match`, `never`; default `when_no_exact_match`)
- `case_law_family` (optional enum: `auto`, `judicial`, `administrative`, `constitutional`, `financial`, `cnil`; default `auto`)
- `fond` (optional enum: `auto`, `JURI`, `CETAT`, `CONSTIT`, `JUFI`, `CNIL`; default `auto`)
- `case_number`, `decision_date`, `ecli`, `nor` (optional): used to resolve a Legifrance id when no id is known or Judilibre fallback is needed
- `text_scope` (optional enum, default `full_text`):
  - `metadata`: metadata only
  - `full_text`: full decision text
  - `zones`, `introduction`, `expose`, `moyens`, `motivations`, `dispositif`, `annexes`: Judilibre structured text scopes when available
- `resolve_references` (optional boolean, default `true`)
- `query` (optional string): terms to highlight when supported by the source
- `operator` (optional enum: `or`, `and`, `exact`; default `and`)
- `timeout_ms` (optional integer)

### `get_french_case_law_taxonomy`
Retrieves unified French case-law taxonomy and schema metadata.

Inputs:
- `source` (optional enum: `auto`, `judilibre`, `legifrance`, `all`; default `auto`)
- `case_law_family` (optional enum: `auto`, `judicial`, `administrative`, `constitutional`, `financial`, `cnil`; default `auto`)
- `fond` (optional enum: `auto`, `JURI`, `CETAT`, `CONSTIT`, `JUFI`, `CNIL`; default `auto`)
- `taxonomy_id`:
  - Legifrance: `fond`, `case_law_family`, `search_field`, `filter`, `sort`
  - Judilibre: `jurisdiction`, `chamber`, `location`, `theme`, `solution`, `type`, `publication`, `field`, `zones`, `filetype`
- `key`, `value`, `context_value`: Judilibre passthrough parameters where applicable
- `timeout_ms` (optional integer)

### `get_judilibre_taxonomy`
Deprecated alias for `get_french_case_law_taxonomy` with `source="judilibre"`.

## Quick start

```bash
npm install
cp .env.example .env
# Set EURLEX_USERNAME / EURLEX_PASSWORD in your environment.
# Judilibre can use PISTE_SANDBOX_API_KEY as KeyId.
# Legifrance requires PISTE_SANDBOX_CLIENT_ID / PISTE_SANDBOX_CLIENT_SECRET for OAuth.
npm run check
```

Run server manually (stdio):

```bash
EURLEX_USERNAME="..." EURLEX_PASSWORD="..." PISTE_SANDBOX_API_KEY="..." PISTE_SANDBOX_CLIENT_ID="..." PISTE_SANDBOX_CLIENT_SECRET="..." node server/index.js
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
- Judilibre and Legifrance are currently wired to PISTE sandbox endpoints only. Production credentials/endpoints should be added after sandbox validation.
- EUR-Lex SOAP requests are retried automatically for transient failures: idle-interval throttling, timeouts, network fetch failures, and HTTP `429`, `503`, or `504`.
- Retry delays are progressive: `2500ms`, `7500ms`, then `15000ms`.
- Non-transient errors, including invalid expert query syntax, are not retried.
- Responses are normalized into a stable `{ ok, data, error }` contract.
