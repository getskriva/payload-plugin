import type { Config, Plugin } from 'payload'
import { makeManifestHandler } from './manifest.js'
import { makeSchemaHandler } from './schema.js'
import { makePublishHandler } from './publish.js'

export type { FieldNode, SchemaResponse, ManifestResponse, PublishRequest, PublishResponse } from './types.js'
export { serializeFields } from './walker.js'

export interface ContentIngestOptions {
  // The collection the app publishes into. REQUIRED — owned here, not chosen by the app.
  targetCollection: string
  // Collections that hold media/uploads. Relationship/upload fields to these are skipped (text-only).
  mediaCollections: string[]
  // The API-key auth collection slug the app authenticates with. Default 'users' — the plugin
  // enables useAPIKey on it (or creates it if missing).
  authCollection?: string
  // Which block slugs the AI may compose with; omit = all blocks of the target.
  blockAllowlist?: string[]
  // Fixed ids for relationship fields the AI never fills (fieldPath → docId), applied at publish.
  relationDefaults?: Record<string, string>
}

const ROOT = '/content-ingest'

// Payload 3 plugin: enables API-key auth on the chosen collection and registers the
// manifest/schema/publish endpoints the Skriva app publishes through. Curried per convention.
export const contentIngest =
  (options: ContentIngestOptions): Plugin =>
  (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }
    const authCollection = options.authCollection ?? 'users'

    // Ensure the auth collection has useAPIKey. Enable it in place on an existing collection
    // (e.g. the default `users`), or create a dedicated key-only collection if it doesn't exist.
    const collections = [...(config.collections ?? [])]
    const existing = collections.find((c) => c.slug === authCollection)
    if (existing) {
      const prev = typeof existing.auth === 'object' ? existing.auth : {}
      existing.auth = { ...prev, useAPIKey: true }
    } else {
      collections.push({
        slug: authCollection,
        auth: { useAPIKey: true, disableLocalStrategy: true },
        admin: { useAsTitle: 'label', group: 'System' },
        fields: [{ name: 'label', type: 'text', required: true }],
      })
    }
    config.collections = collections

    config.endpoints = [
      ...(config.endpoints ?? []),
      {
        path: `${ROOT}/manifest`,
        method: 'get',
        handler: makeManifestHandler({ targetCollection: options.targetCollection, authCollection }),
      },
      {
        path: `${ROOT}/schema`,
        method: 'get',
        handler: makeSchemaHandler({
          targetCollection: options.targetCollection,
          mediaCollections: options.mediaCollections,
          blockAllowlist: options.blockAllowlist,
        }),
      },
      {
        path: `${ROOT}/publish`,
        method: 'post',
        handler: makePublishHandler({
          targetCollection: options.targetCollection,
          relationDefaults: options.relationDefaults,
        }),
      },
    ]

    return config
  }

export default contentIngest
