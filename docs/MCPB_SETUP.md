# MCPB Setup and Validation

## 1) Install dependencies

```bash
npm install
```

## 2) Local dry run (stdio)

```bash
EURLEX_USERNAME="..." EURLEX_PASSWORD="..." node server/index.js --log-level=debug
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
