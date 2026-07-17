import type { PayloadHandler } from 'payload'
import { serializeFields, type RawField } from './walker.js'
import { enrichRelations, filterBlocks, type RelationFinder } from './relations.js'
import { constrainByConditions, type ConditionEvaluator, type RawField as RawCondField } from './conditions.js'
import type { SchemaResponse } from './types.js'

// Cap on relationship candidates exposed to the AI: over this, the field is skipped.
const RELATION_CAP = 100

function singularLabel(labels: unknown): string | undefined {
  if (labels && typeof labels === 'object' && 'singular' in labels) {
    const s = (labels as { singular?: unknown }).singular
    if (typeof s === 'string') return s
  }
  return undefined
}

// GET /api/content-ingest/schema — the configured target collection's field tree as JSON.
// Serialized via the whitelist-walker (never JSON.stringify(config): functions + circular refs),
// media-classified, relation-enriched (candidates, cap 100), and block-palette restricted to the
// plugin's allowlist.
export function makeSchemaHandler(opts: {
  targetCollection: string
  mediaCollections: string[]
  blockAllowlist?: string[]
}): PayloadHandler {
  return async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const collection = req.payload.config.collections.find((c) => c.slug === opts.targetCollection)
    if (!collection) {
      return Response.json({ error: `Unknown target collection: ${opts.targetCollection}` }, { status: 404 })
    }

    const find: RelationFinder = async (target) => {
      const targetConfig = req.payload.config.collections.find((c) => c.slug === target)
      const useAsTitle = targetConfig?.admin?.useAsTitle ?? 'id'
      const res = await req.payload.find({ collection: target, depth: 0, limit: RELATION_CAP + 1, pagination: true })
      return {
        total: res.totalDocs,
        options: res.docs.map((d) => {
          const doc = d as Record<string, unknown>
          return { value: String(doc.id), label: String(doc[useAsTitle] ?? doc.id) }
        }),
      }
    }

    const walked = serializeFields(collection.fields as unknown as RawField[], opts.mediaCollections)
    const enriched = await enrichRelations(walked, find, RELATION_CAP)
    const fields = filterBlocks(enriched, opts.blockAllowlist)

    // Condition-aware constraining: use Payload's own admin.condition functions to restrict
    // option-driven fields to values that avoid unfillable (media) requirements, or mark
    // genuinely-unsatisfiable groups/blocks.
    const evalCondition: ConditionEvaluator = (condition, siblingData) => {
      try {
        return Boolean(
          condition(siblingData, siblingData, {
            blockData: siblingData,
            data: siblingData,
            operation: 'create',
            path: [],
            siblingData,
            user: req.user,
          }),
        )
      } catch {
        return true // conservative: assume the field is shown/required
      }
    }
    constrainByConditions(
      collection.fields as unknown as RawCondField[],
      fields,
      opts.mediaCollections,
      evalCondition,
    )

    const body: SchemaResponse = {
      slug: collection.slug,
      label: singularLabel(collection.labels),
      useAsTitle: collection.admin?.useAsTitle,
      fields,
    }
    return Response.json(body)
  }
}
