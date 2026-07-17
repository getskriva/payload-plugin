import type { FieldNode } from './types.js'
import { transformFieldData } from './richtext.js'

// Looks up the candidate documents for a relationship target. Returns prepared {value,label}
// options + the total count (so the caller can apply the cap). The schema handler builds this from
// req.payload.find; tests inject a fake. label = the target collection's admin.useAsTitle field.
export type RelationFinder = (
  collection: string,
) => Promise<{ options: { value: string; label: string }[]; total: number }>

// Enriches a serialized field tree: for each NON-media relationship, fetch the existing docs
// as options so the AI can pick a real id. Caps at `cap` (over-cap → cappedOut, field skipped) and
// leaves media/upload fields untouched. Polymorphic (multi-target) relationships get candidates
// from EVERY target, with values prefixed "<collection>:<id>" — publish unwraps them back to
// Payload's { relationTo, value } shape (resolvePolymorphicValues).
export async function enrichRelations(
  fields: FieldNode[],
  find: RelationFinder,
  cap: number,
): Promise<FieldNode[]> {
  const out: FieldNode[] = []

  for (const field of fields) {
    const node: FieldNode = { ...field }

    // Recurse into containers first.
    if (node.fields) node.fields = await enrichRelations(node.fields, find, cap)
    if (node.blocks) {
      node.blocks = await Promise.all(
        node.blocks.map(async (b) => ({ ...b, fields: await enrichRelations(b.fields, find, cap) })),
      )
    }

    if (node.type === 'relationship' && !node.isMedia) {
      if (Array.isArray(node.relationTo)) {
        node.polymorphic = true
        const targets = node.relationTo.filter((t) => typeof t === 'string')
        let total = 0
        const options: { value: string; label: string }[] = []
        for (const target of targets) {
          const r = await find(target)
          total += r.total
          options.push(...r.options.map((o) => ({ value: `${target}:${o.value}`, label: o.label })))
        }
        if (total > cap) {
          node.cappedOut = true
        } else if (options.length) {
          node.relationOptions = options
        }
      } else if (node.relationTo) {
        const { options, total } = await find(node.relationTo)
        if (total > cap) {
          node.cappedOut = true
        } else {
          node.relationOptions = options
        }
      }
    }

    out.push(node)
  }

  return out
}

// Set per-site relationship defaults (fieldPath → docId) onto the publish data before create. The
// plugin owns these (configured in payload.config); dotted paths create nested objects.
export function applyRelationDefaults(
  data: Record<string, unknown>,
  defaults: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!defaults) return data
  const out: Record<string, unknown> = { ...data }
  for (const [key, value] of Object.entries(defaults)) {
    const parts = key.split('.')
    let cursor = out
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      const next = cursor[part]
      cursor[part] = next && typeof next === 'object' ? { ...(next as object) } : {}
      cursor = cursor[part] as Record<string, unknown>
    }
    cursor[parts[parts.length - 1]!] = value
  }
  return out
}

// Payload ids are numbers on SQL adapters and strings on Mongo — restore the numeric type so the
// value round-trips through validation.
function coerceId(id: string): string | number {
  return /^\d+$/.test(id) ? Number(id) : id
}

// Unwrap AI-emitted polymorphic relationship values back to Payload's storage shape: the schema
// exposed them as "<collection>:<id>" enum strings; Payload wants { relationTo, value }. Walks the
// RAW field config in parallel with the data (groups/arrays/blocks/tabs). hasMany → array of pairs.
export function resolvePolymorphicValues(
  fields: unknown[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const unwrap = (v: unknown): unknown => {
    if (typeof v !== 'string') return v
    const sep = v.indexOf(':')
    if (sep <= 0) return v
    return { relationTo: v.slice(0, sep), value: coerceId(v.slice(sep + 1)) }
  }
  return transformFieldData(fields as Record<string, unknown>[], data, (field, value) => {
    if (field.type !== 'relationship' || !Array.isArray(field.relationTo) || value == null) {
      return undefined
    }
    return Array.isArray(value) ? value.map(unwrap) : unwrap(value)
  })
}

// Restrict the block palette to an allowlist (per-site, plugin-configured). Recurses; undefined
// allowlist = no filtering.
export function filterBlocks(fields: FieldNode[], allowlist: string[] | undefined): FieldNode[] {
  if (!allowlist?.length) return fields
  return fields.map((f) => {
    const node: FieldNode = { ...f }
    if (node.blocks) {
      node.blocks = node.blocks
        .filter((b) => allowlist.includes(b.slug))
        .map((b) => ({ ...b, fields: filterBlocks(b.fields, allowlist) }))
    }
    if (node.fields) node.fields = filterBlocks(node.fields, allowlist)
    return node
  })
}
