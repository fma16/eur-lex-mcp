# MCPB Setup and Validation

## 1) Install dependencies

```bash
npm install
```

## 2) Local dry run (stdio)

```bash
EURLEX_USERNAME="..." \
EURLEX_PASSWORD="..." \
PISTE_SANDBOX_API_KEY="..." \
node server/index.js --log-level=debug
```

The process will wait for MCP stdio messages from a host client.

## 3) Validate bundle metadata and tests

```bash
npm run check
```

This executes:

- `npm run check:manifest`: verifies required MCPB manifest fields
- `npm run check:server`: validates parsing/response helpers and input constraints

## 4) Pack as `.mcpb`

Install MCPB CLI and package:

```bash
npm install -g @anthropic-ai/mcpb
mcpb pack .
```

Expected output: a `.mcpb` archive containing `manifest.json`, `server/`, `package.json`, and `node_modules`.

## 5) Host integration check

1. Open the `.mcpb` in a compatible MCPB host.
2. Confirm install UI asks for:
   - EUR-Lex username
   - EUR-Lex password
   - PISTE sandbox API key
   - optional PISTE sandbox client id/client secret fallback
   - optional timeout/log settings
3. Invoke `expert_search` with:

```json
{
  "query": "DN = 32016R0679",
  "language": "en",
  "page": 1,
  "page_size": 5
}
```

Tool response is always a JSON string with shape:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

or

```json
{
  "ok": false,
  "data": null,
  "error": {
    "message": "...",
    "code": "..."
  }
}
```

Judilibre sandbox smoke test:

```json
{
  "query": "responsabilite contractuelle",
  "jurisdiction": ["cc"],
  "page": 0,
  "page_size": 5,
  "resolve_references": true
}
```

Then call `get_french_case_law_decision` with a returned decision `id` and a bounded scope such as:

```json
{
  "id": "...",
  "text_scope": "motivations",
  "resolve_references": true
}
```
