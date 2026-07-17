import type { PayloadHandler } from 'payload'
import { convertRichText } from './richtext.js'
import { lexicalConverter } from './lexical.js'
import { applyRelationDefaults, resolvePolymorphicValues } from './relations.js'
import type { PublishRequest, PublishResponse } from './types.js'

function resolveUrl(
  req: Parameters<PayloadHandler>[0],
  slug: string,
  doc: Record<string, unknown>,
): string {
  const base = (req.payload.config.serverURL ?? '').replace(/\/+$/, '')
  const collection = req.payload.config.collections.find((c) => c.slug === slug)
  const preview = collection?.admin?.preview
  if (typeof preview === 'function') {
    try {
      const u = preview(doc, { locale: req.locale ?? '', req, token: '' })
      if (typeof u === 'string' && u) return u
    } catch {
      // fall through to the serverURL convention
    }
  }
  return `${base}/${(doc.slug as string) ?? doc.id}`
}

// POST /api/content-ingest/publish — idempotent upsert into the plugin's configured target collection.
// richText slots arrive as markdown and are converted here; relationship defaults are applied
// server-side (the app never sends a collection or fills relationships).
export function makePublishHandler(opts: {
  targetCollection: string
  relationDefaults?: Record<string, string>
}): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: PublishRequest
    try {
      body = (await req.json!()) as PublishRequest
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const slug = opts.targetCollection
    const { slug: docSlug, externalId, status, data } = body
    if (!docSlug || !data) {
      return Response.json({ error: 'slug and data are required' }, { status: 422 })
    }

    const collection = req.payload.config.collections.find((c) => c.slug === slug)
    if (!collection) return Response.json({ error: `Unknown target collection: ${slug}` }, { status: 404 })

    // The `status` request field is the only authority on draft/published — a `_status` smuggled
    // inside data would silently escalate a draft save to published-level validation.
    delete (data as Record<string, unknown>)._status

    // markdown slots → Lexical (each field's own editorConfig), polymorphic "<collection>:<id>"
    // picks → { relationTo, value }, then fill relationship defaults.
    const converted = convertRichText(collection.fields, data, lexicalConverter)
    const resolved = resolvePolymorphicValues(collection.fields as unknown[], converted)
    const withDefaults = applyRelationDefaults(resolved, opts.relationDefaults)

    const hasDrafts = Boolean(collection.versions && (collection.versions as { drafts?: unknown }).drafts)
    const isDraft = status === 'draft'
    const docData =
      hasDrafts && !isDraft ? { ...withDefaults, _status: 'published' } : { ...withDefaults }
    const draftOpt = hasDrafts ? { draft: isDraft } : {}

    try {
      const existing = externalId
        ? await req.payload.findByID({ collection: slug, id: externalId, depth: 0 }).catch(() => null)
        : (
            await req.payload.find({
              collection: slug,
              where: { slug: { equals: docSlug } },
              limit: 1,
              depth: 0,
            })
          ).docs[0]

      const saved = existing
        ? await req.payload.update({ collection: slug, id: existing.id, data: docData, ...draftOpt, req })
        : await req.payload.create({ collection: slug, data: docData, ...draftOpt, req })

      const res: PublishResponse = {
        externalId: String(saved.id),
        url: resolveUrl(req, slug, saved as Record<string, unknown>),
      }
      return Response.json(res)
    } catch (err) {
      req.payload.logger?.error?.(err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Publish failed' },
        { status: 500 },
      )
    }
  }
}
