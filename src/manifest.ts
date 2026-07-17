import type { PayloadHandler } from 'payload'
import type { ManifestResponse } from './types.js'

function singularLabel(labels: unknown): string | undefined {
  if (labels && typeof labels === 'object' && 'singular' in labels) {
    const s = (labels as { singular?: unknown }).singular
    if (typeof s === 'string') return s
  }
  return undefined
}

// GET /api/content-ingest/manifest — health check + the configured publish target. The app uses this
// to confirm the plugin is installed and to discover which collection it publishes into.
export function makeManifestHandler(opts: {
  targetCollection: string
  authCollection: string
}): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const target = req.payload.config.collections.find((c) => c.slug === opts.targetCollection)
    const body: ManifestResponse = {
      ok: true,
      targetCollection: opts.targetCollection,
      label: singularLabel(target?.labels),
      authCollection: opts.authCollection,
    }
    return Response.json(body)
  }
}
