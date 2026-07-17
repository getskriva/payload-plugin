# @skriva/payload-plugin

[![npm version](https://img.shields.io/npm/v/@skriva/payload-plugin)](https://www.npmjs.com/package/@skriva/payload-plugin)
[![CI](https://github.com/getskriva/payload-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/getskriva/payload-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Payload CMS 3 plugin that lets [Skriva](https://skriva.io) publish generated articles into any
collection of any Payload site. Skriva discovers your collection's schema at runtime — no hardcoded
field mapping, and Skriva never needs to know your content model up front.

## Requirements

- Payload `^3.0.0` with `@payloadcms/richtext-lexical` (peer dependencies — already present in any Payload 3 project)
- Node.js 18+

## Install

```bash
pnpm add @skriva/payload-plugin
# or: npm install @skriva/payload-plugin
```

```ts
// payload.config.ts
import { contentIngest } from '@skriva/payload-plugin'

export default buildConfig({
  // ...
  plugins: [
    contentIngest({
      targetCollection: 'posts',       // where to publish (required)
      mediaCollections: ['media'],     // relation/upload fields to these are skipped (text-only v1)
      // authCollection: 'users',      // default; useAPIKey is enabled on it
      // blockAllowlist: ['hero', 'content', 'cta'], // for block-based collections
      // relationDefaults: { author: '<docId>' },    // fills relations the AI can't pick
    }),
  ],
})
```

## Connect to Skriva

1. In the Payload admin, open a document in your `authCollection` (default `users`) and enable its
   **API key**.
2. In Skriva, open your site's **Connection** page, choose destination "Payload", and paste the
   site's **base URL** and the **API key**.
3. Hit "Test connection" — Skriva reads `/manifest` and confirms the publish target.

> **Note:** rotating `PAYLOAD_SECRET` invalidates all Payload API keys — regenerate the key and
> update it in Skriva afterwards.

## How it works

All configuration that is shaped like your CMS (target collection, media collections, block
allowlist, relationship defaults) lives here, in your `payload.config`. Skriva only stores a base
URL and an API key, sends markdown plus scalar values, and the plugin owns the conversion to
Lexical.

The plugin registers three endpoints under `/api/content-ingest`:

| Endpoint | Purpose |
| --- | --- |
| `GET /manifest` | Health check + the configured publish target (drives "Test connection"). |
| `GET /schema` | The target collection's field tree as JSON. Relationship/upload fields pointing at `mediaCollections` are flagged `isMedia`; other relations are enriched with candidate options (cap 100); the block palette is restricted to `blockAllowlist`. |
| `POST /publish` | Idempotent upsert into the target collection. richText slots arrive as **markdown** and are converted to Lexical with each field's own editor config (`convertMarkdownToLexical`); relationship defaults are filled server-side. Drafts supported via `_status` / `draft: true`. |

## Develop

```bash
pnpm install   # devDeps only; peers are not auto-installed
pnpm test      # vitest — covers the pure schema walker
pnpm build     # tsc → dist
```

The pure `serializeFields` walker is unit-tested here; the endpoint handlers and markdown→Lexical
conversion are integration-tested against a real Payload instance.

## License

[MIT](LICENSE)
