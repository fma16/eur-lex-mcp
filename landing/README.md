# EUR-Lex MCP Landing

Static Astro landing page for Cloudflare Pages.

## Local development

```bash
npm install
npm run dev
```

## Static build

```bash
npm run build
```

Astro writes the static site to `dist/`.

## Cloudflare Pages

Use these settings:

- Root directory: `landing`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22.12.0` or newer
- Environment variable: `ASTRO_TELEMETRY_DISABLED=1`

Keep MCP, dashboard, and admin endpoints on the container-backed service. If the same domain is used,
route only those dynamic paths to the container with Cloudflare routing rules, for example `/mcp/*`,
`/dashboard/*`, and `/admin/*`.
